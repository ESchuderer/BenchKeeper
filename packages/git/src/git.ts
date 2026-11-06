import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull } from "node:os";
import { join } from "node:path";
import type { Finding, Result } from "@cedarloom/contracts";

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

const failed = (step: "start" | "fetch" | "list" | "read", error: string): Result<never> => ({
  ok: false,
  finding: { code: "git.failed", params: { step, error } },
});
const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// BenchKeeper's hardened clone (app/src/origin.mjs): no hooks and no fsmonitor, only the given transports, every
// object checked, and a stalled transfer ends. `-c` wins over every configuration file.
const config = (protocols: readonly string[]): string[] =>
  [
    ["core.hooksPath", devNull],
    ["core.fsmonitor", "false"],
    ["protocol.allow", "never"],
    ...protocols.map((protocol) => [`protocol.${protocol}.allow`, "always"]),
    ["transfer.fsckObjects", "true"],
    ["http.lowSpeedLimit", "1000"],
    ["http.lowSpeedTime", "60"],
  ].flatMap(([key, value]) => ["-c", `${key}=${value}`]);

// The caller's environment without GIT_* variables, which would point git at another repository (GIT_DIR, set when
// CedarLoom runs inside a hook) or add configuration; then no prompts, and ssh fails instead of asking.
const environment = (protocols: readonly string[]): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
  GIT_ALLOW_PROTOCOL: protocols.join(":"),
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=30",
});

type RunOptions = { cwd: string; env: NodeJS.ProcessEnv; input?: string; timeoutMs: number; maxBytes: number };

/** Runs git; `failure` says why it was stopped or could not start. stderr keeps its last 2000 characters. */
const run = (args: string[], options: RunOptions): Promise<Ran> =>
  new Promise((resolve) => {
    const child = spawn("git", args, { cwd: options.cwd, env: options.env, windowsHide: true });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failure: string | undefined;
    // A timeout, too much output, a git that could not start, or one that stopped reading its input.
    const stop = (reason: string | Error): void => {
      failure ??= reason instanceof Error ? reason.message : reason;
      child.kill();
    };
    const timer = setTimeout(() => stop(`stopped after ${options.timeoutMs} ms`), options.timeoutMs);
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
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks), stderr: stderr.trim(), failure });
    });
    child.stdin.end(options.input);
  });

const succeeded = (ran: Ran): boolean => ran.code === 0 && ran.failure === undefined;
const why = (ran: Ran): string => ran.failure ?? (ran.stderr || `exit code ${ran.code}`);

// Printable ASCII without spaces, not starting with "-" (an option to git or ssh).
const printable = (text: string): boolean => /^[!-~]+$/.test(text) && !text.startsWith("-");
const hasPassword = (url: string): boolean => URL.canParse(url) && new URL(url).password !== "";
// A ref git can fetch into `<ref>:<local ref>`: no refspec syntax (`:`, `+`, `*`, `^`, `~`), no `..` and no `@{`.
const isRef = (ref: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(ref) && !ref.includes("..") && !ref.endsWith(".lock");

// The POSIX portable file name characters, no `.` or `..`, no `.git` in any case, nothing Windows would rename or
// open as a device (a trailing dot, CON, NUL, COM1 and the like).
const portable = (part: string): boolean =>
  /^[A-Za-z0-9._-]+$/.test(part) &&
  !/^\.{1,2}$|^\.git$|\.$/i.test(part) &&
  !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part);
const portablePath = (path: string): boolean => path.length <= 1024 && path.split("/").every(portable);

const sourceFinding = (source: Source): Finding | undefined => {
  if (!printable(source.url) || hasPassword(source.url))
    return { code: "git.refused-source", params: { field: "url" } };
  if (!isRef(source.ref)) return { code: "git.refused-source", params: { field: "ref" } };
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
  if (kind !== undefined) return { code: "git.unsafe-entry", params: { path: entry.path, kind } };
  if (!portablePath(entry.path)) return { code: "git.unsafe-entry", params: { path: entry.path, kind: "name" } };
  if (entry.size <= limits.fileBytes) return undefined;
  return {
    code: "git.too-large",
    params: { path: entry.path, found: entry.size, limit: limits.fileBytes, unit: "bytes" },
  };
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

type Git = (args: string[], options?: { input?: string; maxBytes?: number }) => Promise<Ran>;

const fetchCommit = async (git: Git, source: Source): Promise<Result<string>> => {
  const init = await git(["init", "--bare", "--quiet", "--template=", "."]);
  if (!succeeded(init)) return failed("start", why(init));
  const fetch = await git([
    "fetch",
    "--depth=1",
    "--no-tags",
    "--no-recurse-submodules",
    "--quiet",
    "--",
    source.url,
    `${source.ref}:refs/cedarloom/fetched`,
  ]);
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
 * submodule, a name that is not portable, or more than the limits is refused whole.
 */
export const fetchTreeOver =
  (protocols: readonly string[]) =>
  async (source: Source, options: FetchOptions): Promise<Result<Tree>> => {
    const refused = sourceFinding(source);
    if (refused !== undefined) return refuse(refused);
    const dir = await mkdtemp(join(options.parent, "quarantine-"));
    const env = environment(protocols);
    const timeoutMs = options.timeoutMs ?? 300_000;
    const git: Git = (args, extra = {}) =>
      run([...config(protocols), ...args], { cwd: dir, env, timeoutMs, maxBytes: 64 * 1024, ...extra });
    try {
      const commit = await fetchCommit(git, source);
      return commit.ok ? await readTree(git, commit.value, source, options.limits ?? LIMITS) : commit;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
