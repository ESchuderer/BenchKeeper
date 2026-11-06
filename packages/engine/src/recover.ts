import { type BigIntStats, lstatSync, renameSync, rmSync, unlinkSync } from "node:fs";
import type { Step } from "@cedarloom/contracts";
import type { RunStore } from "@cedarloom/ledger";
import { asidePath, hashFile, putBack, tempPath } from "./files.ts";

/**
 * The step's new file is in, and the aside holds exactly the bytes the step found, which the run's backup has too. Only
 * regular files are read: a folder at the path must not stop every later open of the store.
 */
const replaced = (step: Step, aside: string, target: BigIntStats, moved: BigIntStats): boolean =>
  target.isFile() && moved.isFile() && hashFile(step.path) === step.after && hashFile(aside) === step.before;

/**
 * The file a step had set aside when its process died: back at the path when the path is empty, removed when it is the
 * path's own file (put back, then killed) or when the step's new file is in and the aside holds what the step found.
 * Otherwise both stay: the aside may hold an edit no backup has.
 */
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
    for (const step of store.run(run.id)?.steps ?? []) {
      if (step.state !== "running") continue;
      rmSync(tempPath(step.path, run.id, step.index), { force: true });
      settleAside(step, asidePath(step.path, run.id, step.index));
    }
  }
};
