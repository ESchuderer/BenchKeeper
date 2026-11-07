import { NotificationType, NotificationType0, RequestType, RequestType0 } from "vscode-jsonrpc";

/**
 * The extension protocol version this SDK speaks. A manifest's `api` names the version its extension needs; the host
 * starts an extension only for the same major version and at least that minor one.
 */
export const PROTOCOL = "1.0";

/** What the user granted the extension: the origins it may fetch, and the credentials the host adds for it. */
export type Granted = { net: string[]; credentials: string[] };
/**
 * The host's first request: the protocol version, the user's language for the extension's own texts, and its grant;
 * a host that sends none grants nothing.
 */
export type InitializeParams = { protocol: string; locale: string; granted?: Granted };
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

/**
 * A request the host sends for the extension, which has no network of its own (P7 a): to an
 * origin it was granted, following redirects within the grant. `credential` names one of the manifest's credentials,
 * which the host adds for that credential's hosts only; the extension never sees its value (P8 a).
 * Bodies are text, and answers identity-coded: the host sets no Accept-Encoding and refuses one of the
 * extension's. The host replaces the value in an answer as it is, URL-encoded and in its basic form, as best effort: a
 * host that reflects it otherwise still shows it, so use a token rather than a password for basic.
 */
export type FetchParams = {
  url: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  credential?: string;
};
/** The answer of the last request: its status, URL, headers (names in lower case) and body. */
export type FetchResult = { status: number; url: string; headers: Record<string, string>; body: string };
export const hostFetch = new RequestType<FetchParams, FetchResult, void>("host/fetch");
/**
 * A program the host runs for the extension, which starts none itself: one its manifest names under `programs`, found
 * by the host from the manifest's candidates, run without a shell, in the user's home folder with a clean environment
 * (the user's home, PATH, language and temp folders, no tokens), within a time limit and an output cap. Bundled
 * extensions only. `timeoutMs` may shorten the host's limit, never lengthen it.
 */
export type ExecParams = { program: string; args?: string[]; timeoutMs?: number };
/** How the program ended: its exit code (null when a signal ended it) and its output as UTF-8 text. */
export type ExecResult = { code: number | null; stdout: string; stderr: string };
export const hostExec = new RequestType<ExecParams, ExecResult, void>("host/exec");

/**
 * Host call error codes: a request outside the extension's grant, one the host could not complete (a program stopped
 * at its limits), and a program of the manifest that is not installed here.
 */
export const HOST_REFUSED = 2;
export const HOST_FAILED = 3;
export const HOST_MISSING = 4;

/** The host ends an extension with `shutdown`, then `exit`. */
export const shutdown = new RequestType0<null, void>("shutdown");
export const exit = new NotificationType0("exit");

/** The error code of an action that failed; its message says why. Unknown actions answer InvalidParams. */
export const ACTION_FAILED = 1;
