import { rmSync } from "node:fs";
import type { RunStore } from "@cedarloom/ledger";
import { tempPath } from "./files.ts";

/** Removes the temporary files that started steps of interrupted runs may have left next to their targets. */
export const recover = (store: RunStore): void => {
  for (const runId of store.interrupted) {
    for (const step of store.run(runId)?.steps ?? []) {
      if (step.state === "running") rmSync(tempPath(step.path, runId, step.index), { force: true });
    }
  }
};
