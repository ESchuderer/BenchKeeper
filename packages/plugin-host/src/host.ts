import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { Finding, PluginManifest, Result } from "@cedarloom/contracts";
import { exit, initialize, type LogParams, log, PROTOCOL, runAction, shutdown } from "@cedarloom/plugin-sdk";
import {
  CancellationTokenSource,
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { framesUpTo } from "./reader.ts";
import { type Launch, type Sandbox, type SandboxPolicy, unavailable } from "./sandbox.ts";

/**
 * Where a plugin comes from: inside the CedarLoom release, or from elsewhere. Only a bundled plugin runs without the OS
 * sandbox (pending owner decision, P1 a); one from elsewhere never runs on native Windows (A31 a).
 */
export type Tier = "bundled" | "community";

export type HostLimits = {
  /** The largest message a plugin may send. */
  messageBytes: number;
  /** Log lines kept per run, and the length of one; more are counted, not kept. */
  logLines: number;
  logChars: number;
  /** How long the handshake, and the shutdown before a kill, may take. */
  startMs: number;
  stopMs: number;
};
export const HOST_LIMITS: HostLimits = {
  messageBytes: 1024 * 1024,
  logLines: 1000,
  logChars: 2000,
  startMs: 10_000,
  stopMs: 2_000,
};

export type PluginLaunch = {
  manifest: PluginManifest;
  /** The folder of the plugin's files, the only one its process may read. */
  folder: string;
  tier: Tier;
  locale: string;
  sandbox?: Sandbox;
  limits?: Partial<HostLimits>;
  platform?: NodeJS.Platform;
};

export type RunRequest = { action: string; config: unknown; inputs: Record<string, unknown>; run: string };
export type RunLog = { lines: LogParams[]; dropped: number };
export type RunningPlugin = {
  /** Runs an action; the signal cancels it, and any answer after a cancel counts as cancelled. */
  run: (request: RunRequest, signal?: AbortSignal) => Promise<Result<Record<string, unknown>>>;
  log: (run: string) => RunLog;
  /** Asks the plugin to end (shutdown, exit), and kills it after `stopMs`. */
  stop: () => Promise<void>;
};

const refused = (plugin: string, reason: "sandbox-unavailable" | "windows" | "protocol" | "actions"): Finding => ({
  code: "plugin.refused",
  params: { plugin, reason },
});
const failed = (plugin: string, step: "start" | "initialize" | "run", error: string): Result<never> => ({
  ok: false,
  finding: { code: "plugin.failed", params: { plugin, step, error } },
});

// The language and time zone only: no token, home or path of the user's reaches plugin code. Windows needs its own
// folder variables to start a process at all.
const KEPT = ["LANG", "LC_ALL", "TZ", "SYSTEMROOT", "WINDIR"];
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => KEPT.includes(name.toUpperCase())));

/** Whether this host speaks a protocol version `major.minor`: its own major, and at most its minor. */
const speaks = (version: string): boolean => {
  const [major, minor] = /^\d{1,4}\.\d{1,4}$/.test(version) ? version.split(".").map(Number) : [];
  const [hostMajor, hostMinor] = PROTOCOL.split(".").map(Number);
  return major === hostMajor && Number(minor) <= Number(hostMinor);
};

/** How to start the plugin: under Node's permission flags, reading its folder only, and for its tier in a sandbox. */
const launchOf = (launch: PluginLaunch, folder: string): Launch | Finding => {
  const plugin = launch.manifest.id;
  const entry = join(folder, launch.manifest.runtime.entry);
  const flags = { command: process.execPath, args: ["--permission", `--allow-fs-read=${folder}`, entry], cwd: folder };
  const plain = { ...flags, env: cleanEnv() };
  if (!speaks(launch.manifest.api)) return refused(plugin, "protocol");
  if (launch.tier === "bundled") return plain;
  if ((launch.platform ?? process.platform) === "win32") return refused(plugin, "windows");
  const policy: SandboxPolicy = { read: [folder], write: [], network: "none" };
  return (launch.sandbox ?? unavailable).wrap(plain, policy) ?? refused(plugin, "sandbox-unavailable");
};

// Rejects after `ms` with `why`, so a plugin that never answers cannot hold the host.
const within = <T>(promise: Promise<T>, ms: number, why: string): Promise<T> =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(why)), ms).unref())]);

// Every rejection here is an Error: of a timer, or a ResponseError with the plugin's own reason.
const reason = (error: unknown): string => String(Reflect.get(Object(error), "message"));

/** Log lines of the runs in progress only, bounded: a plugin cannot fill the host's memory through `host/log`. */
const logBook = (limits: HostLimits) => {
  const runs = new Map<string, RunLog>();
  const active = new Set<string>();
  // A plugin's notification is untrusted data: each field is read as what it is, not as what the protocol names.
  const write = (line: unknown): void => {
    const [run, level, message]: unknown[] = ["run", "level", "message"].map((key) => Reflect.get(Object(line), key));
    const book = typeof run === "string" && active.has(run) ? runs.get(run) : undefined;
    if (book === undefined) return;
    if (book.lines.length >= limits.logLines) book.dropped += 1;
    else {
      const known = level === "warning" || level === "error" ? level : "info";
      book.lines.push({ run: String(run), level: known, message: String(message).slice(0, limits.logChars) });
    }
  };
  const open = (run: string): void => {
    active.add(run);
    if (!runs.has(run)) runs.set(run, { lines: [], dropped: 0 });
  };
  const read = (run: string): RunLog => runs.get(run) ?? { lines: [], dropped: 0 };
  return { write, open, close: (run: string) => active.delete(run), read };
};

