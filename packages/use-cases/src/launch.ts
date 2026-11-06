import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { Selection } from "@cedarloom/accounts";
import type { AgentEvent, AgentRuntime, Launch } from "@cedarloom/agent-contracts";
import type { Account, AccountRegistry, Agent, LaunchRecord, Result } from "@cedarloom/contracts";
import { deniedPaths, GITHUB_DOMAINS, ghProbe, readResult, resultPrompt, workerEnv } from "@cedarloom/orchestration";
import { type AccountRequest, chooseAccount, loadRegistry } from "./accounts.ts";
import { checkedVersions, recordUsage } from "./agents.ts";
import { withStore } from "./use-cases.ts";

/** How many workers run on one account at once: two per Claude Code account, one per Codex home. */
export const MAX_CONCURRENT: Readonly<Record<Agent, number>> = { claude: 2, codex: 1 };

const BUSY_TRIES = 3;

// Runs `work` again while another CedarLoom process holds the store: three tries, a second apart.
const retryBusy = async <T>(work: () => Result<T>): Promise<Result<T>> => {
  let result = work();
  for (let tries = 1; tries < BUSY_TRIES && !result.ok && result.finding.code === "store.busy"; tries += 1) {
    await setTimeout(1000);
    result = work();
  }
  return result;
};

/** What the launcher decided for one worker; the adapter's launch options take these as they are. */
export type Decided = Pick<
  Launch,
  "home" | "prompt" | "env" | "tmpDir" | "resultFile" | "denyRead" | "allowedDomains" | "verifiedVersions"
> & { readonly runId: string; readonly account: Account };

export interface WorkerRequest<L extends Launch> extends AccountRequest {
  /** The task's prompt; the launcher adds what it says about the result file. */
  readonly prompt: string;
  /** The fine-grained token of the worker's access profile; null when it has none. */
  readonly ghToken: string | null;
  readonly runtime: AgentRuntime<L>;
  /** The adapter's launch options: the decided values with the phase's model and settings and the working folder. */
  readonly launch: (decided: Decided) => L;
}

export interface LaunchHost {
  /** The launcher's environment; the worker's is built from it by allowlist. */
  readonly parent: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  /** The user's home folder. */
  readonly home: string;
  /** The gh command of the token probe; gh on the worker's PATH when unset. */
  readonly gh?: readonly [string, ...string[]];
}

type Verdict = NonNullable<LaunchRecord["verdict"]>;

export type WorkerOutcome =
  | { readonly kind: "no-account"; readonly reason: Extract<Selection, { ok: false }>["reason"] }
  | {
      readonly kind: "finished";
      readonly runId: string;
      readonly account: string;
      /** `failed` without a valid result of this run, or when the CLI did not exit with 0. */
      readonly verdict: Verdict;
      readonly summary: string | null;
      readonly exit: Extract<AgentEvent, { type: "exit" }> | null;
    };

type Lease = Omit<LaunchRecord, "finishedAt" | "verdict">;

// The worker's folder in the state folder, named short for the socket path limit: its temporary folder, gh's empty
// configuration, and the folder of its result file, the one folder outside the working folder it may write.
// shortcut: the folders stay after the run; remove them with a sweep of finished launches once they pile up.
const workerFolders = (state: string, runId: string) => {
  const dir = join(state, "workers", runId.slice(0, 8));
  const folders = { tmpDir: join(dir, "tmp"), ghConfigDir: join(dir, "gh"), out: join(dir, "out") };
  for (const folder of Object.values(folders)) mkdirSync(folder, { recursive: true, mode: 0o700 });
  return { ...folders, resultFile: join(folders.out, "result.json") };
};

