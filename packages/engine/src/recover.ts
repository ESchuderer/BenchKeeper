import { rmSync } from "node:fs";
import type { RunStore } from "@cedarloom/ledger";
import { tempPath } from "./files.ts";

/**
 * Removes the temporary files that started steps of interrupted runs may have left next to their targets; every
 * interrupted run counts, also one a crash right after an earlier open left behind (removing is idempotent).
 */
export const recover = (store: RunStore): void => {
  for (const run of store.runs().filter((r) => r.status === "interrupted")) {
    for (const step of store.run(run.id)?.steps ?? []) {
      if (step.state === "running") rmSync(tempPath(step.path, run.id, step.index), { force: true });
    }
  }
};
