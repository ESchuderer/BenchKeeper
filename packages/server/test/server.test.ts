import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingHttpHeaders, request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { openGraphStore, openRunStore, sha256 } from "@cedarloom/ledger";
import { CSRF_HEADER, type Plan } from "@cedarloom/contracts";
import { cookieName, openapi, type Started, startServer } from "@cedarloom/server";
import { applyPlan, DRAFT_LIMIT, type Fetch } from "@cedarloom/use-cases";
import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { FLOWS, flowsExport } from "./flows-export.ts";

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
  fetch?: Fetch,
): Promise<Client> => {
  const log: string[] = [];
  const server = await startServer({
    state,
    ui,
    fetch,
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
  vi.unstubAllEnvs();
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

/** A graph run of the corpus's minimal workflow whose trigger started and whose runner is gone: interrupted. */
const graphRun = async (client: Client): Promise<string> => {
  const definition = JSON.parse(await readFile(join(corpus, "valid-minimal.json"), "utf8"));
  const store = openGraphStore(client.state);
  if (!store.ok) throw new Error(store.finding.code);
  const run = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
  const lease = store.value.create({ ...run, definition, project: client.state });
  store.value.append(lease.runId, 1, { type: "started", node: "start", attempt: 1, pid: 4242 });
  lease.release();
  return lease.runId;
};

test("the API lists the graph runs and shows one with its node attempts, on the event stream too", async () => {
  const client = await ready();
  const runId = await graphRun(client);
  const summary = {
    id: runId,
    workflow: "minimal",
    trigger: "manual",
    mode: "act",
    status: "interrupted",
    finishedAt: null,
  };
  const seen: unknown[] = [];
  await stream(client.port, { accept: "text/event-stream", ...client.auth() }, (event, data) => {
    seen.push([event, data]);
    return true;
  });
  expect([
    (await client.api({ path: "/api/graph-runs" })).body,
    (await client.api({ path: `/api/graph-runs/${runId}` })).body,
    (await client.api({ path: `/api/graph-runs/${randomUUID()}` })).status,
    seen,
  ]).toMatchObject([
    { graphRuns: [summary] },
    { run: summary, attempts: [{ node: "start", attempt: 1, pid: 4242 }] },
    404,
    [["runs", { runs: [], graphRuns: [summary] }]],
  ]);
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
  db.exec("PRAGMA user_version = 99");
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
  db.exec("PRAGMA user_version = 99");
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
  // Unreadable at connect: no stream opens, and the error handler answers.
  expect(await stream(client.port, { accept: "text/event-stream", ...client.auth() }, () => true)).toMatch(/^500 /);
});

test("a client that stops reading gets no queue of changed run lists, one send waits at most", async () => {
  const client = await ready();
  replaced(client);
  // 3,000 runs make each event about 800 KB, so the socket buffers fill within a few changes.
  const db = new DatabaseSync(join(client.state, "runs.sqlite"));
  db.exec(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000)
    INSERT INTO runs (id, kind, plan, planHash, approvedHash, status, epoch, startedAt, finishedAt)
    SELECT 'copy-' || i, kind, plan, planHash, approvedHash, status, epoch, startedAt, finishedAt FROM runs, n`);
  // Every pending send waits on the socket's drain event; more than 10 waiting draws this warning.
  const warnings: string[] = [];
  const warned = (warning: Error): number => warnings.push(warning.name);
  process.on("warning", warned);
  const headers = { host: `127.0.0.1:${client.port}`, accept: "text/event-stream", ...client.auth() };
  const socket = connect(client.port, "127.0.0.1").pause();
  socket.write(
    `GET /api/events HTTP/1.1\r\n${Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}\r\n`)
      .join("")}\r\n`,
  );
  for (let i = 1; i <= 60; i += 1) {
    db.prepare("UPDATE runs SET finishedAt = ? WHERE id = 'copy-1'").run(new Date(Date.now() + i * 1000).toISOString());
    await delay(30);
  }
  socket.destroy();
  db.close();
  process.off("warning", warned);
  expect(warnings).toEqual([]);
});

const corpus = join(import.meta.dirname, "..", "..", "contracts", "corpus", "WorkflowDefinition", "1");
const DRAFT = "/api/drafts/build-and-review";

/** A logged-in client and a workflow from the corpus to save as a draft. */
const drafting = async (): Promise<Client & { workflow: Record<string, unknown> }> => {
  const client = await open();
  await client.login();
  const workflow: Record<string, unknown> = JSON.parse(
    await readFile(join(corpus, "valid-build-and-review.json"), "utf8"),
  );
  return { ...client, workflow };
};

test("drafts are saved, listed, read and deleted behind the session checks; a save says when it replaced another", async () => {
  const { api, workflow } = await drafting();
  expect(await api({ path: "/api/drafts", headers: { cookie: "" } })).toMatchObject({ status: 401 });
  expect(await api({ path: "/api/drafts" })).toMatchObject({ status: 200, body: { drafts: [] } });
  const first = await api({ method: "PUT", path: DRAFT, body: { workflow, replaces: null } });
  const { hash } = z.object({ hash: z.string() }).parse(first.body);
  expect(first).toMatchObject({ status: 200, body: { id: "build-and-review", overwrote: false } });
  expect(await api({ path: "/api/drafts" })).toMatchObject({ body: { drafts: [{ id: "build-and-review" }] } });
  expect(await api({ path: DRAFT })).toMatchObject({ status: 200, body: { workflow, hash } });
  // Two tabs save on the version both saw: both are written, and the second learns that it replaced the first's.
  const renamed = { ...workflow, metadata: { id: "build-and-review", name: "Renamed", version: "1.0.0" } };
  expect(await api({ method: "PUT", path: DRAFT, body: { workflow: renamed, replaces: hash } })).toMatchObject({
    body: { overwrote: false },
  });
  const again = { method: "PUT", path: DRAFT, body: { workflow, replaces: hash } };
  expect(await api(again)).toMatchObject({ body: { overwrote: true } });
  // A save needs the CSRF header like every other request.
  expect(await api({ ...again, headers: { [CSRF_HEADER]: "x" } })).toMatchObject({ status: 403 });
  expect(await api({ method: "DELETE", path: DRAFT })).toMatchObject({ status: 204, body: "" });
  expect(await api({ method: "DELETE", path: DRAFT })).toMatchObject({
    status: 404,
    body: { findings: [{ code: "draft.not-found" }] },
  });
});

test("a draft that is missing, broken, no workflow or too large is refused with its finding", async () => {
  const { api, state, workflow } = await drafting();
  await api({ method: "PUT", path: DRAFT, body: { workflow, replaces: null } });
  writeFileSync(join(state, "drafts", "workflow-broken.json"), "{");
  const metadata = { id: "build-and-review", name: "W", version: "1.0.0" };
  // Compact JSON under the body limit whose canonical file, one value per line, is over the draft limit.
  const long = { ...workflow, metadata: { ...metadata, list: Array(300_000).fill(1) } };
  const refusals: [Call, number, string][] = [
    [{ path: "/api/drafts/broken" }, 409, "document.invalid"],
    [{ path: "/api/drafts/none" }, 404, "draft.not-found"],
    [{ method: "PUT", path: DRAFT, body: { workflow: { kind: "other" }, replaces: null } }, 409, "document.invalid"],
    [{ method: "PUT", path: DRAFT, body: { workflow: long, replaces: null } }, 409, "draft.too-large"],
  ];
  for (const [sent, code, finding] of refusals) {
    expect(await api(sent)).toMatchObject({ status: code, body: { findings: [{ code: finding }] } });
  }
  const huge = { ...workflow, metadata: { ...metadata, notes: "x".repeat(DRAFT_LIMIT) } };
  expect(await api({ method: "PUT", path: DRAFT, body: { workflow: huge, replaces: null } })).toMatchObject({
    status: 413,
    body: { error: "FST_ERR_CTP_BODY_TOO_LARGE" },
  });
  expect(await api({ path: "/api/drafts/not%20an%20id" })).toMatchObject({
    status: 400,
    body: { error: "invalid-request" },
  });
  // The refused saves left the draft as it was.
  expect(await api({ path: DRAFT })).toMatchObject({ status: 200, body: { workflow } });
});

// The document's WorkflowJsonInput leaves out these keys, so Schemathesis sends them only as invalid requests.
test("a save whose JSON the parser refuses, a __proto__ key or constructor.prototype at any depth, gets 400 with the parser's code", async () => {
  const { api } = await drafting();
  const refused: [string, string][] = [
    ['{"workflow":{"a":[{"__proto__":1}]},"replaces":null}', "FST_ERR_CTP_INVALID_JSON_BODY"],
    ['{"workflow":{"a":{"constructor":{"prototype":null}}},"replaces":null}', "FST_ERR_CTP_INVALID_JSON_BODY"],
    ["", "FST_ERR_CTP_EMPTY_JSON_BODY"],
  ];
  for (const [body, error] of refused) {
    expect(await api({ method: "PUT", path: DRAFT, body })).toMatchObject({ status: 400, body: { error } });
  }
});

test("the committed OpenAPI document is the one the routes generate (pnpm --filter @cedarloom/server generate)", async () => {
  const committed = await readFile(join(import.meta.dirname, "..", "openapi.json"), "utf8");
  expect(committed).toBe(await openapi(pkg.version));
});

test("an import of a Git ref is reviewed with its plan under an id, which applies only with the hash of its preview, once", async () => {
  // Store commits carry the user's Git identity: a home folder of the test's own gives one.
  const home = mkdtempSync(join(tmpdir(), "cedarloom-home-"));
  writeFileSync(join(home, ".gitconfig"), "[user]\n\tname = Ada\n\temail = ada@example.org\n");
  vi.stubEnv("HOME", home);
  vi.stubEnv("XDG_CONFIG_HOME", home);
  const client = await serve(undefined, undefined, undefined, await flowsExport());
  started.push(client);
  await client.login();
  const imports = (body: object) => client.api({ method: "POST", path: "/api/imports", body });
  const reviewed = await imports({ git: FLOWS, ref: "main" });
  const units = z.array(z.object({ status: z.string() }));
  const { id, planHash, review } = z
    .object({ id: z.string(), planHash: z.string(), review: z.object({ units }) })
    .parse(reviewed.body);
  const apply = (approve: string) =>
    client.api({ method: "POST", path: `/api/imports/${id}/apply`, body: { approve } });
  const answers = [
    reviewed.status,
    review.units.map((unit) => unit.status),
    (await apply(sha256("another plan"))).status,
    (await apply(planHash)).status,
    (await apply(planHash)).status,
    (await imports({ git: "https://git.example.org/acme/other.git", ref: "main" })).status,
    // The API reads no folder a request names: an export folder is imported through its Git URL, or with the CLI.
    (await imports({ folder: home })).status,
  ];
  expect(answers).toEqual([200, ["new"], 409, 200, 404, 409, 400]);
}, 30_000);
