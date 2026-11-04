import { readFileSync } from "node:fs";
import { type Finding, findingInfo, Plan, readDocument } from "@cedarloom/contracts";
import { apply, errorCode, type Outcome, planUndo, recover } from "@cedarloom/engine";
import { openRunStore, openRunView, planHash, type Run, type RunStore, type RunView } from "@cedarloom/ledger";
import { type Context, EXIT, emit, fail, report, showPlan } from "./output.ts";

const loadPlan = (ctx: Context, path: string): Plan | number => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return fail(
      ctx,
      "plan",
      [{ code: "document.unreadable", params: { path, error: errorCode(error) } }],
      EXIT.noInput,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail(
      ctx,
      "plan",
      [{ code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } }],
      EXIT.data,
    );
  }
  const plan = readDocument(Plan, 1, json);
  return plan.ok ? plan.value : fail(ctx, "plan", [plan.finding], EXIT.data);
};

const withStore = (ctx: Context, work: (store: RunStore) => number): number => {
  const store = openRunStore(ctx.state);
  if (!store.ok) return fail(ctx, "run", [store.finding], EXIT.refused);
  try {
    recover(store.value);
    return work(store.value);
  } finally {
    store.value.close();
  }
};

/** Reads never write: no lock, no run, no state folder created. */
const withView = (ctx: Context, work: (view: RunView | null) => number): number => {
  const view = openRunView(ctx.state);
  if (!view.ok) return fail(ctx, "runs", [view.finding], EXIT.refused);
  try {
    return work(view.value);
  } finally {
    view.value?.close();
  }
};

const result = (ctx: Context, outcome: Outcome, skipped: Finding[] = []): number => {
  const findings = [...skipped, ...outcome.findings];
  const done = outcome.status === "applied";
  emit(
    ctx,
    "run",
    { runId: outcome.runId, status: outcome.status, findings },
    done ? `Run ${outcome.runId} applied.` : "",
  );
  report(ctx, findings);
  return done ? EXIT.ok : EXIT.refused;
};

const ASK = "Nothing changed. Run the command again with --yes to apply this plan.";

export const plansShow = (ctx: Context, path: string): number => {
  const plan = loadPlan(ctx, path);
  if (typeof plan === "number") return plan;
  emit(ctx, "plan", { planHash: planHash(plan), plan }, showPlan(plan));
  return EXIT.ok;
};

export const plansApply = (ctx: Context, path: string, yes: boolean): number => {
  const plan = loadPlan(ctx, path);
  if (typeof plan === "number") return plan;
  if (!yes) {
    emit(ctx, "plan", { planHash: planHash(plan), plan }, `${showPlan(plan)}\n${ASK}`);
    return EXIT.ok;
  }
  if (!ctx.json) ctx.io.out(`${showPlan(plan)}\n`);
  return withStore(ctx, (store) => result(ctx, apply(store, plan, planHash(plan))));
};

/** A run a dead process left running shows as interrupted, also before a store opened and marked it. */
const statusOf = (run: Run, held: boolean): string => (run.status === "running" && !held ? "interrupted" : run.status);

export const runsList = (ctx: Context): number =>
  withView(ctx, (view) => {
    const held = view?.held() ?? false;
    const runs = (view?.runs() ?? []).map((run) => ({ ...run, status: statusOf(run, held) }));
    const lines = runs.map((run) => `${run.id}  ${run.kind.padEnd(5)}  ${run.status.padEnd(11)}  ${run.startedAt}`);
    emit(ctx, "runs", { runs }, lines.length > 0 ? lines.join("\n") : "No runs yet.");
    return EXIT.ok;
  });

export const runsShow = (ctx: Context, runId: string): number =>
  withView(ctx, (view) => {
    const detail = view?.run(runId);
    if (view === null || detail === undefined)
      return fail(ctx, "run", [{ code: "run.not-found", params: { runId } }], EXIT.refused);
    const run = { ...detail.run, status: statusOf(detail.run, view.held()) };
    const steps = detail.steps.map((step) => `  ${step.state.padEnd(8)} ${step.path}`);
    emit(
      ctx,
      "run",
      { run, steps: detail.steps },
      [`Run ${run.id}: ${run.kind}, ${run.status}, ${run.startedAt}`, ...steps].join("\n"),
    );
    return EXIT.ok;
  });

const previewUndo = (ctx: Context, runId: string): number =>
  withView(ctx, (view) => {
    const planned = view === null ? null : planUndo(view, runId);
    if (planned === null) return fail(ctx, "run", [{ code: "run.not-found", params: { runId } }], EXIT.refused);
    if (!planned.ok) return fail(ctx, "run", [planned.finding], EXIT.refused);
    const { plan, skipped } = planned.value;
    emit(
      ctx,
      "plan",
      { planHash: plan && planHash(plan), plan, findings: skipped },
      plan ? `${showPlan(plan)}\n${ASK}` : "Nothing to undo.",
    );
    report(ctx, skipped);
    return EXIT.ok;
  });

export const runsUndo = (ctx: Context, runId: string, yes: boolean): number => {
  if (!yes) return previewUndo(ctx, runId);
  return withStore(ctx, (store) => {
    const planned = planUndo(store, runId);
    if (!planned.ok) return fail(ctx, "run", [planned.finding], EXIT.refused);
    const { plan, skipped } = planned.value;
    if (plan === null) {
      emit(ctx, "run", { runId: null, status: "nothing-to-undo", findings: skipped }, "Nothing to undo.");
      report(ctx, skipped);
      return EXIT.ok;
    }
    if (!ctx.json) ctx.io.out(`${showPlan(plan)}\n`);
    return result(ctx, apply(store, plan, planHash(plan), { kind: "undo", undoes: runId }), skipped);
  });
};

export const doctor = (ctx: Context): number => {
  const view = openRunView(ctx.state);
  const findings: Finding[] = view.ok ? [] : [view.finding];
  if (view.ok && view.value !== null) {
    const held = view.value.held();
    for (const run of view.value.runs()) {
      if (statusOf(run, held) === "interrupted") findings.push({ code: "run.interrupted", params: { runId: run.id } });
    }
    view.value.close();
  }
  emit(ctx, "doctor", { findings }, findings.length > 0 ? "" : "No problems found.");
  report(ctx, findings, "out");
  return findings.some((finding) => findingInfo[finding.code].severity === "error") ? EXIT.refused : EXIT.ok;
};
