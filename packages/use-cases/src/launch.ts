import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Selection } from "@cedarloom/accounts";
import type { AgentEvent, AgentRuntime, AgentSession, Launch } from "@cedarloom/agent-contracts";
import type {
  Account,
  AccountRegistry,
  Agent,
  GuardPolicy,
  LaunchRecord,
  Result,
  RunLabels,
} from "@cedarloom/contracts";
import { fetchTree } from "@cedarloom/git";
import type { Lease, LeaseLock, RunStore } from "@cedarloom/ledger";
import {
  deniedPaths,
  GITHUB_DOMAINS,
  ghProbe,
  guardHookOf,
  managedProblems,
  managedSettingsDir,
  readResult,
  resultPrompt,
  workerEnv,
} from "@cedarloom/orchestration";
import { type AccountRequest, chooseAccount, loadRegistry, MAX_CONCURRENT, ownFolder } from "./accounts.ts";
import { checkedVersions, recordUsage } from "./agents.ts";
import { type FetchTree, workflowPlugin } from "./plugins.ts";
import { retryBusy, withStore } from "./use-cases.ts";

/** What the launcher decided for one worker; the adapter's launch options take these as they are. */
export type Decided = Pick<
  Launch,
  | "home"
  | "prompt"
  | "env"
  | "tmpDir"
  | "resultFile"
  | "denyRead"
  | "allowedDomains"
  | "verifiedVersions"
  | "pluginDirs"
  | "guardHook"
> & { readonly runId: string; readonly account: Account };

export interface WorkerRequest<L extends Launch> extends AccountRequest {
  /** The task's prompt; the launcher adds what it says about the result file. */
  readonly prompt: string;
  /** The fine-grained token of the worker's access profile; null when it has none. */
  readonly ghToken: string | null;
  /** What the worker's guard hook holds its shell commands to: its repositories, the hub, the memory repository. */
  readonly guard: GuardPolicy;
  readonly runtime: AgentRuntime<L>;
  /** The adapter's launch options: the decided values with the phase's model and settings and the working folder. */
  readonly launch: (decided: Decided) => L;
  /** The run's settings that the launch options do not hold; the rest comes from the built launch (A90). */
  readonly labels: Pick<RunLabels, "phase" | "review" | "level" | "tier">;
  /** The session the worker resumes, on the account it ran on, whose home holds its transcript; a new one when unset. */
  readonly resume?: Resume;
}

export interface Resume {
  readonly sessionId: string;
  readonly account: string;
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
  /** Reads the marketplace's plugins at the pinned commit; the git package's fetch over https when unset. */
  readonly fetchTree?: FetchTree;
}

// Claude Code's managed settings files that loosen the worker sandbox or switch its guard hook off, or cannot be read,
// refuse every launch of it: a managed key outranks --settings.
const managedRefusal = (host: LaunchHost, agent: Agent): Result<null> => {
  const dir = host.managedDir === undefined ? managedSettingsDir(host.platform) : host.managedDir;
  const [problem] = agent === "claude" && dir !== null ? managedProblems(dir) : [];
  if (problem === undefined) return { ok: true, value: null };
  if (problem.kind === "unreadable") {
    const params = { path: problem.path, error: problem.error };
    return { ok: false, finding: { code: "launch.managed-settings-unreadable", params } };
  }
  return {
    ok: false,
    finding: { code: "launch.sandbox-overridden", params: { path: problem.path, key: problem.key } },
  };
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

type Exit = Extract<AgentEvent, { type: "exit" }>;
const nothing = (): void => undefined;
type Finished = Extract<WorkerOutcome, { kind: "finished" }>;

/** What a caller sees of a worker as it runs: each event of its session, and a signal that stops it. */
interface Watch {
  readonly onEvent?: (event: AgentEvent) => void;
  readonly signal?: AbortSignal;
}

/** A worker on an account whose lease it holds: `run` starts it, `release` lets the lease go unused. */
export interface LeasedWorker {
  readonly kind: "leased";
  readonly runId: string;
  run(watch?: Watch): Promise<Result<Finished>>;
  release(): Promise<void>;
}

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
  return { dir, ...folders, resultFile: resultFileOf(state, runId) };
};

