import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type ClaudeLaunch, FRESH_INSTALL_PHASES } from "@cedarloom/adapter-claude";
import type { AgentEvent, AgentRuntime } from "@cedarloom/agent-contracts";
import type { Result } from "@cedarloom/contracts";
import type { Attempt, Prepared } from "@cedarloom/engine";
import { addWorktree } from "@cedarloom/git";
import { loadRegistry } from "./accounts.ts";
import { levelAtGate } from "./automation.ts";
import { type LaunchHost, type LeasedWorker, leaseWorker, type WorkerRequest } from "./launch.ts";

/** What `agent.run` nodes start their workers with. */
export interface AgentOptions {
  /** The config folder that holds the account registry. */
  readonly config: string;
  readonly host: LaunchHost;
  readonly runtime: AgentRuntime<ClaudeLaunch>;
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
const PHASES = ["plan", "implement", "review"] as const;
// A worker that did its task: one that found problems in a review did too.
const DONE = new Set(["pass", "findings"]);

const failed = (why: string): Prepared => ({
  pid: null,
  run: () => Promise.resolve({ ok: false, values: { error: why } }),
});

// The run's worktree on the branch cedarloom/<run>, from the project's HEAD (Q12): an act-mode agent works there, and
// Git shows and undoes what it did. A later attempt or runner finds it made.
const worktree = (run: AgentRun): Promise<Result<string>> => {
  const path = join(run.state, "worktrees", run.runId);
  if (existsSync(path)) return Promise.resolve({ ok: true, value: path });
  return addWorktree(run.project, path, `cedarloom/${run.runId}`);
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
): WorkerRequest<ClaudeLaunch> | string => {
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
    launch: (decided) => ({ ...FRESH_INSTALL_PHASES[phase], ...decided, cwd, allow: [] }),
  };
};

type Lease = () => ReturnType<typeof leaseWorker<ClaudeLaunch>>;

// Takes a lease on the pool, waiting while every account's leases are taken; the wait ends with the attempt.
const leased = async (attempt: Attempt, lease: Lease, retryMs: number): ReturnType<Lease> => {
  const got = await lease();
  const full = got.ok
    ? got.value.kind === "no-account" && got.value.reason === "all-leased"
    : got.finding.code === "launch.account-full";
  if (!full) return got;
  try {
    await sleep(retryMs, undefined, { signal: attempt.signal });
  } catch {
    return got;
  }
  return leased(attempt, lease, retryMs);
};

const outcomeOf = (ran: Awaited<ReturnType<LeasedWorker["run"]>>, stalled: boolean) => {
  if (!ran.ok) return { ok: false, stalled, values: { error: ran.finding.code } };
  const { verdict, summary } = ran.value;
  return { ok: DONE.has(verdict), stalled, values: { result: summary ?? "", verdict } };
};

// The leased worker as an attempt: its session id is committed at init, and a session that sends nothing for `stallMs`
// is stopped and counts as stalled. An attempt stopped before it went lets the lease go unused.
const going = (attempt: Attempt, worker: LeasedWorker, stallMs: number): Prepared => ({
  pid: null,
  run: async () => {
    if (attempt.signal.aborted) {
      await worker.release();
      return { ok: false };
    }
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
  },
});

/**
 * The executor of `agent.run` for one run: each attempt is a worker of the M3 launcher on the registry's Claude Code
 * pool, in the run's worktree. It waits for a free account lease before it starts, which no timeout counts.
 */
export const agentRun = (run: AgentRun, options: AgentOptions) => {
  let made: Promise<Result<string>> | undefined;
  return async (attempt: Attempt): Promise<Prepared> => {
    made ??= worktree(run);
    const where = await made;
    const request = where.ok ? requestOf(attempt, run, options, where.value) : where.finding.code;
    if (typeof request === "string") return failed(request);
    const lease = () => leaseWorker(run.state, options.config, request, options.host);
    const got = await leased(attempt, lease, options.retryMs ?? RETRY_MS);
    if (!got.ok) return failed(got.finding.code);
    if (got.value.kind === "no-account") return failed(got.value.reason);
    return going(attempt, got.value, options.stallMs ?? STALL_MS);
  };
};
