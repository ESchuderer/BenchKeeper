import { type ChildProcess, execFile, spawn, spawnSync } from "node:child_process";
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

export {
  type ClaudeLaunch,
  claudeTelemetry,
  FRESH_INSTALL_PHASES,
  type PermissionMode,
  phaseLaunch,
} from "./launch.ts";

type Command = readonly [string, ...string[]];

// Enough to name a failure; the stream carries everything else.
const STDERR_TAIL = 4096;

// Far above any line the CLI should write (unverified), far below the string limit that ends the host process.
const MAX_LINE_BYTES = 64 * 1024 * 1024;

// The probe asks for the shortest answer, so a check spends little of the account's usage.
const PROBE_PROMPT = "Reply with the single word OK.";

// On SIGTERM the CLI stops the process tree of a running command and exits; a slow reader delays the exit by 30 s at most
// (https://code.claude.com/docs/en/headless#stop-a-run-with-sigterm). Windows has no POSIX signals: kill() ends the CLI
// at once and leaves its commands running (https://nodejs.org/api/child_process.html#subprocesskillsignal), so taskkill
// ends the whole tree there, also at once and without the CLI's SessionEnd hooks. It runs from System32, not from PATH.
const stop = (child: ChildProcess): void => {
  // Once the CLI has exited, Windows may give its process ID to another process, whose tree taskkill would end.
  if (child.exitCode !== null || child.signalCode !== null) return;
  /* v8 ignore start -- Windows only; the Windows CI leg runs it */
  if (process.platform === "win32" && child.pid !== undefined) {
    const taskkill = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "taskkill.exe");
    execFile(taskkill, ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, (failed) => {
      if (failed !== null) child.kill();
    });
    return;
  }
  /* v8 ignore stop */
  child.kill();
};

const run = (
  command: Command,
  launch: ClaudeLaunch,
  extraArgs: readonly string[] = [],
  verified = (version: string) => launch.verifiedVersions.includes(version),
): AgentSession => {
  const [file, ...prefix] = command;
  const args = [...prefix, ...launchArgs(launch), ...extraArgs];
  const child = spawn(file, args, { cwd: launch.cwd, env: launchEnv(launch), windowsHide: true });
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
    // A reader that leaves early (a session without the settings proof, a throw) must not close stdout: the CLI would
    // die of EPIPE on its next line, before a cancel reaches it, and leave its commands running. Its output is drained
    // instead (readable.iterator is stable since Node 24: https://nodejs.org/api/stream.html#readableiteratoroptions).
    try {
      for await (const line of lines(child.stdout.iterator({ destroyOnReturn: false }), MAX_LINE_BYTES)) {
        if (line === null) {
          error = { code: "line-too-long", limitBytes: MAX_LINE_BYTES };
          stop(child);
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
      stop(child);
      await exited;
    },
  };
};

/**
 * Checks a probe's events: the version ran, its tool list lacks the settings' sentinel (so the CLI applied the
 * settings), at least one usage window has a share and a reset time (without one, nothing ages the reading out), and
 * the result succeeded.
 */
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

// The fields of `claude auth status` the doctor reads (https://code.claude.com/docs/en/cli-reference); the CLI prints
// more, and `configDirectory` only from 2.1.268.
const AuthStatus = z.object({ authMethod: z.string(), configDirectory: z.string().optional() });

// The JSON a CLI printed, or undefined when it is none.
const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// The login status a finished `claude auth status` reports: its JSON with exit 0 (logged in) or 1 (logged out). `code`
// is the exit code, or why the CLI did not run (ENOENT), with `message` the error's.
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
  (command: Command = ["claude"], timeoutMs = 30_000) =>
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
  (command: Command = ["claude"]) =>
  (env: Record<string, string>): { readonly code: number | null; readonly error?: string } => {
    const [file, ...prefix] = command;
    // Its output goes to stderr, the same terminal, so stdout keeps only CedarLoom's result (also with --json).
    const ran = spawnSync(file, [...prefix, "auth", "login"], { env, stdio: ["inherit", 2, "inherit"] });
    return ran.error === undefined ? { code: ran.status } : { code: null, error: ran.error.message };
  };

/**
 * The Claude Code adapter: runs `claude -p` with stream-json output under the account's config folder. `command` is the
 * CLI and any arguments before its own; a bare name is looked up on the PATH of the launch's environment.
 */
export const claudeRuntime = (command: Command = ["claude"]): AgentRuntime<ClaudeLaunch> => {
  const [file, ...prefix] = command;
  const start = (launch: ClaudeLaunch): AgentSession => run(command, launch);
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
      return version.data;
    },
    checkContract: async (launch) => {
      const probe = { ...launch, prompt: PROBE_PROMPT, verifiedVersions: [] };
      return contractCheck(run(command, probe, [], () => true));
    },
    loginStatus: claudeAuthStatus(command),
    start,
    // The CLI reads a value that starts with `-` as a flag, and `--resume` also takes a title or a transcript path.
    resume: (sessionId, launch) => {
      if (!z.uuid().safeParse(sessionId).success) throw new Error(`not a session ID: ${sessionId}`);
      return run(command, launch, ["--resume", sessionId]);
    },
    handover: async (from, to) => {
      launchArgs(to); // refuses a bad launch while `from` still runs
      await from.cancel();
      return start(to);
    },
  };
};
