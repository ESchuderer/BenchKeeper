import { type ChildProcess, execFile, spawn, spawnSync } from "node:child_process";
import { Socket } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import type {
  AgentEvent,
  AgentRuntime,
  AgentSession,
  ContractCheck,
  LoginStatus,
  SessionError,
} from "@cedarloom/agent-contracts";
import { AgentVersion } from "@cedarloom/contracts";
import { z } from "zod";
import { type ClaudeLaunch, launchArgs, launchEnv } from "./launch.ts";
import { lines, streamParser } from "./stream.ts";

export { type ClaudeLaunch, FRESH_INSTALL_PHASES, type PermissionMode, phaseLaunch } from "./launch.ts";

type Command = readonly [string, ...string[]];

// Enough to name a failure; the stream carries everything else.
const STDERR_TAIL = 4096;

// Far above any line the CLI should write (unverified), far below the string limit that ends the host process.
const MAX_LINE_BYTES = 64 * 1024 * 1024;

// The probe asks for the shortest answer, so a check spends little of the account's usage.
const PROBE_PROMPT = "Reply with the single word OK.";

// Cancel and kill, also on Windows: docs/agents/git-and-processes.md#stopping-claude-code
const TASKKILL = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
const stop = (child: ChildProcess, killAfterMs: number): void => {
  // Once the CLI has exited, Windows may give its process ID to another process, whose tree taskkill would end.
  if (child.exitCode !== null || child.signalCode !== null) return;
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  if (process.platform === "win32" && child.pid !== undefined) {
    execFile(TASKKILL, ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, (failed) => {
      if (failed !== null) child.kill();
    });
    return;
  }
  /* v8 ignore stop */
  child.kill();
  const { pid } = child;
  const timer = setTimeout(() => pid !== undefined && process.kill(-pid, "SIGKILL"), killAfterMs).unref();
  child.once("exit", () => clearTimeout(timer));
};

// Stops the CLI should the host die first: docs/agents/git-and-processes.md#stopping-claude-code
// shortcut: a CLI ignoring SIGTERM leaves commands in groups of their own running, on a cancel too (hub issue 143).
const WATCHER = `let exited = false;
const [pid, grace] = process.argv.slice(1).map(Number);
const taskkill = process.argv[3];
const host = new (require("node:net").Socket)({ fd: 3, readable: true });
host.on("data", () => { exited = true; });
host.on("close", () => {
  if (exited) return;
  if (process.platform === "win32") {
    require("node:child_process").execFile(taskkill, ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try { process.kill(pid, "SIGTERM"); } catch { return; }
  const end = Date.now() + grace;
  const poll = setInterval(() => {
    try { process.kill(-pid, Date.now() < end ? 0 : "SIGKILL"); } catch { clearInterval(poll); }
  }, 250);
});`;

// Detached, with a watcher; a CLI no watcher can watch (EAGAIN, EMFILE, ENFILE) is stopped at once.
const spawned = (file: string, args: readonly string[], launch: ClaudeLaunch, killAfterMs: number) => {
  const child = spawn(file, args, { cwd: launch.cwd, env: launchEnv(launch), detached: true, windowsHide: true });
  if (child.pid === undefined) return child;
  const watcher = spawn(process.execPath, ["-e", WATCHER, String(child.pid), String(killAfterMs), TASKKILL], {
    stdio: ["ignore", "ignore", "ignore", "pipe"],
    detached: true,
    env: {},
  });
  watcher.once("error", () => stop(child, killAfterMs));
  watcher.unref();
  const pipe = watcher.stdio?.[3];
  if (pipe instanceof Socket) {
    pipe.unref();
    child.once("exit", () => pipe.end("exited"));
  }
  return child;
};

// The CLI's own bound on its exit after SIGTERM (30 s, above), with a margin.
const KILL_AFTER_MS = 35_000;

/** The CLI and any arguments before its own, and how long a stopped CLI may take to exit. */
interface Cli {
  readonly command: Command;
  readonly killAfterMs: number;
}

