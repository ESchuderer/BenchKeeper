import { type ExtensionManifest, FORBIDDEN_HEADERS } from "@cedarloom/contracts";
import { type FetchResult, HOST_FAILED, HOST_REFUSED } from "@cedarloom/extension-sdk";
import { type CancellationToken, ResponseError } from "vscode-jsonrpc/node";
import { z } from "zod";
import type { HopAnswer, Transport } from "./transport.ts";

/** A credential's value, which only the host reads: the secret, and for HTTP basic the user name the user entered. */
export type CredentialValue = { secret: string; user?: string };
/** Where the host finds the value of an extension's credential: the user's own store, which no extension reaches. */
export type Credentials = (id: string) => CredentialValue | undefined | Promise<CredentialValue | undefined>;

type Broker = {
  manifest: ExtensionManifest;
  credentials: Credentials | undefined;
  transport: Transport;
  limits: { fetchBytes: number; fetchMs: number; fetches: number };
};
type Answer = FetchResult | ResponseError;
type Declared = NonNullable<NonNullable<ExtensionManifest["capabilities"]>["credentials"]>[string];
type Injected = { name: string; value: string; hosts: Set<string>; secrets: string[] };
type Hop = { url: URL; method: string; body: string | undefined };

const REDIRECTS = 5;
const MOVED = new Set([301, 302, 303, 307, 308]);

const Request = z
  .strictObject({
    url: z.string().max(8192),
    method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    headers: z
      .record(
        z
          .string()
          .regex(/^[A-Za-z0-9-]{1,64}$/)
          .refine((name) => !FORBIDDEN_HEADERS.includes(name.toLowerCase())),
        z.string().regex(/^[\t -~]{0,8192}$/),
      )
      .refine((headers) => Object.keys(headers).length <= 64)
      .default({}),
    body: z.string().optional(),
    credential: z.string().optional(),
  })
  .refine(({ method, body }) => body === undefined || (method !== "GET" && method !== "HEAD"), { path: ["body"] });
type Request = z.infer<typeof Request>;

const refused = (message: string): ResponseError => new ResponseError(HOST_REFUSED, message);
const failed = (message: string): ResponseError => new ResponseError(HOST_FAILED, message);
const messageOf = (error: unknown): string => String(Reflect.get(Object(error), "message"));

// The extension's request, untrusted until read: header names in lower case.
const requestOf = (params: unknown): Request | ResponseError => {
  const parsed = Request.safeParse(params);
  if (!parsed.success) {
    return refused(`invalid ${parsed.error.issues.map((issue) => issue.path.join(".")).find(Boolean) ?? "request"}`);
  }
  const headers = Object.entries(parsed.data.headers).map(([name, value]) => [name.toLowerCase(), value]);
  return { ...parsed.data, headers: Object.fromEntries(headers) };
};

// A URL the extension may reach: one of its granted origins (P7 a: fixed origins, pending owner decision), with no user
// or password, which the HTTP client would send as a credential of the extension's own.
const granted = (net: Set<string>, url: string): URL | string => {
  const parsed = URL.parse(url);
  if (parsed === null) return "not a URL";
  if (parsed.username !== "" || parsed.password !== "") return "a URL with a user or password";
  return net.has(parsed.origin) ? parsed : `${parsed.origin} is not granted`;
};

const headerOf = ({ scheme }: Declared): string =>
  scheme.type === "apiKey" ? scheme.name.toLowerCase() : "authorization";

// The credential the request names: one the manifest declares, bound to the URL's origin, whose header the extension
// leaves to the host.
const declaredFor = (broker: Broker, id: string, request: Request, url: URL): Declared | ResponseError => {
  const declared = broker.manifest.capabilities?.credentials ?? {};
  const credential = Object.hasOwn(declared, id) ? declared[id] : undefined;
  if (credential === undefined) return refused(`no credential ${id}`);
  if (!credential.hosts.includes(url.origin)) return refused(`credential ${id} is not for ${url.origin}`);
  const name = headerOf(credential);
  return Object.hasOwn(request.headers, name) ? refused(`the credential ${id} sets ${name}`) : credential;
};

// The header that carries the named credential's value (P8 a, pending owner decision), and the texts that would show it.
const injected = async (broker: Broker, request: Request, url: URL): Promise<Injected | ResponseError | undefined> => {
  const id = request.credential;
  if (id === undefined) return undefined;
  const credential = declaredFor(broker, id, request, url);
  if (credential instanceof ResponseError) return credential;
  const value = await broker.credentials?.(id);
  if (value === undefined || value.secret === "") return failed(`credential ${id} has no value`);
  const basic = Buffer.from(`${value.user ?? ""}:${value.secret}`).toString("base64");
  const { scheme } = credential;
  const header = { apiKey: value.secret, bearer: `Bearer ${value.secret}`, basic: `Basic ${basic}` };
  const kind = scheme.type === "apiKey" ? "apiKey" : scheme.scheme;
  return {
    name: headerOf(credential),
    value: header[kind],
    hosts: new Set(credential.hosts),
    secrets: [value.secret, basic],
  };
};

