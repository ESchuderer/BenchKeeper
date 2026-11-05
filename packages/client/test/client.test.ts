import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { client, exchange } from "@cedarloom/client";
import { CSRF_HEADER } from "@cedarloom/contracts/http";
import { sha256 } from "@cedarloom/ledger";
import { type Started, startServer } from "@cedarloom/server";
import { applyPlan } from "@cedarloom/services";
import { afterEach, expect, test } from "vitest";

const servers: Started[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

/** A server on a fresh state folder, with the base URL and token a page reads from the printed link. */
const serve = async (): Promise<{ base: string; token: string; state: string }> => {
  const state = join(mkdtempSync(join(tmpdir(), "cedarloom-client-")), "state");
  const server = await startServer({ state, log: () => undefined });
  servers.push(server);
  const url = new URL(server.url);
  return { base: url.origin, token: url.hash.slice("#t=".length), state };
};

/** fetch with a cookie jar of one cookie, as a browser tab keeps the session cookie for its origin. */
const browser = (): typeof fetch => {
  let cookie = "";
  return async (input, init) => {
    const request = new Request(input, init);
    if (cookie !== "") request.headers.set("cookie", cookie);
    const response = await fetch(request);
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
    return response;
  };
};

/** A run that wrote one file, and the path parameters that name it. */
const written = (state: string): { path: string; params: { params: { path: { runId: string } } } } => {
  const path = join(state, "..", "notes.md");
  const plan = {
    schemaVersion: 1 as const,
    operations: [{ kind: "write" as const, path, before: null, content: "hi\n" }],
  };
  const run = applyPlan(state, plan, { yes: true });
  return { path, params: { params: { path: { runId: run.ok ? String(run.value.runId) : "" } } } };
};

test("the URL token is exchanged once, and a refusal names its status and error code", async () => {
  const { base, token } = await serve();
  const tab = browser();
  await expect(exchange(base, `${token}x`, tab)).rejects.toThrow("the session exchange answered 401 token");
  expect(await exchange(base, token, tab)).toMatch(/^[\w-]{43}$/);
  await expect(exchange(base, token, browser())).rejects.toThrow("answered 401 token");
});

test("the client reads runs and undoes one only with the previewed hash; a refusal arrives as the error", async () => {
  const { base, token, state } = await serve();
  const tab = browser();
  const api = client(base, await exchange(base, token, tab), tab);
  expect((await api.GET("/api/runs")).data).toEqual({ runs: [] });
  const { path, params } = written(state);
  const shown = await api.GET("/api/runs/{runId}", params);
  expect(shown.data?.steps.map((step) => [step.state, step.after])).toEqual([["done", sha256("hi\n")]]);
  const preview = await api.GET("/api/runs/{runId}/undo", params);
  const approve = preview.data && "planHash" in preview.data ? preview.data.planHash : "";
  const refused = await api.POST("/api/runs/{runId}/undo", { ...params, body: { approve: sha256("x") } });
  expect([refused.response.status, refused.error]).toEqual([409, expect.objectContaining({ status: "refused" })]);
  expect((await api.POST("/api/runs/{runId}/undo", { ...params, body: { approve } })).data?.status).toBe("applied");
  expect(existsSync(path)).toBe(false);
  // Nothing left to undo: openapi-fetch types this answer as { findings }, and the nulls are there at runtime.
  expect((await api.GET("/api/runs/{runId}/undo", params)).data).toEqual({ planHash: null, plan: null, findings: [] });
});

test("a reloaded page keeps working with its stored CSRF token; a request without it is refused", async () => {
  const { base, token } = await serve();
  const tab = browser();
  const csrf = await exchange(base, token, tab);
  expect((await client(base, csrf, tab).GET("/api/runs")).response.status).toBe(200);
  const bare = await tab(`${base}/api/runs`);
  expect([bare.status, await bare.json()]).toEqual([403, { error: "csrf" }]);
});

test("the CSRF token goes to the API's origin only, also when a request names another base URL", async () => {
  const sent: Request[] = [];
  const spy: typeof fetch = async (input, init) => {
    sent.push(new Request(input, init));
    return Response.json({ runs: [] });
  };
  const api = client("http://127.0.0.1:9", "secret-csrf", spy);
  await api.GET("/api/runs");
  await api.GET("/api/runs", { baseUrl: "http://example.invalid" });
  expect(sent.map((request) => [new URL(request.url).host, request.headers.get(CSRF_HEADER)])).toEqual([
    ["127.0.0.1:9", "secret-csrf"],
    ["example.invalid", null],
  ]);
});

test("with the platform's fetch the session needs a cookie store: Node's fetch keeps none, a browser tab does", async () => {
  const { base, token } = await serve();
  const api = client(base, await exchange(base, token));
  expect((await api.GET("/api/runs")).error).toEqual({ error: "no-session" });
});

test("the committed types are the ones openapi-typescript generates from the server's document (pnpm --filter @cedarloom/client generate)", async () => {
  const check = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "generate.ts"), "--check"], {
    encoding: "utf8",
  });
  expect([check.status, check.stderr]).toEqual([0, ""]);
});
