import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { devNull } from "node:os";
import { dirname, join } from "node:path";
import { type Result, STORE_REF } from "@cedarloom/contracts";
import { environment, flags, hookNames, hooksOff, shown } from "./git.ts";

/** A commit that changed a stored file: its id, when (ISO 8601) and by whom it was made, and its message. */
export type Commit = { commit: string; at: string; author: string; message: string };

/**
 * The workflow store (P3 a): one bare repository, whose branch `STORE_REF` holds the export layout. It is read and
 * written with plumbing only, so nothing is checked out and no hook runs; every call waits for git, as apply does.
 */
export interface Store {
  /** The branch's commit; null before the first save, or when there is no store. */
  head: () => string | null;
  /** The id of the blob at `path` in `commit`, or null. */
  blob: (commit: string, path: string) => string | null;
  read: (blob: string) => Result<Buffer>;
  /**
   * A commit on `parent` (null: the first) with each of `files` (path, content) set, which nothing references yet, so
   * it is inert until the branch moves to it; the blobs in the order of `files`. Its author is the user's Git identity;
   * the store is made at the first commit.
   */
  commit: (
    parent: string | null,
    files: [path: string, content: string][],
    message: string,
  ) => Result<{ blobs: string[]; commit: string }>;
  /** The commits on the branch that changed `path`, newest first. */
  log: (path: string) => Result<Commit[]>;
  /**
   * Moves the branch to `after` (null: removes it), only while it is at `before` (null: while it does not exist); git's
   * error otherwise, a moved branch or a lock another process holds.
   */
  move: (after: string | null, before: string | null) => Result<null>;
}

type Ran = { ok: boolean; out: string; stdout: Buffer; error: string };
type Git = (args: string[], input?: string, extra?: NodeJS.ProcessEnv) => Ran;

const failed = (step: "start" | "read" | "commit" | "update", ran: Ran): Result<never> => ({
  ok: false,
  finding: { code: "git.failed", params: { step, error: ran.error } },
});

// No hook, fsmonitor, maintenance or gc, as for a fetch; `--git-dir` names the repository (safe.bareRepository).
const OFF = flags([
  ["core.hooksPath", devNull],
  ["core.fsmonitor", "false"],
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
]);

// A git that does not end in a minute is stopped: a synchronous call would otherwise hold the process for good.
const BASE = { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 60_000 };

// The hooks the user's configuration names run whatever core.hooksPath says (git 2.54), `init` among them: read where
// no repository is found, so only the user's own configuration is, and turned off.
const hooklessEnv = (dir: string, program: string): NodeJS.ProcessEnv => {
  const env = environment([]);
  const parent = dirname(dir);
  const listed = spawnSync(program, ["config", "-z", "--get-regexp", "^hook\\."], {
    ...BASE,
    cwd: existsSync(parent) ? parent : undefined,
    env: { ...env, GIT_CEILING_DIRECTORIES: parent },
  });
  return { ...env, ...hooksOff(hookNames({ stdout: listed.stdout ?? Buffer.alloc(0) })) };
};

/** git on the repository `dir`, set up at its first call; `extra` joins the environment of one call. */
const runner = (dir: string, program: string): Git => {
  let env: NodeJS.ProcessEnv | undefined;
  return (args, input, extra = {}) => {
    env ??= hooklessEnv(dir, program);
    const ran = spawnSync(program, [...OFF, `--git-dir=${dir}`, ...args], {
      ...BASE,
      input,
      env: { ...env, ...extra },
    });
    const stdout = ran.stdout ?? Buffer.alloc(0);
    const error = ran.error?.message ?? (ran.stderr?.toString().trim() || `exit code ${ran.status}`);
    return { ok: ran.status === 0, out: stdout.toString().trim(), stdout, error: shown(error) };
  };
};

const revision = (git: Git, spec: string): string | null => {
  const ran = git(["rev-parse", "--verify", "--quiet", spec]);
  return ran.ok ? ran.out : null;
};

const identity = (git: Git): Result<null> => {
  for (const key of ["user.name", "user.email"] as const) {
    if (git(["config", "--get", key]).out === "") {
      return { ok: false, finding: { code: "store.identity-missing", params: { key } } };
    }
  }
  return { ok: true, value: null };
};