/** The result file of the launch `runId`. */
export const resultFileOf = (state: string, runId: string): string =>
  join(state, "workers", runId.slice(0, 8), "out", "result.json");

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
// a login of its own, and for an account outside its own home or in a linked one, so nothing lands in another folder.
const decide = async <L extends Launch>(
  state: string,
  registry: AccountRegistry,
  { request, host, account }: { request: WorkerRequest<L>; host: LaunchHost; account: Account },
): Promise<Result<Prepared<L>>> => {
  const folder = ownFolder(state, account, { create: false });
  if (!folder.ok) return folder;
  const runId = randomUUID();
  const { dir, tmpDir, ghConfigDir, resultFile } = workerFolders(state, runId);
  const { parent, platform, home } = host;
  const env = workerEnv({ parent, platform, ghToken: request.ghToken, ghConfigDir });
  const gh = await ghProbe(env, host.gh);
  if (!gh.ok) return refused(dir, gh);
  const plugin = await workflowPlugin(state, host.fetchTree ?? fetchTree);
  const fixed = {
    runId,
    account,
    env,
    // The own home as ownFolder spells it, as the login ran in it.
    home: folder.value,
    prompt: `${request.prompt}\n\n${resultPrompt(resultFile, runId)}`,
    tmpDir,
    resultFile,
    denyRead: deniedPaths(registry, home, parent["XDG_CONFIG_HOME"]),
    allowedDomains: GITHUB_DOMAINS,
    pluginDirs: plugin === null ? [] : [plugin],
    guardHook: guardHookOf(request.guard),
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

// Keeps a run's usage: busy tries are retried, and usage the store cannot take, busy for every try or failing, is
// dropped, since losing a reading must never fail the run that reported it.
const keepUsage = async (state: string, lease: Lease, event: Extract<AgentEvent, { type: "usage" }>): Promise<void> => {
  try {
    await retryBusy(() =>
      recordUsage(state, { account: lease.account, agent: lease.agent, runId: lease.runId }, event),
    );
  } catch {
    // Dropped: the readings are the launch-time choice's input, not the run's.
  }
};

// Keeps what a session reports about its run for the doctor and the run's views; a store error drops it, as the run's
// outcome does not depend on it.
const keep = async (state: string, work: (store: RunStore) => void): Promise<void> => {
  try {
    await retryBusy(() =>
      withStore(state, (store) => {
        work(store);
        return { ok: true, value: null };
      }),
    );
  } catch {
    // Dropped: the views read what the run kept.
  }
};

// Keeps the plugins the run's init line names, with the skills of the ones the launch passed, for the doctor.
const keepPlugins = async (state: string, lease: Lease, expected: readonly string[], event: AgentEvent) => {
  if (event.type !== "init" || event.plugins === null) return;
  const { loaded, skills, errors } = event.plugins;
  const own = skills.filter((skill) => expected.some((name) => skill.startsWith(`${name}:`)));
  const plugins = { expected: [...expected], loaded: [...loaded], skills: own, errors: [...errors] };
  await keep(state, (store) => store.recordPlugins(lease.runId, plugins));
};

// Keeps the totals the session's result reports.
const keepTotals = async (state: string, lease: Lease, event: AgentEvent) => {
  if (event.type !== "result" || event.totals === null) return;
  const { totals } = event;
  await keep(state, (store) => store.recordTotals(lease.runId, totals));
};

// Reads the session to its end with its usage stored as readings; stops reading at an init line without the proof that
// the CLI applied the worker settings, and returns the version it named. `proved`: the session's init line proved them.
// `expected`: the plugins the launch passed, by folder name.
const observe = async (
  state: string,
  session: AgentSession,
  lease: Lease,
  { expected, watch }: { expected: readonly string[]; watch: Watch },
) => {
  let exit: Exit | null = null;
  let proved = false;
  for await (const event of session.events) {
    watch.onEvent?.(event);
    if (event.type === "init" && !event.settingsApplied) {
      return { exit, proved, unproven: event.agentVersion ?? lease.version };
    }
    if (event.type === "init") proved = true;
    await keepPlugins(state, lease, expected, event);
    await keepTotals(state, lease, event);
    if (event.type === "usage") await keepUsage(state, lease, event);
    if (event.type === "exit") exit = event;
  }
  return { exit, proved, unproven: null };
};

// Observes the session until its end or `watch.signal`, which stops it: its events then end, so the run ends as one that
// exited without a verdict.
const watched = async (...[state, session, lease, seen]: Parameters<typeof observe>) => {
  const stop = (): void => void session.cancel().then(nothing, nothing);
  seen.watch.signal?.addEventListener("abort", stop, { once: true });
  // A signal that ended already sends no abort event.
  if (seen.watch.signal?.aborted === true) stop();
  try {
    return await observe(state, session, lease, seen);
  } finally {
    seen.watch.signal?.removeEventListener("abort", stop);
  }
};

// Runs the leased worker to its end and reads its verdict. Every path that leaves without the CLI's exit (a throw, a
// session without the settings proof) stops the CLI and its commands first; the lease then ends, as failed unless the
// result file holds a verdict.
const runLeased = async <L extends Launch>(
  state: string,
  start: { build: () => L; open: (launch: L) => AgentSession },
  held: Held,
  watch: Watch,
): Promise<Result<Finished>> => {
  const { lease } = held;
  let verdict: Verdict = "failed";
  let session: AgentSession | undefined;
  let exit: Exit | null = null;
  try {
    const launch = start.build();
    session = start.open(launch);
    const seen = await watched(state, session, lease, {
      expected: launch.pluginDirs.map((dir) => basename(dir)),
      watch,
    });
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

type NoAccount = Extract<WorkerOutcome, { kind: "no-account" }>;
type Chosen = { readonly kind: "account"; readonly accounts: AccountRegistry; readonly account: Account };

// The account a resumed session ran on, whose home holds its transcript.
const pinned = (accounts: AccountRegistry, agent: Agent, name: string): NoAccount | Chosen => {
  const account = accounts.accounts.find((each) => each.name === name && each.agent === agent);
  return account === undefined
    ? { kind: "no-account", reason: "unknown-pool" }
    : { kind: "account", accounts, account };
};

// The account a new worker of the task takes, or the one a resumed session ran on; refused under managed settings that
// loosen the sandbox.
const accountFor = async (
  state: string,
  config: string,
  request: AccountRequest & { readonly resume?: Resume },
  host: LaunchHost,
): Promise<Result<NoAccount | Chosen>> => {
  const managed = managedRefusal(host, request.agent);
  if (!managed.ok) return managed;
  const registry = loadRegistry(config);
  if (!registry.ok) return registry;
  const accounts = registry.value;
  if (accounts === null) return { ok: true, value: { kind: "no-account", reason: "unknown-pool" } };
  if (request.resume !== undefined) return { ok: true, value: pinned(accounts, request.agent, request.resume.account) };
  const selection = await retryBusy(() => chooseAccount(state, accounts, request));
  if (!selection.ok) return selection;
  if (!selection.value.ok) return { ok: true, value: { kind: "no-account", reason: selection.value.reason } };
  return { ok: true, value: { kind: "account", accounts, account: selection.value.account } };
};

/**
 * Takes a worker of the task as far as its account's lease: chooses an account with a free lease, builds its clean
 * environment, refuses while gh finds a keyring login, checks the CLI version and takes one of the account's leases. A
 * launch refused before its run leaves no worker folder.
 */
export const leaseWorker = async <L extends Launch>(
  state: string,
  config: string,
  request: WorkerRequest<L>,
  host: LaunchHost,
): Promise<Result<NoAccount | LeasedWorker>> => {
  const chosen = await accountFor(state, config, request, host);
  if (!chosen.ok) return chosen;
  if (chosen.value.kind === "no-account") return { ok: true, value: chosen.value };
  const { accounts, account } = chosen.value;
  const prepared = await decide(state, accounts, { request, host, account });
  if (!prepared.ok) return prepared;
  const { runId, dir, build } = prepared.value;
  const probe = build([]);
  const { agent, task, runtime } = request;
  const checked = await checkedVersions(state, agent, runtime, { env: probe.env, probe, account: account.name });
  if (!checked.ok) return refused(dir, checked);
  const { version, verified, settingsApplied } = checked.value;
  // The backstop: a version whose own check proved no settings starts no run, whatever a run's init line would say.
  if (!settingsApplied) {
    return refused(dir, { ok: false, finding: { code: "launch.settings-unproven", params: { agent, version } } });
  }
  const startedAt = new Date().toISOString();
  const { model, subagentModel, effort, permissionMode } = probe;
  const labels = { ...request.labels, model, subagentModel, effort, permissionMode };
  const held = await takeLease(state, {
    runId,
    task,
    agent,
    account: account.name,
    version,
    pid: process.pid,
    startedAt,
    labels,
  });
  if (!held.ok) return refused(dir, held);
  const { resume } = request;
  const start = {
    build: () => build(verified),
    // A resumed session goes on from its transcript.
    open: (launch: L) => (resume === undefined ? runtime.start(launch) : runtime.resume(resume.sessionId, launch)),
  };
  const run = (watch: Watch = {}) => runLeased(state, start, held.value, watch);
  return { ok: true, value: { kind: "leased", runId, run, release: () => end(state, held.value, "not-run") } };
};

/**
 * Starts a worker of the task end to end (`leaseWorker`), runs it, stops it at once when its session gives no proof
 * that the CLI applied the worker settings, and reads its verdict from the result file.
 */
export const launchWorker = async <L extends Launch>(
  state: string,
  config: string,
  request: WorkerRequest<L>,
  host: LaunchHost,
): Promise<Result<WorkerOutcome>> => {
  const leased = await leaseWorker(state, config, request, host);
  if (!leased.ok) return leased;
  const worker = leased.value;
  return worker.kind === "no-account" ? { ok: true, value: worker } : worker.run();
};