// The run's id and its launch options on `account`, given the versions whose check passed; refused while gh finds a
// login of its own.
const decide = async <L extends Launch>(
  state: string,
  registry: AccountRegistry,
  { request, host, account }: { request: WorkerRequest<L>; host: LaunchHost; account: Account },
): Promise<Result<{ runId: string; build: (verifiedVersions: readonly string[]) => L }>> => {
  const runId = randomUUID();
  const { tmpDir, ghConfigDir, resultFile } = workerFolders(state, runId);
  const { parent, platform, home } = host;
  const env = workerEnv({ parent, platform, ghToken: request.ghToken, ghConfigDir });
  const gh = await ghProbe(env, host.gh);
  if (!gh.ok) return gh;
  const fixed = {
    runId,
    account,
    env,
    home: account.home,
    prompt: `${request.prompt}\n\n${resultPrompt(resultFile, runId)}`,
    tmpDir,
    resultFile,
    denyRead: deniedPaths(registry, home, parent["XDG_CONFIG_HOME"]),
    allowedDomains: GITHUB_DOMAINS,
  };
  return { ok: true, value: { runId, build: (verifiedVersions) => request.launch({ ...fixed, verifiedVersions }) } };
};

// Takes one of the account's leases: launch.account-full while all are taken.
const takeLease = (state: string, lease: Lease): Promise<Result<null>> => {
  const max = MAX_CONCURRENT[lease.agent];
  return retryBusy(() =>
    withStore(state, (store) =>
      store.leaseAccount(lease, max)
        ? { ok: true, value: null }
        : { ok: false, finding: { code: "launch.account-full", params: { account: lease.account, max } } },
    ),
  );
};

// Runs the leased worker to its end with its usage stored as readings, and ends the lease with its verdict: failed when
// the run throws.
const runLeased = async <L extends Launch>(state: string, runtime: AgentRuntime<L>, launch: L, lease: Lease) => {
  let verdict: Verdict = "failed";
  try {
    let exit: Extract<AgentEvent, { type: "exit" }> | null = null;
    for await (const event of runtime.start(launch).events) {
      // A reading the store cannot take is dropped; the run goes on.
      if (event.type === "usage") await retryBusy(() => recordUsage(state, lease.account, event.windows));
      if (event.type === "exit") exit = event;
    }
    const result = readResult(launch.resultFile, lease.runId);
    if (result !== null && exit?.code === 0) verdict = result.verdict;
    const summary = result?.summary ?? null;
    return { kind: "finished", runId: lease.runId, account: lease.account, verdict, summary, exit } as const;
  } finally {
    // shortcut: a store busy for all three tries leaves the lease taken until this process ends.
    await retryBusy(() =>
      withStore(state, (store) => {
        store.finishLaunch(lease.runId, verdict);
        return { ok: true, value: null };
      }),
    );
  }
};

/**
 * Starts a worker of the task end to end: chooses its account, builds its clean environment, refuses while gh finds a
 * keyring login, checks the CLI version, refuses a version without proof that the CLI applies the worker settings,
 * takes one of the account's leases, runs the worker, and reads its verdict from the result file.
 */
export const launchWorker = async <L extends Launch>(
  state: string,
  config: string,
  request: WorkerRequest<L>,
  host: LaunchHost,
): Promise<Result<WorkerOutcome>> => {
  const registry = loadRegistry(config);
  if (!registry.ok) return registry;
  const accounts = registry.value;
  if (accounts === null) return { ok: true, value: { kind: "no-account", reason: "unknown-pool" } };
  const selection = await retryBusy(() => chooseAccount(state, accounts, request));
  if (!selection.ok) return selection;
  if (!selection.value.ok) return { ok: true, value: { kind: "no-account", reason: selection.value.reason } };
  const account = selection.value.account;
  const launch = await decide(state, accounts, { request, host, account });
  if (!launch.ok) return launch;
  const { runId, build } = launch.value;
  const probe = build([]);
  const { agent, task, runtime } = request;
  const checked = await checkedVersions(state, agent, runtime, { env: probe.env, probe });
  if (!checked.ok) return checked;
  const { version, verified, settingsApplied } = checked.value;
  if (!settingsApplied) return { ok: false, finding: { code: "launch.settings-unproven", params: { agent, version } } };
  const startedAt = new Date().toISOString();
  const lease = { runId, task, agent, account: account.name, version, pid: process.pid, startedAt };
  const leased = await takeLease(state, lease);
  if (!leased.ok) return leased;
  return { ok: true, value: await runLeased(state, runtime, build(verified), lease) };
};
