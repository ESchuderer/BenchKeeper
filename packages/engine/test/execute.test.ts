import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JournalEvent, Json, WorkflowDefinition } from "@cedarloom/contracts";
import { type Attempt, capped, type ExecuteOptions, type Executors, execute, OUTPUT_CAP } from "@cedarloom/engine";
import { type GraphStore, openGraphStore, type RunLease } from "@cedarloom/ledger";
import { expect, test } from "vitest";

type Values = Record<string, Json>;
// How a node's next attempt ends: done with these values, failed, hung until stopped, or done after a side step.
type Plan = Values | "fail" | "hang" | (() => void);

/** t (a manual trigger, with a precheck if given) -> a -> b, both commands; b's stdout is the output `out`. */
const workflow = (execution: WorkflowDefinition["execution"] = {}, precheck?: string): WorkflowDefinition => ({
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id: "w", name: "W", version: "1.0.0" },
  outputs: { out: { type: "string" } },
  nodes: [
    { id: "t", type: "trigger.manual", ...(precheck === undefined ? {} : { with: { precheck } }) },
    { id: "a", type: "command.run", with: { command: "a" } },
    { id: "b", type: "command.run", with: { command: "b" } },
  ],
  edges: [
    { id: "e1", from: { node: "t", handle: "start" }, to: { node: "a", handle: "run" } },
    { id: "e2", from: { node: "a", handle: "done" }, to: { node: "b", handle: "run" } },
    { id: "e3", from: { node: "b", handle: "stdout" }, to: { output: "out" } },
  ],
  execution,
});

// Commands that end as the script says, per node; a node without a plan left ends done.
const scripted = (script: Record<string, Plan[]>): Executors => ({
  "command.run": (attempt: Attempt) => ({
    pid: null,
    run: async () => {
      const plan = script[attempt.node]?.shift() ?? {};
      if (typeof plan === "function") plan();
      if (plan === "hang") await new Promise((resolve) => attempt.signal.addEventListener("abort", resolve));
      return plan === "fail" || plan === "hang"
        ? { ok: false }
        : { ok: true, values: typeof plan === "object" ? plan : {} };
    },
  }),
});

const graphs = (dir = mkdtempSync(join(tmpdir(), "cedarloom-execute-"))): GraphStore => {
  const store = openGraphStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  return store.value;
};
const created = (store: GraphStore, definition: WorkflowDefinition): RunLease =>
  store.create({ definition, inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null });
const now = () => Promise.resolve();
const start = async (
  definition: WorkflowDefinition,
  script: Record<string, Plan[]>,
  options: Partial<ExecuteOptions> = {},
) => {
  const store = graphs();
  const lease = created(store, definition);
  const source = { workflow: definition, inputs: {}, journal: [] };
  const result = await execute(store, lease, source, { executors: scripted(script), sleep: now, ...options });
  const events = store.events(lease.runId);
  return { result, store, lease, events: events.ok ? events.value : [] };
};
// Resumes a run of `definition` whose journal holds `journal`; the events it adds are the second item.
const resume = async (definition: WorkflowDefinition, journal: JournalEvent[]) => {
  const store = graphs();
  const lease = created(store, definition);
  for (const event of journal) store.append(lease.runId, 1, event);
  const source = { workflow: definition, inputs: {}, journal };
  const result = await execute(store, lease, source, { executors: scripted({}), sleep: now });
  const events = store.events(lease.runId);
  return [result, trail(events.ok ? events.value.slice(journal.length) : [])];
};
const held = (runId: string) => ({
  ok: false,
  finding: { code: "run.lease-held", params: { runId, pid: process.pid } },
});
const trail = (events: readonly JournalEvent[]) =>
  events.map((event) => ("attempt" in event ? `${event.type} ${event.node}#${event.attempt}` : event.type)).join(", ");

test("each start is committed before its attempt goes; a failure retries, outputs keep within the cap, and the run ends", async () => {
  const big = "x".repeat(OUTPUT_CAP + 10);
  const { result, events } = await start(workflow({ nodes: { a: { retries: 1 } } }), {
    a: ["fail"],
    b: [{ stdout: big }],
  });
  expect(result).toEqual({ ok: true, value: "succeeded" });
  expect(trail(events)).toBe("started a#1, ended a#1, started a#2, ended a#2, started b#1, ended b#1, finished");
  const [ended, finished] = events.slice(-2);
  expect(ended).toMatchObject({ outcome: "done", values: { stdout: "x".repeat(OUTPUT_CAP), truncated: ["stdout"] } });
  expect(finished).toEqual({ type: "finished", status: "succeeded", outputs: { out: "x".repeat(OUTPUT_CAP) } });
  // A cut through a character keeps no half of it; a value that is no string is dropped.
  const cut = capped({ text: "é".repeat(OUTPUT_CAP), list: ["x".repeat(OUTPUT_CAP)], small: 1 });
  expect(cut).toMatchObject({ list: null, small: 1, truncated: ["text", "list"] });
  expect(Buffer.byteLength(typeof cut["text"] === "string" ? cut["text"] : "")).toBe(OUTPUT_CAP);
});