// The tree of `parent` with each path set to its blob, built by `git` in an index that only this call uses.
const treeOf = (git: Git, parent: string | null, entries: [path: string, blob: string][]): Ran => {
  const read = git(parent === null ? ["read-tree", "--empty"] : ["read-tree", parent]);
  // NUL-ended records, so no path can end one early.
  const lines = entries.map(([path, blob]) => `100644 ${blob}\t${path}\0`).join("");
  const added = read.ok ? git(["update-index", "--add", "-z", "--index-info"], lines) : read;
  return added.ok ? git(["write-tree"]) : added;
};

const committer =
  (dir: string, git: Git): Store["commit"] =>
  (parent, files, message) => {
    const known = identity(git);
    if (!known.ok) return known;
    // SHA-1 and main whatever the user's init.defaultObjectFormat and init.defaultBranch say.
    const init = ["init", "--bare", "--quiet", "--template=", "--object-format=sha1", "--initial-branch=main", dir];
    const made = existsSync(join(dir, "HEAD")) ? undefined : git(init);
    if (made !== undefined && !made.ok) return failed("start", made);
    const blobs = files.map(([path, content]) => ({ path, blob: git(["hash-object", "-w", "--stdin"], content) }));
    const missed = blobs.find(({ blob }) => !blob.ok);
    if (missed !== undefined) return failed("commit", missed.blob);
    const index = join(dir, `index-${randomUUID()}`);
    const indexed: Git = (args, input) => git(args, input, { GIT_INDEX_FILE: index });
    try {
      const tree = treeOf(
        indexed,
        parent,
        blobs.map(({ path, blob }) => [path, blob.out]),
      );
      const parents = parent === null ? [] : ["-p", parent];
      const commit = tree.ok ? git(["commit-tree", tree.out, ...parents, "-F", "-"], message) : tree;
      if (!commit.ok) return failed("commit", commit);
      return { ok: true, value: { blobs: blobs.map(({ blob }) => blob.out), commit: commit.out } };
    } finally {
      rmSync(index, { force: true });
    }
  };

// `%x1f` between a commit's fields and `%x1e` after each: neither is in an id, a date, a name or CedarLoom's messages.
const logOf =
  (git: Git): Store["log"] =>
  (path) => {
    if (revision(git, `${STORE_REF}^{commit}`) === null) return { ok: true, value: [] };
    const ran = git(["log", "--format=%H%x1f%aI%x1f%an%x1f%B%x1e", STORE_REF, "--", path]);
    if (!ran.ok) return failed("read", ran);
    const records = ran.stdout
      .toString()
      .split("\x1e")
      .map((record) => record.replace(/^\n/, ""));
    const commits = records.filter(Boolean).map((record): Commit => {
      const [commit = "", at = "", author = "", message = ""] = record.split("\x1f");
      return { commit, at, author, message };
    });
    return { ok: true, value: commits };
  };

/** The store in the bare repository `dir`, which the first commit makes. `program` is the git to run. */
export const openStore = (dir: string, program = "git"): Store => {
  const git = runner(dir, program);
  return {
    head: () => revision(git, `${STORE_REF}^{commit}`),
    blob: (commit, path) => revision(git, `${commit}:${path}`),
    read: (blob) => {
      const ran = git(["cat-file", "blob", blob]);
      return ran.ok ? { ok: true, value: ran.stdout } : failed("read", ran);
    },
    commit: committer(dir, git),
    log: logOf(git),
    move: (after, before) => {
      // A removal names the commit it removes: `update-ref -d` with an empty or zero old value removes whatever is there.
      if (after === null && before === null) {
        return { ok: false, finding: { code: "git.failed", params: { step: "update", error: "no commit to remove" } } };
      }
      const args = after === null ? ["-d", STORE_REF, String(before)] : [STORE_REF, after, before ?? ""];
      const ran = git(["update-ref", ...args]);
      return ran.ok ? { ok: true, value: null } : failed("update", ran);
    },
  };
};
