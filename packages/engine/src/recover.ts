import { lstatSync, rmSync, unlinkSync } from "node:fs";
import type { Step } from "@cedarloom/contracts";
import type { RunStore } from "@cedarloom/ledger";
import { asidePath, hashFile, putBack, tempPath } from "./files.ts";

/**
 * The file a step had set aside when its process died: back at the path when the path is empty, removed when the path
 * holds the step's new content or is the same file (put back, then killed). When the path holds another file, both stay.
 */
const settleAside = (step: Step, aside: string): void => {
  const moved = lstatSync(aside, { throwIfNoEntry: false });
  if (moved === undefined) return;
  const target = lstatSync(step.path, { throwIfNoEntry: false });
  if (target === undefined) return putBack(aside, step.path);
  const same = target.dev === moved.dev && target.ino === moved.ino;
  // Only a regular file is read: a folder at the path must not stop every later open of the store.
  if (same || (target.isFile() && hashFile(step.path) === step.after)) unlinkSync(aside);
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
