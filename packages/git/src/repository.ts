import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** A worktree's root, its own git folder, and the git folder its repository's worktrees share (the same outside a linked worktree). */
export interface Repository {
  readonly root: string;
  readonly gitDir: string;
  readonly common: string;
}

const text = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

// Read as it is, never checked first, so nothing changes between a check and its read.
const repositoryAt = (root: string): Repository | null => {
  const dotGit = join(root, ".git");
  let file: string;
  try {
    file = readFileSync(dotGit, "utf8");
  } catch (error) {
    // A `.git` folder, or a link to one, cannot be read as a file.
    const folder = error instanceof Error && "code" in error && error.code === "EISDIR";
    return folder ? { root, gitDir: dotGit, common: dotGit } : null;
  }
  const own = /^gitdir: (.+)$/m.exec(file)?.[1]?.trim();
  if (own === undefined) return null;
  const gitDir = resolve(root, own);
  const common = text(join(gitDir, "commondir"))?.trim();
  return { root, gitDir, common: common ? resolve(gitDir, common) : gitDir };
};

/** The repository a folder lies in, its own or a parent's, read from the `.git` entries as git resolves them; null outside Git. */
export const repositoryOf = (folder: string): Repository | null => {
  for (let root = folder; ; root = dirname(root)) {
    const found = repositoryAt(root);
    if (found !== null || dirname(root) === root) return found;
  }
};
