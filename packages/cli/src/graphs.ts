import type { Finding, Result } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { type Context, EXIT, emit, fail } from "./output.ts";

const exitOf = (finding: Finding): number => (finding.code === "document.unreadable" ? EXIT.noInput : EXIT.refused);

// A graph run's end: exit 1 when it failed. Ctrl+C or SIGTERM cancels a run this process runs.
const ran = (ctx: Context, result: Result<{ runId: string; status: string }>): number => {
  if (!result.ok) return fail(ctx, "run", [result.finding], exitOf(result.finding));
  const { runId, status } = result.value;
  emit(ctx, "run", { runId, status }, `Run ${runId}: ${status}.`);
  return status === "failed" ? EXIT.refused : EXIT.ok;
};

const runOptions = (ctx: Context, project: string | undefined): useCases.RunOptions => {
  const stop = new AbortController();
  void ctx.io.untilStopped().then(() => stop.abort());
  return { project, signal: stop.signal };
};

export const workflowsRun = async (
  ctx: Context,
  file: string,
  inputs: Record<string, string>,
  project: string,
): Promise<number> => ran(ctx, await useCases.runWorkflow(ctx.state, file, inputs, runOptions(ctx, project)));

// Without --yes, what a resume or a cancel would do; nothing changes. A cancel starts nothing, so it needs no folder.
// What becomes of the attempts still running: a live runner ends them cancelled; those a dead runner left end interrupted.
const ATTEMPTS = {
  live: "Running now; its runner ends them cancelled:",
  resume: "Left running when its runner died; they end interrupted, count as failed, and retries rerun them:",
  cancel: "Left running when its runner died; they end interrupted:",
} as const;

const preview = (ctx: Context, runId: string, project: string | undefined, verb: "resume" | "cancel"): number => {
  const plan = useCases.planGraphRun(ctx.state, runId, { verb, project });
  if (!plan.ok) return fail(ctx, "run", [plan.finding], EXIT.refused);
  const { run, attempts, project: folder } = plan.value;
  const where = folder === null ? "" : `, in ${folder}`;
  const left = attempts.map((each) => `  ${each.node}#${each.attempt}  pid ${each.pid ?? "none"}`);
  const lines = [
    `Run ${run.id}: graph ${run.definition.metadata.id}, ${run.status}${where}.`,
    ...(left.length > 0 ? [ATTEMPTS[run.status === "interrupted" ? verb : "live"], ...left] : []),
    `Nothing changed. Run the command again with --yes to ${verb} it.`,
  ];
  emit(ctx, "run", { run, attempts }, lines.join("\n"));
  return EXIT.ok;
};

export const runsResume = async (ctx: Context, runId: string, options: Acting): Promise<number> =>
  options.yes === true
    ? ran(ctx, await useCases.resumeRun(ctx.state, runId, runOptions(ctx, options.project)))
    : preview(ctx, runId, options.project, "resume");

export const runsCancel = async (ctx: Context, runId: string, options: Acting): Promise<number> =>
  options.yes === true
    ? ran(ctx, await useCases.cancelRun(ctx.state, runId, runOptions(ctx, options.project)))
    : preview(ctx, runId, options.project, "cancel");

interface Acting {
  readonly project?: string | undefined;
  readonly yes?: true | undefined;
}

/** A graph run and its attempts, each with the process it started: one that ended interrupted may still run. */
export const graphRunShow = (ctx: Context, runId: string): number => {
  const shown = useCases.showGraphRun(ctx.state, runId);
  if (!shown.ok) return fail(ctx, "run", [shown.finding], EXIT.refused);
  const { run, attempts } = shown.value;
  const lines = attempts.map((each) => {
    const pid = each.pid === null ? "" : `  pid ${each.pid}`;
    return `  ${`${each.node}#${each.attempt}`.padEnd(16)} ${each.state.padEnd(11)}${pid}`;
  });
  const head = `Run ${run.id}: graph ${run.definition.metadata.id}, ${run.status}, ${run.startedAt}`;
  emit(ctx, "run", { run, attempts }, [head, ...lines].join("\n"));
  return EXIT.ok;
};
