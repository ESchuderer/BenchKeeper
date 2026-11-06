import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Selection } from "@cedarloom/accounts";
import type { AgentEvent, AgentRuntime, AgentSession, Launch } from "@cedarloom/agent-contracts";
import type { Account, AccountRegistry, LaunchRecord, Result } from "@cedarloom/contracts";
import type { LeaseLock } from "@cedarloom/ledger";
import {
  deniedPaths,
  GITHUB_DOMAINS,
  ghProbe,
  managedSettingsDir,
  readResult,
  resultPrompt,
  sandboxOverrides,
  workerEnv,
} from "@cedarloom/orchestration";
import { type AccountRequest, chooseAccount, loadRegistry, MAX_CONCURRENT } from "./accounts.ts";
import { checkedVersions, recordUsage } from "./agents.ts";
import { retryBusy, withStore } from "./use-cases.ts";

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
  /** The folder of Claude Code's managed settings files; the platform's when unset, none when null. */
  readonly managedDir?: string | null;
}

// A managed settings file that lets commands run outside the sandbox refuses every launch: it outranks --settings.
const managedRefusal = (host: LaunchHost): Result<null> => {
  const dir = host.managedDir === undefined ? managedSettingsDir(host.platform) : host.managedDir;
  const [override] = dir === null ? [] : sandboxOverrides(dir);
  if (override === undefined) return { ok: true, value: null };
  const params = { path: override.path, key: `sandbox.${override.key}` };
  return { ok: false, finding: { code: "launch.sandbox-overridden", params } };
};

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
type Exit = Extract<AgentEvent, { type: "exit" }>;
interface Held {
  readonly lease: Lease;
  readonly lock: LeaseLock;
}

// The worker's folder in the state folder, named short for the socket path limit: its temporary folder, gh's empty
// configuration, and the folder of its result file, the one folder outside the working folder it may write.
// shortcut: a run's folders stay after it; remove them with a sweep of finished launches once they pile up.
const workerFolders = (state: string, runId: string) => {
  const dir = join(state, "workers", runId.slice(0, 8));
  const folders = { tmpDir: join(dir, "tmp"), ghConfigDir: join(dir, "gh"), out: join(dir, "out") };
  for (const folder of Object.values(folders)) mkdirSync(folder, { recursive: true, mode: 0o700 });
  return { dir, ...folders, resultFile: join(folders.out, "result.json") };
};

// A launch refused before its run removes the worker's folder.
const refused = <T>(dir: string, result: Result<T> & { ok: false }): Result<never> => {
  rmSync(dir, { recursive: true, force: true });
  return result;
};

interface Prepared<L extends Launch> {
  readonly runId: string;
  readonly dir: string;
  readonly build: (verifiedVersions: readonly string[]) => L;
}

// The run's id, folder and launch options on `account`, given the versions whose check passed; refused while gh finds
// a login of its own.
const decide = async <L extends Launch>(
  state: string,
  registry: AccountRegistry,
  { request, host, account }: { request: WorkerRequest<L>; host: LaunchHost; account: Account },
): Promise<Result<Prepared<L>>> => {
  const runId = randomUUID();
  const { dir, tmpDir, ghConfigDir, resultFile } = workerFolders(state, runId);
  const { parent, platform, home } = host;
  const env = workerEnv({ parent, platform, ghToken: request.ghToken, ghConfigDir });
  const gh = await ghProbe(env, host.gh);
  if (!gh.ok) return refused(dir, gh);
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
  return {
    ok: true,
    value: { runId, dir, build: (verifiedVersions) => request.launch({ ...fixed, verifiedVersions }) },
  };
};

// Takes one of the account's leases and holds its lock: launch.account-full while all are taken.
const takeLease = (state: string, lease: Lease): Promise<Result<Held>> => {
  const max = MAX_CONCURRENT[lease.agent];
  return retryBusy(() =>
    withStore(state, (store) => {
      const lock = store.leaseAccount(lease, max);
      if (lock === null) {
        return { ok: false, finding: { code: "launch.account-full", params: { account: lease.account, max } } };
      }
      return { ok: true, value: { lease, lock } };
    }),
  );
};

// Ends the lease with the run's verdict, then lets go of its lock; a lease let go without a finish reads as interrupted.
const end = async (state: string, { lease, lock }: Held, verdict: Verdict): Promise<void> => {
  try {
    await retryBusy(() =>
      withStore(state, (store) => {
        store.finishLaunch(lease.runId, verdict);
        return { ok: true, value: null };
      }),
    );
  } finally {
    lock.release();
  }
};