const run = (
  { command, killAfterMs }: Cli,
  launch: ClaudeLaunch,
  extraArgs: readonly string[] = [],
  verified = (version: string) => launch.verifiedVersions.includes(version),
): AgentSession => {
  const [file, ...prefix] = command;
  const args = [...prefix, ...launchArgs(launch), ...extraArgs];
  const child = spawned(file, args, launch, killAfterMs);
  let error: SessionError | null = null;
  let stderr = "";
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.on("error", (cause) => {
      error = { code: "process", message: cause.message };
      resolve();
    });
  });
  const closed = new Promise<[number | null, string | null]>((resolve) => {
    child.once("close", (code, signal) => resolve([code, signal]));
  });
  // A process that exits before it reads the prompt makes the write fail; its exit event reports why.
  child.stdin.on("error", () => undefined);
  child.stdin.end(launch.prompt);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL);
  });
  async function* events(): AsyncGenerator<AgentEvent> {
    const parse = streamParser(verified);
    // An early leave drains stdout instead of closing it: docs/agents/git-and-processes.md#stopping-claude-code
    try {
      for await (const line of lines(child.stdout.iterator({ destroyOnReturn: false }), MAX_LINE_BYTES)) {
        if (line === null) {
          error = { code: "line-too-long", limitBytes: MAX_LINE_BYTES };
          stop(child, killAfterMs);
        } else if (line.trim() !== "") yield parse(line);
      }
    } finally {
      child.stdout.resume();
    }
    const [code, signal] = await closed;
    yield { type: "exit", code, signal, error, stderr };
  }
  return {
    events: events(),
    cancel: async () => {
      stop(child, killAfterMs);
      await exited;
    },
  };
};

// onFailure, with which a crashed or timed-out guard hook refuses its call, came in 2.1.295 (code.claude.com/docs/en/hooks).
const GUARD_VERSION = "2.1.295";

// Whether a version is below `floor` by its release numbers; a pre-release of the floor counts as the floor.
const releaseParts = (text: string): number[] => text.split(/[.+-]/).slice(0, 3).map(Number);
const older = (version: string, floor: string): boolean => {
  const [have, need] = [releaseParts(version), releaseParts(floor)];
  const at = have.findIndex((part, i) => part !== need[i]);
  return at >= 0 && (have[at] ?? 0) < (need[at] ?? 0);
};

// Version ran, sentinel gone (settings applied), a window with a share and a reset (else nothing ages it out), result succeeded.
const contractCheck = async (session: AgentSession): Promise<ContractCheck> => {
  const events: AgentEvent[] = [];
  for await (const event of session.events) events.push(event);
  const init = events.find((event) => event.type === "init");
  const passed = {
    // An init line without a version of the known form proves no version.
    init: init?.agentVersion != null,
    settings: init?.settingsApplied === true,
    usage: events.some(
      (event) =>
        event.type === "usage" && event.windows.some((window) => window.percent !== null && window.resetsAt !== null),
    ),
    result: events.some((event) => event.type === "result" && event.ok),
  };
  return {
    version: init?.agentVersion ?? null,
    missing: (["init", "settings", "usage", "result"] as const).filter((part) => !passed[part]),
  };
};

// The fields the doctor reads (https://code.claude.com/docs/en/cli-reference); `configDirectory` only from 2.1.268.
const AuthStatus = z.object({ authMethod: z.string(), configDirectory: z.string().optional() });

// The JSON a CLI printed, or undefined when it is none.
const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// Exit 0 logged in, 1 logged out; `code` is the exit code or why the CLI did not run (ENOENT), `message` the error's.
const statusOf = (code: number | string | undefined, stdout: string, message: string | undefined): LoginStatus => {
  const status = AuthStatus.safeParse(json(stdout));
  if (status.success && code === 1) return { kind: "logged-out" };
  if (status.success && code === 0) {
    const { authMethod, configDirectory = null } = status.data;
    return { kind: "logged-in", authMethod, configDirectory };
  }
  const reason = typeof code === "number" ? `exit code ${code} with output that is no login status` : null;
  return { kind: "unknown", error: reason ?? message ?? "no login status" };
};

