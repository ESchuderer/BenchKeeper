import { spawn } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type ExtensionManifest as Manifest, type Finding, type Result, shown } from "@cedarloom/contracts";
import {
  exit,
  type Granted,
  hostExec,
  hostFetch,
  initialize,
  type LogParams,
  log,
  PROTOCOL,
  runAction,
  shutdown,
} from "@cedarloom/extension-sdk";
import {
  CancellationTokenSource,
  createMessageConnection,
  type MessageConnection,
  type MessageStrategy,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { executor } from "./exec.ts";
import { type Credentials, fetcher, messageOf } from "./fetch.ts";
import { framesUpTo } from "./reader.ts";
import { type Launch, type Sandbox, type SandboxPolicy, unavailable } from "./sandbox.ts";
import { type Transport, transport } from "./transport.ts";

/**
 * Where an extension comes from, which is how far it is trusted: inside the CedarLoom release, or from elsewhere. Only
 * a bundled extension runs without the OS sandbox (P1 a); one from elsewhere never runs on
 * native Windows (A31 a).
 */
export type Trust = "bundled" | "community";

export type HostLimits = {
  /** The largest message an extension may send, and how many it may have sent that the host has not read yet. */
  messageBytes: number;
  unreadMessages: number;
  /** Log lines kept per run, and the length of one; more are counted, not kept. */
  logLines: number;
  logChars: number;
  /** How long the handshake may take, and how long an extension has to end after a cancel or a stop. */
  startMs: number;
  stopMs: number;
  /** For `host/fetch`: the largest answer body, how long a request may take with its redirects, and how many at once. */
  fetchBytes: number;
  fetchMs: number;
  fetches: number;
  /** For `host/exec`: how long a program may run, its output (both streams), and how many at once. */
  execMs: number;
  execBytes: number;
  execs: number;
};
export const HOST_LIMITS: HostLimits = {
  messageBytes: 1024 * 1024,
  unreadMessages: 1000,
  logLines: 1000,
  logChars: 2000,
  startMs: 10_000,
  stopMs: 2_000,
  fetchBytes: 512 * 1024,
  fetchMs: 30_000,
  fetches: 8,
  // A claude-swap tick may wait about 18 s on Claude Code's locks and then fetch usage (account-switching plan 1.5).
  execMs: 120_000,
  execBytes: 1024 * 1024,
  execs: 4,
};

export type ExtensionLaunch = {
  manifest: Manifest;
  /** The folder of the extension's files, the only one its process may read. */
  folder: string;
  trust: Trust;
  locale: string;
  sandbox?: Sandbox;
  limits?: Partial<HostLimits>;
  platform?: NodeJS.Platform;
  /** The version of Node that runs the extension: this host's own, which a test may name. */
  node?: string;
  /** The values of the extension's credentials, which the host adds to its requests; it never sees them. */
  credentials?: Credentials;
  /** How the host sends the extension's requests: over the network to public addresses, unless a test says otherwise. */
  transport?: Transport;
};

export type RunRequest = { action: string; config: unknown; inputs: Record<string, unknown>; run: string };
export type RunLog = { lines: LogParams[]; dropped: number };
export type RunningExtension = {
  /**
   * Runs an action. The host sets no time limit of its own: the caller's signal carries the deadline (for example
   * `AbortSignal.timeout`). After it aborts, the extension has `stopMs` to answer, or its process is killed; any
   * answer after an abort counts as cancelled.
   */
  run: (request: RunRequest, signal?: AbortSignal) => Promise<Result<Record<string, unknown>>>;
  /** The log of a run; once the run has ended, reading it also drops it. */
  log: (run: string) => RunLog;
  /** Asks the extension to end (shutdown, exit), and kills it after `stopMs`. */
  stop: () => Promise<void>;
};

type Refusal = "sandbox-unavailable" | "windows" | "protocol" | "actions" | "folder" | "runtime" | "programs";
type Step = "start" | "initialize" | "run";

const refused = (extension: string, reason: Refusal): Finding => ({
  code: "extension.refused",
  params: { extension, reason },
});
// Text an extension wrote (its errors, its standard error) reaches findings and terminals: shown safely and bounded.
const failed = (extension: string, step: Step, error: string): Result<never> => ({
  ok: false,
  finding: { code: "extension.failed", params: { extension, step, error: shown(error) } },
});

// The language and time zone, and Windows' folder variables, without which no process starts there: no token reaches
// extension code. The OS adds a few of its own names (see the conformance kit).
const KEPT = ["LANG", "LC_ALL", "TZ", "SYSTEMROOT", "WINDIR"];
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => KEPT.includes(name.toUpperCase())));

