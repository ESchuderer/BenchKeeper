import { Writable } from "node:stream";
import {
  type CancellationToken,
  createMessageConnection,
  ErrorCodes,
  type MessageConnection,
  RequestType,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import {
  ACTION_FAILED,
  exit,
  type DoctorFinding,
  doctorRun,
  type ExecParams,
  type ExecResult,
  type FetchParams,
  type FetchResult,
  type Granted,
  hostExec,
  hostFetch,
  initialize,
  type LogParams,
  log,
  PROTOCOL,
  type RunParams,
  runAction,
  shutdown,
  TARGET_CALLS,
  type TargetAnswers,
  type TargetCall,
  type TargetCallParams,
} from "./protocol.ts";

export * from "./protocol.ts";

/**
 * What an action gets: its node's `with`, its data inputs, the run's id, the user's language and its grant (from
 * `initialize`), a signal the host's cancel aborts, a log that reaches the run's log, and `fetch` and `exec` through the
 * host, which the host's cancel of the run cancels too. A refused or failed call throws an error with `HOST_REFUSED` or
 * `HOST_FAILED` as its `code`, and an `exec` of a program not installed here one with `HOST_MISSING`.
 */
export type ActionContext = Omit<RunParams, "action"> & {
  locale: string;
  granted: Granted;
  signal: AbortSignal;
  log: (message: string, level?: LogParams["level"]) => void;
  fetch: (request: FetchParams) => Promise<FetchResult>;
  exec: (request: ExecParams) => Promise<ExecResult>;
};
/** An action returns the values of its data outputs; it throws to fail. */
export type Action = (context: ActionContext) => Record<string, unknown> | Promise<Record<string, unknown>>;

export type ExtensionOptions = {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /**
   * Called once the host is gone: on its `exit`, or when the input ends or closes (a host that crashed or was
   * killed). The code is 0 after `shutdown` and 1 otherwise, as a language server does; on the real stdio the extension's
   * process exits with it.
   */
  onExit?: (code: number) => void;
  /**
   * The extension's own checks for the doctor, which its manifest names under `contributes.doctor`: in the language
   * `initialize` named, with `exec` as an action has it.
   */
  doctor?: (context: Pick<ActionContext, "locale" | "exec">) => DoctorFinding[] | Promise<DoctorFinding[]>;
  /**
   * The calls of its switch targets (`contributes.switchTargets`, bundled extensions only), with `exec` as an action
   * has it; a call it leaves out answers MethodNotFound.
   */
  targets?: TargetHandlers;
};

/** What a switch target's call gets: the language `initialize` named, and `exec` through the host. */
export type TargetContext = Pick<ActionContext, "locale" | "exec">;
/** An async handler per `target/*` call; each rejects to fail. */
export type TargetHandlers = {
  [C in TargetCall]?: (params: TargetCallParams[C], context: TargetContext) => Promise<TargetAnswers[C]>;
};

// A cancel that came before the action started has a token that is cancelled already and never fires.
const abortOn = (token: CancellationToken): AbortSignal => {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error("cancelled by the host"));
  if (token.isCancellationRequested) abort();
  token.onCancellationRequested(abort);
  return controller.signal;
};

// The reason of a failure as text; a value without a text form (an object without a prototype) gets a fixed one.
const reasonOf = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  try {
    return String(error);
  } catch {
    return "the action failed";
  }
};
const failure = (error: unknown): ResponseError => new ResponseError(ACTION_FAILED, reasonOf(error));

// What an action returns reaches the host as JSON: what JSON makes of it (a toJSON method can turn an object into
// anything) must be an object of outputs, or the run fails here with a reason. Throws for a BigInt or a cycle too.
const outputsOf = (value: unknown): Record<string, unknown> => {
  // In a list, so an undefined result becomes null rather than no text at all.
  const [json]: unknown[] = JSON.parse(JSON.stringify([value]));
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new TypeError("an action returns an object of its outputs");
  }
  return Object.fromEntries(Object.entries(json));
};

