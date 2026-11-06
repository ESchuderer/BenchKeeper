import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plan, WorkflowDefinition } from "@cedarloom/contracts";
import { type GraphStore, type NewGraphRun, openGraphStore, openRunStore, planHash } from "@cedarloom/ledger";
import { afterEach, expect, test, vi } from "vitest";
import { failCommits } from "./helpers.ts";

const definition: WorkflowDefinition = {
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id: "lint", name: "Lint", version: "1.0.0" },
  inputs: { strict: { type: "boolean", default: false } },
  nodes: [
    { id: "start", type: "trigger.manual" },
    { id: "lint", type: "command.run", with: { command: "npm run lint" } },
  ],
  edges: [{ id: "e1", from: { node: "start", handle: "start" }, to: { node: "lint", handle: "run" } }],
};
const manual: NewGraphRun = {
  definition,
  inputs: { strict: true },
  trigger: "manual",
  mode: "act",
  parentRun: null,
  parentNode: null,
};
const [A, B] = ["runner-a", "runner-b"];

const open: { close(): void }[] = [];
const fresh = (): string => mkdtempSync(join(tmpdir(), "cedarloom-graph-"));
const graphs = (dir: string): GraphStore => {
  const store = openGraphStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  open.push(store.value);
  return store.value;
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const store of open.splice(0)) store.close();
});

// An apply run in the store of `dir`, whose lock stays held until the test ends.
const applyRunIn = (dir: string): string => {
  const plan: Plan = { schemaVersion: 1, operations: [{ kind: "write", path: "/x", before: null, content: "x" }] };
  const runs = openRunStore(dir);
  if (!runs.ok) throw new Error(runs.finding.code);
  open.push(runs.value);
  const run = runs.value.begin("apply", plan, planHash(plan));
  if (!run.ok) throw new Error(run.finding.code);
  return run.value;
};

const rows = (dir: string, sql: string): Record<string, unknown>[] => {
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { readOnly: true });
  const found = db.prepare(sql).all();
  db.close();
  return found.map((row) => ({ ...row }));
};
const attempts = (dir: string) => rows(dir, "SELECT nodeId, attempt, state, outputs, pid, applyRun FROM node_attempts");

test("a run keeps its definition and inputs as it started, its events in order, and each projection with its event", () => {
  const dir = fresh();
  const store = graphs(dir);
  const id = store.create(manual, A);
  expect(store.graphRun(id)).toMatchObject({ definition, inputs: { strict: true }, status: "running", epoch: 1 });
  const events = [
    { type: "started", node: "lint", attempt: 1, pid: 4242 },
    { type: "ended", node: "lint", attempt: 1, outcome: "done", values: {} },
    { type: "decided", node: "lint", approved: true },
    { type: "finished", status: "succeeded", outputs: {} },
  ] as const;
  expect(events.map((event) => store.append(id, A, event))).toEqual(
    [1, 2, 3, 4].map((seq) => ({ ok: true, value: seq })),
  );
  expect(rows(dir, "SELECT nodeId, attempt FROM run_events ORDER BY seq")).toEqual([
    { nodeId: "lint", attempt: 1 },
    { nodeId: "lint", attempt: 1 },
    { nodeId: "lint", attempt: null },
    { nodeId: null, attempt: null },
  ]);
  expect(store.events(id)).toEqual({ ok: true, value: events });
  expect(attempts(dir)).toEqual([
    { nodeId: "lint", attempt: 1, state: "done", outputs: "{}", pid: 4242, applyRun: null },
  ]);
  expect(store.graphRun(id)).toMatchObject({ status: "succeeded", finishedAt: expect.any(String) });
  // An ended run takes no more events, and nothing takes it over.
  const finished = { ok: false, finding: { code: "run.finished", params: { runId: id, status: "succeeded" } } };
  expect([store.append(id, A, { type: "cancel" }), store.takeOver(id, B), store.heartbeat(id, A)]).toEqual([
    finished,
    finished,
    finished,
  ]);
  const unknown = { ok: false, finding: { code: "run.not-found", params: { runId: "nope" } } };
  expect([store.append("nope", A, { type: "cancel" }), store.takeOver("nope", B), store.events("nope")]).toEqual([
    unknown,
    unknown,
    unknown,
  ]);
  expect(store.graphRun("nope")).toBeUndefined();
});

