import { mkdtempSync } from "node:fs";
import { type IncomingHttpHeaders, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CSRF_HEADER, cookieName, type Started, startServer } from "@cedarloom/server";
import { z } from "zod";

export interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: unknown;
}

export interface Call {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  /** Sent as JSON; a string is sent as it is. */
  body?: unknown;
}

/** One HTTP request through node:http, which lets a test set the Host header as a browser or an attacker would. */
export const call = (port: number, { method = "GET", path, headers = {}, body }: Call): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const payload = body === undefined || typeof body === "string" ? body : JSON.stringify(body);
    const json = payload === undefined ? {} : { "content-type": "application/json" };
    const req = request(
      { host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...json, ...headers } },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (text += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: JSON.parse(text || "null") }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });

export interface Client {
  server: Started;
  port: number;
  /** The URL token from the fragment of the printed URL. */
  token: string;
  state: string;
  log: string[];
  /** A request with the session cookie and the CSRF header, once `login` ran. */
  api: (sent: Call) => Promise<Answer>;
  login: () => Promise<{ cookie: string; csrf: string }>;
}

/** Starts a server on a fresh state folder; `login` exchanges the URL token as the UI page does. */
export const serve = async (
  tokenMs?: number,
  state = join(mkdtempSync(join(tmpdir(), "cedarloom-server-")), "state"),
): Promise<Client> => {
  const log: string[] = [];
  const server = await startServer({
    state,
    log: (text) => log.push(text),
    ...(tokenMs === undefined ? {} : { tokenMs }),
  });
  const url = new URL(server.url);
  const port = Number(url.port);
  const token = url.hash.replace(/^#t=/, "");
  let auth: Record<string, string> = {};
  const login = async (): Promise<{ cookie: string; csrf: string }> => {
    const answer = await call(port, { method: "POST", path: "/api/session", body: { token } });
    if (answer.status !== 200) throw new Error(`the session exchange answered ${answer.status}`);
    const cookie = String(answer.headers["set-cookie"]?.[0]).split(";")[0] ?? "";
    const { csrf } = z.object({ csrf: z.string() }).parse(answer.body);
    auth = { cookie, [CSRF_HEADER]: csrf };
    return { cookie, csrf };
  };
  const api = (sent: Call): Promise<Answer> => call(port, { ...sent, headers: { ...auth, ...sent.headers } });
  return { server, port, token, state, log, api, login };
};

export const sessionCookie = (port: number, value: string): string => `${cookieName(port)}=${value}`;
