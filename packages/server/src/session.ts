import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { CSRF_HEADER } from "@cedarloom/contracts";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

/** The URL token works once and for this long, so a printed link does not stay valid while the server runs. */
export const TOKEN_MS = 10 * 60_000;
/** Named per port: browsers send a 127.0.0.1 cookie to every port, so two servers must not take each other's. */
export const cookieName = (port: number): string => `cedarloom_session_${port}`;

/** The port a listening TCP server is bound to. */
export const portOf = (server: { address: () => AddressInfo | string | null }): number => {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
};

const secret = (): string => randomBytes(32).toString("base64url");

// Byte lengths: timingSafeEqual throws on buffers of different lengths, and one character can be several bytes.
const same = (given: unknown, expected: string | null): boolean => {
  if (typeof given !== "string" || expected === null) return false;
  const [a, b] = [Buffer.from(given), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
};

// Every value: another 127.0.0.1 port can set a same-named cookie on a longer path, which browsers send first.
const cookieValues = (header: string | undefined, name: string): string[] =>
  (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));

/** One browser session: a 256-bit URL token exchanged once for a session cookie value and a CSRF token. */
export class Session {
  readonly token: string;
  #pending: string | null;
  readonly #expires: number;
  #cookie: string | null = null;
  #csrf: string | null = null;

  constructor(ttlMs = TOKEN_MS) {
    this.token = secret();
    this.#pending = this.token;
    this.#expires = Date.now() + ttlMs;
  }

  /** The cookie value and CSRF token for the URL token, once and before it expires; null otherwise. */
  exchange(token: string): { cookie: string; csrf: string } | null {
    if (Date.now() >= this.#expires || !same(token, this.#pending)) return null;
    this.#pending = null;
    [this.#cookie, this.#csrf] = [secret(), secret()];
    return { cookie: this.#cookie, csrf: this.#csrf };
  }

  /** Any cookie value of the session's name counts, so a shadowing cookie cannot hide the real one. */
  hasCookie(values: string[]): boolean {
    return values.some((value) => same(value, this.#cookie));
  }

  hasCsrf(header: unknown): boolean {
    return same(header, this.#csrf);
  }
}

type Refusal = [status: number, error: string] | null;

// This port's literal 127.0.0.1 Host (421 stops DNS rebinding), its Origin, same-origin: other ports are same-site too.
const foreign = (req: FastifyRequest, self: string): Refusal => {
  const { host, origin } = req.headers;
  const site = req.headers["sec-fetch-site"];
  if (host !== self) return [421, "wrong-host"];
  if (origin !== undefined && origin !== `http://${self}`) return [403, "foreign-origin"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return [403, "cross-site"];
  return null;
};

// The web UI's files hold no data, and a browser loads them before it has a session.
const page = (req: FastifyRequest): boolean =>
  (req.method === "GET" || req.method === "HEAD") && req.routeOptions.url === "/*" && !req.url.startsWith("/api/");

const outside = (req: FastifyRequest, session: Session, port: number): Refusal => {
  if ((req.method === "POST" && req.routeOptions.url === "/api/session") || page(req)) return null;
  if (!session.hasCookie(cookieValues(req.headers.cookie, cookieName(port)))) return [401, "no-session"];
  return session.hasCsrf(req.headers[CSRF_HEADER]) ? null : [403, "csrf"];
};

/** Router errors (a malformed or overlong path) are answered before any hook runs: the origin rules first, no details. */
export const frameworkErrors = (error: FastifyError, req: FastifyRequest, reply: FastifyReply): FastifyReply => {
  const [code, text] = foreign(req, `127.0.0.1:${portOf(req.server.server)}`) ?? [error.statusCode ?? 400, error.code];
  // These replies skip the onSend hooks, so the headers the other answers get from them are set here.
  return reply
    .code(code)
    .headers({ "cache-control": "no-store", "x-content-type-options": "nosniff" })
    .send({ error: text });
};

/** Checks every request, unknown paths too: the origin rules, then the session cookie and the CSRF header, except for the exchange and the web UI's files. */
export const guard =
  (session: Session) =>
  async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    const port = portOf(req.server.server);
    const refusal = foreign(req, `127.0.0.1:${port}`) ?? outside(req, session, port);
    return refusal === null ? undefined : reply.code(refusal[0]).send({ error: refusal[1] });
  };