test("another runner takes a run over only once its lease ran out; the old runner's writes are refused from then on", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00.000Z"));
  const dir = fresh();
  const [first, second] = [graphs(dir), graphs(dir)];
  const id = first.create(manual, A);
  vi.setSystemTime(new Date("2026-11-06T12:00:50.000Z"));
  expect(first.heartbeat(id, A)).toEqual({ ok: true, value: undefined });
  // 60 s after the heartbeat, not after the start.
  vi.setSystemTime(new Date("2026-11-06T12:01:30.000Z"));
  const held = {
    ok: false,
    finding: { code: "run.lease-held", params: { runId: id, until: "2026-11-06T12:01:50.000Z" } },
  };
  expect([second.takeOver(id, B), second.graphRun(id)?.status]).toEqual([held, "running"]);
  vi.setSystemTime(new Date("2026-11-06T12:01:51.000Z"));
  expect(second.graphRun(id)?.status).toBe("interrupted");
  // Of two runners that try, one wins: the second meets the lease the first just took.
  expect([second.takeOver(id, B), first.takeOver(id, A)]).toEqual([
    { ok: true, value: 2 },
    { ok: false, finding: { code: "run.lease-held", params: { runId: id, until: "2026-11-06T12:02:51.000Z" } } },
  ]);
  expect([first.append(id, A, { type: "cancel" }), first.heartbeat(id, A)]).toEqual([
    { ok: false, finding: { code: "run.lease-held", params: { runId: id, until: "2026-11-06T12:02:51.000Z" } } },
    { ok: false, finding: { code: "run.lease-held", params: { runId: id, until: "2026-11-06T12:02:51.000Z" } } },
  ]);
  expect(second.append(id, B, { type: "cancel" })).toEqual({ ok: true, value: 2 });
  expect(second.events(id)).toEqual({ ok: true, value: [{ type: "resumed" }, { type: "cancel" }] });
  expect(second.graphRun(id)).toMatchObject({ status: "running", epoch: 2 });
});

test("a stored event that fails its schema is refused before replay, with its sequence number", () => {
  const dir = fresh();
  const store = graphs(dir);
  const id = store.create(manual, A);
  store.append(id, A, { type: "cancel" });
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  const insert = db.prepare("INSERT INTO run_events VALUES (?, ?, '2026-11-06T12:00:00.000Z', 'ended', 'lint', 0, ?)");
  insert.run(id, 2, JSON.stringify({ type: "ended", node: "lint", attempt: 0, outcome: "done", extra: 1 }));
  const issues = [
    { path: "attempt", code: "too_small" },
    { path: "", code: "unrecognized_keys" },
  ];
  expect(store.events(id)).toEqual({
    ok: false,
    finding: { code: "run.event-invalid", params: { runId: id, seq: 2, issues } },
  });
  db.prepare("DELETE FROM run_events WHERE seq = 2").run();
  insert.run(id, 2, "{");
  db.close();
  expect(store.events(id)).toMatchObject({
    ok: false,
    finding: { params: { seq: 2, issues: [{ path: "", code: "invalid_json" }] } },
  });
  // The append side refuses such an event before it reaches the log.
  expect(() => store.append(id, A, { type: "ended", node: "lint", attempt: 0, outcome: "done" })).toThrow(
    /too_small|>0/,
  );
});

