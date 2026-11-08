import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Tree } from "@cedarloom/git";

// Staged, then moved into place in one step, so no reader sees a part of it; staging goes even when the move fails.
export const writeTree = (parent: string, folder: string, tree: Tree): void => {
  const staging = mkdtempSync(join(parent, "staging-"));
  try {
    for (const file of tree.files) {
      // The git package passed only portable paths inside the folder: no "..", no absolute path, no link.
      const path = join(staging, ...file.path.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      // Read-only, so no process changes the files for the next reader.
      writeFileSync(path, file.content, { mode: file.mode === "100755" ? 0o555 : 0o444 });
    }
    renameSync(staging, folder);
  } finally {
    // Gone after the move; after a failure, partly written.
    rmSync(staging, { recursive: true, force: true, maxRetries: 3 });
  }
};
