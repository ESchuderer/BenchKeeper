import { CSRF_HEADER } from "@cedarloom/contracts/http";
import createClient, { type Client } from "openapi-fetch";
import type { components, paths } from "../schema/api.d.ts";

export type { components, paths } from "../schema/api.d.ts";

/**
 * A typed client of the local API: `api.GET("/api/runs")` and so on, with the paths, bodies and answers of its OpenAPI
 * document. A refusal (4xx) arrives in `error`, as the 409 of an undo the files changed under.
 */
export type Api = Client<paths>;

// Every call refuses a redirect: one would carry the CSRF header, or the one-time token in a body, to wherever it points.

/**
 * Exchanges the token from the page's URL fragment for the session: the browser keeps the cookie, the returned CSRF
 * token goes to `client`. The token works once, so a page keeps the CSRF token (sessionStorage) to survive a reload.
 */
export const exchange = async (baseUrl: string, token: string, fetch?: typeof globalThis.fetch): Promise<string> => {
  const api = createClient<paths>({ baseUrl, redirect: "error", ...(fetch === undefined ? {} : { fetch }) });
  const { data, error, response } = await api.POST("/api/session", { body: { token } });
  if (data === undefined) throw new Error(`the session exchange answered ${response.status} ${error.error}`);
  return data.csrf;
};

/** A client that sends the CSRF token with every request to the API's own origin, and never to another one. */
export const client = (baseUrl: string, csrf: string, fetch?: typeof globalThis.fetch): Api => {
  const api = createClient<paths>({ baseUrl, redirect: "error", ...(fetch === undefined ? {} : { fetch }) });
  const origin = new URL(baseUrl).origin;
  api.use({
    onRequest: ({ request }) => {
      if (new URL(request.url).origin === origin) request.headers.set(CSRF_HEADER, csrf);
      return request;
    },
  });
  return api;
};

/** A run as the API and the event stream give it. */
type Run = components["schemas"]["Run"];
/** An event of the stream: the runs as they stand, or the findings that say why they cannot be read. */
export type RunEvent = { event: "runs"; runs: Run[] } | { event: "refusal"; findings: { code: string }[] };

// An array field of a parsed event, or none.
const list = (data: unknown, key: string): unknown[] => {
  const value: unknown = typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;
  return Array.isArray(value) ? value : [];
};
const isRun = (value: unknown): value is Run =>
  typeof value === "object" && value !== null && "id" in value && "status" in value && "startedAt" in value;
const isFinding = (value: unknown): value is { code: string } =>
  typeof value === "object" && value !== null && "code" in value && typeof value.code === "string";

// The server writes `event:` and one `data:` line of JSON per event (packages/server/src/events.ts).
const parse = (block: string): RunEvent | undefined => {
  const event = /^event: (.*)$/m.exec(block)?.[1];
  const data: unknown = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? "null");
  if (event === "runs") return { event, runs: list(data, "runs").filter(isRun) };
  return event === "refusal" ? { event, findings: list(data, "findings").filter(isFinding) } : undefined;
};

/** Hands each complete event of `buffer` (they end with a blank line) to `onEvent` and returns the incomplete rest. */
const drain = (buffer: string, onEvent: (event: RunEvent) => void): string => {
  let rest = buffer;
  for (let end = rest.indexOf("\n\n"); end >= 0; end = rest.indexOf("\n\n")) {
    const event = parse(rest.slice(0, end));
    rest = rest.slice(end + 2);
    if (event !== undefined) onEvent(event);
  }
  return rest;
};

/**
 * Reads the server's event stream and calls `onEvent` for each event until `signal` aborts (it then returns) or the
 * stream ends. It uses fetch, not EventSource, because EventSource cannot send the CSRF header; a refused or broken
 * stream throws.
 */
export const subscribe = async (
  baseUrl: string,
  csrf: string,
  onEvent: (event: RunEvent) => void,
  options: { signal: AbortSignal; fetch?: typeof globalThis.fetch },
): Promise<void> => {
  const headers = { accept: "text/event-stream", [CSRF_HEADER]: csrf };
  const response = await (options.fetch ?? globalThis.fetch)(new URL("/api/events", baseUrl), {
    headers,
    redirect: "error",
    signal: options.signal,
  });
  if (!response.ok || response.body === null) throw new Error(`the event stream answered ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      buffer = drain(buffer + chunk.value, onEvent);
    }
  } catch (error) {
    // Aborting is how a page stops listening; anything else is a stream that broke.
    if (!options.signal.aborted) throw error;
  }
};
