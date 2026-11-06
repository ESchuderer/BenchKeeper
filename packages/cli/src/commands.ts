import {
  type Account,
  Agent,
  type AutomationLevel,
  type Finding,
  findingInfo,
  type Plan,
  type PlanPreview,
  type RunResult,
} from "@cedarloom/contracts";
import * as useCases from "@cedarloom/use-cases";
import type { Approval } from "@cedarloom/use-cases";
import { type Context, EXIT, emit, fail, report, showPlan } from "./output.ts";
import { benchKeeperRegistry } from "./state.ts";

const loadPlan = (ctx: Context, path: string): Plan | number => {
  const plan = useCases.loadPlan(path);
  if (plan.ok) return plan.value;
  return fail(ctx, "plan", [plan.finding], plan.finding.code === "document.unreadable" ? EXIT.noInput : EXIT.data);
};

// A store the reads cannot open is reported in the format of `runs list`, for every read command.
const readFailed = (ctx: Context, finding: Finding): number =>
  fail(ctx, finding.code.startsWith("store.") ? "runs" : "run", [finding], EXIT.refused);

const HUMAN: Record<RunResult["status"], (runId: string | null) => string> = {
  applied: (runId) => `Run ${runId} applied.`,
  "nothing-to-undo": () => "Nothing to undo.",
  failed: () => "",
  refused: () => "",
};

const result = (ctx: Context, { runId, status, findings }: RunResult, data: object = {}): number => {
  emit(ctx, "run", { runId, status, findings, ...data }, HUMAN[status](runId));
  report(ctx, findings);
  return status === "applied" || status === "nothing-to-undo" ? EXIT.ok : EXIT.refused;
};

const approved = (approval: Approval): boolean => approval.yes === true || approval.approve !== undefined;

const ask = (preview: PlanPreview): string =>
  `${showPlan(preview)}\nNothing changed. Run the command again with --yes, or with --approve ${preview.planHash} to apply exactly this plan.`;

export const plansShow = (ctx: Context, path: string): number => {
  const plan = loadPlan(ctx, path);
  if (typeof plan === "number") return plan;
  const preview = useCases.previewPlan(plan);
  emit(ctx, "plan", preview, showPlan(preview));
  return EXIT.ok;
};

// Prints what is applied (not with --json), applies it as one run and reports the run with `findings` first.
const applyShown = (ctx: Context, plan: Plan, { shown, findings, data }: Shown, approval: Approval): number => {
  if (!ctx.json) ctx.io.out(`${shown}\n`);
  const run = useCases.applyPlan(ctx.state, plan, approval);
  if (!run.ok) return fail(ctx, "run", [...findings, run.finding], EXIT.refused);
  return result(ctx, { ...run.value, findings: [...findings, ...run.value.findings] }, data);
};

interface Shown {
  readonly shown: string;
  readonly findings: Finding[];
  readonly data: object;
}

export const plansApply = (ctx: Context, path: string, approval: Approval): number => {
  const plan = loadPlan(ctx, path);
  if (typeof plan === "number") return plan;
  const preview = useCases.previewPlan(plan);
  if (!approved(approval)) {
    emit(ctx, "plan", preview, ask(preview));
    return EXIT.ok;
  }
  return applyShown(ctx, plan, { shown: showPlan(preview), findings: [], data: {} }, approval);
};

export const runsList = (ctx: Context): number => {
  const runs = useCases.listRuns(ctx.state);
  if (!runs.ok) return fail(ctx, "runs", [runs.finding], EXIT.refused);
  const lines = runs.value.map((run) => `${run.id}  ${run.kind.padEnd(5)}  ${run.status.padEnd(11)}  ${run.startedAt}`);
  emit(ctx, "runs", { runs: runs.value }, lines.length > 0 ? lines.join("\n") : "No runs yet.");
  return EXIT.ok;
};

export const runsShow = (ctx: Context, runId: string): number => {
  const shown = useCases.showRun(ctx.state, runId);
  if (!shown.ok) return readFailed(ctx, shown.finding);
  const { run, steps } = shown.value;
  const lines = steps.map((step) => `  ${step.state.padEnd(8)} ${step.path}`);
  emit(
    ctx,
    "run",
    { run, steps },
    [`Run ${run.id}: ${run.kind}, ${run.status}, ${run.startedAt}`, ...lines].join("\n"),
  );
  return EXIT.ok;
};

const previewUndo = (ctx: Context, runId: string): number => {
  const preview = useCases.previewUndo(ctx.state, runId);
  if (!preview.ok) return readFailed(ctx, preview.finding);
  const { value } = preview;
  emit(
    ctx,
    "plan",
    value,
    value.plan === null || value.planHash === null
      ? "Nothing to undo."
      : ask({ planHash: value.planHash, plan: value.plan }),
  );
  report(ctx, value.findings);
  return EXIT.ok;
};

export const runsUndo = (ctx: Context, runId: string, approval: Approval): number => {
  if (!approved(approval)) return previewUndo(ctx, runId);
  const show = (preview: PlanPreview): void => {
    if (!ctx.json) ctx.io.out(`${showPlan(preview)}\n`);
  };
  const undone = useCases.undoRun(ctx.state, runId, approval, show);
  return undone.ok ? result(ctx, undone.value) : fail(ctx, "run", [undone.finding], EXIT.refused);
};

export const doctor = (ctx: Context): number => {
  const findings = useCases.doctor(ctx.state);
  emit(ctx, "doctor", { findings }, findings.length > 0 ? "" : "No problems found.");
  report(ctx, findings, "out");
  return findings.some((finding) => findingInfo[finding.code].severity === "error") ? EXIT.refused : EXIT.ok;
};

