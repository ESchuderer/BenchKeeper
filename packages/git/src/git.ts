import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { type Finding, GitRef, GitUrl, PortablePath, type Result, shown } from "@cedarloom/contracts";
import { missing, programPath } from "@cedarloom/orchestration";

/** What a fetched tree may hold; a tree over any of these is refused whole. */
export type Limits = { files: number; bytes: number; fileBytes: number };
export const LIMITS: Limits = { files: 2000, bytes: 50 * 1024 * 1024, fileBytes: 10 * 1024 * 1024 };

/** Where to fetch from: a repository URL, a branch, tag or commit, and a folder inside it (its root when absent). */
export type Source = { url: string; ref: string; path?: string };
export type TreeFile = { path: string; mode: "100644" | "100755"; sha256: string; content: Buffer };
/** The files of a folder at a commit, and the SHA-256 of their listing: `<mode> <SHA-256> <path>` lines sorted by path. */
export type Tree = { commit: string; files: TreeFile[]; digest: string };
export type FetchOptions = { parent: string; limits?: Limits; timeoutMs?: number };

type Ran = { code: number | null; stdout: Buffer; stderr: string; failure: string | undefined };

const failed = (step: "start" | "fetch" | "list" | "read" | "worktree", error: string): Result<never> => ({
  ok: false,
  finding: { code: "git.failed", params: { step, error: shown(error) } },
});
const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

export const flags = (settings: string[][]): string[] => settings.flatMap(([key, value]) => ["-c", `${key}=${value}`]);

// Hardened as the app's clone (app/src/origin.mjs): docs/agents/git-and-processes.md#git
const config = (protocols: readonly string[]): string[] => [
  ...flags([
    ["core.hooksPath", devNull],
    ["core.fsmonitor", "false"],
    ["maintenance.auto", "false"],
    ["gc.auto", "0"],
    ["protocol.allow", "never"],
    ...protocols.map((protocol) => [`protocol.${protocol}.allow`, "always"]),
    ["transfer.fsckObjects", "true"],
    ["transfer.bundleURI", "false"],
    ["http.lowSpeedLimit", "1000"],
    ["http.lowSpeedTime", "60"],
  ]),
  // As safe.bareRepository=explicit asks.
  "--git-dir=.",
];

// Hooks the user's configuration defines (`hook.<name>.event`, git 2.54) run despite core.hooksPath; names hold dots.
export const hookNames = ({ stdout }: { stdout: Buffer }): string[] => [
  ...new Set(
    stdout
      .toString()
      .split("\0")
      .map((item) => item.slice(0, item.indexOf("\n")))
      .map((key) => key.slice("hook.".length, key.lastIndexOf(".")))
      .filter(Boolean),
  ),
];

// Each is turned off through the environment, where a name holding "=" stays one key; `-c` would split it there.
export const hooksOff = (names: readonly string[]): NodeJS.ProcessEnv =>
  Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(names.length)],
    ...names.flatMap((name, index) => [
      [`GIT_CONFIG_KEY_${index}`, `hook.${name}.enabled`],
      [`GIT_CONFIG_VALUE_${index}`, "false"],
    ]),
  ]);

// No GIT_* variables and no prompts: docs/agents/git-and-processes.md#git
export const environment = (protocols: readonly string[]): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
  GIT_ALLOW_PROTOCOL: protocols.join(":"),
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=15 -o ServerAliveCountMax=4",
  // Git Credential Manager asks in a window otherwise.
  GCM_INTERACTIVE: "never",
});

type RunOptions = {
  program: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs: number;
  maxBytes: number;
  // Polled while git runs: true stops it.
  over?: () => boolean;
};

// stderr keeps its last 2,000 characters; a stopped git returns on exit, while its children may hold the pipes longer.
const run = (args: string[], options: RunOptions): Promise<Ran> =>
  new Promise((resolve) => {
    const file = programPath(options.program, options.env);
    if (file === undefined) {
      resolve({ code: null, stdout: Buffer.alloc(0), stderr: "", failure: missing(options.program) });
      return;
    }
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failure: string | undefined;
    // A timeout, too much output, a git that could not start, or one that stopped reading its input.
    const stop = (reason: string | Error): void => {
      failure ??= reason instanceof Error ? reason.message : reason;
      child.kill();
    };
    const timer = setTimeout(() => stop("stopped at the time limit"), options.timeoutMs);
    const check = (): unknown => options.over?.() && stop("over its disk limit");
    check();
    const watch = setInterval(check, 250);
    let done = false;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(watch);
      resolve({ code, stdout: Buffer.concat(chunks), stderr: stderr.trim(), failure });
    };
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > options.maxBytes) stop(`output over ${options.maxBytes} bytes`);
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.stdin.on("error", stop);
    child.on("error", stop);
    child.on("exit", (code) => failure !== undefined && finish(code));
    child.on("close", finish);
    child.stdin.end(options.input);
  });