// Answers the host's call of a switch target with its handler, which runs programs through the host.
const serveTarget = <C extends TargetCall>(
  connection: MessageConnection,
  call: C,
  handle: TargetHandlers[C],
  locale: () => string,
): void => {
  if (handle === undefined) return;
  // The answer is typed by the handler: the host checks it against its contract.
  connection.onRequest(new RequestType<TargetCallParams[C], unknown, void>(call), (params, token) => {
    const exec = (request: ExecParams): Promise<ExecResult> => connection.sendRequest(hostExec, request, token);
    return handle(params, { locale: locale(), exec }).catch(failure);
  });
};

/* v8 ignore start -- an extension's own process on its real stdio; the spawned extension of the tests runs it */
// Standard output carries the protocol: its writes (console.log, console.dir, process.stdout.write) go to standard
// error, and the protocol writes through the original.
const protocolOutput = (): Writable => {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  // A writer that waits for stdout's drain gets the drain of the stream its writes went to.
  process.stderr.on("drain", () => process.stdout.emit("drain"));
  return new Writable({ write: (chunk, encoding, done) => write(chunk, encoding, done) });
};
/* v8 ignore stop */

/**
 * Serves an extension's actions to the host over stdio (or the given streams) until the host is gone. On the real stdio,
 * what extension code writes through `process.stdout` goes to standard error; an action logs with `context.log`.
 */
export const defineExtension = (actions: Record<string, Action>, options: ExtensionOptions = {}): void => {
  /* v8 ignore start -- an extension's own process on its real stdio; the spawned extension of the tests runs it */
  const { input = process.stdin, output = protocolOutput(), onExit = (code) => process.exit(code) } = options;
  /* v8 ignore stop */
  const connection = createMessageConnection(new StreamMessageReader(input), new StreamMessageWriter(output));
  let hello: Pick<ActionContext, "locale" | "granted"> = { locale: "en", granted: { net: [], credentials: [] } };
  const names = Object.keys(actions);
  connection.onRequest(initialize, ({ locale, granted = { net: [], credentials: [] } }) => {
    hello = { locale, granted };
    return { protocol: PROTOCOL, actions: names };
  });
  connection.onRequest(doctorRun, async (token) => {
    const exec = (request: ExecParams): Promise<ExecResult> => connection.sendRequest(hostExec, request, token);
    return { findings: (await options.doctor?.({ locale: hello.locale, exec })) ?? [] };
  });
  for (const call of TARGET_CALLS) serveTarget(connection, call, options.targets?.[call], () => hello.locale);
  connection.onRequest(runAction, async ({ action, ...given }, token) => {
    const run = Object.hasOwn(actions, action) ? actions[action] : undefined;
    if (run === undefined) return new ResponseError(ErrorCodes.InvalidParams, `no action ${action}`);
    // A log line that cannot be sent is lost, not a crash of the extension: String turns a refusal into nothing, and a
    // connection already gone (an action logging after its host ended) throws at once.
    const send = (message: string, level: LogParams["level"] = "info"): void => {
      try {
        void connection.sendNotification(log, { run: given.run, level, message }).catch(String);
      } catch {
        // The host is gone; so is the line.
      }
    };
    const fetch = (request: FetchParams): Promise<FetchResult> => connection.sendRequest(hostFetch, request, token);
    const exec = (request: ExecParams): Promise<ExecResult> => connection.sendRequest(hostExec, request, token);
    try {
      return { outputs: outputsOf(await run({ ...given, ...hello, signal: abortOn(token), log: send, fetch, exec })) };
    } catch (error) {
      return failure(error);
    }
  });
  let shutDown = false;
  // Disposing the connection also removes its close listener, so the extension ends once.
  const end = (): void => {
    connection.dispose();
    onExit(shutDown ? 0 : 1);
  };
  connection.onRequest(shutdown, () => {
    shutDown = true;
    return null;
  });
  connection.onNotification(exit, end);
  // A host that crashed or was killed sends no exit: its end of the input closes, and a running action must not keep
  // the extension alive.
  connection.onClose(end);
  connection.listen();
};
