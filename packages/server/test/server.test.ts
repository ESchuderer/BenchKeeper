import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingHttpHeaders, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openRunStore, sha256 } from "@cedarloom/ledger";
import { CSRF_HEADER, type Plan } from "@cedarloom/contracts";
import { cookieName, openapi, type Started, startServer } from "@cedarloom/server";
import { applyPlan } from "@cedarloom/services";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: unknown;
}

interface Call {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  /** Sent as JSON; a string is sent as it is. */
  body?: unknown;
}

/** One HTTP request through node:http, which lets a test set the Host header as a browser or an attacker would. */
const call = (port: number, { method = "GET", path, headers = {}, body }: Call): Promise<Answer> =>
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
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: text !== "" && res.headers["content-type"]?.includes("json") ? JSON.parse(text) : text,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(payload);
  });

interface Client {
  server: Started;
  port: number;
  /** The URL token from the fragment of the printed URL. */
  token: string;
  state: string;
  log: string[];
  /** A request with the session cookie and the CSRF header, once `login` ran. */
  api: (sent: Call) => Promise<Answer>;
  login: () => Promise<{ cookie: string; csrf: string }>;
  /** The session cookie and CSRF header `login` set. */
  auth: () => Record<string, string>;
}

/** Starts a server on a fresh state folder; `login` exchanges the URL token as the UI page does. */
const serve = async (
  tokenMs?: number,
  state = join(mkdtempSync(join(tmpdir(), "cedarloom-server-")), "state"),
  ui?: string,
): Promise<Client> => {
  const log: string[] = [];
  const server = await startServer({
    state,
    ui,
    every: 25,
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
  return { server, port, token, state, log, api, login, auth: () => auth };
};

const sessionCookie = (port: number, value: string): string => `${cookieName(port)}=${value}`;

const started: Client[] = [];
const open = async (tokenMs?: number, ui?: string): Promise<Client> => {
  const client = await serve(tokenMs, undefined, ui);
  started.push(client);
  return client;
};
afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => client.server.close()));
});