// A finding before any plan, in the format of the command's result: an unreadable file exits 66, a file that is not the
// expected document 65, a rule 1.
const refused = (ctx: Context, format: "accounts" | "levels" | "plan", finding: Finding): number => {
  const code = finding.code === "document.unreadable" ? EXIT.noInput : EXIT.data;
  return fail(ctx, format, [finding], finding.code.startsWith("document.") ? code : EXIT.refused);
};

/**
 * Shows a planned change with `note` below it and its findings, or with --yes applies it as one run; `data` joins the
 * plan's JSON, and the findings join the plan's and the run's, so every output form carries them.
 */
const change = (ctx: Context, plan: Plan, { note, data, findings }: Change, yes?: true): number => {
  const preview = useCases.previewPlan(plan);
  if (yes === true) return applyShown(ctx, plan, { shown: `${showPlan(preview)}${note}`, findings, data }, { yes });
  const human = `${showPlan(preview)}${note}\nNothing changed. Run the command again with --yes.`;
  emit(ctx, "plan", { ...preview, ...data, findings }, human);
  report(ctx, findings);
  return EXIT.ok;
};

interface Change {
  readonly note: string;
  readonly data: object;
  readonly findings: Finding[];
}

export const accountsList = (ctx: Context): number => {
  const loaded = useCases.loadRegistry(ctx.config);
  if (!loaded.ok) return refused(ctx, "accounts", loaded.finding);
  const registry = loaded.value;
  const confirmed = (agent: Agent, pool: string): boolean =>
    registry !== null && useCases.isConfirmed(registry, { agent, pool });
  const pool = ({ agent, pool: name }: Account): string =>
    name === null ? "-" : `${name} (${confirmed(agent, name) ? "confirmed" : "not confirmed"})`;
  const lines = (registry?.accounts ?? []).map((a) => `${a.name}  ${a.agent}  ${pool(a)}  ${a.home}`);
  const none = "No accounts yet. Import BenchKeeper's with: cedarloom accounts import";
  // The derived state, as the choice sees it: a pool whose accounts changed since its confirmation is not confirmed.
  const pools = Agent.options.flatMap((agent) =>
    Object.keys(registry?.pools[agent] ?? {}).map((name) => ({ agent, pool: name })),
  );
  emit(
    ctx,
    "accounts",
    { registry, confirmed: pools.filter((p) => confirmed(p.agent, p.pool)) },
    lines.length > 0 ? lines.join("\n") : none,
  );
  return EXIT.ok;
};

export const accountsImport = (ctx: Context, { from, yes }: { from?: string; yes?: true }): number => {
  const planned = useCases.planImport(ctx.config, from ?? benchKeeperRegistry());
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  const { plan, left } = planned.value;
  const note = left.map(
    (each) => `\n  not imported: ${each.item}${each.account === null ? "" : ` of ${each.account}`}`,
  );
  return change(ctx, plan, { note: note.join(""), data: { left }, findings: [] }, yes);
};

export const accountsConfirm = (ctx: Context, pool: string, { agent, yes }: { agent: Agent; yes?: true }): number => {
  const planned = useCases.planConfirm(ctx.config, { agent, pool });
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  return change(ctx, planned.value.plan, { note: "", data: {}, findings: planned.value.findings }, yes);
};

const showLevels = (ctx: Context): number => {
  const settings = useCases.automationSettings(ctx.config);
  if (!settings.ok) return refused(ctx, "levels", settings.finding);
  const fallback = settings.value?.default ?? "supervised";
  const projects = settings.value?.projects ?? {};
  const own = Object.entries(projects).map(([folder, level]) => `${level.padEnd(10)}  ${folder}`);
  emit(ctx, "levels", { default: fallback, projects }, [`${fallback.padEnd(10)}  (default)`, ...own].join("\n"));
  return EXIT.ok;
};

/** Shows the default level and each project's own (`next` null), or plans the change `next`; --yes applies it. */
export const levelCommand = (ctx: Context, next: useCases.LevelChange | null, { yes }: { yes?: true }): number => {
  if (next === null) return showLevels(ctx);
  const planned = useCases.planLevel(ctx.config, next);
  if (!planned.ok) return refused(ctx, "plan", planned.finding);
  return change(ctx, planned.value, { note: "", data: {}, findings: [] }, yes);
};

const showMode = (ctx: Context): number => {
  const current = useCases.mode(ctx.state, ctx.config);
  if (!current.ok) return fail(ctx, "mode", [current.finding], EXIT.data);
  const { running } = current.value;
  const fallback = current.value.settings?.default ?? "supervised";
  const human =
    running === null
      ? `Running work follows each project's level; the default is ${fallback}.`
      : `Running work runs at ${running} from each run's next gate.`;
  emit(ctx, "mode", { running, default: fallback }, human);
  return EXIT.ok;
};

/** Shows the level of running work, or with a level (off: back to each project's) and --yes switches it. */
export const modeCommand = (
  ctx: Context,
  level: AutomationLevel | "off" | undefined,
  { yes }: { yes?: true },
): number => {
  if (level === undefined) return showMode(ctx);
  const next = level === "off" ? null : level;
  const what = next === null ? "Running work goes back to each project's level" : `Running work switches to ${next}`;
  if (yes !== true) {
    emit(
      ctx,
      "mode",
      { switch: next },
      `${what} at each run's next gate.\nNothing changed. Run the command again with --yes.`,
    );
    return EXIT.ok;
  }
  const switched = useCases.switchMode(ctx.state, next);
  if (!switched.ok) return fail(ctx, "mode", [switched.finding], EXIT.refused);
  emit(ctx, "mode", switched.value, `${what} at each run's next gate; the switch is in the ledger.`);
  return EXIT.ok;
};
