import { homedir } from "node:os";
import { phaseLaunch } from "@cedarloom/adapter-claude";
import { type Finding, type GraphRun, type Json, type Result, shown as safeText } from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import { type Context, EXIT, emit, fail } from "./output.ts";

const exitOf = (finding: Finding): number => (finding.code === "document.unreadable" ? EXIT.noInput : EXIT.refused);

// A graph run's end: exit 1 when it failed. Ctrl+C or SIGTERM cancels a run this process runs.
const ran = (ctx: Context, result: Result<{ runId: string; status: string }>): number => {
  if (!result.ok) return fail(ctx, "run", [result.finding], exitOf(result.finding));
  const { runId, status } = result.value;
  const next = status === "waiting" ? ` cloom runs show ${runId} lists what for.` : "";
  emit(ctx, "run", { runId, status }, `Run ${runId}: ${status}.${next}`);
  return status === "failed" ? EXIT.refused : EXIT.ok;
};

const runOptions = (ctx: Context, project: string | undefined): useCases.RunOptions => {
  const stop = new AbortController();
  void ctx.io.untilStopped().then(() => stop.abort());
  const host = { parent: ctx.io.env, platform: process.platform, home: homedir() };
  const agents = { config: ctx.config, host, runtime: ctx.io.agent, launch: phaseLaunch };
  return { project, signal: stop.signal, agents };
};

export const workflowsRun = async (
  ctx: Context,
  file: string,
  inputs: Record<string, string>,
  project: string,
): Promise<number> => ran(ctx, await useCases.runWorkflow(ctx.state, file, inputs, runOptions(ctx, project)));

// Without --yes, what a resume or a cancel would do; nothing changes. A cancel starts nothing, so it needs no folder.
// What becomes of the attempts still running: a live runner ends them cancelled; a dead runner's end interrupted,
// except an agent's that a resume recovers and a write whose apply run applied.
const ATTEMPTS = {
  live: "Running now; its runner ends them cancelled:",
  resume:
    "Left running when its runner died; an agent with a recorded session ends with its result or resumes, a write whose apply run applied ends done, the others end interrupted, count as failed, and retries rerun them:",
  cancel:
    "Left running when its runner died; a write whose apply run applied ends cancelled with its file written, the others end interrupted:",
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

// A configuration value as text: the validator checked that these are strings.
const said = (value: Json | undefined): string => (typeof value === "string" ? value : JSON.stringify(value ?? ""));

// A write's content as the owner reads it before approving: its lines and tabs as they are, every other control or
// bidirectional character as an escape, so the untrusted content cannot move the cursor or rewrite what is shown.
const escaped = (content: string): string =>
  content
    .split("\n")
    .map((line) =>
      line
        .split("\t")
        .map((part) => safeText(part, Number.POSITIVE_INFINITY))
        .join("\t"),
    )
    .join("\n");

// What a node waits for: an approval's question, or a gate with the plan it would apply.
const waitText = (run: GraphRun, { node, point, planHash }: useCases.Waiting): string => {
  const config = run.definition.nodes.find((each) => each.id === node)?.with ?? {};
  if (point === "human.approval") return `${node} asks: ${said(config["message"])}`;
  return planHash === null
    ? `${node} waits to start`
    : `${node} waits to write ${said(config["path"])} (plan ${planHash})`;
};

/** Approves or rejects what a graph run's node waits for; without --yes, shows what that is and changes nothing. */
export const runsDecide = async (
  ctx: Context,
  { runId, node, approved }: { readonly runId: string; readonly node: string; readonly approved: boolean },
  options: Acting,
): Promise<number> => {
  if (options.yes === true) {
    const decided = await useCases.decideRun(ctx.state, runId, { node, approved }, runOptions(ctx, options.project));
    return ran(ctx, decided);
  }
  const shown = useCases.waitsOf(ctx.state, runId);
  if (!shown.ok) return fail(ctx, "run", [shown.finding], EXIT.refused);
  const wait = shown.value.waits.find((each) => each.node === node);
  if (wait === undefined) return fail(ctx, "run", [{ code: "run.not-waiting", params: { runId, node } }], EXIT.refused);
  const verb = approved ? "approve" : "reject";
  const writes = wait.content === null ? [] : ["It writes:", escaped(wait.content)];
  const lines = [
    `Run ${runId}: ${waitText(shown.value.run, wait)}.`,
    ...writes,
    `Nothing changed. Run it again with --yes to ${verb} it.`,
  ];
  emit(ctx, "run", { run: shown.value.run, wait }, lines.join("\n"));
  return EXIT.ok;
};

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
  const waiting = useCases.waitsOf(ctx.state, runId);
  const waits = waiting.ok ? waiting.value.waits.map((wait) => `  ${waitText(run, wait)}`) : [];
  emit(ctx, "run", { run, attempts }, [head, ...lines, ...waits].join("\n"));
  return EXIT.ok;
};
