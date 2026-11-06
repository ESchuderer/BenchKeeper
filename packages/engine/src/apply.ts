import { isAbsolute, resolve } from "node:path";
import type { Finding, Operation, Plan } from "@cedarloom/contracts";
import { type RunStore, sha256 } from "@cedarloom/ledger";
import { asidePath, backUp, errorCode, hashFile, isSymlink, remove, tempPath, writeStep } from "./files.ts";

/**
 * Points between the crash-ordered steps of one operation. "set-aside": the file the step replaces or deletes is moved
 * aside and checked (a new file: its content is ready), and the path is free for the new file.
 */
export type Phase = "backed-up" | "journaled" | "set-aside" | "written" | "settled";

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

const targetProblem = (op: Operation, actual: string | null): Finding | undefined => {
  if (isSymlink(op.path)) return { code: "apply.symlink", params: { path: op.path } };
  if (actual !== op.before)
    return { code: "plan.file-changed", params: { path: op.path, expected: op.before, actual } };
  return undefined;
};

/** A path's first operation: an absolute, normalized path to a regular file (or none) that hashes as the plan expects. */
const firstProblem = (op: Operation): Finding | undefined => {
  if (!isAbsolute(op.path) || resolve(op.path) !== op.path)
    return { code: "plan.path-not-absolute", params: { path: op.path } };
  try {
    return targetProblem(op, hashFile(op.path));
  } catch (error) {
    return { code: "plan.not-a-file", params: { path: op.path, error: errorCode(error) } };
  }
};

/**
 * Every operation before anything is written: a path's first one against the file now, each later one against the
 * hash the operations before it leave, so a plan whose chain breaks writes nothing.
 */
const operationProblem = (op: Operation, index: number, expected: string | null | undefined): Finding | undefined => {
  if (expected === undefined) return firstProblem(op);
  if (op.before === expected) return undefined;
  return { code: "plan.chain-broken", params: { path: op.path, index, expected, found: op.before } };
};

const planProblems = (plan: Plan): Finding[] => {
  const next = new Map<string, string | null>();
  const problems: Finding[] = [];
  for (const [index, op] of plan.operations.entries()) {
    const problem = operationProblem(op, index, next.get(op.path));
    if (problem !== undefined) problems.push(problem);
    next.set(op.path, op.kind === "write" ? sha256(op.content) : null);
  }
  return problems;
};

interface Run {
  store: RunStore;
  runId: string;
  onPhase: Required<ApplyOptions>["onPhase"];
}

/** What took the file's place: its hash, or (a folder, say) not a file at all, as the plan check reports it. */
const changedFinding = (op: Operation): Finding => {
  try {
    return { code: "plan.file-changed", params: { path: op.path, expected: op.before, actual: hashFile(op.path) } };
  } catch (error) {
    return { code: "plan.not-a-file", params: { path: op.path, error: errorCode(error) } };
  }
};

const change = (run: Run, index: number, op: Operation, mode: number | null): Finding | undefined => {
  const aside = asidePath(op.path, run.runId, index);
  const onSetAside = (): void => run.onPhase(index, "set-aside");
  try {
    if (op.kind === "delete") remove(op.path, op.before, aside, onSetAside);
    else {
      const temp = tempPath(op.path, run.runId, index);
      // The planned mode wins, so a file that gets a secret becomes private, and undo restores the mode it had.
      writeStep(
        { path: op.path, before: op.before, temp, aside },
        op.content,
        op.mode ?? mode ?? undefined,
        onSetAside,
      );
    }
    return undefined;
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ECHANGED") return { code: "apply.write-failed", params: { path: op.path, error: code } };
    return changedFinding(op);
  }
};

/** Backs up an existing file and checks the copy against the precondition; returns the file's mode or the problem. */
const backup = ({ store, runId }: Run, index: number, op: Operation): Finding | number | null => {
  const { path, before } = op;
  let copy = { hash: hashFile(path), mode: 0, text: true };
  try {
    if (before !== null && !isSymlink(path)) copy = backUp(path, store.backupPath(runId, index));
  } catch (error) {
    return { code: "apply.backup-failed", params: { path, error: errorCode(error) } };
  }
  const problem =
    targetProblem(op, copy.hash) ?? (copy.text ? undefined : { code: "apply.not-text", params: { path } });
  return problem ?? (before === null ? null : copy.mode);
};

/** Backup checked against the precondition, journal `running`, write, check the written hash, journal `done`. */
const step = (run: Run, index: number, op: Operation): Finding | undefined => {
  const { store, runId, onPhase } = run;
  const mode = backup(run, index, op);
  if (mode !== null && typeof mode === "object") return mode;
  onPhase(index, "backed-up");
  store.start(runId, index, mode);
  onPhase(index, "journaled");
  const failed = change(run, index, op, mode);
  if (failed !== undefined) return failed;
  onPhase(index, "written");
  const expected = op.kind === "write" ? sha256(op.content) : null;
  const written = hashFile(op.path);
  if (written !== expected)
    return { code: "apply.write-mismatch", params: { path: op.path, expected, actual: written } };
  store.settle(runId, index, "done");
  onPhase(index, "settled");
  return undefined;
};

const steps = (run: Run, plan: Plan): Finding | undefined => {
  for (const [index, op] of plan.operations.entries()) {
    const finding = step(run, index, op);
    if (finding !== undefined) return finding;
  }
  return undefined;
};

/** Applies an approved plan as one run; stops at the first operation that fails and leaves the run for undo. */
export const apply = (store: RunStore, plan: Plan, approvedHash: string, options: ApplyOptions = {}): Outcome => {
  const problems = planProblems(plan);
  if (problems.length > 0) return { runId: null, status: "refused", findings: problems };
  const begun = store.begin(options.kind ?? "apply", plan, approvedHash, options.undoes ?? null);
  if (!begun.ok) return { runId: null, status: "refused", findings: [begun.finding] };
  const runId = begun.value;
  let finding: Finding | undefined;
  try {
    store.prune(BACKUP_DAYS);
    finding = steps({ store, runId, onPhase: options.onPhase ?? (() => undefined) }, plan);
  } catch (error) {
    store.finish(runId, "failed");
    throw error;
  }
  const findings = finding === undefined ? [] : [finding];
  const status = finding === undefined ? "applied" : "failed";
  store.finish(runId, status);
  return { runId, status, findings };
};