const succeeded = (ran: Ran): boolean => ran.code === 0 && ran.failure === undefined;
const why = (ran: Ran): string => ran.failure ?? (ran.stderr || `exit code ${ran.code}`);

// The contracts' Git URL rule, also percent-encoded: docs/agents/cedarloom-rationale.md#git-urls
const urlAllowed = (url: string, protocols: readonly string[]): boolean =>
  GitUrl.safeParse(url).success ||
  (/^[!-~]+$/.test(url) &&
    protocols.some((protocol) => !["https", "ssh"].includes(protocol) && url.startsWith(`${protocol}:`)));
const portablePath = (path: string): boolean => PortablePath.safeParse(path).success;

const sourceFinding = (source: Source, protocols: readonly string[]): Finding | undefined => {
  if (!urlAllowed(source.url, protocols)) return { code: "git.refused-source", params: { field: "url" } };
  if (!GitRef.safeParse(source.ref).success) return { code: "git.refused-source", params: { field: "ref" } };
  if (source.path !== undefined && !portablePath(source.path)) {
    return { code: "git.refused-source", params: { field: "path" } };
  }
  return undefined;
};

type Entry = { path: string; mode: string; sha: string; size: number };

// `ls-tree -r -l -z` lines: `<mode> <type> <object> <size, padded>\t<path>`.
const entries = (listing: Buffer): Entry[] =>
  listing
    .toString()
    .split("\0")
    .filter((line) => line !== "")
    .map((line) => {
      const tab = line.indexOf("\t");
      const [mode = "", , sha = "", size = ""] = line.slice(0, tab).split(" ").filter(Boolean);
      return { path: line.slice(tab + 1), mode, sha, size: Number(size) || 0 };
    });

const KINDS = new Map<string, "link" | "submodule">([
  ["120000", "link"],
  ["160000", "submodule"],
]);

const entryFinding = (entry: Entry, limits: Limits): Finding | undefined => {
  const kind = KINDS.get(entry.mode);
  if (kind !== undefined) return { code: "git.unsafe-entry", params: { path: shown(entry.path), kind } };
  if (!portablePath(entry.path)) return { code: "git.unsafe-entry", params: { path: shown(entry.path), kind: "name" } };
  if (entry.size <= limits.fileBytes) return undefined;
  return {
    code: "git.too-large",
    params: { path: entry.path, found: entry.size, limit: limits.fileBytes, unit: "bytes" },
  };
};

// The first path a case-ignoring file system (macOS, Windows) joins with an earlier one: same path, file or folder.
const caseClash = (list: Entry[]): string | undefined => {
  const files = new Set<string>();
  const folders = new Set<string>();
  for (const { path } of list) {
    const parts = path.toLowerCase().split("/");
    const name = parts.join("/");
    const above = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    if (files.has(name) || folders.has(name) || above.some((folder) => files.has(folder))) return shown(path);
    files.add(name);
    for (const folder of above) folders.add(folder);
  }
  return undefined;
};

/** The first reason to refuse the whole listing: an unsafe entry, a file too large, or too many files or bytes. */
const listingFinding = (list: Entry[], limits: Limits): Finding | undefined => {
  if (list.length > limits.files) {
    return { code: "git.too-large", params: { path: null, found: list.length, limit: limits.files, unit: "files" } };
  }
  for (const entry of list) {
    const finding = entryFinding(entry, limits);
    if (finding !== undefined) return finding;
  }
  const clash = caseClash(list);
  if (clash !== undefined) return { code: "git.unsafe-entry", params: { path: clash, kind: "case" } };
  const bytes = list.reduce((sum, entry) => sum + entry.size, 0);
  if (bytes <= limits.bytes) return undefined;
  return { code: "git.too-large", params: { path: null, found: bytes, limit: limits.bytes, unit: "bytes" } };
};

