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

export const runsResume = async (ctx: Context, runId: string, project?: string): Promise<number> =>
  ran(ctx, await useCases.resumeRun(ctx.state, runId, runOptions(ctx, project)));

export const runsCancel = async (ctx: Context, runId: string, project?: string): Promise<number> =>
  ran(ctx, await useCases.cancelRun(ctx.state, runId, runOptions(ctx, project)));

/** A graph run and its attempts, each with the process it started: one that ended interrupted may still run. */
export const graphRunShow = async (ctx: Context, runId: string): Promise<number> => {
  const shown = await useCases.showGraphRun(ctx.state, runId);
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
