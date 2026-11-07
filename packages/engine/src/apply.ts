import { isAbsolute, resolve } from "node:path";
import type { Finding, Operation, Plan, Result, StoreUpdate } from "@cedarloom/contracts";
import { type RunStore, sha256 } from "@cedarloom/ledger";
import { asidePath, backUp, errorCode, hashFile, isSymlink, remove, tempPath, writeStep } from "./files.ts";

/**
 * Points between the crash-ordered steps of one operation. "set-aside": the file the step replaces or deletes is moved
 * aside and checked (a new file: its content is ready), and the path is free for the new file.
 */
export type Phase = "backed-up" | "journaled" | "set-aside" | "written" | "settled";

/** The workflow store's branch, which `store.update` operations move (the git package's store). */
export interface StoreBranch {
  head: () => string | null;
  move: (after: string | null, before: string | null) => Result<null>;
}

type FileOperation = Exclude<Operation, StoreUpdate>;

export interface ApplyOptions {
  /** Without it, every `store.update` is refused as a moved branch. */
  branch?: StoreBranch;
  kind?: "apply" | "undo";
  undoes?: string | null;
  /** Called after each phase; tests use it to crash or race at every point. */
  onPhase?: (index: number, phase: Phase) => void;
  /** Called with the run's id once it is recorded, before it writes anything; a throw stops the run, failed. */
  onBegun?: (runId: string) => void;
}

export interface Outcome {
  runId: string | null;
  status: "applied" | "failed" | "refused";
  findings: Finding[];
}

const BACKUP_DAYS = 90;
export const NO_BRANCH: StoreBranch = {
  head: () => null,
  move: () => ({ ok: false, finding: { code: "git.failed", params: { step: "update", error: "no workflow store" } } }),
};

const targetProblem = (op: FileOperation, actual: string | null): Finding | undefined => {
  if (isSymlink(op.path)) return { code: "apply.symlink", params: { path: op.path } };
  if (actual !== op.before)
    return { code: "plan.file-changed", params: { path: op.path, expected: op.before, actual } };
  return undefined;
};

/** A path's first operation: an absolute, normalized path to a regular file (or none) that hashes as the plan expects. */
const firstProblem = (op: FileOperation): Finding | undefined => {
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
const operationProblem = (
  op: FileOperation,
  index: number,
  expected: string | null | undefined,
): Finding | undefined => {
  if (expected === undefined) return firstProblem(op);
  if (op.before === expected) return undefined;
  return { code: "plan.chain-broken", params: { path: op.path, index, expected, found: op.before } };
};

const moved = (op: StoreUpdate, actual: string | null): Finding => ({
  code: "store.moved",
  params: { ref: op.ref, expected: op.before, actual },
});

/** The branch where the operations before it leave it, or where it is now, must be where the operation expects it. */
const branchProblem = (
  op: StoreUpdate,
  expected: string | null | undefined,
  branch: StoreBranch,
): Finding | undefined => {
  const actual = expected === undefined ? branch.head() : expected;
  return actual === op.before ? undefined : moved(op, actual);
};

// What an operation leaves at its path or branch: the written file's hash, the branch's new commit, or nothing.
const leaves = (op: Operation): string | null => {
  if (op.kind === "write") return sha256(op.content);
  return op.kind === "store.update" ? op.after : null;
};

const planProblems = (plan: Plan, branch: StoreBranch): Finding[] => {
  const next = new Map<string, string | null>();
  const problems: Finding[] = [];
  for (const [index, op] of plan.operations.entries()) {
    const key = op.kind === "store.update" ? op.ref : op.path;
    const problem =
      op.kind === "store.update"
        ? branchProblem(op, next.get(key), branch)
        : operationProblem(op, index, next.get(key));
    if (problem !== undefined) problems.push(problem);
    next.set(key, leaves(op));
  }
  return problems;
};

interface Run {
  store: RunStore;
  runId: string;
  branch: StoreBranch;
  onPhase: Required<ApplyOptions>["onPhase"];
}

/** What took the file's place: its hash, or (a folder, say) not a file at all, as the plan check reports it. */
const changedFinding = (op: FileOperation): Finding => {
  try {
    return { code: "plan.file-changed", params: { path: op.path, expected: op.before, actual: hashFile(op.path) } };
  } catch (error) {
    return { code: "plan.not-a-file", params: { path: op.path, error: errorCode(error) } };
  }
};

const change = (run: Run, index: number, op: FileOperation, mode: number | null): Finding | undefined => {
  const aside = asidePath(op.path, run.runId, index);
  const onSetAside = (): void => run.onPhase(index, "set-aside");
  try {
    if (op.kind === "delete") remove(op.path, op.before, aside, onSetAside);
    else {
      const temp = tempPath(op.path, run.runId, index);
      writeStep({ path: op.path, before: op.before, temp, aside }, op.content, mode ?? op.mode, onSetAside);
    }
    return undefined;
  } catch (error) {
    const code = errorCode(error);
    if (code !== "ECHANGED") return { code: "apply.write-failed", params: { path: op.path, error: code } };
    return changedFinding(op);
  }
};

/** Backs up an existing file and checks the copy against the precondition; returns the file's mode or the problem. */
const backup = ({ store, runId }: Run, index: number, op: FileOperation): Finding | number | null => {
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
const step = (run: Run, index: number, op: FileOperation): Finding | undefined => {
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

/** Journal `running`, move the branch only while it is where the plan found it, journal `done`. */
const branchStep = (run: Run, index: number, op: StoreUpdate): Finding | undefined => {
  run.store.start(run.runId, index, null);
  run.onPhase(index, "journaled");
  const done = run.branch.move(op.after, op.before);
  if (!done.ok) {
    // A branch still at `before` did not move for another reason, such as a lock another git holds: git's error.
    const actual = run.branch.head();
    return actual === op.before ? done.finding : moved(op, actual);
  }
  run.onPhase(index, "written");
  run.store.settle(run.runId, index, "done");
  run.onPhase(index, "settled");
  return undefined;
};

const steps = (run: Run, plan: Plan): Finding | undefined => {
  for (const [index, op] of plan.operations.entries()) {
    const finding = op.kind === "store.update" ? branchStep(run, index, op) : step(run, index, op);
    if (finding !== undefined) return finding;
  }
  return undefined;
};

const onPhaseOf = (options: ApplyOptions): Run["onPhase"] => options.onPhase ?? (() => undefined);
const onBegunOf = (options: ApplyOptions): Required<ApplyOptions>["onBegun"] => options.onBegun ?? (() => undefined);

/** Applies an approved plan as one run; stops at the first operation that fails and leaves the run for undo. */
export const apply = (store: RunStore, plan: Plan, approvedHash: string, options: ApplyOptions = {}): Outcome => {
  const branch = options.branch ?? NO_BRANCH;
  const problems = planProblems(plan, branch);
  if (problems.length > 0) return { runId: null, status: "refused", findings: problems };
  const begun = store.begin(options.kind ?? "apply", plan, approvedHash, options.undoes ?? null);
  if (!begun.ok) return { runId: null, status: "refused", findings: [begun.finding] };
  const runId = begun.value;
  let finding: Finding | undefined;
  try {
    onBegunOf(options)(runId);
    store.prune(BACKUP_DAYS);
    finding = steps({ store, runId, branch, onPhase: onPhaseOf(options) }, plan);
  } catch (error) {
    store.finish(runId, "failed");
    throw error;
  }
  const findings = finding === undefined ? [] : [finding];
  const status = finding === undefined ? "applied" : "failed";
  store.finish(runId, status);
  return { runId, status, findings };
};