// Reads the session to its end with its usage stored as readings; stops reading at an init line without the proof that
// the CLI applied the worker settings, and returns the version it named. `proved`: the session's init line proved them.
const observe = async (state: string, session: AgentSession, lease: Lease) => {
  let exit: Exit | null = null;
  let proved = false;
  for await (const event of session.events) {
    if (event.type === "init" && !event.settingsApplied) {
      return { exit, proved, unproven: event.agentVersion ?? lease.version };
    }
    if (event.type === "init") proved = true;
    // A reading the store cannot take is dropped; the run goes on.
    if (event.type === "usage") await retryBusy(() => recordUsage(state, lease.account, event.windows));
    if (event.type === "exit") exit = event;
  }
  return { exit, proved, unproven: null };
};

// Runs the leased worker to its end and reads its verdict. Every path that leaves without the CLI's exit (a throw, a
// session without the settings proof) stops the CLI and its commands first; the lease then ends, as failed unless the
// result file holds a verdict.
const runLeased = async <L extends Launch>(
  state: string,
  runtime: AgentRuntime<L>,
  build: () => L,
  held: Held,
): Promise<Result<WorkerOutcome>> => {
  const { lease } = held;
  let verdict: Verdict = "failed";
  let session: AgentSession | undefined;
  let exit: Exit | null = null;
  try {
    const launch = build();
    session = runtime.start(launch);
    const seen = await observe(state, session, lease);
    exit = seen.exit;
    if (seen.unproven !== null) {
      return {
        ok: false,
        finding: { code: "launch.settings-unproven", params: { agent: lease.agent, version: seen.unproven } },
      };
    }
    const result = readResult(launch.resultFile, lease.runId);
    // A session without an init line proved no settings, so its result counts for nothing.
    if (result !== null && exit?.code === 0 && seen.proved) verdict = result.verdict;
    const { runId, account } = lease;
    return { ok: true, value: { kind: "finished", runId, account, verdict, summary: result?.summary ?? null, exit } };
  } finally {
    try {
      if (exit === null) await session?.cancel();
    } finally {
      await end(state, held, verdict);
    }
  }
};

/**
 * Starts a worker of the task end to end: chooses an account with a free lease, builds its clean environment, refuses
 * while gh finds a keyring login, checks the CLI version, takes one of the account's leases, runs the worker, stops it
 * at once when its session gives no proof that the CLI applied the worker settings, and reads its verdict from the
 * result file. A launch refused before its run leaves no worker folder.
 */
export const launchWorker = async <L extends Launch>(
  state: string,
  config: string,
  request: WorkerRequest<L>,
  host: LaunchHost,
): Promise<Result<WorkerOutcome>> => {
  const managed = managedRefusal(host);
  if (!managed.ok) return managed;
  const registry = loadRegistry(config);
  if (!registry.ok) return registry;
  const accounts = registry.value;
  if (accounts === null) return { ok: true, value: { kind: "no-account", reason: "unknown-pool" } };
  const selection = await retryBusy(() => chooseAccount(state, accounts, request));
  if (!selection.ok) return selection;
  if (!selection.value.ok) return { ok: true, value: { kind: "no-account", reason: selection.value.reason } };
  const account = selection.value.account;
  const prepared = await decide(state, accounts, { request, host, account });
  if (!prepared.ok) return prepared;
  const { runId, dir, build } = prepared.value;
  const probe = build([]);
  const { agent, task, runtime } = request;
  const checked = await checkedVersions(state, agent, runtime, { env: probe.env, probe });
  if (!checked.ok) return refused(dir, checked);
  const { version, verified, settingsApplied } = checked.value;
  // The backstop: a version whose own check proved no settings starts no run, whatever a run's init line would say.
  if (!settingsApplied) {
    return refused(dir, { ok: false, finding: { code: "launch.settings-unproven", params: { agent, version } } });
  }
  const startedAt = new Date().toISOString();
  const held = await takeLease(state, {
    runId,
    task,
    agent,
    account: account.name,
    version,
    pid: process.pid,
    startedAt,
  });
  if (!held.ok) return refused(dir, held);
  return runLeased(state, runtime, () => build(verified), held.value);
};