// What the extension gets back holds no credential's value, also not one a host echoed in its answer.
const hidden =
  (secrets: string[]) =>
  (text: string): string =>
    secrets.reduce((shown, secret) => shown.replaceAll(secret, "[redacted]"), text);
const resultOf = (url: URL, answer: HopAnswer, hide: (text: string) => string): FetchResult => ({
  status: answer.status,
  url: hide(url.href),
  headers: Object.fromEntries(Object.entries(answer.headers).map(([name, value]) => [name, hide(value)])),
  body: hide(answer.body.toString()),
});

// The request a redirect asks for, within the grant, or "done" for an answer that is no redirect. After a 303, or a
// 301 or 302 that answered a POST, it is a GET without a body, as in the Fetch standard
// (https://fetch.spec.whatwg.org/#http-redirect-fetch).
const next = (net: Set<string>, hop: Hop, answer: HopAnswer): Hop | ResponseError | "done" => {
  const location = answer.headers["location"];
  if (!MOVED.has(answer.status) || location === undefined) return "done";
  const moved = new URL(location, hop.url);
  if (typeof granted(net, moved.href) === "string")
    return refused(`a redirect to ${moved.origin}, which is not granted`);
  const get = hop.method !== "HEAD" && (answer.status === 303 || (hop.method === "POST" && answer.status < 303));
  return get ? { url: moved, method: "GET", body: undefined } : { ...hop, url: moved };
};

type Call = { request: Request; credential: Injected | undefined; signal: AbortSignal; hide: (text: string) => string };

// Sends the request and follows up to 5 redirects; the credential goes to its own hosts only.
const follow = async (broker: Broker, call: Call, first: URL): Promise<Answer> => {
  const net = new Set(broker.manifest.capabilities?.net);
  const { request, credential, signal } = call;
  let hop: Hop = { url: first, method: request.method, body: request.body };
  for (let redirects = 0; ; redirects += 1) {
    const own = credential !== undefined && credential.hosts.has(hop.url.origin);
    const headers = own ? { ...request.headers, [credential.name]: credential.value } : request.headers;
    const answer = await broker.transport({ ...hop, headers, signal, maxBytes: broker.limits.fetchBytes });
    const after = next(net, hop, answer);
    if (after === "done") return resultOf(hop.url, answer, call.hide);
    if (after instanceof ResponseError) return after;
    if (redirects === REDIRECTS) return failed(`more than ${REDIRECTS} redirects`);
    hop = after;
  }
};

// Sends within the host's time limit and the extension's cancel; a failure reaches the extension without a value.
const send = async (broker: Broker, request: Request, url: URL, token: CancellationToken): Promise<Answer> => {
  const cancelled = new AbortController();
  token.onCancellationRequested(() => cancelled.abort());
  const late = AbortSignal.timeout(broker.limits.fetchMs);
  const signal = AbortSignal.any([cancelled.signal, late]);
  const credential = await injected(broker, request, url).catch((error: unknown) => failed(messageOf(error)));
  if (credential instanceof ResponseError) return credential;
  const hide = hidden(credential?.secrets ?? []);
  return follow(broker, { request, credential, signal, hide }, url).catch((error: unknown) =>
    failed(late.aborted ? `no answer within ${broker.limits.fetchMs} ms` : hide(messageOf(error))),
  );
};

/**
 * The extension's `host/fetch`, the only network it has (P7 a, pending owner decision). The host sends to its granted
 * origins only, adds a credential's value for that credential's hosts and hides it in the answer (P8 a, pending owner
 * decision), and bounds how many requests run at once, how long one takes and how large its answer is. Where the host
 * connects is decided by the grant and the transport's address check, never by text of the extension alone.
 */
export const fetcher = (broker: Broker) => {
  const net = new Set(broker.manifest.capabilities?.net);
  let open = 0;
  return async (params: unknown, token: CancellationToken): Promise<Answer> => {
    const request = requestOf(params);
    if (request instanceof ResponseError) return request;
    const url = granted(net, request.url);
    if (typeof url === "string") return refused(url);
    if (open >= broker.limits.fetches) return refused(`too many requests at once (limit ${broker.limits.fetches})`);
    open += 1;
    try {
      return await send(broker, request, url, token);
    } finally {
      open -= 1;
    }
  };
};