const sha256 = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

// `cat-file --batch` output: `<object> blob <size>\n<content>\n` per object, in the order asked.
const contents = (output: Buffer, list: Entry[]): TreeFile[] => {
  let at = 0;
  return list.map((entry) => {
    const start = output.indexOf("\n", at) + 1;
    at = start + entry.size + 1;
    const content = output.subarray(start, start + entry.size);
    // An executable file stays one; git's other blob modes are plain files.
    const mode = entry.mode === "100755" ? "100755" : "100644";
    return { path: entry.path, mode, sha256: sha256(content), content };
  });
};

// `ls-tree -r` lists in git's tree order, which for whole paths is their byte order, the order the digest needs.
const tree = (commit: string, files: TreeFile[]): Tree => ({
  commit,
  files,
  digest: sha256(files.map((file) => `${file.mode} ${file.sha256} ${file.path}\n`).join("")),
});

type Git = (args: string[], options?: Partial<Pick<RunOptions, "input" | "maxBytes" | "over">>) => Promise<Ran>;

// It runs in a timer, where a throw would end CedarLoom, so a file renamed or a folder removed meanwhile counts 0.
const bytesIn = (dir: string): number => {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .reduce(
        (sum, entry) => sum + (statSync(join(entry.parentPath, entry.name), { throwIfNoEntry: false })?.size ?? 0),
        0,
      );
  } catch {
    /* v8 ignore start -- git removing a folder between the listing and the read; no test can time that */
    return 0;
    /* v8 ignore stop */
  }
};

const fetchCommit = async (git: Git, source: Source, dir: string, limits: Limits): Promise<Result<string>> => {
  const init = await git(["init", "--bare", "--quiet", "--template="]);
  if (!succeeded(init)) return failed("start", why(init));
  // A server may send far more than the folder holds, and outside it: the quarantine is watched while git fetches.
  const cap = 2 * limits.bytes + 1024 * 1024;
  const fetch = await git(
    [
      "fetch",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      "--quiet",
      "--",
      source.url,
      `${source.ref}:refs/cedarloom/fetched`,
    ],
    { over: () => bytesIn(dir) > cap },
  );
  const used = bytesIn(dir);
  if (used > cap)
    return refuse({ code: "git.too-large", params: { path: null, found: used, limit: cap, unit: "bytes" } });
  if (!succeeded(fetch)) return failed("fetch", why(fetch));
  const commit = await git(["rev-parse", "--verify", "--quiet", "refs/cedarloom/fetched^{commit}"]);
  return succeeded(commit) ? { ok: true, value: commit.stdout.toString().trim() } : failed("fetch", why(commit));
};

const readTree = async (git: Git, commit: string, source: Source, limits: Limits): Promise<Result<Tree>> => {
  const treeish = source.path === undefined ? commit : `${commit}:${source.path}`;
  // About 100 bytes of mode, type, object and size per entry besides its path.
  const listed = await git(["ls-tree", "-r", "-l", "-z", treeish], { maxBytes: (limits.files + 1) * 1200 });
  if (!succeeded(listed)) return failed("list", why(listed));
  const list = entries(listed.stdout);
  const finding = listingFinding(list, limits);
  if (finding !== undefined) return refuse(finding);
  const input = list.map((entry) => `${entry.sha}\n`).join("");
  const read = await git(["cat-file", "--batch"], { input, maxBytes: limits.bytes + list.length * 100 });
  return succeeded(read) ? { ok: true, value: tree(commit, contents(read.stdout, list)) } : failed("read", why(read));
};

/**
 * Fetches one ref into a new bare repository below `parent` and reads the files of `source.path` at that commit:
 * nothing is checked out, no hook or filter runs, and the repository is removed afterwards. A tree holding a link, a
 * submodule, a name that is not portable, or more than the limits is refused whole. `program` is the git to run,
 * the one on PATH unless the caller names another.
 */
