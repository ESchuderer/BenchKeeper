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

/** What an action gets: its node's `with`, its data inputs, the run's id, a signal the host's cancel aborts, and a log. */
export type ActionContext = Omit<RunParams, "action"> & {
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

const abortOn = (token: CancellationToken): AbortSignal => {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort(new Error("cancelled by the host")));
  return controller.signal;
};

const failure = (error: unknown): ResponseError =>
  new ResponseError(ACTION_FAILED, error instanceof Error ? error.message : String(error));

/**
 * Serves a plugin's actions to the host over stdio (or the given streams) and returns the started connection. Standard
 * output carries the protocol, so the SDK sends `console.log` and its kin to standard error; an action logs with
 * `context.log`, which reaches the run's log.
 */
export const definePlugin = (actions: Record<string, Action>, options: PluginOptions = {}): MessageConnection => {
  /* v8 ignore start -- a plugin's own process on its real stdio; the spawned plugin of the tests runs it */
  if (options.output === undefined) {
    for (const name of ["log", "info", "debug"] as const) console[name] = console.error;
  }
  const { input = process.stdin, output = process.stdout, onExit = () => process.exit(0) } = options;
  /* v8 ignore stop */
  const connection = createMessageConnection(new StreamMessageReader(input), new StreamMessageWriter(output));
  const send = (message: string, level: LogParams["level"] = "info"): void =>
    void connection.sendNotification(log, { level, message });
  const names = Object.keys(actions);
  connection.onRequest(initialize, () => ({ protocol: PROTOCOL, actions: names }));
  connection.onRequest(runAction, async ({ action, ...given }, token) => {
    const run = Object.hasOwn(actions, action) ? actions[action] : undefined;
    if (run === undefined) return new ResponseError(ErrorCodes.InvalidParams, `no action ${action}`);
    try {
      return { outputs: await run({ ...given, signal: abortOn(token), log: send }) };
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