/** Whether this host speaks a protocol version `major.minor`: its own major, and at most its minor. */
export const speaks = (version: string): boolean => {
  const [major, minor] = /^\d{1,4}\.\d{1,4}$/.test(version) ? version.split(".").map(Number) : [];
  const [hostMajor, hostMinor] = PROTOCOL.split(".").map(Number);
  return major === hostMajor && Number(minor) <= Number(hostMinor);
};

// Whether a link lies anywhere below `folder`, read from the entries themselves (a link is never followed): Node 26's
// recursive readdir descends into a link to a folder, where it may loop, fail or walk the whole disk.
const holdsLink = (folder: string): boolean =>
  readdirSync(folder, { withFileTypes: true }).some(
    (entry) => entry.isSymbolicLink() || (entry.isDirectory() && holdsLink(join(folder, entry.name))),
  );

/**
 * The folder becomes the read grant, so it must be what it says: no `*` or `?` in its path, which Node reads as a
 * wildcard and so would grant its siblings, and no link inside it, which Node follows outside the grant
 * (https://nodejs.org/api/permissions.html, known issues).
 */
const folderIsPlain = (folder: string): boolean => !/[*?]/.test(folder) && !holdsLink(folder);

// Why an extension from elsewhere may not run: a program runs outside every sandbox (Q-O1 a); Windows has none.
const elsewhere = (launch: ExtensionLaunch): Refusal | undefined => {
  if (launch.manifest.capabilities?.programs !== undefined) return "programs";
  return (launch.platform ?? process.platform) === "win32" ? "windows" : undefined;
};

/**
 * How to start the extension: under Node's permission flags, reading its folder only, `node:sqlite` off (it reaches
 * files past the flags), and for an extension from elsewhere in a sandbox. Node denies the network under
 * `--permission` only from version 25 (`--allow-net`, v25.0.0), so an older Node is refused.
 */
const launchOf = async (launch: ExtensionLaunch, folder: string): Promise<Launch | Finding> => {
  const { id, api, runtime } = launch.manifest;
  const flags = ["--permission", "--no-experimental-sqlite", `--allow-fs-read=${folder}`, join(folder, runtime.entry)];
  const plain = { command: process.execPath, args: flags, cwd: folder, env: cleanEnv() };
  if (Number((launch.node ?? process.versions.node).split(".")[0]) < 25) return refused(id, "runtime");
  if (!speaks(api)) return refused(id, "protocol");
  if (!folderIsPlain(folder)) return refused(id, "folder");
  if (launch.trust === "bundled") return plain;
  const refusal = elsewhere(launch);
  if (refusal !== undefined) return refused(id, refusal);
  const policy: SandboxPolicy = { read: [folder], write: [], network: "none" };
  return (await (launch.sandbox ?? unavailable).wrap(plain, policy)) ?? refused(id, "sandbox-unavailable");
};

// Rejects after `ms` with `why`, so an extension that never answers cannot hold the host.
const within = <T>(promise: Promise<T>, ms: number, why: string): Promise<T> =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(why)), ms).unref())]);

/** Log lines of the runs in progress only, bounded: an extension cannot fill the host's memory through `host/log`. */
const logBook = (limits: HostLimits) => {
  const runs = new Map<string, RunLog>();
  const active = new Set<string>();
  // An extension's notification is untrusted data: each field is read as what it is, not as what the protocol names.
  const write = (line: unknown): void => {
    const [run, level, message]: unknown[] = ["run", "level", "message"].map((key) => Reflect.get(Object(line), key));
    const book = typeof run === "string" && active.has(run) ? runs.get(run) : undefined;
    if (book === undefined) return;
    if (book.lines.length >= limits.logLines) book.dropped += 1;
    else {
      const known = level === "warning" || level === "error" ? level : "info";
      book.lines.push({ run: String(run), level: known, message: shown(String(message), limits.logChars) });
    }
  };
  const open = (run: string): void => {
    active.add(run);
    if (!runs.has(run)) runs.set(run, { lines: [], dropped: 0 });
  };
  const read = (run: string): RunLog => {
    const book = runs.get(run) ?? { lines: [], dropped: 0 };
    if (!active.has(run)) runs.delete(run);
    return book;
  };
  return { write, open, close: (run: string) => active.delete(run), read };
};