export const fetchTreeOver =
  (protocols: readonly string[], program = "git") =>
  async (source: Source, options: FetchOptions): Promise<Result<Tree>> => {
    const refused = sourceFinding(source, protocols);
    if (refused !== undefined) return refuse(refused);
    const dir = await mkdtemp(join(options.parent, "quarantine-"));
    // Git never looks above the quarantine for a repository, also while it is none yet.
    const env = { ...environment(protocols), GIT_CEILING_DIRECTORIES: options.parent };
    // One time limit for the whole read, not for each git call.
    const timeoutMs = options.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    const limits = options.limits ?? LIMITS;
    const base = { program, cwd: dir, env, timeoutMs, maxBytes: 64 * 1024 };
    // Read before `init`, which runs them; the empty folder is no repository, so this reads the user's configuration.
    const hooks = hooksOff(hookNames(await run(["config", "-z", "--get-regexp", "^hook\\."], base)));
    const git: Git = async (args, extra = {}) => {
      const left = Math.max(0, deadline - Date.now());
      const ran = await run([...config(protocols), ...args], {
        ...base,
        env: { ...env, ...hooks },
        timeoutMs: left,
        ...extra,
      });
      // A URL may carry a token in its path: git's messages name the repository instead.
      return { ...ran, stderr: ran.stderr.replaceAll(source.url, "the repository") };
    };
    try {
      const commit = await fetchCommit(git, source, dir, limits);
      return commit.ok ? await readTree(git, commit.value, source, limits) : commit;
    } finally {
      // A left-over child process can keep a file busy on Windows; the result stands either way.
      await Promise.allSettled([rm(dir, { recursive: true, force: true, maxRetries: 3 })]);
    }
  };

// A folder's real path; one that is gone by its parent's, so git's `D:/a/b` and Node's `D:\\a\\b` compare equal.
const real = (folder: string): string => {
  try {
    return realpathSync.native(folder);
  } catch {
    // A root is always there, so this ends.
    return join(real(dirname(folder)), basename(folder));
  }
};

// Whether git's porcelain listing of worktrees (`-z`) names the folder `path`, compared as real paths.
const listed = (listing: Buffer, path: string): boolean =>
  listing
    .toString()
    .split("\0")
    .filter((line) => line.startsWith("worktree "))
    .some((line) => real(line.slice("worktree ".length)) === real(path));

/**
 * The git folder a checkout shares with its main checkout, as an absolute path (`git rev-parse --git-common-dir`, which
 * gives it relative to `folder` or absolute): a linked worktree's own `.git` is a file, and its objects and refs live in
 * the main checkout's folder.
 */
export const commonDir = async (folder: string, program = "git"): Promise<Result<string>> => {
  const base = { program, cwd: folder, env: environment([]), timeoutMs: 60_000, maxBytes: 64 * 1024 };
  const found = await run(["rev-parse", "--git-common-dir"], base);
  return succeeded(found)
    ? { ok: true, value: resolvePath(folder, found.stdout.toString("utf8").trim()) }
    : failed("worktree", why(found));
};

/**
 * The worktree of the repository `repo` at `path` on the branch `branch`: the one git lists there, or a new one. The
 * branch is made from HEAD unless an add that failed left it; a listed worktree whose folder is gone is added again. No
 * hook runs, not even one the user's configuration names, as for a fetch. `program` is the git to run.
 */
export const worktreeOf = async (
  repo: string,
  path: string,
  branch: string,
  program = "git",
): Promise<Result<string>> => {
  const base = { program, cwd: repo, env: environment([]), timeoutMs: 60_000, maxBytes: 1024 * 1024 };
  const hooks = hooksOff(hookNames(await run(["config", "-z", "--get-regexp", "^hook\\."], base)));
  const off = flags([
    ["core.hooksPath", devNull],
    ["core.fsmonitor", "false"],
  ]);
  const git = (args: string[]): Promise<Ran> => run([...off, ...args], { ...base, env: { ...base.env, ...hooks } });
  const listing = await git(["worktree", "list", "--porcelain", "-z"]);
  if (!succeeded(listing)) return failed("worktree", why(listing));
  const known = listed(listing.stdout, path);
  if (known && existsSync(path)) return { ok: true, value: path };
  const branched = succeeded(await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]));
  const target = branched ? ["--", path, branch] : ["-b", branch, "--", path, "HEAD"];
  const added = await git(["worktree", "add", "--quiet", ...(known ? ["--force"] : []), ...target]);
  return succeeded(added) ? { ok: true, value: path } : failed("worktree", why(added));
};
