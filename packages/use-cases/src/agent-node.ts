import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { AgentEvent, AgentRuntime, Launch } from "@cedarloom/agent-contracts";
import type { Result } from "@cedarloom/contracts";
import type { Attempt, Prepared } from "@cedarloom/engine";
import { worktreeOf } from "@cedarloom/git";
import { loadRegistry } from "./accounts.ts";
import { levelAtGate } from "./automation.ts";
import { type Decided, type LaunchHost, type LeasedWorker, leaseWorker, type WorkerRequest } from "./launch.ts";

const PHASES = ["plan", "implement", "review"] as const;
/** The workflow phase an agent node works in; `implement` when the node names none. */
export type Phase = (typeof PHASES)[number];

/** What `agent.run` nodes start their workers with. */
export interface AgentOptions<L extends Launch = Launch> {
  /** The config folder that holds the account registry. */
  readonly config: string;
  readonly host: LaunchHost;
  readonly runtime: AgentRuntime<L>;
  /** The adapter's launch options of a worker: the decided values with the phase's model and settings, in `cwd`. */
  readonly launch: (decided: Decided, phase: Phase, cwd: string) => L;
  /** How long an agent may send nothing before it counts as stalled: 15 minutes when unset. */
  readonly stallMs?: number;
  /** How long a wait for a free account lease waits before it asks again: 5 seconds when unset. */
  readonly retryMs?: number;
}

/** The run an agent works for: its state folder, id and project folder. */
export interface AgentRun {
  readonly state: string;
  readonly runId: string;
  readonly project: string;
}

const STALL_MS = 15 * 60_000;
const RETRY_MS = 5000;
// A worker that did its task: one that found problems in a review did too.
const DONE = new Set(["pass", "findings"]);

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
  let made: Promise<Result<string>> | undefined;
  return async (): Promise<Result<string>> => {
    made ??= worktreeOf(run.project, folderOf(run), `cedarloom/${run.runId}`);
    const result = await made;
    if (!result.ok) made = undefined;
    return result;
  };
};

// shortcut: an agent runs on the registry's only Claude Code pool; give the run a choice once someone keeps two.
const onlyPool = (config: string): string | null => {
  const registry = loadRegistry(config);
  const pools = Object.keys((registry.ok ? registry.value?.pools.claude : undefined) ?? {});
  return pools.length === 1 ? (pools[0] ?? null) : null;
};

// The worker of an attempt, the node's task in the worktree with its phase's model and settings; or why there is none.
const requestOf = (
  attempt: Attempt,
  run: AgentRun,
  options: AgentOptions,
  cwd: string,
): WorkerRequest<Launch> | string => {
  const pool = onlyPool(options.config);
  if (pool === null) return "no-single-pool";
  const level = levelAtGate(run.state, options.config, { project: run.project, startedAt: new Date().toISOString() });
  if (!level.ok) return level.finding.code;
  const phase = PHASES.find((each) => each === attempt.config["phase"]) ?? "implement";
  const task = attempt.config["task"];
  return {
    task: `${run.runId}:${attempt.node}`,
    agent: "claude",
    pool,
    previous: null,
    prompt: typeof task === "string" ? task : "",
    ghToken: null,
    runtime: options.runtime,
    labels: { phase, review: phase === "review", level: level.value, tier: null },
    // The version check's probe comes before the worktree is made: it runs in the worker's own temporary folder.
    launch: (decided) => options.launch(decided, phase, existsSync(cwd) ? cwd : decided.tmpDir),
  };
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

const outcomeOf = (ran: Awaited<ReturnType<LeasedWorker["run"]>>, stalled: boolean) => {
  if (!ran.ok) return { ok: false, stalled, values: { error: ran.finding.code } };
  const { verdict, summary } = ran.value;
  return { ok: DONE.has(verdict), stalled, values: { result: summary ?? "", verdict } };
};

// Runs the leased worker: its session id is committed at init, and a session that sends nothing for `stallMs` is
// stopped and counts as stalled.
const watched = async (attempt: Attempt, worker: LeasedWorker, stallMs: number) => {
  const quiet = new AbortController();
  const arm = () => setTimeout(() => quiet.abort(), stallMs);
  let timer = arm();
  const onEvent = (event: AgentEvent): void => {
    clearTimeout(timer);
    timer = arm();
    if (event.type === "init") attempt.session(event.sessionId);
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
    if (where?.ok === true) return watched(attempt, worker, stallMs);
    await worker.release();
    return where === null ? { ok: false } : { ok: false, values: { error: where.finding.code } };
  },
});

/**
 * The executor of `agent.run` for one run: each attempt is a worker of the M3 launcher on the registry's Claude Code
 * pool, in the run's worktree. Every check that can refuse it comes first; it then waits for a free account lease
 * before it starts, which no timeout counts, and makes the worktree once it goes.
 */
export const agentRun = (run: AgentRun, options: AgentOptions) => {
  const worktree = worktrees(run);
  return async (attempt: Attempt): Promise<Prepared> => {
    const request = requestOf(attempt, run, options, folderOf(run));
    if (typeof request === "string") return failed(request);
    const lease = () => leaseWorker(run.state, options.config, request, options.host);
    const got = await leased(attempt, lease, options.retryMs ?? RETRY_MS);
    if (!got.ok) return failed(got.finding.code);
    if (got.value.kind === "no-account") return failed(got.value.reason);
    return going(attempt, got.value, { stallMs: options.stallMs ?? STALL_MS, worktree });
  };
};
