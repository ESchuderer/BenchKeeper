import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { ExtensionManifest } from "@cedarloom/contracts";
import { type ExecResult, HOST_FAILED, HOST_MISSING, HOST_REFUSED } from "@cedarloom/extension-sdk";
import { type CancellationToken, ResponseError } from "vscode-jsonrpc/node";
import { z } from "zod";

type Answer = ExecResult | ResponseError;
type Limits = { execMs: number; execBytes: number; execs: number };
type Broker = {
  manifest: ExtensionManifest;
  limits: Limits;
  /** Aborts when the extension's session ends: nothing it started goes on without it. */
  ended: AbortSignal;
};

const Request = z.strictObject({
  program: z.string(),
  args: z
    .array(z.string().max(32 * 1024))
    .max(256)
    .optional(),
  timeoutMs: z.int().min(1).optional(),
});

// What a program needs to find the user's configuration, runtime and temp folders, and nothing more: no token, no
// CLAUDE_CONFIG_DIR or CLAUDE_SECURESTORAGE_CONFIG_DIR (which take a tool away from the default home; claude-swap
// refuses to run with them), no GIT_*.
const KEPT = new Set(
  ["HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].concat(
    ["XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "SYSTEMROOT", "WINDIR", "USERPROFILE", "APPDATA"],
    ["LOCALAPPDATA", "TEMP", "TMP"],
  ),
);
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => KEPT.has(name.toUpperCase())));

// A file this user may run; on Windows an .exe or .com, since a .cmd or .bat would run through a shell.
const runnable = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform === "win32") return /\.(?:exe|com)$/i.test(path);
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// Where a candidate is: `~/` and a path in the user's home folder, or a file name in an absolute PATH folder (a
// relative one would follow the current folder).
const located = (candidate: string, path: string): string | undefined => {
  if (candidate.startsWith("~/")) {
    const file = join(homedir(), ...candidate.slice(2).split("/"));
    return runnable(file) ? file : undefined;
  }
  const names = process.platform === "win32" ? [`${candidate}.exe`, `${candidate}.com`] : [candidate];
  const folders = path.split(delimiter).filter((folder) => isAbsolute(folder));
  return folders.flatMap((folder) => names.map((name) => join(folder, name))).find(runnable);
};

const refused = (message: string): ResponseError => new ResponseError(HOST_REFUSED, message);

/** The program's file, from the manifest's candidates for this platform, or why the host runs none. */
const resolve = (manifest: ExtensionManifest, program: string, env: NodeJS.ProcessEnv): string | ResponseError => {
  const programs = manifest.capabilities?.programs ?? {};
  if (!Object.hasOwn(programs, program)) return refused(`no program ${program} in the manifest`);
  const platform = process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32";
  const candidates = programs[program]?.[platform] ?? [];
  const file = candidates.map((candidate) => located(candidate, env["PATH"] ?? "")).find(Boolean);
  return file ?? new ResponseError(HOST_MISSING, `${program} is not installed: none of ${candidates.join(", ")} found`);
};

type Run = { file: string; args: string[]; env: NodeJS.ProcessEnv; ms: number; bytes: number; stop: AbortSignal };

/**
 * Runs the file without a shell in the user's home folder, and answers when it exits: its code and output, or why it
 * was stopped (the time limit, the output cap, a cancel, the session's end, a start that failed). A stopped program
 * answers at its exit, as its own children may hold its pipes open longer.
 */
const run = ({ file, args, env, ms, bytes, stop }: Run): Promise<Answer> =>
  new Promise((done) => {
    const child = spawn(file, args, {
      cwd: homedir(),
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let total = 0;
    let failure: string | undefined;
    const end = (why: string): void => {
      failure ??= why;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => end(`stopped at the time limit of ${ms} ms`), ms);
    const cancel = (): void => end("stopped: the run was cancelled or the extension ended");
    stop.addEventListener("abort", cancel, { once: true });
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      total += chunk.length;
      if (total > bytes) end(`stopped at the output cap of ${bytes} bytes`);
      else into.push(chunk);
    };
    child.stdout.on("data", collect(out));
    child.stderr.on("data", collect(err));
    let answered = false;
    const finish = (code: number | null): void => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      stop.removeEventListener("abort", cancel);
      if (failure !== undefined) done(new ResponseError(HOST_FAILED, failure));
      else done({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    };
    child.on("error", (error) => {
      failure ??= error.message;
      finish(null);
    });
    child.on("exit", (code) => failure !== undefined && finish(code));
    child.on("close", finish);
  });

/** `host/exec` for one extension: the programs its manifest names, never more than `limits.execs` at once. */
export const executor = (broker: Broker) => {
  let running = 0;
  return async (params: unknown, token: CancellationToken): Promise<Answer> => {
    const parsed = Request.safeParse(params);
    if (!parsed.success) return refused("invalid request");
    const env = cleanEnv();
    const file = resolve(broker.manifest, parsed.data.program, env);
    if (file instanceof ResponseError) return file;
    if (running >= broker.limits.execs) return refused(`more than ${broker.limits.execs} programs at once`);
    const cancelled = new AbortController();
    token.onCancellationRequested(() => cancelled.abort());
    const ms = Math.min(parsed.data.timeoutMs ?? broker.limits.execMs, broker.limits.execMs);
    running += 1;
    try {
      const stop = AbortSignal.any([cancelled.signal, broker.ended]);
      return await run({ file, args: parsed.data.args ?? [], env, ms, bytes: broker.limits.execBytes, stop });
    } finally {
      running -= 1;
    }
  };
};
