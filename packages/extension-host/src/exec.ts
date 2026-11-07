import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionManifest } from "@cedarloom/contracts";
import { type ExecResult, HOST_FAILED, HOST_MISSING, HOST_REFUSED } from "@cedarloom/extension-sdk";
import { programPath, runnable } from "@cedarloom/orchestration";
import { type CancellationToken, ResponseError } from "vscode-jsonrpc/node";
import { z } from "zod";
import { stopTree } from "./tree.ts";

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
  // No NUL, which no program argument can hold (spawn would throw).
  args: z
    .array(
      z
        .string()
        .max(32 * 1024)
        .regex(/^[^\0]*$/),
    )
    .max(256)
    .optional(),
  timeoutMs: z.int().min(1).optional(),
});

// What a program needs to find the user's configuration, runtime and temp folders and to reach the network through
// the user's proxy, and nothing more: no token, no CLAUDE_CONFIG_DIR or CLAUDE_SECURESTORAGE_CONFIG_DIR (which take a
// tool away from the default home; claude-swap refuses to run with them), no GIT_*. Names compare in upper case, so
// Windows' Path and a lower-case http_proxy count.
const KEPT = new Set(
  ["HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "TZ", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].concat(
    ["XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "SYSTEMROOT", "WINDIR", "USERPROFILE", "APPDATA"],
    ["LOCALAPPDATA", "TEMP", "TMP", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"],
  ),
);
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => KEPT.has(name.toUpperCase())));
const PLATFORMS = new Set(["darwin", "linux", "win32"] as const);

// Where a candidate is: `~/` and a path in the user's home folder, or a file name in an absolute PATH folder.
const located = (candidate: string, env: NodeJS.ProcessEnv): string | undefined => {
  if (!candidate.startsWith("~/")) return programPath(candidate, env);
  const file = join(homedir(), ...candidate.slice(2).split("/"));
  return runnable(file) ? file : undefined;
};

const refused = (message: string): ResponseError => new ResponseError(HOST_REFUSED, message);

/** The program's file, from the manifest's candidates for this platform, or why the host runs none. */
const resolve = (manifest: ExtensionManifest, program: string, env: NodeJS.ProcessEnv): string | ResponseError => {
  const programs = manifest.capabilities?.programs ?? {};
  if (!Object.hasOwn(programs, program)) return refused(`no program ${program} in the manifest`);
  // A platform the manifest cannot name has no candidates.
  const platform = [...PLATFORMS].find((each) => each === process.platform);
  const candidates = platform === undefined ? [] : (programs[program]?.[platform] ?? []);
  const file = candidates.map((candidate) => located(candidate, env)).find(Boolean);
  return file ?? new ResponseError(HOST_MISSING, `${program} is not installed: none of ${candidates.join(", ")} found`);
};

/** Whether host/exec would find the program from the manifest's candidates for this platform. */
export const programFound = (manifest: ExtensionManifest, program: string): boolean =>
  !(resolve(manifest, program, cleanEnv()) instanceof ResponseError);

type Run = { file: string; args: string[]; env: NodeJS.ProcessEnv; ms: number; bytes: number; stop: AbortSignal };

/**
 * Runs the file without a shell in the user's home folder, in a process group of its own, and answers when it ends:
 * its code and output, or why it was stopped (the time limit, the output cap, a cancel, the session's end, a start that
 * failed). A stop ends the whole tree, background children included, and answers at once when the program itself has
 * exited already while a child of it holds its output open.
 */
const run = ({ file, args, env, ms, bytes, stop }: Run): Promise<Answer> =>
  new Promise((done) => {
    const child = spawn(file, args, {
      cwd: homedir(),
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let total = 0;
    let failure: string | undefined;
    let answered = false;
    const finish = (code: number | null): void => {
      if (answered) return;
      answered = true;
      clearTimeout(timer);
      stop.removeEventListener("abort", cancel);
      if (failure !== undefined) done(new ResponseError(HOST_FAILED, failure));
      else done({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    };
    const end = (why: string): void => {
      failure ??= why;
      if (child.pid !== undefined) stopTree(child.pid, child);
      if (child.exitCode === null && child.signalCode === null) return;
      child.stdout.destroy();
      child.stderr.destroy();
      finish(child.exitCode);
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
    // A cancel that came before the request was handled starts nothing.
    if (token.isCancellationRequested || broker.ended.aborted) {
      return new ResponseError(HOST_FAILED, "stopped: the run was cancelled or the extension ended");
    }
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