test("no projection without its event: a commit that fails keeps neither, nor does an attempt that never started", () => {
  const dir = fresh();
  const store = graphs(dir);
  const id = store.create(manual, A);
  expect(() => store.append(id, A, { type: "ended", node: "lint", attempt: 1, outcome: "done" })).toThrow(
    /not running/,
  );
  const failure = new Error("database or disk is full");
  failCommits(failure);
  expect(() => store.append(id, A, { type: "started", node: "lint", attempt: 1, pid: null })).toThrow(failure);
  expect(() => store.append(id, A, { type: "finished", status: "failed", outputs: {} })).toThrow(failure);
  vi.restoreAllMocks();
  expect([store.events(id), attempts(dir), store.graphRun(id)?.status]).toEqual([
    { ok: true, value: [] },
    [],
    "running",
  ]);
  // A run ends after its attempts: an end while one still runs is refused, and the run goes on.
  const started = { type: "started", node: "lint", attempt: 1, pid: null } as const;
  store.append(id, A, started);
  expect(() => store.append(id, A, { type: "finished", status: "failed", outputs: {} })).toThrow(/attempts running/);
  expect([store.events(id), store.graphRun(id)?.status]).toEqual([{ ok: true, value: [started] }, "running"]);
});

test("an apply run is linked to its attempt under an act run, never under a report run", () => {
  const dir = fresh();
  const applyRun = applyRunIn(dir);
  const store = graphs(dir);
  const [act, report] = [store.create(manual, A), store.create({ ...manual, mode: "report" }, A)];
  const applying = { type: "applying", node: "lint", attempt: 1, applyRun } as const;
  for (const id of [act, report]) store.append(id, A, { type: "started", node: "lint", attempt: 1, pid: null });
  expect([store.append(act, A, applying), store.append(report, A, applying)]).toEqual([
    { ok: true, value: 2 },
    { ok: false, finding: { code: "run.report-only-apply", params: { runId: report, applyRun } } },
  ]);
  expect(attempts(dir).map((row) => row["applyRun"])).toEqual([applyRun, null]);
  expect(store.events(report)).toMatchObject({ ok: true, value: [{ type: "started" }] });
});

test("one process applies under the store lock while another appends events, and both succeed", async () => {
  const dir = fresh();
  const store = graphs(dir);
  const id = store.create(manual, A);
  const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures", "apply.ts"), dir, "2000"], {
    stdio: "pipe",
  });
  const exited = once(child, "exit");
  await once(child.stdout, "data");
  const failures: string[] = [];
  let attempt = 0;
  // A pair per timer tick, some 300 events a second, far more than an executor appends. Measured while writing this
  // test: two processes that both wrote without a pause kept one of them out past its 1 s wait in 4 of 6 runs.
  for (const end = Date.now() + 1500; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 1))) {
    attempt += 1;
    try {
      store.append(id, A, { type: "started", node: "lint", attempt, pid: null });
      store.append(id, A, { type: "ended", node: "lint", attempt, outcome: "failed" });
    } catch (error) {
      failures.push(String(error));
    }
  }
  const [code] = await exited;
  expect([code, failures]).toEqual([0, []]);
  const events = store.events(id);
  expect(events.ok && events.value.length).toBe(attempt * 2);
  const runs = openRunStore(dir);
  open.push(...(runs.ok ? [runs.value] : []));
  expect(runs.ok && new Set(runs.value.runs().map((run) => run.status))).toEqual(new Set(["applied"]));
}, 15_000);

test("a store from before the graph tables gains them when a graph store opens it, and keeps its apply runs", () => {
  const dir = fresh();
  applyRunIn(dir);
  open.splice(0).forEach((store) => store.close());
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec(
    "DROP TABLE gates; DROP TABLE run_events; DROP TABLE node_attempts; DROP TABLE graph_runs; PRAGMA user_version = 6",
  );
  db.close();
  expect(openGraphStore(dir, () => "nfs4")).toEqual({
    ok: false,
    finding: { code: "store.network-filesystem", params: { dir, fsType: "nfs4" } },
  });
  const store = graphs(dir);
  expect(store.graphRun(store.create(manual, A))?.status).toBe("running");
  const after = new DatabaseSync(join(dir, "runs.sqlite"), { readOnly: true });
  expect([after.prepare("PRAGMA user_version").get(), after.prepare("SELECT count(*) AS n FROM runs").get()]).toEqual([
    { user_version: 7 },
    { n: 1 },
  ]);
  after.close();
});
