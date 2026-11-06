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
// The broker with the granted origins it checks every URL against.
type Granting = Broker & { net: Set<string> };
type Answer = FetchResult | ResponseError;
type Declared = NonNullable<NonNullable<ExtensionManifest["capabilities"]>["credentials"]>[string];
type Injected = { name: string; value: string; hosts: Set<string>; secrets: string[] };
// One request of a fetch: the first, or the one a redirect asks for.
type Target = { url: URL; method: string; headers: Record<string, string>; body: string | undefined };

const REDIRECTS = 5;
const MOVED = new Set([301, 302, 303, 307, 308]);
// Headers that describe a request's body: a redirect that drops the body drops them too (Fetch standard).
const BODY_HEADERS = new Set(["content-type", "content-encoding", "content-language", "content-location"]);

const Request = z
  .strictObject({
    url: z.string().max(8192),
    method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    headers: z
      .record(
        z
          .string()
          .regex(/^[A-Za-z0-9-]{1,64}$/)
          // Node decodes no answer, so the host asks for none coded: no Accept-Encoding of the extension's.
          .refine((name) => ![...FORBIDDEN_HEADERS, "accept-encoding"].includes(name.toLowerCase())),
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
/** The message of an error: of a timer, of Node, or a ResponseError with the extension's own reason. */
export const messageOf = (error: unknown): string => String(Reflect.get(Object(error), "message"));

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
  // shortcut: the value is hidden as it is, URL-encoded and in its basic form; a host that reflects it otherwise (in
  // another encoding, a Range slice, or a page that shows whether a guessed value matched) still shows it. Best effort,
  // pending owner decision P8 a; tokens rather than passwords for basic. Upgrade if the owner refuses basic (P8 b).
  const secrets = [value.secret, encodeURIComponent(value.secret), basic];
  return { name: headerOf(credential), value: header[kind], hosts: new Set(credential.hosts), secrets };
};

// What the extension gets back holds no credential's value, also not one a host echoed in its answer.
const hidden =
  (secrets: string[]) =>
  (text: string): string =>
    secrets.reduce((shown, secret) => shown.replaceAll(secret, "[redacted]"), text);

// The answer as text, identity-coded only: Node decodes nothing, so a coded body would be garbled, would hide an echoed
// value from the redaction, and its length could confirm a guess of it a piece at a time (BREACH).
const resultOf = (target: Target, answer: HopAnswer, hide: (text: string) => string): Answer => {
  const coding = answer.headers["content-encoding"] ?? "identity";
  if (coding.trim().toLowerCase() !== "identity") {
    return failed(hide(`an answer coded as ${coding}, which the host does not decode`));
  }
  return {
    status: answer.status,
    url: hide(target.url.href),
    headers: Object.fromEntries(Object.entries(answer.headers).map(([name, value]) => [name, hide(value)])),
    body: hide(answer.body.toString()),
  };
};

// The request a redirect asks for, within the grant, or "done" for an answer that is no redirect. After a 303, or a
// 301 or 302 that answered a POST, it is a GET without a body or the headers that describe one, as in the Fetch
// standard (https://fetch.spec.whatwg.org/#http-redirect-fetch).
const next = (net: Set<string>, target: Target, answer: HopAnswer): Target | ResponseError | "done" => {
  const location = answer.headers["location"];
  if (!MOVED.has(answer.status) || location === undefined) return "done";
  const moved = new URL(location, target.url);
  if (typeof granted(net, moved.href) === "string")
    return refused(`a redirect to ${moved.origin}, which is not granted`);
  const { method, headers } = target;
  if (method === "HEAD" || (answer.status !== 303 && (method !== "POST" || answer.status > 302))) {
    return { ...target, url: moved };
  }
  const kept = Object.entries(headers).filter(([name]) => !BODY_HEADERS.has(name));
  return { url: moved, method: "GET", headers: Object.fromEntries(kept), body: undefined };
};

type Call = { credential: Injected | undefined; signal: AbortSignal; hide: (text: string) => string };

// Sends the request and follows up to 5 redirects; the credential goes to its own hosts only.
const follow = async (broker: Granting, call: Call, first: Target): Promise<Answer> => {
  const { credential, signal } = call;
  let target = first;
  for (let redirects = 0; ; redirects += 1) {
    const own = credential !== undefined && credential.hosts.has(target.url.origin);
    const headers = own ? { ...target.headers, [credential.name]: credential.value } : target.headers;
    const answer = await broker.transport({ ...target, headers, signal, maxBytes: broker.limits.fetchBytes });
    const after = next(broker.net, target, answer);
    if (after === "done") return resultOf(target, answer, call.hide);
    if (after instanceof ResponseError) return after;
    if (redirects === REDIRECTS) return failed(`more than ${REDIRECTS} redirects`);
    target = after;
  }
};

// Sends within the host's time limit and the extension's cancel; a failure reaches the extension without a value.
const send = async (broker: Granting, request: Request, url: URL, token: CancellationToken): Promise<Answer> => {
  const cancelled = new AbortController();
  token.onCancellationRequested(() => cancelled.abort());
  const late = AbortSignal.timeout(broker.limits.fetchMs);
  const signal = AbortSignal.any([cancelled.signal, late]);
  const credential = await injected(broker, request, url).catch((error: unknown) => failed(messageOf(error)));
  if (credential instanceof ResponseError) return credential;
  const hide = hidden(credential?.secrets ?? []);
  const first = { url, method: request.method, headers: request.headers, body: request.body };
  return follow(broker, { credential, signal, hide }, first).catch((error: unknown) =>
    failed(late.aborted ? `no answer within ${broker.limits.fetchMs} ms` : hide(messageOf(error))),
  );
};

/**
 * The extension's `host/fetch`, the only network it has (P7 a, pending owner decision). The host sends to its granted
 * origins only, adds a credential's value for that credential's hosts, and bounds how many requests run at once, how
 * long one takes and how large its answer is. Where the host connects is decided by the grant and the transport's
 * address check, never by text of the extension alone.
 *
 * The extension never holds the value (P8 a, pending owner decision), and hiding it in answers is best effort: the
 * host takes identity-coded answers only and replaces the value as it is, URL-encoded and in its basic form. A host
 * that reflects it in another form still shows it, so a token is the better credential for basic than a password.
 */
export const fetcher = (broker: Broker) => {
  const granting: Granting = { ...broker, net: new Set(broker.manifest.capabilities?.net) };
  let open = 0;
  return async (params: unknown, token: CancellationToken): Promise<Answer> => {
    const request = requestOf(params);
    if (request instanceof ResponseError) return request;
    const url = granted(granting.net, request.url);
    if (typeof url === "string") return refused(url);
    if (open >= broker.limits.fetches) return refused(`too many requests at once (limit ${broker.limits.fetches})`);
    open += 1;
    try {
      return await send(granting, request, url, token);
    } finally {
      open -= 1;
    }
  };
};
