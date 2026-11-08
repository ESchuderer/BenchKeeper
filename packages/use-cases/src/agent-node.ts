import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AgentEvent, AgentRuntime, Launch } from "@cedarloom/agent-contracts";
import type { AccountRegistry, Result } from "@cedarloom/contracts";
import type { Attempt, Prepared, Recovery } from "@cedarloom/engine";
import { commonDir, worktreeOf } from "@cedarloom/git";
import { readResult, workerPolicy } from "@cedarloom/orchestration";
import { loadRegistry } from "./accounts.ts";
import { levelAtGate } from "./automation.ts";
import {
  type Decided,
  type LaunchHost,
  type LeasedWorker,
  leaseWorker,
  type Resume,
  resultFileOf,
  type WorkerRequest,
} from "./launch.ts";
import { readSelection } from "./profiles.ts";
import { retryBusy, withStore } from "./use-cases.ts";

const PHASES = ["plan", "implement", "review"] as const;
/** The workflow phase an agent node works in; `implement` when the node names none. */
export type Phase = (typeof PHASES)[number];

/** What `agent.run` nodes start their workers with. */
export interface AgentOptions<L extends Launch = Launch> {
  /** The config folder that holds the account registry. */
  readonly config: string;
  readonly host: LaunchHost;
  readonly runtime: AgentRuntime<L>;
  /**
   * The adapter's launch options of a worker: the decided values with the phase's model and settings, in `cwd`; with
   * `readOnly`, `cwd` and those folders are closed to its writes.
   */
  readonly launch: (decided: Decided, phase: Phase, cwd: string, readOnly?: readonly string[]) => L;
  /** The model a worker of the phase runs, whose own weekly window counts in its account's choice. */
  readonly model?: (phase: Phase) => string;
  /** How long an agent may send nothing before it counts as stalled: 15 minutes when unset. */
  readonly stallMs?: number;
  /** How long a wait for a free account lease waits before it asks again: 5 seconds when unset. */
  readonly retryMs?: number;
  /** Keeps the accounts' latest readings (claude-swap's) before a new worker's account is chosen. */
  readonly readings?: () => Promise<unknown>;
}

/** The run an agent works for: its state folder, id and project folder, and whether it only reports. */
export interface AgentRun {
  readonly state: string;
  readonly runId: string;
  readonly project: string;
  readonly report?: boolean;
}

const STALL_MS = 15 * 60_000;
const RETRY_MS = 5000;
// A worker that did its task: one that found problems in a review did too.
const DONE = new Set(["pass", "findings"]);
// What a resumed session is told; the launcher adds where its result goes now.
const RESUMED = "Your run was stopped before it finished. Continue the task from where you left off.";

const failed = (why: string): Prepared => ({
  pid: null,
  run: () => Promise.resolve({ ok: false, values: { error: why } }),
});

// The folder of the run's worktree, on the branch cedarloom/<run> from the project's HEAD (Q12): an act-mode agent works
// there, and Git shows and undoes what it did.
const folderOf = (run: AgentRun): string => join(run.state, "worktrees", run.runId);

// The run's worktree, made by the first attempt that goes and found again by a later one or a later runner. Only a
// success is kept: the next attempt tries an add that failed again.
const worktrees = (run: AgentRun) => {
  // A report run's agent works in the project itself, which its launch closes to writes.
  if (run.report === true) return () => Promise.resolve<Result<string>>({ ok: true, value: run.project });
  let made: Promise<Result<string>> | undefined;
  return async (): Promise<Result<string>> => {
    made ??= worktreeOf(run.project, folderOf(run), `cedarloom/${run.runId}`);
    const result = await made;
    if (!result.ok) made = undefined;
    return result;
  };
};

// shortcut: an agent runs on the registry's only Claude Code pool; give the run a choice once someone keeps two.
const onlyPool = (registry: AccountRegistry | null): string | null => {
  const pools = Object.keys(registry?.pools.claude ?? {});
  return pools.length === 1 ? (pools[0] ?? null) : null;
};

// The launcher's task of an attempt: a later runner finds the attempt's launches by it.
const taskOf = (run: AgentRun, attempt: Attempt): string => `${run.runId}:${attempt.node}#${attempt.attempt}`;

