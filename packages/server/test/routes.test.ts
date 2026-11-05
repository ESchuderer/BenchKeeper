import { readFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plan } from "@cedarloom/contracts";
import { openRunStore, sha256 } from "@cedarloom/ledger";
import { applyPlan } from "@cedarloom/services";
import { afterEach, expect, test } from "vitest";
import { z } from "zod";
import { openapi } from "@cedarloom/server";
import pkg from "../package.json" with { type: "json" };
import { type Client, serve } from "./helpers.ts";

const started: Client[] = [];
const ready = async (): Promise<Client> => {
  const client = await serve();
  started.push(client);
  await client.login();
  return client;
};
afterEach(async () => {
  await Promise.all(started.splice(0).map((client) => client.server.close()));
});

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
  expect(await client.api({ path: "/api/runs/nope" })).toMatchObject({
    status: 404,
    body: { findings: [{ code: "run.not-found", params: { runId: "nope" } }] },
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
  expect((await undo(sha256("another plan"))).body).toMatchObject({ status: "refused" });
  expect(await readFile(path, "utf8")).toBe("KEY=new-secret\n");
  expect(await undo(planHash)).toMatchObject({ status: 200, body: { status: "applied", findings: [] } });
  expect(await readFile(path, "utf8")).toBe("KEY=old-secret\n");
  expect((await client.api({ path: `/api/runs/${runId}/undo` })).body).toEqual({
    planHash: null,
    plan: null,
    findings: [],
  });
  expect(JSON.stringify(preview.body)).not.toContain("secret");
  expect((await client.api({ method: "POST", path: "/api/runs/nope/undo", body: { approve: planHash } })).status).toBe(
    404,
  );
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

test("the committed OpenAPI document is the one the routes generate (pnpm --filter @cedarloom/server generate)", async () => {
  const committed = await readFile(join(import.meta.dirname, "..", "openapi.json"), "utf8");
  expect(committed).toBe(await openapi(pkg.version));
  expect(Object.keys(JSON.parse(committed).paths)).toEqual([
    "/api/session",
    "/api/runs",
    "/api/runs/{runId}",
    "/api/doctor",
    "/api/runs/{runId}/undo",
  ]);
});
