import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Intent, IssueRef, RunLabels, WorkflowDefinition } from "@cedarloom/contracts";
import { openGraphStore, openRunStore, openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
import { afterEach, expect, test } from "vitest";

const issue: IssueRef = { repo: "acme/tracker", number: 7 };
const add: Intent = { kind: "label", issue, label: "agent:review" };
const ADD_HASH = "9be3b439bfaf9f2879656ffbddcffb7e2c3c99a9cb75b7c6c48e8f93aba192a7";
const OTHER_HASH = "e644bd1a83a8949e63e7359fec419e9f6c62e582a11505adae713862dfa08f00";

const open: { close(): void }[] = [];
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});
const workItems = (dir: string): WorkItemStore => {
  const store = openWorkItemStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  open.push(store.value);
  return store.value;
};
const fresh = (): string => mkdtempSync(join(tmpdir(), "cedarloom-work-items-"));

test("an intent is queued only under an approval of its own hash, and once per key", () => {
  const store = workItems(fresh());
  expect(store.enqueue("mirror:1", add, { by: "owner", hash: OTHER_HASH })).toEqual({
    ok: false,
    finding: { code: "outbox.not-approved", params: { key: "mirror:1", hash: ADD_HASH, approvedHash: OTHER_HASH } },
  });
  const first = store.enqueue("mirror:1", add, { by: "mirroring", hash: ADD_HASH });
  expect(first).toMatchObject({ ok: true, value: { key: "mirror:1", status: "pending", approvedBy: "mirroring" } });
  expect(store.enqueue("mirror:1", add, { by: "mirroring", hash: ADD_HASH })).toEqual(first);
  const other: Intent = { ...add, label: "ready-for-human" };
  expect(store.enqueue("mirror:1", other, { by: "owner", hash: OTHER_HASH })).toEqual({
    ok: false,
    finding: { code: "outbox.key-taken", params: { key: "mirror:1", id: first.ok ? first.value.id : "" } },
  });
});

test("a run is linked to a hub issue once, and only a run the ledger recorded", () => {
  const dir = fresh();
  const graphs = openGraphStore(dir);
  if (!graphs.ok) throw new Error(graphs.finding.code);
  open.push(graphs.value);
  const run = graphs.value.create({
    definition: {
      schemaVersion: 1,
      kind: "cedarloom.workflow",
      metadata: { id: "lint", name: "Lint", version: "1.0.0" },
      nodes: [{ id: "start", type: "trigger.manual" }],
      edges: [],
    },
    inputs: {},
    trigger: "manual",
    mode: "act",
    parentRun: null,
    parentNode: null,
    project: "/work/lint",
  });
  run.release();
  const store = workItems(dir);
  const unknown = randomUUID();
  expect(store.link(unknown, issue)).toEqual({
    ok: false,
    finding: { code: "run.not-found", params: { runId: unknown } },
  });
  const first = store.link(run.runId, issue);
  expect(store.link(run.runId, issue)).toEqual(first);
  expect(store.links(run.runId)).toEqual([{ runId: run.runId, issue, linkedAt: expect.any(String) }]);
});

// A workflow and a worker's labels for runs that only end.
const definition: WorkflowDefinition = {
  schemaVersion: 1,
  kind: "cedarloom.workflow",
  metadata: { id: "fix", name: "Fix", version: "1.0.0" },
  nodes: [{ id: "start", type: "trigger.manual" }],
  edges: [],
};
const labels: RunLabels = {
  phase: "implement",
  model: "claude-opus-5-5",
  subagentModel: "claude-opus-5-5",
  effort: "high",
  permissionMode: "dontAsk",
  review: false,
  level: "checkpoint",
  tier: null,
};

test("a linked run that has ended is listed with its project: a graph run by its status, a worker by its verdict", () => {
  const dir = fresh();
  const graphs = openGraphStore(dir);
  if (!graphs.ok) throw new Error(graphs.finding.code);
  open.push(graphs.value);
  const base = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
  const run = graphs.value.create({ ...base, definition, project: "/work/app" });
  graphs.value.append(run.runId, 1, { type: "finished", status: "failed", outputs: {} });
  run.release();
  const runs = openRunStore(dir);
  if (!runs.ok) throw new Error(runs.finding.code);
  const worker = {
    task: `${run.runId}:agent#1`,
    agent: "claude",
    account: "work",
    version: "2.1.316",
    labels,
  } as const;
  const [ended, running] = ["0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e61", "0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e62"];
  for (const runId of [ended, running]) {
    runs.value.leaseAccount({ ...worker, runId, pid: 101, startedAt: "2026-11-08T08:00:00.000Z" }, 2);
  }
  runs.value.finishLaunch(ended, "pass");
  runs.value.close();
  const store = workItems(dir);
  for (const runId of [run.runId, ended, running]) store.link(runId, issue);
  const listed = store.endedLinks();
  expect(listed).toHaveLength(2);
  expect(listed).toEqual(
    expect.arrayContaining([
      { runId: run.runId, issue, project: "/work/app", ended: "failed" },
      { runId: ended, issue, project: "/work/app", ended: "pass" },
    ]),
  );
});