/**
 * Reads the login of the config folder `env` names with `claude auth status`, which prints its status as JSON and exits
 * 0 when logged in and 1 when not; anything else, a crash or a timeout included, is unknown. `command` is the CLI as for
 * claudeRuntime.
 */
export const claudeAuthStatus =
  (command: Command, timeoutMs = 30_000) =>
  (env: Readonly<Record<string, string>>): Promise<LoginStatus> =>
    new Promise((resolve) => {
      const [file, ...prefix] = command;
      const options = { env, timeout: timeoutMs, windowsHide: true };
      execFile(file, [...prefix, "auth", "status"], options, (error, stdout) => {
        if (error?.killed === true) resolve({ kind: "unknown", error: `timed out after ${timeoutMs / 1000} s` });
        else resolve(statusOf(error === null ? 0 : error.code, stdout, error?.message));
      });
    });

/**
 * Runs Claude Code's own login in this terminal, `claude auth login` (https://code.claude.com/docs/en/cli-reference),
 * with `env`, which names the account's config folder. Tells the exit code, or null with the error when it did not
 * start. `command` is the CLI as for claudeRuntime.
 */
export const claudeLogin =
  (command: Command) =>
  (env: Record<string, string>): { readonly code: number | null; readonly error?: string } => {
    const [file, ...prefix] = command;
    // Its output goes to stderr, the same terminal, so stdout keeps only CedarLoom's result (also with --json).
    const ran = spawnSync(file, [...prefix, "auth", "login"], { env, stdio: ["inherit", 2, "inherit"] });
    return ran.error === undefined ? { code: ran.status } : { code: null, error: ran.error.message };
  };

/**
 * The Claude Code adapter: runs `claude -p` with stream-json output under the account's config folder. `command` is the
 * CLI by its file and any arguments before its own: Windows looks for a bare name in the launch's folder before PATH. A
 * cancel that the CLI has not obeyed after `killAfterMs` kills it.
 */
export const claudeRuntime = (command: Command, killAfterMs = KILL_AFTER_MS): AgentRuntime<ClaudeLaunch> => {
  const [file, ...prefix] = command;
  const cli = { command, killAfterMs };
  const start = (launch: ClaudeLaunch): AgentSession => run(cli, launch);
  return {
    // Usage is partial: the CLI does not document its rate-limit lines, so they are read only on checked versions.
    capabilities: {
      start: "supported",
      observe: "supported",
      cancel: "supported",
      resume: "supported",
      handover: "supported",
      usage: "partial",
    },
    version: async (env) => {
      const { stdout } = await promisify(execFile)(file, [...prefix, "--version"], {
        env,
        windowsHide: true,
        timeout: 10_000,
      });
      // The output's first word, such as 2.1.316 in "2.1.316 (Claude Code)", in the form the init line reports too.
      const version = AgentVersion.safeParse(stdout.trim().split(/\s/, 1)[0]);
      if (!version.success) throw new Error("unrecognized claude --version output");
      if (older(version.data, GUARD_VERSION)) {
        throw new Error(`Claude Code ${version.data} is older than ${GUARD_VERSION}, which the guard hook needs`);
      }
      return version.data;
    },
    checkContract: async (launch) => {
      const probe = { ...launch, prompt: PROBE_PROMPT, verifiedVersions: [] };
      return contractCheck(run(cli, probe, [], () => true));
    },
    loginStatus: claudeAuthStatus(command),
    start,
    // The CLI reads a value that starts with `-` as a flag, and `--resume` also takes a title or a transcript path.
    resume: (sessionId, launch) => {
      if (!z.uuid().safeParse(sessionId).success) throw new Error(`not a session ID: ${sessionId}`);
      return run(cli, launch, ["--resume", sessionId]);
    },
    handover: async (from, to) => {
      launchArgs(to); // refuses a bad launch while `from` still runs
      await from.cancel();
      return start(to);
    },
  };
};
