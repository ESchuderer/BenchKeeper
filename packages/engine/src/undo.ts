import type { Finding, Operation, Plan, Result } from "@cedarloom/contracts";
import { type RunView, type Step, sha256 } from "@cedarloom/ledger";
import { hashFile, readOrNull } from "./files.ts";

export interface UndoPlan {
  /** Null when nothing is left to undo. */
  plan: Plan | null;
  /** Files the run changed that were edited afterwards: left as they are. */
  skipped: Finding[];
}

// Apply refuses files that are not UTF-8, so a backup whose hash matches decodes; the byte order mark stays.
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const restore = (store: RunView, runId: string, step: Step, actual: string | null): Result<Operation> => {
  if (step.before === null && actual !== null)
    return { ok: true, value: { kind: "delete", path: step.path, before: actual } };
  const params = { runId, path: step.path };
  const backup = readOrNull(store.backupPath(runId, step.index));
  if (backup === null) return { ok: false, finding: { code: "undo.backup-missing", params } };
  if (sha256(backup) !== step.before) return { ok: false, finding: { code: "undo.backup-changed", params } };
  const mode = step.mode === null ? {} : { mode: step.mode };
  return { ok: true, value: { kind: "write", path: step.path, before: actual, content: text.decode(backup), ...mode } };
};

type Next = "restore" | "pass" | "edited";

/** Per path, newest step first: restore while the file hashes as the step left it; a step that never wrote passes. */
const next = (step: Step, actual: string | null, original: string | null | undefined): Next => {
  if (actual === step.after) return "restore";
  if (step.state === "running" && actual === step.before) return "pass";
  return actual === original ? "pass" : "edited";
};

/**
 * The plan that undoes a run, newest step first. Every step the run started counts, whatever its state. A path whose
 * file holds neither what the run left nor what it found (an edit since, also back to an intermediate version) is
 * skipped and reported; one that already holds its content from before the run needs nothing.
 */
interface Walk {
  store: RunView;
  runId: string;
  /** Each path's hash before the run's first change to it. */
  original: Map<string, string | null>;
  /** Each path's hash once the operations planned so far ran. */
  now: Map<string, string | null>;
  edited: Set<string>;
  operations: Operation[];
}

const visit = (walk: Walk, step: Step): Finding | undefined => {
  if (walk.edited.has(step.path)) return undefined;
  const actual = walk.now.has(step.path) ? (walk.now.get(step.path) ?? null) : hashFile(step.path);
  const verdict = next(step, actual, walk.original.get(step.path));
  if (verdict === "edited") walk.edited.add(step.path);
  if (verdict !== "restore") return undefined;
  const op = restore(walk.store, walk.runId, step, actual);
  if (!op.ok) return op.finding;
  walk.operations.push(op.value);
  walk.now.set(step.path, step.before);
  return undefined;
};

export const planUndo = (store: RunView, runId: string): Result<UndoPlan> => {
  const detail = store.run(runId);
  if (detail === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
  const started = detail.steps.filter((step) => step.state === "running" || step.state === "done");
  const walk: Walk = { store, runId, original: new Map(), now: new Map(), edited: new Set(), operations: [] };
  for (const step of started) if (!walk.original.has(step.path)) walk.original.set(step.path, step.before);
  for (const step of started.toReversed()) {
    const refused = visit(walk, step);
    if (refused !== undefined) return { ok: false, finding: refused };
  }
  const skipped = [...walk.edited].map((path): Finding => ({ code: "undo.file-edited", params: { runId, path } }));
  const plan: Plan | null = walk.operations.length > 0 ? { schemaVersion: 1, operations: walk.operations } : null;
  return { ok: true, value: { plan, skipped } };
};