/** The extension's answer to `initialize` is the protocol it speaks and exactly the actions its manifest names. */
const handshake = (answer: unknown, manifest: Manifest): "protocol" | "actions" | undefined => {
  const protocol = Reflect.get(Object(answer), "protocol");
  const actions: unknown = Reflect.get(Object(answer), "actions");
  if (typeof protocol !== "string" || !speaks(protocol)) return "protocol";
  // Names only: anything else in the list (a deeply nested array) is never turned into text.
  const names = Array.isArray(actions) && actions.every((action) => typeof action === "string");
  const named = new Set(Object.keys(manifest.contributes.actions));
  const served = new Set<unknown>(names ? actions : []);
  const same = names && served.size === named.size && [...named].every((name) => served.has(name));
  return same ? undefined : "actions";
};

type Session = {
  connection: MessageConnection;
  stopped: Promise<unknown>;
  broken: () => string | undefined;
  kill: () => void;
  /** Counts a message as read that the connection took without handing it to the message strategy. */
  consumed: () => void;
  /** Aborts once the extension's process has ended. */
  ended: AbortSignal;
};

// Starts the process and connects to it; the guard on its output and the end of the process are kept for the reasons.
const connect = (launch: Launch, limits: HostLimits): Session => {
  const child = spawn(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, windowsHide: true });
  let broken: string | undefined;
  let stderr = "";
  // vscode-jsonrpc queues what it reads without a bound: a flood of small frames would fill the host's memory, so the
  // frames the guard passed on and the reader has not yet handed out are counted, and too many end the extension.
  let unread = 0;
  const admit = (): string | undefined =>
    (unread += 1) > limits.unreadMessages ? `over ${limits.unreadMessages} messages unread` : undefined;
  const output = child.stdout.pipe(framesUpTo(limits.messageBytes, admit));
  output.on("error", (error) => {
    broken ??= error.message;
    child.kill("SIGKILL");
  });
  child.on("error", (error) => (broken ??= error.message));
  child.stderr.on("data", (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-2000)));
  const stopped = new Promise((resolve) => child.on("close", resolve));
  // A message counts as read once its handling has ended, an answer to a request included: an extension that sends
  // requests and never reads the answers would otherwise hold them in the host's memory, below the bound.
  const strategy: MessageStrategy = {
    handleMessage: (message, next) =>
      Promise.resolve(next(message)).finally(() => {
        unread -= 1;
      }),
  };
  const connection = createMessageConnection(
    new StreamMessageReader(output),
    new StreamMessageWriter(child.stdin),
    undefined,
    { messageStrategy: strategy },
  );
  // An extension that ended answers nothing more: its open requests fail at once instead of waiting for their limit,
  // and the requests the host sends for it stop.
  const ended = new AbortController();
  void stopped.then(() => ended.abort()).then(() => connection.dispose());
  const why = (): string | undefined => broken ?? (child.exitCode === null ? undefined : stderr.trim() || "it ended");
  const consumed = (): void => {
    unread -= 1;
  };
  return { connection, stopped, broken: why, kill: () => child.kill("SIGKILL"), consumed, ended: ended.signal };
};

/** Greets the started extension; a wrong or missing answer ends it. */
const greet = async (
  launch: ExtensionLaunch,
  session: Session,
  limits: HostLimits,
): Promise<Finding | Result<never> | undefined> => {
  const { net = [], credentials = {} } = launch.manifest.capabilities ?? {};
  const granted: Granted = { net, credentials: Object.keys(credentials) };
  const ask = session.connection.sendRequest(initialize, { protocol: PROTOCOL, locale: launch.locale, granted });
  const answer = await within(ask, limits.startMs, "no answer to the handshake").catch((error: unknown) => error);
  if (answer instanceof Error) {
    // Its reason is on standard error, complete only once the process has closed (an entry that is missing ends Node
    // before its message is read); a process that never started never closes, so the wait has a bound.
    session.kill();
    await Promise.race([session.stopped, new Promise((resolve) => setTimeout(resolve, limits.stopMs).unref())]);
    return failed(launch.manifest.id, "initialize", session.broken() ?? messageOf(answer));
  }
  const mismatch = handshake(answer, launch.manifest);
  return mismatch === undefined ? undefined : refused(launch.manifest.id, mismatch);
};