/** The plugin's answer to `initialize` is the protocol it speaks and exactly the actions its manifest names. */
const handshake = (answer: unknown, manifest: PluginManifest): "protocol" | "actions" | undefined => {
  const protocol = Reflect.get(Object(answer), "protocol");
  const actions: unknown = Reflect.get(Object(answer), "actions");
  if (typeof protocol !== "string" || !speaks(protocol)) return "protocol";
  const named = Object.keys(manifest.contributes.actions).toSorted().join("\n");
  const served = Array.isArray(actions) ? actions.map(String).toSorted().join("\n") : undefined;
  return served === named ? undefined : "actions";
};

type Session = { connection: MessageConnection; stopped: Promise<unknown>; broken: () => string | undefined };

// Starts the process and connects to it; the guard on its output and the end of the process are kept for the reasons.
const connect = (launch: Launch, limits: HostLimits): Session & { kill: () => void } => {
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, windowsHide: true });
  let broken: string | undefined;
  let stderr = "";
  const output = child.stdout.pipe(framesUpTo(limits.messageBytes));
  output.on("error", (error) => {
    broken ??= error.message;
    child.kill("SIGKILL");
  });
  child.on("error", (error) => (broken ??= error.message));
  child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
  const stopped = new Promise((resolve) => child.on("close", resolve));
  const connection = createMessageConnection(new StreamMessageReader(output), new StreamMessageWriter(child.stdin));
  // A plugin that ended answers nothing more: its open requests fail at once instead of waiting for their limit.
  void stopped.then(() => connection.dispose());
  const why = (): string | undefined => broken ?? (child.exitCode === null ? undefined : stderr.trim() || "it ended");
  return { connection, stopped, broken: why, kill: () => child.kill("SIGKILL") };
};

/**
 * Starts a plugin and greets it. It runs under Node's permission flags, reading its own folder only: no writes, no
 * child processes, workers, addons or network, and an environment without the user's tokens or paths. A plugin from
 * elsewhere also needs the OS sandbox; until one exists it is refused. The host answers only `host/log`; any other
 * call of the plugin is a method that does not exist.
 */
export const startPlugin = async (launch: PluginLaunch): Promise<Result<RunningPlugin>> => {
  const plugin = launch.manifest.id;
  const limits = { ...HOST_LIMITS, ...launch.limits };
  const how = launchOf(launch, realpathSync(launch.folder));
  if ("code" in how) return { ok: false, finding: how };
  const session = connect(how, limits);
  const logs = logBook(limits);
  session.connection.onNotification(log, logs.write);
  session.connection.listen();
  const ask = session.connection.sendRequest(initialize, { protocol: PROTOCOL, locale: launch.locale });
  const answer = await within(ask, limits.startMs, "no answer to the handshake").catch((error: unknown) => error);
  const mismatch = answer instanceof Error ? undefined : handshake(answer, launch.manifest);
  if (answer instanceof Error || mismatch !== undefined) {
    session.kill();
    session.connection.dispose();
    if (mismatch !== undefined) return { ok: false, finding: refused(plugin, mismatch) };
    return failed(plugin, "initialize", session.broken() ?? reason(answer));
  }
  return { ok: true, value: running(plugin, session, logs, limits) };
};

const running = (
  plugin: string,
  session: Session & { kill: () => void },
  logs: ReturnType<typeof logBook>,
  limits: HostLimits,
): RunningPlugin => ({
  run: async (request, signal) => {
    logs.open(request.run);
    const source = new CancellationTokenSource();
    const cancel = (): void => source.cancel();
    signal?.addEventListener("abort", cancel);
    try {
      const answer = await session.connection.sendRequest(runAction, request, source.token);
      if (signal?.aborted === true) return failed(plugin, "run", "cancelled by the host");
      const outputs: unknown = Reflect.get(Object(answer), "outputs");
      const plain = typeof outputs === "object" && outputs !== null && !Array.isArray(outputs);
      return plain
        ? { ok: true, value: Object.fromEntries(Object.entries(outputs)) }
        : failed(plugin, "run", "no outputs");
    } catch (error) {
      return failed(plugin, "run", session.broken() ?? reason(error));
    } finally {
      signal?.removeEventListener("abort", cancel);
      logs.close(request.run);
    }
  },
  log: logs.read,
  stop: async () => {
    // In a promise, so a connection already gone (the plugin ended) is one more reason to kill.
    const ended = Promise.resolve()
      .then(() => within(session.connection.sendRequest(shutdown), limits.stopMs, "no answer to shutdown"))
      .then(() => session.connection.sendNotification(exit));
    await ended.catch(() => session.kill());
    await within(session.stopped, limits.stopMs, "still running").catch(() => session.kill());
    session.connection.dispose();
  },
});
