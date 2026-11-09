import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** A worktree's root, its own git folder, and the git folder its repository's worktrees share (the same outside a linked worktree). */
export interface Repository {
  readonly root: string;
  readonly gitDir: string;
  readonly common: string;
}

// As git reads a `.git` file (read_gitfile_raw in setup.c): a regular file of at most 1 MiB.
const LIMIT = 1024 * 1024;

// A folder, a small regular file's text, or null. Opened without waiting on a FIFO and checked on the open descriptor,
// so nothing changes between a check and its read.
const entryAt = (path: string): { folder: true } | { text: string } | null => {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    // Windows cannot open a folder.
    return error instanceof Error && "code" in error && error.code === "EISDIR" ? { folder: true } : null;
  }
  try {
    const stat = fstatSync(descriptor);
    if (stat.isDirectory()) return { folder: true };
    return stat.isFile() && stat.size <= LIMIT ? { text: readFileSync(descriptor, "utf8") } : null;
  } catch {
    return null;
  } finally {
    closeSync(descriptor);
  }
};

const repositoryAt = (root: string): Repository | null => {
  const dotGit = join(root, ".git");
  const entry = entryAt(dotGit);
  if (entry === null) return null;
  if ("folder" in entry) return { root, gitDir: dotGit, common: dotGit };
  const own = /^gitdir: (.+)/.exec(entry.text)?.[1]?.trim();
  if (own === undefined) return null;
  const gitDir = resolve(root, own);
  const common = entryAt(join(gitDir, "commondir"));
  const shared = common !== null && "text" in common ? common.text.trim() : "";
  return { root, gitDir, common: shared ? resolve(gitDir, shared) : gitDir };
};

/** The repository a folder lies in, its own or a parent's, read from the `.git` entries as git resolves them; null outside Git. */
export const repositoryOf = (folder: string): Repository | null => {
  for (let root = folder; ; root = dirname(root)) {
    const found = repositoryAt(root);
    if (found !== null || dirname(root) === root) return found;
  }
};
