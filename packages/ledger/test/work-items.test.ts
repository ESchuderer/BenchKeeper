import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Intent, IssueRef } from "@cedarloom/contracts";
import { openGraphStore, openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
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
