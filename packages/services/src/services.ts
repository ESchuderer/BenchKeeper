import { readFileSync } from "node:fs";
import {
  type Finding,
  type Operation,
  PLAN_SCHEMA_VERSION,
  Plan,
  type Result,
  readDocument,
} from "@cedarloom/contracts";
import { apply, errorCode, type Outcome, planUndo, recover, type UndoPlan } from "@cedarloom/engine";
import {
  openRunStore,
  openRunView,
  planHash,
  type Run,
  type RunStore,
  type RunView,
  sha256,
  type Step,
} from "@cedarloom/ledger";

type WriteFile = Extract<Operation, { kind: "write" }>;

/** A plan as previews show it: no file contents, which can hold secrets, but their hash and size. */
export type PlanPreview = {
  planHash: string;
  plan: {
    schemaVersion: Plan["schemaVersion"];
    operations: (Exclude<Operation, WriteFile> | (Omit<WriteFile, "content"> & { after: string; bytes: number }))[];
  };
};

/** `yes` approves the plan as computed now, `approve` only the plan with that hash (it wins when both are given). */
export interface Approval {
  yes?: true | undefined;
  approve?: string | undefined;
}

/** How a change ended; a run that stopped midway carries a `run.failed` finding that names it and its undo. */
export interface RunResult {
  runId: string | null;
  status: Outcome["status"] | "nothing-to-undo";
  findings: Finding[];
}

/** An undo's result with the plan it applied: null when nothing was left to undo. */
export interface UndoResult extends RunResult {
  plan: Plan | null;
}

const notFound = (runId: string): Result<never> => ({
  ok: false,
  finding: { code: "run.not-found", params: { runId } },
});

// An empty hash approves no plan, so a call without an approval is refused by the run store.
const approvedHash = (approval: Approval, plan: Plan): string =>
  approval.approve ?? (approval.yes ? planHash(plan) : "");

/** Opens the store for a change, removes what interrupted runs left, and closes it again. */
const withStore = <T>(state: string, work: (store: RunStore) => Result<T>): Result<T> => {
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
const withView = <T>(state: string, work: (view: RunView | null) => Result<T>): Result<T> => {
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

/** Reads a plan file: `document.unreadable`, or `document.invalid` and `document.newer-schema` for no plan this CedarLoom reads. */
export const loadPlan = (path: string): Result<Plan> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, finding: { code: "document.unreadable", params: { path, error: errorCode(error) } } };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      finding: { code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } },
    };
  }
  return readDocument(Plan, PLAN_SCHEMA_VERSION, json);
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

/** The plan that would undo a run and the files it would leave because they were edited since; writes nothing. */
export const previewUndo = (state: string, runId: string): Result<UndoPlan> =>
  withView(state, (view) => (view === null ? notFound(runId) : planUndo(view, runId)));

/** Plans the undo of a run under the store's lock and applies it, as approved, as a run of its own. */
export const undoRun = (state: string, runId: string, approval: Approval): Result<UndoResult> =>
  withStore<UndoResult>(state, (store) => {
    const planned = planUndo(store, runId);
    if (!planned.ok) return planned;
    const { plan, skipped } = planned.value;
    if (plan === null) return { ok: true, value: { plan, runId: null, status: "nothing-to-undo", findings: skipped } };
    const outcome = apply(store, plan, approvedHash(approval, plan), { kind: "undo", undoes: runId });
    return { ok: true, value: { plan, ...settled(outcome, skipped, runId) } };
  });

/** Interrupted and failed runs no undo has dealt with, and a store this CedarLoom cannot read. */
export const doctor = (state: string): Finding[] => {
  const problems = withView(state, (view) => ({ ok: true, value: view?.problems() ?? [] }));
  return problems.ok ? problems.value : [problems.finding];
};
