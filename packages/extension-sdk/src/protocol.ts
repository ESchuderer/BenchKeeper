import { NotificationType, NotificationType0, RequestType, RequestType0 } from "vscode-jsonrpc";

/**
 * The extension protocol version this SDK speaks. A manifest's `api` names the version its extension needs; the host
 * starts an extension only for the same major version and at least that minor one.
 */
export const PROTOCOL = "1.0";

/** The host's first request: the protocol version and the user's language, for the extension's own texts. */
export type InitializeParams = { protocol: string; locale: string };
/** The extension's protocol version and the actions it serves, which the host checks against its manifest. */
export type InitializeResult = { protocol: string; actions: string[] };
export const initialize = new RequestType<InitializeParams, InitializeResult, void>("initialize");

/** One run of an action: the node's `with` and the values of its data inputs, and the run it belongs to. */
export type RunParams = { action: string; config: unknown; inputs: Record<string, unknown>; run: string };
/** The values of the action's data outputs. */
export type RunResult = { outputs: Record<string, unknown> };
/**
 * The host cancels a run with the protocol's `$/cancelRequest` and treats any answer after it as cancelled: code 1 with
 * "cancelled by the host", or the outputs of an action that ignored its signal.
 */
export const runAction = new RequestType<RunParams, RunResult, void>("action/run");

/** A line for the log of a run, which the host bounds and redacts. */
export type LogParams = { run: string; level: "info" | "warning" | "error"; message: string };
export const log = new NotificationType<LogParams>("host/log");

/** The host ends an extension with `shutdown`, then `exit`. */
export const shutdown = new RequestType0<null, void>("shutdown");
export const exit = new NotificationType0("exit");

/** The error code of an action that failed; its message says why. Unknown actions answer InvalidParams. */
export const ACTION_FAILED = 1;