test("a cancel stops the running attempt, and one waiting out its backoff ends cancelled without going", async () => {
  const stop = new AbortController();
  const cancelAt = (type: string) => (event: JournalEvent) => {
    if (event.type === type) stop.abort();
  };
  const running = await start(workflow(), { a: ["hang"] }, { signal: stop.signal, onEvent: cancelAt("started") });
  expect(running.result).toEqual({ ok: true, value: "cancelled" });
  expect(trail(running.events)).toBe("started a#1, cancel, ended a#1, finished");
  // Cancelled in a's backoff, which the timer or an immediate wait ends: attempt 2 ends cancelled without going.
  for (const sleep of [undefined, now]) {
    const again = new AbortController();
    const onEvent = (event: JournalEvent) => event.type === "ended" && again.abort();
    const backoff = await start(
      workflow({ nodes: { a: { retries: 1 } } }),
      { a: ["fail"] },
      { signal: again.signal, sleep, onEvent },
    );
    expect(trail(backoff.events)).toBe("started a#1, ended a#1, cancel, started a#2, ended a#2, finished");
    expect(backoff.events[4]).toMatchObject({ outcome: "cancelled" });
  }
});

test("an attempt past its timeout is stopped and counts as timed out; a type without an executor fails", async () => {
  const late = await start(workflow({ nodes: { a: { timeoutSeconds: 1 } } }), { a: ["hang"] });
  expect([late.result, late.events[1]]).toEqual([
    { ok: true, value: "failed" },
    { type: "ended", node: "a", attempt: 1, outcome: "timed-out", values: {} },
  ]);
  expect((await start(workflow(), {}, { executors: {} })).result).toEqual({ ok: true, value: "failed" });
  // Inputs the workflow does not declare start nothing.
  const store = graphs();
  const source = { workflow: workflow(), inputs: { nope: 1 }, journal: [] };
  expect(await execute(store, created(store, workflow()), source, { executors: {} })).toMatchObject({
    ok: false,
    finding: { code: "run.input-unknown" },
  });
});

test("a precheck that fails skips the run; one that passes starts it; a cancel while it runs ends the run", async () => {
  expect(trail((await start(workflow({}, "check"), { t: ["fail"] })).events)).toBe("precheck, finished");
  expect((await start(workflow({}, "check"), { t: [{}] })).result).toEqual({ ok: true, value: "succeeded" });
  const stop = new AbortController();
  setImmediate(() => stop.abort());
  const cancelled = await start(workflow({}, "check"), { t: ["hang"] }, { signal: stop.signal });
  expect([cancelled.result, trail(cancelled.events)]).toEqual([{ ok: true, value: "cancelled" }, "cancel, finished"]);
});

test("once another runner has taken the run over, the run stops writing and ends with the refusal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-execute-"));
  const [store, other] = [graphs(dir), graphs(dir)];
  const definition = workflow({ nodes: { a: { retries: 1 } } });
  const lease = created(store, definition);
  // During a's backoff, this runner lets go of its lease and another takes the run over.
  const sleep = async () => {
    lease.release();
    expect(other.takeOver(lease.runId)).toMatchObject({ ok: true });
  };
  const source = { workflow: definition, inputs: {}, journal: [] };
  const result = await execute(store, lease, source, { executors: scripted({ a: ["fail"] }), sleep });
  expect(result).toEqual(held(lease.runId));
  // A runner whose epoch is gone writes not even the ends of the attempts it found started.
  const journal: JournalEvent[] = [{ type: "started", node: "a", attempt: 2, pid: null }];
  expect(await execute(store, lease, { ...source, journal }, { executors: {} })).toEqual(held(lease.runId));
  // Taken over while a runs: a's end is refused.
  const next = created(store, definition);
  const takeOver = () => {
    next.release();
    other.takeOver(next.runId);
  };
  const executors = scripted({ a: [takeOver] });
  expect(await execute(store, next, source, { executors })).toEqual(held(next.runId));
});

test("a run taken over goes on from its journal: started attempts end interrupted, and what was left is done", async () => {
  const started = { type: "started", node: "a", attempt: 1, pid: null } as const;
  const failed = { type: "ended", node: "a", attempt: 1, outcome: "failed" } as const;
  const retried = workflow({ nodes: { a: { retries: 1 } } });
  const succeeded = { ok: true, value: "succeeded" };
  const after = "ended a#1, started a#2, ended a#2, started b#1, ended b#1, finished";
  expect(await resume(retried, [started])).toEqual([succeeded, after]);
  // Cancelled in a's backoff: the planned attempt ends cancelled without going.
  const cancelled = [{ ok: true, value: "cancelled" }, "started a#2, ended a#2, finished"];
  expect(await resume(retried, [started, failed, { type: "cancel" }])).toEqual(cancelled);
  // Every node ended before the crash: only the run's end is left.
  const b = [
    { type: "started", node: "b", attempt: 1, pid: null },
    { type: "ended", node: "b", attempt: 1, outcome: "done" },
  ] as const;
  expect(await resume(workflow(), [started, { ...failed, outcome: "done" }, ...b])).toEqual([succeeded, "finished"]);
});
