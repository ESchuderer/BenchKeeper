import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@cedarloom/client";
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

test("connect exchanges the URL token once; the client then reads runs and undoes one with the previewed hash", async () => {
  const { base, token, state } = await serve();
  const tab = browser();
  await expect(connect(base, `${token}x`, tab)).rejects.toThrow("the session exchange answered 401");
  const api = await connect(base, token, tab);
  await expect(connect(base, token, browser())).rejects.toThrow("the session exchange answered 401");
  expect((await api.GET("/api/runs")).data).toEqual({ runs: [] });
  const path = join(state, "..", "notes.md");
  const run = applyPlan(
    state,
    { schemaVersion: 1, operations: [{ kind: "write", path, before: null, content: "hi\n" }] },
    { yes: true },
  );
  const runId = run.ok ? String(run.value.runId) : "";
  const params = { params: { path: { runId } } };
  const shown = await api.GET("/api/runs/{runId}", params);
  expect(shown.data?.steps.map((step) => [step.state, step.after])).toEqual([["done", sha256("hi\n")]]);
  const preview = await api.GET("/api/runs/{runId}/undo", params);
  const approve = preview.data && "planHash" in preview.data ? preview.data.planHash : "";
  expect(
    (await api.POST("/api/runs/{runId}/undo", { ...params, body: { approve: sha256("x") } })).response.status,
  ).toBe(409);
  expect((await api.POST("/api/runs/{runId}/undo", { ...params, body: { approve } })).data?.status).toBe("applied");
  expect(existsSync(path)).toBe(false);
});

test("a request without the client's CSRF header is refused, also with the session cookie", async () => {
  const { base, token } = await serve();
  const tab = browser();
  await connect(base, token, tab);
  const bare = await tab(`${base}/api/runs`);
  expect([bare.status, await bare.json()]).toEqual([403, { error: "csrf" }]);
});

test("with the platform's fetch the session needs a cookie store: Node's fetch keeps none, a browser tab does", async () => {
  const { base, token } = await serve();
  const api = await connect(base, token);
  expect((await api.GET("/api/runs")).error).toEqual({ error: "no-session" });
});

test("the committed types are the ones openapi-typescript generates from the server's document (pnpm --filter @cedarloom/client generate)", async () => {
  const check = spawnSync(process.execPath, [join(import.meta.dirname, "..", "scripts", "generate.ts"), "--check"], {
    encoding: "utf8",
  });
  expect([check.status, check.stderr]).toEqual([0, ""]);
});