// The worker of an attempt, the node's task in the worktree with its phase's model and settings, or the session it
// resumes; or why there is none.
const requestOf = (
  attempt: Attempt,
  run: AgentRun,
  options: AgentOptions,
  { resume, readOnly }: { resume: Resume | null; readOnly: readonly string[] | undefined },
): WorkerRequest<Launch> | string => {
  const registry = loadRegistry(options.config);
  if (!registry.ok) return registry.finding.code;
  const pool = onlyPool(registry.value);
  if (pool === null) return "no-single-pool";
  const level = levelAtGate(run.state, options.config, { project: run.project, startedAt: new Date().toISOString() });
  if (!level.ok) return level.finding.code;
  const phase = PHASES.find((each) => each === attempt.config["phase"]) ?? "implement";
  const task = attempt.config["task"];
  const cwd = readOnly === undefined ? folderOf(run) : run.project;
  return {
    task: taskOf(run, attempt),
    agent: "claude",
    pool,
    previous: null,
    model: options.model?.(phase),
    ...(resume === null ? { prompt: typeof task === "string" ? task : "" } : { prompt: RESUMED, resume }),
    ghToken: null,
    guard: workerPolicy(run.project, hubOf(options.config)),
    runtime: options.runtime,
    labels: { phase, review: phase === "review", level: level.value, tier: null },
    // The version check's probe comes before the worktree is made: it runs in the worker's own temporary folder.
    launch: (decided) => options.launch(decided, phase, existsSync(cwd) ? cwd : decided.tmpDir, readOnly),
  };
};

// This machine's hub binding; none when the selection names none or cannot be read, which leaves issue commands refused.
const hubOf = (config: string): string | null => {
  const read = readSelection(config);
  return read.ok ? (read.value.selection?.bindings?.hub ?? null) : null;
};

type Lease = () => ReturnType<typeof leaseWorker<Launch>>;

// Whether `ms` passed before `signal` ended the wait.
const waited = async (ms: number, signal: AbortSignal): Promise<boolean> => {
  try {
    await sleep(ms, undefined, { signal });
    return true;
  } catch {
    return false;
  }
};

// Takes a lease on the pool, waiting while every account's leases are taken; the wait ends with the attempt.
const leased = async (attempt: Attempt, lease: Lease, retryMs: number): ReturnType<Lease> => {
  for (;;) {
    const got = await lease();
    const full = got.ok
      ? got.value.kind === "no-account" && got.value.reason === "all-leased"
      : got.finding.code === "launch.account-full";
    if (!full || !(await waited(retryMs, attempt.signal))) return got;
  }
};

const ended = (verdict: string, summary: string | null) => ({
  ok: DONE.has(verdict),
  values: { result: summary ?? "", verdict },
});

const outcomeOf = (ran: Awaited<ReturnType<LeasedWorker["run"]>>, stalled: boolean) => {
  if (!ran.ok) return { ok: false, stalled, values: { error: ran.finding.code } };
  return { ...ended(ran.value.verdict, ran.value.summary), stalled };
};

// Runs the leased worker: its session id is committed at an init line that proves the worker settings, so only such a
// session is resumed; a session that sends nothing for `stallMs` is stopped and counts as stalled.
const watched = async (attempt: Attempt, worker: LeasedWorker, stallMs: number) => {
  const quiet = new AbortController();
  const arm = () => setTimeout(() => quiet.abort(), stallMs);
  let timer = arm();
  const onEvent = (event: AgentEvent): void => {
    clearTimeout(timer);
    timer = arm();
    if (event.type === "init" && event.settingsApplied) attempt.session(event.sessionId);
  };
  try {
    const ran = await worker.run({ onEvent, signal: AbortSignal.any([attempt.signal, quiet.signal]) });
    return outcomeOf(ran, quiet.signal.aborted);
  } finally {
    clearTimeout(timer);
  }
};

type Going = { readonly stallMs: number; readonly worktree: () => Promise<Result<string>> };