test("the server listens on 127.0.0.1 with the token in the URL fragment, and answers any other Host with 421", async () => {
  const { server, port, token, api, login } = await open();
  expect(server.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/#t=[A-Za-z0-9_-]{43}$`));
  expect(Buffer.from(token, "base64url")).toHaveLength(32);
  // Host values a request for localhost, another port, a rebound DNS name or IPv6 loopback carries: none is this origin.
  for (const host of [`localhost:${port}`, `127.0.0.1:${port + 1}`, "attacker.example", `[::1]:${port}`]) {
    const answer = await api({ method: "POST", path: "/api/session", headers: { host }, body: { token } });
    expect([host, answer.status, answer.body]).toEqual([host, 421, { error: "wrong-host" }]);
  }
  // The router answers a malformed or overlong path before any hook: it gets the origin rules and no details too.
  const malformed = { path: "/api/runs/%zz", headers: { host: "attacker.example" } };
  const refused = await api(malformed);
  expect([refused.status, refused.body, refused.headers["cache-control"]]).toEqual([
    421,
    { error: "wrong-host" },
    "no-store",
  ]);
  expect((await api({ ...malformed, headers: { origin: "http://attacker.example" } })).status).toBe(403);
  expect(await api({ path: "/api/runs/%zz" })).toMatchObject({ status: 400, body: { error: "FST_ERR_BAD_URL" } });
  expect(await api({ path: `/api/runs/${"a".repeat(101)}` })).toMatchObject({
    status: 414,
    body: { error: "FST_ERR_MAX_PARAM_LENGTH" },
  });
  // None of these refusals spent the token.
  await expect(login()).resolves.toMatchObject({ csrf: expect.any(String) });
});

test("the URL token is exchanged once, before it expires, for an HttpOnly SameSite=Strict cookie and a CSRF token", async () => {
  const { port, token, api, login } = await open();
  expect((await api({ method: "POST", path: "/api/session", body: { token: `${token}x` } })).status).toBe(401);
  const exchanged = await api({ method: "POST", path: "/api/session?from=link", body: { token } });
  expect(exchanged.status).toBe(200);
  expect(exchanged.headers["set-cookie"]).toEqual([
    expect.stringMatching(new RegExp(`^${cookieName(port)}=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Strict; Path=/$`)),
  ]);
  expect(exchanged.body).toEqual({ csrf: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  expect(await api({ method: "POST", path: "/api/session", body: { token } })).toMatchObject({
    status: 401,
    body: { error: "token" },
  });
  await expect(login()).rejects.toThrow("the session exchange answered 401");
  const late = await open(0);
  expect((await late.api({ method: "POST", path: "/api/session", body: { token: late.token } })).status).toBe(401);
});

test("every other request needs the session cookie and the CSRF header, unknown paths too", async () => {
  const { port, token, api, login } = await open();
  expect(await api({ path: "/api/runs" })).toMatchObject({ status: 401, body: { error: "no-session" } });
  // Before the exchange there is no cookie value or CSRF token to match, empty ones included.
  const empty = { cookie: sessionCookie(port, ""), [CSRF_HEADER]: "" };
  const unknown = [
    { method: "GET", path: "/api/runs" },
    { method: "HEAD", path: "/api/runs" },
    { method: "OPTIONS", path: "/api/runs" },
    { method: "GET", path: "/nowhere" },
  ];
  for (const sent of unknown) {
    expect([sent, (await api({ ...sent, headers: empty })).status]).toEqual([sent, 401]);
  }

  expect((await api({ method: "POST", path: "/api/session/", body: { token } })).status).toBe(401);
  const { cookie, csrf } = await login();
  expect(await api({ path: "/api/runs", headers: { [CSRF_HEADER]: "" } })).toMatchObject({ status: 403 });
  expect(await api({ path: "/api/runs", headers: { [CSRF_HEADER]: `${csrf}x` } })).toMatchObject({
    status: 403,
    body: { error: "csrf" },
  });
  expect((await call(port, { path: "/api/runs", headers: { cookie } })).status).toBe(403);
  expect((await call(port, { path: "/api/runs", headers: { [CSRF_HEADER]: csrf } })).status).toBe(401);
  expect(await api({ path: "/api/runs" })).toMatchObject({ status: 200, body: { runs: [] } });
  expect(await api({ path: "/nowhere" })).toMatchObject({ status: 404, body: { error: "not-found" } });
  for (const method of ["PUT", "QUERY"]) {
    const other = await api({ method, path: "/api/runs?x=1" });
    expect([other.status, other.headers["allow"], other.body]).toEqual([
      405,
      "GET, HEAD",
      { error: "method-not-allowed" },
    ]);
  }
});

test("a foreign Origin or a cross-site fetch is refused, and no request gets CORS headers", async () => {
  const { port, api, login } = await open();
  await login();
  // The undo too: refused before its handler runs, which would answer 404 for this unknown run.
  const undo = { method: "POST", path: `/api/runs/${randomUUID()}/undo`, body: { approve: "0".repeat(64) } };
  for (const sent of [{ path: "/api/runs" }, undo]) {
    for (const origin of [`http://127.0.0.1:${port + 1}`, `http://localhost:${port}`, "null"]) {
      expect(await api({ ...sent, headers: { origin } })).toMatchObject({
        status: 403,
        body: { error: "foreign-origin" },
      });
    }
    for (const site of ["same-site", "cross-site"]) {
      expect(await api({ ...sent, headers: { "sec-fetch-site": site } })).toMatchObject({
        status: 403,
        body: { error: "cross-site" },
      });
    }
    expect(await api({ ...sent, headers: { [CSRF_HEADER]: "" } })).toMatchObject({
      status: 403,
      body: { error: "csrf" },
    });
  }
  expect((await api(undo)).status).toBe(404);
  // Opening the printed link is a top-level navigation the user started: Sec-Fetch-Site none.
  expect((await api({ path: "/api/runs", headers: { "sec-fetch-site": "none" } })).status).toBe(200);
  const refusal = await api({ path: "/api/runs", headers: { origin: "null" } });
  expect(refusal.headers).toMatchObject({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": expect.stringContaining("frame-ancestors 'none'"),
  });
  const own = { origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" };
  const allowed = await api({ path: "/api/runs", headers: own });
  const preflight = await api({
    method: "OPTIONS",
    path: "/api/runs",
    headers: { ...own, "access-control-request-method": "POST" },
  });
  expect([allowed.status, preflight.status]).toEqual([200, 405]);
  for (const answer of [allowed, preflight]) {
    expect(Object.keys(answer.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
  }
});

test("two servers on two ports keep their sessions apart, and a shadowing cookie cannot lock the page out", async () => {
  const [a, b] = [await open(), await open()];
  const [loginA, loginB] = [await a.login(), await b.login()];
  const csrfA = { [CSRF_HEADER]: loginA.csrf };
  const runs = (client: Client, cookie: string, headers = csrfA) =>
    call(client.port, { path: "/api/runs", headers: { cookie, ...headers } }).then((answer) => answer.status);
  // A browser sends both servers' cookies to each port; a script of another port set a same-named one on a longer path.
  const forged = sessionCookie(a.port, "forged");
  expect(await runs(a, `${loginB.cookie}; ${forged}; ${loginA.cookie}`)).toBe(200);
  expect(await runs(a, `${forged}; ${loginB.cookie}`)).toBe(401);
  expect(await runs(b, loginA.cookie, { [CSRF_HEADER]: loginB.csrf })).toBe(401);
  expect(
    await runs(b, loginA.cookie.replace(cookieName(a.port), cookieName(b.port)), { [CSRF_HEADER]: loginB.csrf }),
  ).toBe(401);
});

test("answers carry the security headers and refuse large or malformed bodies", async () => {
  const { token, api, login } = await open();
  const big = await api({ method: "POST", path: "/api/session", body: { token: "x".repeat(20_000) } });
  const malformed = await api({ method: "POST", path: "/api/session", body: "{" });
  const invalid = await api({ method: "POST", path: "/api/session", body: { token, extra: 1 } });
  expect([big.status, malformed.status, invalid.status]).toEqual([413, 400, 400]);
  expect(invalid.body).toEqual({ error: "invalid-request" });
  await login();
  const { headers } = await api({ path: "/api/runs" });
  expect(headers).toMatchObject({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": expect.stringContaining("default-src 'self'"),
  });
  expect(headers["content-security-policy"]).toBe(
    "default-src 'self';style-src 'self' 'unsafe-inline';object-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'",
  );
  expect(headers["strict-transport-security"]).toBeUndefined();
});

test("the web UI's files load without a session, from this origin only; API paths still need one", async () => {
  const ui = mkdtempSync(join(tmpdir(), "cedarloom-ui-"));
  writeFileSync(join(ui, "index.html"), "<!doctype html><title>CedarLoom</title>");
  writeFileSync(join(ui, ".hidden"), "not for the browser");
  const { port, api, login } = await open(undefined, ui);
  const page = await api({ path: "/" });
  expect([page.status, page.body]).toEqual([200, "<!doctype html><title>CedarLoom</title>"]);
  expect(page.headers["content-security-policy"]).toMatch(/^default-src 'self';style-src 'self' 'unsafe-inline';/);
  // A dotfile and path tricks reach only the file handler, which serves neither.
  for (const path of ["/.hidden", "//api/runs", "/x/../api/runs"]) {
    const answer = await api({ path });
    expect([path, answer.status < 400, JSON.stringify(answer.body)]).toEqual([
      path,
      false,
      expect.not.stringContaining("runs"),
    ]);
  }
  expect((await api({ path: "/index.html", headers: { host: `localhost:${port}` } })).status).toBe(421);
  expect((await api({ path: "/index.html", headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
  for (const path of ["/api/runs", "/api/nope"]) expect((await api({ path })).status).toBe(401);
  expect((await api({ method: "POST", path: "/index.html" })).status).toBe(401);
  await login();
  // With the files served, an unknown API path is still a 404 in the API's shape, whatever the method.
  for (const method of ["GET", "POST", "PUT"]) {
    const answer = await api({ method, path: "/api/nope" });
    expect([method, answer.status, answer.headers["allow"], answer.body]).toEqual([
      method,
      404,
      undefined,
      { error: "not-found" },
    ]);
  }
  expect((await api({ method: "PUT", path: "/api/runs" })).headers["allow"]).toBe("GET, HEAD");
  // An API path the files' route caught for GET still names the methods it has.
  const caught = await api({ path: "/api/session" });
  expect([caught.status, caught.headers["allow"]]).toEqual([405, "POST"]);
  // A folder without a build serves nothing and says so in the log.
  const bare = await open(undefined, mkdtempSync(join(tmpdir(), "cedarloom-ui-")));
  expect([(await bare.api({ path: "/" })).status, bare.log.join("")]).toEqual([
    401,
    expect.stringContaining("not built"),
  ]);
});

const ready = async (): Promise<Client> => {
  const client = await open();
  await client.login();
  return client;
};

/** A run that replaced a file holding a secret; its undo would write the secret back. */
const replaced = (client: Client): { path: string; runId: string } => {
  const path = join(client.state, "..", "app.env");
  writeFileSync(path, "KEY=old-secret\n");
  const plan: Plan = {
    schemaVersion: 1,
    operations: [{ kind: "write", path, before: sha256("KEY=old-secret\n"), content: "KEY=new-secret\n" }],
  };
  const run = applyPlan(client.state, plan, { yes: true });
  return { path, runId: run.ok ? String(run.value.runId) : "" };
};

test("the runs, a run with its steps and the doctor's findings, read without writing", async () => {
  const client = await ready();
  expect((await client.api({ path: "/api/doctor" })).body).toEqual({ findings: [] });
  const { path, runId } = replaced(client);
  const runs = await client.api({ path: "/api/runs" });
  expect(runs.body).toMatchObject({ runs: [{ id: runId, kind: "apply", status: "applied" }] });
  expect((await client.api({ path: `/api/runs/${runId}` })).body).toMatchObject({
    run: { id: runId },
    steps: [{ index: 0, path, state: "done", after: sha256("KEY=new-secret\n") }],
  });
  const unknown = randomUUID();
  expect(await client.api({ path: `/api/runs/${unknown}` })).toMatchObject({
    status: 404,
    body: { findings: [{ code: "run.not-found", params: { runId: unknown } }] },
  });
  expect(await client.api({ path: "/api/runs/nope" })).toMatchObject({
    status: 400,
    body: { error: "invalid-request" },
  });
});

test("an undo is previewed without file contents and applies only with the hash of that preview", async () => {
  const client = await ready();
  const { path, runId } = replaced(client);
  const preview = await client.api({ path: `/api/runs/${runId}/undo` });
  expect(preview.body).toMatchObject({
    plan: { operations: [{ path, after: sha256("KEY=old-secret\n") }] },
    findings: [],
  });
  const { planHash } = z.object({ planHash: z.string() }).parse(preview.body);
  const undo = (approve: unknown) => client.api({ method: "POST", path: `/api/runs/${runId}/undo`, body: { approve } });
  expect((await undo("yes")).status).toBe(400);
  expect(await undo(sha256("another plan"))).toMatchObject({ status: 409, body: { status: "refused" } });
  expect(await readFile(path, "utf8")).toBe("KEY=new-secret\n");
  expect(await undo(planHash)).toMatchObject({ status: 200, body: { status: "applied", findings: [] } });
  expect(await readFile(path, "utf8")).toBe("KEY=old-secret\n");
  expect((await client.api({ path: `/api/runs/${runId}/undo` })).body).toEqual({
    planHash: null,
    plan: null,
    findings: [],
  });
  expect(JSON.stringify(preview.body)).not.toContain("secret");
  expect(
    (await client.api({ method: "POST", path: `/api/runs/${randomUUID()}/undo`, body: { approve: planHash } })).status,
  ).toBe(404);
});

test("a busy or newer store is a 409 with its finding; a broken one a 500 whose details stay in the log", async () => {
  const client = await ready();
  const { runId } = replaced(client);
  const held = openRunStore(client.state);
  const approve = { approve: sha256("x") };
  expect(await client.api({ method: "POST", path: `/api/runs/${runId}/undo`, body: approve })).toMatchObject({
    status: 409,
    body: { findings: [{ code: "store.busy" }] },
  });
  if (held.ok) held.value.close();
  const db = new DatabaseSync(join(client.state, "runs.sqlite"));
  db.exec(`UPDATE runs SET plan = '{"schemaVersion":1,"operations":[]}'`);
  const broken = await client.api({ path: `/api/runs/${runId}` });
  expect([broken.status, broken.body, client.log.join("")]).toEqual([
    500,
    { error: "internal" },
    expect.stringContaining("stored plan unreadable"),
  ]);
  db.exec("PRAGMA user_version = 4");
  db.close();
  for (const path of ["/api/runs", `/api/runs/${runId}`, `/api/runs/${runId}/undo`]) {
    expect(await client.api({ path })).toMatchObject({
      status: 409,
      body: { findings: [{ code: "store.newer-schema" }] },
    });
  }
});

/** Reads the event stream with the given headers and hands each event to `next` until it returns true or `ms` pass. */
const stream = (
  port: number,
  headers: Record<string, string>,
  next: (event: string, data: unknown) => boolean,
  ms = 5000,
) =>
  new Promise<string>((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path: "/api/events",
      headers: { host: `127.0.0.1:${port}`, ...headers },
    });
    setTimeout(() => req.destroy(), ms);
    req.on("response", (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const [event, data] = [/^event: (.*)$/m, /^data: (.*)$/m].map((line) => line.exec(buffer.slice(0, end))?.[1]);
          buffer = buffer.slice(end + 2);
          if (event !== undefined && data !== undefined && next(event, JSON.parse(data))) req.destroy();
        }
      });
      res.on("close", () => resolve(`${res.statusCode} ${res.headers["cache-control"]}`));
    });
    req.on("error", reject);
    req.end();
  });

test("the event stream sends the runs at once and again whenever they change, behind the session checks", async () => {
  const client = await ready();
  const { auth } = client;
  const seen: unknown[] = [];
  const done = stream(client.port, { accept: "text/event-stream", ...auth() }, (event, data) => {
    seen.push([event, data]);
    if (seen.length === 1) replaced(client);
    return seen.length === 2;
  });
  expect(await done).toBe("200 no-store");
  expect(seen).toMatchObject([
    ["runs", { runs: [] }],
    ["runs", { runs: [{ kind: "apply", status: "applied" }] }],
  ]);
  const { [CSRF_HEADER]: _csrf, ...cookieOnly } = auth();
  expect(await stream(client.port, { accept: "text/event-stream", ...cookieOnly }, () => true)).toMatch(/^403 /);
  expect(await stream(client.port, { accept: "application/json", ...auth() }, () => true)).toMatch(/^406 /);
  // A HEAD would hold a stream open: it has no route, so it is a 405 that names GET.
  const head = await client.api({ method: "HEAD", path: "/api/events" });
  expect([head.status, head.headers["allow"]]).toEqual([405, "GET"]);
  const db = new DatabaseSync(join(client.state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 4");
  db.close();
  // Unchanged reads send nothing: one refusal in 150 ms of reads every 25 ms.
  const refused: unknown[] = [];
  const keep = (event: string, data: unknown): boolean => refused.push([event, data]) < 0;
  await stream(client.port, { accept: "text/event-stream", ...auth() }, keep, 150);
  expect(refused).toMatchObject([["refusal", { findings: [{ code: "store.newer-schema" }] }]]);
});

test("a store that turns unreadable ends the open stream and goes to the log; the server keeps answering", async () => {
  const client = await ready();
  replaced(client);
  const seen: string[] = [];
  const ended = stream(client.port, { accept: "text/event-stream", ...client.auth() }, (event) => {
    seen.push(event);
    writeFileSync(join(client.state, "runs.sqlite"), "not a database");
    return false;
  });
  expect([await ended, seen]).toEqual(["200 no-store", ["runs"]]);
  expect(client.log.join("")).toContain("The event stream stopped");
  expect((await client.api({ path: "/nowhere" })).status).toBe(404);
});

test("the committed OpenAPI document is the one the routes generate (pnpm --filter @cedarloom/server generate)", async () => {
  const committed = await readFile(join(import.meta.dirname, "..", "openapi.json"), "utf8");
  expect(committed).toBe(await openapi(pkg.version));
  expect(Object.keys(JSON.parse(committed).paths)).toEqual([
    "/api/session",
    "/api/runs",
    "/api/runs/{runId}",
    "/api/doctor",
    "/api/runs/{runId}/undo",
    "/api/events",
  ]);
});
