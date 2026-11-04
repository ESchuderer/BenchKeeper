import type { Finding, Operation, Plan, Result } from "@cedarloom/contracts";
import { type RunStore, type Step, sha256 } from "@cedarloom/ledger";
import { hashFile, readOrNull } from "./files.ts";

export interface UndoPlan {
  /** Null when nothing is left to undo. */
  plan: Plan | null;
  /** Files the run changed that were edited afterwards: left as they are. */
  skipped: Finding[];
}

const text = new TextDecoder("utf-8", { fatal: true });

const restore = (store: RunStore, runId: string, step: Step, actual: string | null): Result<Operation> => {
  if (step.before === null && actual !== null)
    return { ok: true, value: { kind: "delete", path: step.path, before: actual } };
  const params = { runId, path: step.path };
  const backup = readOrNull(store.backupPath(runId, step.index));
  if (backup === null) return { ok: false, finding: { code: "undo.backup-missing", params } };
  if (sha256(backup) !== step.before) return { ok: false, finding: { code: "undo.backup-changed", params } };
  let content: string;
  try {
    content = text.decode(backup);
  } catch {
    return { ok: false, finding: { code: "undo.not-text", params } };
  }
  const mode = step.mode === null ? {} : { mode: step.mode };
  return { ok: true, value: { kind: "write", path: step.path, before: actual, content, ...mode } };
};

/**
 * The plan that undoes a run, newest step first. Every step the run started counts, whatever its state: its file is
 * restored only while it still hashes as the run left it; a file edited since is skipped and reported.
 */
export const planUndo = (store: RunStore, runId: string): Result<UndoPlan> => {
  const detail = store.run(runId);
  if (detail === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
  const simulated = new Map<string, string | null>();
  const hashNow = (path: string): string | null =>
    simulated.has(path) ? (simulated.get(path) ?? null) : hashFile(path);
  const operations: Operation[] = [];
  const skipped: Finding[] = [];
  for (const step of detail.steps.toReversed().filter((s) => s.state === "running" || s.state === "done")) {
    const actual = hashNow(step.path);
    if (actual === step.before) continue;
    if (actual !== step.after) {
      skipped.push({ code: "undo.file-edited", params: { runId, path: step.path } });
      continue;
    }
    const op = restore(store, runId, step, actual);
    if (!op.ok) return op;
    operations.push(op.value);
    simulated.set(step.path, step.before);
  }
  return { ok: true, value: { plan: operations.length > 0 ? { schemaVersion: 1, operations } : null, skipped } };
};
