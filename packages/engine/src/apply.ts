import type { Finding, Operation, Plan } from "@cedarloom/contracts";
import { type RunStore, sha256 } from "@cedarloom/ledger";
import { backUp, errorCode, hashFile, remove, writeAtomic } from "./files.ts";

/** Points between the crash-ordered steps of one operation. */
export type Phase = "backed-up" | "journaled" | "written" | "settled";

export interface ApplyOptions {
  kind?: "apply" | "undo";
  undoes?: string | null;
  /** Called after each phase; tests use it to crash or race at every point. */
  onPhase?: (index: number, phase: Phase) => void;
}

export interface Outcome {
  runId: string | null;
  status: "applied" | "failed" | "refused";
  findings: Finding[];
}

const BACKUP_DAYS = 90;

/** The first operation on each path against the file as it is now: a stale plan records no run. */
const staleFiles = (plan: Plan): Finding[] => {
  const first = new Map<string, Operation>();
  for (const op of plan.operations) if (!first.has(op.path)) first.set(op.path, op);
  return [...first.values()].flatMap((op): Finding[] => {
    const actual = hashFile(op.path);
    return actual === op.before
      ? []
      : [{ code: "plan.file-changed", params: { path: op.path, expected: op.before, actual } }];
  });
};

const change = (op: Operation, mode: number | null): void => {
  if (op.kind === "delete") remove(op.path);
  else writeAtomic(op.path, op.content, mode ?? op.mode);
};

interface Run {
  store: RunStore;
  runId: string;
  onPhase: Required<ApplyOptions>["onPhase"];
}

/** Backup, journal `running`, write, check the written hash, journal `done`: a crash at any point leaves an undoable run. */
const step = ({ store, runId, onPhase }: Run, index: number, op: Operation): Finding | undefined => {
  const { path, before } = op;
  // The precondition is checked on the backed-up bytes themselves: no window between the check and the copy.
  let copy = { hash: hashFile(path), mode: 0 };
  try {
    if (before !== null) copy = backUp(path, store.backupPath(runId, index));
  } catch (error) {
    return { code: "apply.backup-failed", params: { path, error: errorCode(error) } };
  }
  if (copy.hash !== before) return { code: "plan.file-changed", params: { path, expected: before, actual: copy.hash } };
  const mode = before === null ? null : copy.mode;
  onPhase(index, "backed-up");
  store.start(runId, index, before !== null, mode);
  onPhase(index, "journaled");
  try {
    change(op, mode);
  } catch (error) {
    return { code: "apply.write-failed", params: { path, error: errorCode(error) } };
  }
  onPhase(index, "written");
  const expected = op.kind === "write" ? sha256(op.content) : null;
  const written = hashFile(path);
  if (written !== expected) return { code: "apply.write-mismatch", params: { path, expected, actual: written } };
  store.settle(runId, index, "done");
  onPhase(index, "settled");
  return undefined;
};

/** Applies an approved plan as one run; stops at the first operation that fails and leaves the run for undo. */
export const apply = (store: RunStore, plan: Plan, approvedHash: string, options: ApplyOptions = {}): Outcome => {
  const stale = staleFiles(plan);
  if (stale.length > 0) return { runId: null, status: "refused", findings: stale };
  store.prune(BACKUP_DAYS);
  const begun = store.begin(options.kind ?? "apply", plan, approvedHash, options.undoes ?? null);
  if (!begun.ok) return { runId: null, status: "refused", findings: [begun.finding] };
  const runId = begun.value;
  const run = { store, runId, onPhase: options.onPhase ?? (() => undefined) };
  for (const [index, op] of plan.operations.entries()) {
    const finding = step(run, index, op);
    if (finding !== undefined) {
      store.finish(runId, "failed");
      return { runId, status: "failed", findings: [finding] };
    }
  }
  store.finish(runId, "applied");
  return { runId, status: "applied", findings: [] };
};