// The leased worker as an attempt, in the run's worktree, made now that the attempt's start is committed. An attempt
// stopped before it went, or without its worktree, lets the lease go unused.
const going = (attempt: Attempt, worker: LeasedWorker, { stallMs, worktree }: Going): Prepared => ({
  pid: null,
  run: async () => {
    const where = attempt.signal.aborted ? null : await worktree();
    // A stop may come while the worktree is added: the session then never starts.
    if (where?.ok === true && !attempt.signal.aborted) return watched(attempt, worker, stallMs);
    await worker.release();
    return where?.ok === false ? { ok: false, values: { error: where.finding.code } } : { ok: false };
  },
});

type Worktree = () => Promise<Result<string>>;

// The folders a report run's agent may not write besides the project: its repository's git folder, which a linked
// worktree shares from outside. None for an act run, whose agent works in its own worktree.
const closedOf = async (run: AgentRun): Promise<Result<readonly string[] | undefined>> => {
  if (run.report !== true) return { ok: true, value: undefined };
  const shared = await commonDir(run.project);
  return shared.ok ? { ok: true, value: [shared.value] } : shared;
};

// A worker of the attempt, or of the session it resumes, as an attempt that goes in the run's worktree.
const attempted = async (
  attempt: Attempt,
  run: AgentRun,
  options: AgentOptions,
  { worktree, resume }: { worktree: Worktree; resume: Resume | null },
): Promise<Prepared> => {
  const readOnly = await closedOf(run);
  if (!readOnly.ok) return failed(readOnly.finding.code);
  const request = requestOf(attempt, run, options, { resume, readOnly: readOnly.value });
  if (typeof request === "string") return failed(request);
  const lease = async () => {
    // A resumed worker keeps its account; a new one is chosen on readings as fresh as each try for a lease.
    if (resume === null) await options.readings?.();
    return leaseWorker(run.state, options.config, request, options.host);
  };
  const got = await leased(attempt, lease, options.retryMs ?? RETRY_MS);
  if (!got.ok) return failed(got.finding.code);
  if (got.value.kind === "no-account") return failed(got.value.reason);
  return going(attempt, got.value, { stallMs: options.stallMs ?? STALL_MS, worktree });
};

/**
 * The executor of `agent.run` for one run: each attempt is a worker of the M3 launcher on the registry's Claude Code
 * pool, in the run's worktree. Every check that can refuse it comes first; it then waits for a free account lease
 * before it starts, which no timeout counts, and makes the worktree once it goes.
 */
export const agentRun = (run: AgentRun, options: AgentOptions) => {
  const worktree = worktrees(run);
  return (attempt: Attempt): Promise<Prepared> => attempted(attempt, run, options, { worktree, resume: null });
};

// An attempt whose worker ended with a verdict: it ends with that.
const finished = (verdict: string, summary: string | null): Prepared => ({
  pid: null,
  run: () => Promise.resolve(ended(verdict, summary)),
});

/**
 * The recovery of `agent.run` attempts a dead runner left, for a run taken over. An attempt with a recorded session
 * ends with the verdict the launcher gave its latest launch, else with the result that launch wrote, without a relaunch.
 * With neither, it resumes the session on the account it ran on, in the run's worktree. An attempt without a session, or whose runtime cannot resume, ends
 * interrupted (Q4).
 */
export const agentRecover = (run: AgentRun, options: AgentOptions): Recovery => {
  const worktree = worktrees(run);
  return async (left) => {
    const { sessionId } = left;
    if (sessionId === null) return null;
    const task = taskOf(run, left);
    const launches = await retryBusy(() => withStore(run.state, (store) => ({ ok: true, value: store.launches() })));
    const launch = launches.ok ? launches.value.findLast((each) => each.task === task) : undefined;
    if (launch === undefined) return null;
    const result = readResult(resultFileOf(run.state, launch.runId), launch.runId);
    // A launch the launcher ended is decided: its verdict holds, which judged the CLI's exit too.
    if (launch.verdict !== null && launch.verdict !== "interrupted") {
      return finished(launch.verdict, result?.summary ?? null);
    }
    if (result !== null) return finished(result.verdict, result.summary);
    if (options.runtime.capabilities.resume !== "supported") return null;
    return attempted(left, run, options, { worktree, resume: { sessionId, account: launch.account } });
  };
};
