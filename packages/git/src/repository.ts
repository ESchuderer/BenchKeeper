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

type Entry = { folder: true } | { text: string } | "absent" | "invalid";

const codeOf = (error: unknown): unknown => (error instanceof Error && "code" in error ? error.code : undefined);

// Opened without waiting on a FIFO and checked on the open descriptor, so nothing changes between a check and its read.
const entryAt = (path: string): Entry => {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    const code = codeOf(error);
    // Windows cannot open a folder.
    if (code === "EISDIR") return { folder: true };
    return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "invalid";
  }
  try {
    const stat = fstatSync(descriptor);
    if (stat.isDirectory()) return { folder: true };
    return stat.isFile() && stat.size <= LIMIT ? { text: readFileSync(descriptor, "utf8") } : "invalid";
  } catch {
    return "invalid";
  } finally {
    closeSync(descriptor);
  }
};

// "invalid": a `.git` there that git refuses (too large, not a regular file, no `gitdir: `), where git stops looking.
const repositoryAt = (root: string): Repository | "absent" | "invalid" => {
  const dotGit = join(root, ".git");
  const entry = entryAt(dotGit);
  if (typeof entry === "string") return entry;
  if ("folder" in entry) return { root, gitDir: dotGit, common: dotGit };
  const own = /^gitdir: (.+)/.exec(entry.text)?.[1]?.trim();
  if (own === undefined) return "invalid";
  const gitDir = resolve(root, own);
  const common = entryAt(join(gitDir, "commondir"));
  const shared = typeof common === "object" && "text" in common ? common.text.trim() : "";
  return { root, gitDir, common: shared ? resolve(gitDir, shared) : gitDir };
};

/**
 * The repository a folder lies in, its own or a parent's, read from the `.git` entries as git resolves them; null outside
 * Git, or at a `.git` git refuses.
 */
export const repositoryOf = (folder: string): Repository | null => {
  for (let root = folder; ; root = dirname(root)) {
    const found = repositoryAt(root);
    if (found === "invalid") return null;
    if (found !== "absent") return found;
    if (dirname(root) === root) return null;
  }
};
