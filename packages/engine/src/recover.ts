import { type BigIntStats, lstatSync, renameSync, rmSync, unlinkSync } from "node:fs";
import type { Step } from "@cedarloom/contracts";
import type { RunStore } from "@cedarloom/ledger";
import { asidePath, hashFile, putBack, tempPath } from "./files.ts";

// The step's file is in and the aside holds what it found; only regular files are read, so a folder stops nothing.
const replaced = (step: Step, aside: string, target: BigIntStats, moved: BigIntStats): boolean =>
  target.isFile() && moved.isFile() && hashFile(step.path) === step.after && hashFile(aside) === step.before;

// A dead step's aside: back if the path is empty, gone if it is the path's or a finished step's, else kept (an edit).
const settleAside = (step: Step, aside: string): void => {
  // 64-bit ids: as numbers, Windows file ids lose precision, and two files could look like one.
  const moved = lstatSync(aside, { throwIfNoEntry: false, bigint: true });
  if (moved === undefined) return;
  const target = lstatSync(step.path, { throwIfNoEntry: false, bigint: true });
  if (target === undefined) {
    // A folder or a link set aside goes back by rename: a hard link would follow a link on macOS.
    if (moved.isFile()) putBack(aside, step.path);
    else renameSync(aside, step.path);
    return;
  }
  const same = target.dev === moved.dev && target.ino === moved.ino;
  if (same || replaced(step, aside, target, moved)) unlinkSync(aside);
};

/**
 * Cleans up after the started steps of interrupted runs: removes their temporary files and settles the files they had
 * set aside. Every interrupted run counts, also one a crash right after an earlier open left behind (it is idempotent).
 */
export const recover = (store: RunStore): void => {
  for (const run of store.runs().filter((r) => r.status === "interrupted")) {
    const detail = store.run(run.id);
    for (const step of detail?.steps ?? []) {
      // A store update moved its branch in one step or not at all: there is nothing of it to clean up.
      if (step.state !== "running" || detail?.plan.operations[step.index]?.kind === "store.update") continue;
      rmSync(tempPath(step.path, run.id, step.index), { force: true });
      settleAside(step, asidePath(step.path, run.id, step.index));
    }
  }
};
