import { Writable } from "node:stream";
import {
  type CancellationToken,
  createMessageConnection,
  ErrorCodes,
  type MessageConnection,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import {
  ACTION_FAILED,
  exit,
  initialize,
  type LogParams,
  log,
  PROTOCOL,
  type RunParams,
  runAction,
  shutdown,
} from "./protocol.ts";

export * from "./protocol.ts";

/**
 * What an action gets: its node's `with`, its data inputs, the run's id, the user's language (from `initialize`), a
 * signal the host's cancel aborts, and a log that reaches the run's log.
 */
export type ActionContext = Omit<RunParams, "action"> & {
  locale: string;
  signal: AbortSignal;
  log: (message: string, level?: LogParams["level"]) => void;
};
/** An action returns the values of its data outputs; it throws to fail. */
export type Action = (context: ActionContext) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type PluginOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Called on the host's `exit`; on the real stdio the plugin's process exits there. */
  onExit?: () => void;
};

// A cancel that came before the action started has a token that is cancelled already and never fires.
const abortOn = (token: CancellationToken): AbortSignal => {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("cancelled by the host"));
  if (token.isCancellationRequested) abort();
  token.onCancellationRequested(abort);
  return controller.signal;
};

const failure = (error: unknown): ResponseError =>
  new ResponseError(ACTION_FAILED, error instanceof Error ? error.message : String(error));

// What an action returns reaches the host as JSON: an object of outputs, or the run fails here with a reason.
const outputsOf = (value: unknown): Record<string, unknown> => {
  const plain =
    typeof value === "object" && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  if (!plain) throw new TypeError("an action returns an object of its outputs");
  // Throws for a BigInt or a cycle.
  JSON.stringify(value);
  return Object.fromEntries(Object.entries(value));
};

/* v8 ignore start -- a plugin's own process on its real stdio; the spawned plugin of the tests runs it */
// Standard output carries the protocol: its writes (console.log, console.dir, process.stdout.write) go to standard
// error, and the protocol writes through the original.
const protocolOutput = (): Writable => {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  return new Writable({ write: (chunk, encoding, done) => write(chunk, encoding, done) });
};
/* v8 ignore stop */

/**
 * Serves a plugin's actions to the host over stdio (or the given streams) and returns the started connection. On the
 * real stdio everything else written to standard output goes to standard error; an action logs with `context.log`.
 */
export const definePlugin = (actions: Record<string, Action>, options: PluginOptions = {}): MessageConnection => {
  /* v8 ignore start -- a plugin's own process on its real stdio; the spawned plugin of the tests runs it */
  const { input = process.stdin, output = protocolOutput(), onExit = () => process.exit(0) } = options;
  /* v8 ignore stop */
  const connection = createMessageConnection(new StreamMessageReader(input), new StreamMessageWriter(output));
  let locale = "en";
  const names = Object.keys(actions);
  connection.onRequest(initialize, (params) => {
    locale = params.locale;
    return { protocol: PROTOCOL, actions: names };
  });
  connection.onRequest(runAction, async ({ action, ...given }, token) => {
    const run = Object.hasOwn(actions, action) ? actions[action] : undefined;
    if (run === undefined) return new ResponseError(ErrorCodes.InvalidParams, `no action ${action}`);
    // A log line that cannot be sent is lost, not a crash of the plugin: String turns the refusal into nothing.
    const send = (message: string, level: LogParams["level"] = "info"): void =>
      void connection.sendNotification(log, { run: given.run, level, message }).catch(String);
    try {
      return { outputs: outputsOf(await run({ ...given, locale, signal: abortOn(token), log: send })) };
    } catch (error) {
      return failure(error);
    }
  });
  connection.onRequest(shutdown, () => null);
  connection.onNotification(exit, () => {
    connection.dispose();
    onExit();
  });
  connection.listen();
  return connection;
};
