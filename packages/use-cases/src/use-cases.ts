import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import {
  type Finding,
  PLAN_SCHEMA_VERSION,
  Plan,
  type PlanPreview,
  type Result,
  type Run,
  type RunResult,
  readDocument,
  type Step,
  type UndoPreview,
} from "@cedarloom/contracts";
import { apply, errorCode, type Outcome, planUndo, recover } from "@cedarloom/engine";
import { openRunStore, openRunView, planHash, type RunStore, type RunView, sha256 } from "@cedarloom/ledger";

/** `yes` approves the plan as computed now, `approve` only the plan with that hash (it wins when both are given). */
export interface Approval {
  yes?: true | undefined;
  approve?: string | undefined;
}

const notFound = (runId: string): Result<never> => ({
  ok: false,
  finding: { code: "run.not-found", params: { runId } },
});

// An empty hash approves no plan, so a call without an approval is refused by the run store.
const approvedHash = (approval: Approval, plan: Plan): string =>
  approval.approve ?? (approval.yes === true ? planHash(plan) : "");

const BUSY_TRIES = 3;

/** Runs `work` again while another CedarLoom process holds the store: three tries, a second apart. */
export const retryBusy = async <T>(work: () => Result<T>): Promise<Result<T>> => {
  let result = work();
  for (let tries = 1; tries < BUSY_TRIES && !result.ok && result.finding.code === "store.busy"; tries += 1) {
    await setTimeout(1000);
    result = work();
  }
  return result;
};

/** Opens the store for a change, removes what interrupted runs left, and closes it again. */
export const withStore = <T>(state: string, work: (store: RunStore) => Result<T>): Result<T> => {
  const store = openRunStore(state);
  if (!store.ok) return store;
  try {
    recover(store.value);
    return work(store.value);
  } finally {
    store.value.close();
  }
};

/** Reads never write: no lock, no run, no state folder created; `null` when no run was ever recorded. */
export const withView = <T>(state: string, work: (view: RunView | null) => Result<T>): Result<T> => {
  const view = openRunView(state);
  if (!view.ok) return view;
  try {
    return work(view.value);
  } finally {
    view.value?.close();
  }
};

const settled = (outcome: Outcome, skipped: Finding[], undoes: string | null): RunResult => {
  const { runId, status } = outcome;
  const stopped: Finding[] =
    status === "failed" && runId !== null ? [{ code: "run.failed", params: { runId, undoes } }] : [];
  return { runId, status, findings: [...skipped, ...outcome.findings, ...stopped] };
};

/** The document a file's text holds: `document.invalid` for text that is no JSON, else as `read` decides. */
export const parseDocument = <T>(text: string, read: (json: unknown) => Result<T>): Result<T> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      finding: { code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } },
    };
  }
  return read(json);
};

/** Reads a JSON file with its text: `document.unreadable` when it cannot be read, `document.invalid` when it is no JSON. */
export const readJson = (path: string): Result<{ text: string; json: unknown }> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, finding: { code: "document.unreadable", params: { path, error: errorCode(error) } } };
  }
  return parseDocument(text, (json) => ({ ok: true, value: { text, json } }));
};

/** `readJson` with a missing file as null: only a missing file is none, and one the process cannot read is reported. */
export const readOptionalJson = (path: string): Result<{ text: string; json: unknown } | null> => {
  const file = readJson(path);
  if (file.ok) return file;
  const missing = file.finding.code === "document.unreadable" && file.finding.params.error === "ENOENT";
  return missing ? { ok: true, value: null } : file;
};

/** Reads a plan file: `document.unreadable`, or `document.invalid` and `document.newer-schema` for no plan this CedarLoom reads. */
export const loadPlan = (path: string): Result<Plan> => {
  const file = readJson(path);
  return file.ok ? readDocument(Plan, PLAN_SCHEMA_VERSION, file.value.json) : file;
};

export const previewPlan = (plan: Plan): PlanPreview => ({
  planHash: planHash(plan),
  plan: {
    schemaVersion: plan.schemaVersion,
    operations: plan.operations.map((op) => {
      if (op.kind === "delete") return op;
      const { content, ...rest } = op;
      return { ...rest, after: sha256(content), bytes: Buffer.byteLength(content) };
    }),
  },
});

/** Applies an approved plan as one run; fails only when the store cannot be opened. */
export const applyPlan = (state: string, plan: Plan, approval: Approval): Result<RunResult> =>
  withStore(state, (store) => ({
    ok: true,
    value: settled(apply(store, plan, approvedHash(approval, plan)), [], null),
  }));

/** The runs, newest first; one still marked running while no process holds the store shows as interrupted. */
export const listRuns = (state: string): Result<Run[]> =>
  withView(state, (view) => ({ ok: true, value: view?.current() ?? [] }));

export const showRun = (state: string, runId: string): Result<{ run: Run; steps: Step[] }> =>
  withView(state, (view) => {
    const detail = view?.run(runId);
    if (view === null || detail === undefined) return notFound(runId);
    const run = view.current().find((current) => current.id === runId) ?? detail.run;
    return { ok: true, value: { run, steps: detail.steps } };
  });

/** Plans the undo of a run and writes nothing. */
export const previewUndo = (state: string, runId: string): Result<UndoPreview> =>
  withView(state, (view) => {
    const planned = view === null ? notFound(runId) : planUndo(view, runId);
    if (!planned.ok) return planned;
    const { plan, skipped: findings } = planned.value;
    return { ok: true, value: { ...(plan === null ? { planHash: null, plan: null } : previewPlan(plan)), findings } };
  });

/**
 * Plans the undo of a run under the store's lock and applies it, as approved, as a run of its own; `onPlan` sees the
 * plan before anything is written.
 */
export const undoRun = (
  state: string,
  runId: string,
  approval: Approval,
  onPlan: (preview: PlanPreview) => void = () => undefined,
): Result<RunResult> =>
  withStore<RunResult>(state, (store) => {
    const planned = planUndo(store, runId);
    if (!planned.ok) return planned;
    const { plan, skipped } = planned.value;
    if (plan === null) return { ok: true, value: { runId: null, status: "nothing-to-undo", findings: skipped } };
    onPlan(previewPlan(plan));
    const outcome = apply(store, plan, approvedHash(approval, plan), { kind: "undo", undoes: runId });
    return { ok: true, value: settled(outcome, skipped, runId) };
  });

/** Interrupted and failed runs no undo has dealt with, and a store this CedarLoom cannot read. */
export const doctor = (state: string): Finding[] => {
  const problems = withView(state, (view) => ({ ok: true, value: view?.problems() ?? [] }));
  return problems.ok ? problems.value : [problems.finding];
};