/**
 * Starts an extension and greets it, always with a Result: nothing it does leaves its process running on a refusal or
 * a failure. It runs under Node's permission flags, reading its own folder only: no writes, child processes, workers,
 * addons, `node:sqlite` or network, and an environment without the user's tokens. An extension from elsewhere also
 * needs the OS sandbox; until one exists it is refused. The host answers only `host/log` and `host/fetch`; any other
 * call of the extension is a method that does not exist.
 */
export const startExtension = async (launch: ExtensionLaunch): Promise<Result<RunningExtension>> => {
  const id = launch.manifest.id;
  const limits = { ...HOST_LIMITS, ...launch.limits };
  let session: Session | undefined;
  try {
    const how = await launchOf(launch, realpathSync(launch.folder));
    if ("code" in how) return { ok: false, finding: how };
    session = connect(how, limits);
    const logs = logBook(limits);
    session.connection.onNotification(log, logs.write);
    const broker = { manifest: launch.manifest, credentials: launch.credentials, limits, ended: session.ended };
    const fetch = fetcher({ ...broker, transport: launch.transport ?? transport() });
    const { consumed } = session;
    // vscode-jsonrpc 10.0.0 takes a `$/cancelRequest` for a request still being handled by cancelling the request's
    // token, without handing it to the message strategy: it counts as read when the token fires. A cancel that came
    // before the handler started went through the strategy, and its token is cancelled already.
    session.connection.onRequest(hostFetch, (params, token) => {
      if (!token.isCancellationRequested) token.onCancellationRequested(consumed);
      return fetch(params, token);
    });
    const exec = executor(broker);
    session.connection.onRequest(hostExec, (params, token) => {
      if (!token.isCancellationRequested) token.onCancellationRequested(consumed);
      return exec(params, token);
    });
    session.connection.listen();
    const problem = await greet(launch, session, limits);
    if (problem === undefined) return { ok: true, value: running(id, session, logs, limits) };
    session.kill();
    return "code" in problem ? { ok: false, finding: problem } : problem;
  } catch (error) {
    session?.kill();
    return failed(id, "start", messageOf(error));
  }
};

// Only an object of outputs is an answer.
const outputsOf = (id: string, answer: unknown): Result<Record<string, unknown>> => {
  const outputs: unknown = Reflect.get(Object(answer), "outputs");
  const plain = typeof outputs === "object" && outputs !== null && !Array.isArray(outputs);
  return plain ? { ok: true, value: Object.fromEntries(Object.entries(outputs)) } : failed(id, "run", "no outputs");
};

const running = (
  id: string,
  session: Session,
  logs: ReturnType<typeof logBook>,
  limits: HostLimits,
): RunningExtension => ({
  run: async (request, signal) => {
    if (signal?.aborted === true) return failed(id, "run", "cancelled by the host");
    logs.open(request.run);
    const source = new CancellationTokenSource();
    let deadline: NodeJS.Timeout | undefined;
    // The cancel goes to the extension; one that does not end within `stopMs` is killed, and its run ends with it.
    const cancel = (): void => {
      source.cancel();
      deadline = setTimeout(session.kill, limits.stopMs);
    };
    signal?.addEventListener("abort", cancel);
    try {
      // In a promise, so a connection already gone answers a Result too; and raced with the end of the extension's
      // process, so a run whose answer the reader can never build still ends when the process does.
      const answer = Promise.resolve().then(() => session.connection.sendRequest(runAction, request, source.token));
      const ended = session.stopped.then(() => Promise.reject(new Error(session.broken() ?? "it ended")));
      const outcome = await Promise.race([answer, ended]).then(
        (answered) => outputsOf(id, answered),
        (error: unknown) => failed(id, "run", session.broken() ?? messageOf(error)),
      );
      return source.token.isCancellationRequested ? failed(id, "run", "cancelled by the host") : outcome;
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener("abort", cancel);
      logs.close(request.run);
    }
  },
  log: logs.read,
  stop: async () => {
    // In a promise, so a connection already gone (the extension ended) is one more reason to kill.
    const ended = Promise.resolve()
      .then(() => within(session.connection.sendRequest(shutdown), limits.stopMs, "no answer to shutdown"))
      .then(() => session.connection.sendNotification(exit));
    await ended.catch(() => session.kill());
    await within(session.stopped, limits.stopMs, "still running").catch(() => session.kill());
    session.connection.dispose();
  },
});
