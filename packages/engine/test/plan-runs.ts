import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Operation, Plan } from "@cedarloom/contracts";
import { type ApplyOptions, apply, type Outcome, planUndo } from "@cedarloom/engine";
import { openRunStore, planHash, type RunStore, sha256 } from "@cedarloom/ledger";

export const hash = (text: string): string => sha256(text);
export const plan = (...operations: Operation[]): Plan => ({ schemaVersion: 1, operations });
export const read = (path: string): string => readFileSync(path, "utf8");
export const modeOf = (path: string): number => statSync(path).mode & 0o777;

/** A temporary folder with a run store in `state/` and files next to it. */
export const workspace = (): {
  root: string;
  state: string;
  file: (name: string, text?: string, mode?: number) => string;
} => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-engine-"));
  const file = (name: string, text?: string, mode?: number): string => {
    const path = join(root, name);
    if (text !== undefined) writeFileSync(path, text);
    if (mode !== undefined) chmodSync(path, mode);
    return path;
  };
  return { root, state: join(root, "state"), file };
};

export const storeAt = (dir: string): RunStore => {
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  return store.value;
};

export const run = (store: RunStore, value: Plan, options?: ApplyOptions): Outcome =>
  apply(store, value, planHash(value), options);

/** A run of `value` in the store at `dir` whose first step started and never finished; returns the run's id. */
export const interruptedRun = (dir: string, value: Plan): string => {
  const store = storeAt(dir);
  const begun = store.begin("apply", value, planHash(value));
  if (!begun.ok) throw new Error(begun.finding.code);
  store.start(begun.value, 0, 0o644);
  store.close();
  // An earlier open marked the run interrupted and the process died before recover ran.
  storeAt(dir).close();
  return begun.value;
};

/** Plans the undo of a run and applies it as approved; returns the skipped files too. */
export const undo = (store: RunStore, runId: string | null): Outcome & { skipped: string[] } => {
  const planned = planUndo(store, runId ?? "");
  if (!planned.ok) return { runId: null, status: "refused", findings: [planned.finding], skipped: [] };
  const skipped = planned.value.skipped.map((finding) => finding.code);
  if (planned.value.plan === null) return { runId: null, status: "applied", findings: [], skipped };
  return { ...run(store, planned.value.plan, { kind: "undo", undoes: runId }), skipped };
};
