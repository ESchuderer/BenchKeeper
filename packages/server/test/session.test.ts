import { CSRF_HEADER, cookieName } from "@cedarloom/server";
import { afterEach, expect, test } from "vitest";
import { call, type Client, serve, sessionCookie } from "./helpers.ts";

const started: Client[] = [];
const open = async (tokenMs?: number): Promise<Client> => {
  const client = await serve(tokenMs);
  started.push(client);
  return client;
};
afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => client.server.close()));
});

test("the server listens on 127.0.0.1 with the token in the URL fragment, and answers any other Host with 421", async () => {
  const { server, port, token, api } = await open();
  expect(server.url).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:${port}/#t=[A-Za-z0-9_-]{43}$`));
  expect(Buffer.from(token, "base64url")).toHaveLength(32);
  // localhost, another port and a rebound DNS name all reach the same socket, and none of them is this origin.
  for (const host of [`localhost:${port}`, `127.0.0.1:${port + 1}`, "attacker.example", `[::1]:${port}`]) {
    const answer = await api({ method: "POST", path: "/api/session", headers: { host }, body: { token } });
    expect([host, answer.status, answer.body]).toEqual([host, 421, { error: "wrong-host" }]);
  }
});

test("the URL token is exchanged once, before it expires, for an HttpOnly SameSite=Strict cookie and a CSRF token", async () => {
  const { port, token, api, login } = await open();
  expect((await api({ method: "POST", path: "/api/session", body: { token: `${token}x` } })).status).toBe(401);
  const exchanged = await api({ method: "POST", path: "/api/session", body: { token } });
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
  const { port, api, login } = await open();
  expect(await api({ path: "/api/runs" })).toMatchObject({ status: 401, body: { error: "no-session" } });
  expect(await api({ path: "/nowhere" })).toMatchObject({ status: 401 });
  const { cookie, csrf } = await login();
  expect(await api({ path: "/api/runs", headers: { [CSRF_HEADER]: "" } })).toMatchObject({ status: 403 });
  expect(await api({ path: "/api/runs", headers: { [CSRF_HEADER]: `${csrf}x` } })).toMatchObject({
    status: 403,
    body: { error: "csrf" },
  });
  expect((await call(port, { path: "/api/runs", headers: { cookie } })).status).toBe(403);
  expect((await call(port, { path: "/api/runs", headers: { [CSRF_HEADER]: csrf } })).status).toBe(401);
  expect(await api({ path: "/api/runs" })).toMatchObject({ status: 200, body: { runs: [] } });
  expect((await api({ path: "/nowhere" })).status).toBe(404);
});

test("a foreign Origin or a cross-site fetch is refused, and no request gets CORS headers", async () => {
  const { port, api, login } = await open();
  await login();
  for (const origin of [`http://127.0.0.1:${port + 1}`, `http://localhost:${port}`, "null"]) {
    expect(await api({ path: "/api/runs", headers: { origin } })).toMatchObject({
      status: 403,
      body: { error: "foreign-origin" },
    });
  }
  for (const site of ["same-site", "cross-site"]) {
    expect(await api({ path: "/api/runs", headers: { "sec-fetch-site": site } })).toMatchObject({
      status: 403,
      body: { error: "cross-site" },
    });
  }
  const own = { origin: `http://127.0.0.1:${port}`, "sec-fetch-site": "same-origin" };
  const allowed = await api({ path: "/api/runs", headers: own });
  const preflight = await api({
    method: "OPTIONS",
    path: "/api/runs",
    headers: { ...own, "access-control-request-method": "POST" },
  });
  expect([allowed.status, preflight.status]).toEqual([200, 404]);
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
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toBeUndefined();
});
