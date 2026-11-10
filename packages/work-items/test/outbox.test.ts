import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Intent, IssueRef } from "@cedarloom/contracts";
import { intentHash, openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
import { compensate, drain, send } from "@cedarloom/work-items";
import { afterEach, expect, test } from "vitest";
import { FakeTracker } from "./tracker.ts";

const issue: IssueRef = { repo: "acme/tracker", number: 7 };
const open: WorkItemStore[] = [];
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});
const fresh = (): WorkItemStore => {
  const store = openWorkItemStore(mkdtempSync(join(tmpdir(), "cedarloom-outbox-")));
  if (!store.ok) throw new Error(store.finding.code);
  open.push(store.value);
  return store.value;
};
// Queues an intent as the owner approved it; its entry's id.
const queue = (store: WorkItemStore, key: string, intent: Intent): string => {
  const entry = store.enqueue(key, intent, { by: "owner", hash: intentHash(intent) });
  if (!entry.ok) throw new Error(entry.finding.code);
  return entry.value.id;
};
const bodies = (tracker: FakeTracker): string[] => [...tracker.issue(issue).comments.values()];
// A sent entry that found the tracker already as asked: its undo has nothing to take back.
const expectNoUndo = (store: WorkItemStore, id: string): void => {
  expect(compensate(store, id, "")).toEqual({
    ok: false,
    finding: { code: "outbox.not-undoable", params: { id, reason: "unchanged" } },
  });
};
// Sends the undo `back` of a sent entry as the owner approved it; that undo has no undo of its own.
const sendUndo = async (store: WorkItemStore, tracker: FakeTracker, id: string, back: Intent): Promise<void> => {
  const undo = compensate(store, id, intentHash(back));
  if (!undo.ok) throw new Error(undo.finding.code);
  await drain(store, tracker);
  expect(compensate(store, undo.value.id, "")).toEqual({
    ok: false,
    finding: { code: "outbox.not-undoable", params: { id: undo.value.id, reason: "no-inverse" } },
  });
};

test.each(["lose-answer", "crash"] as const)(
  "a comment sent again after a %s is posted once: the next send finds it by its marker",
  async (fault) => {
    const [store, tracker] = [fresh(), new FakeTracker([issue])];
    const id = queue(store, "mirror", { kind: "comment", issue, body: "Run ended." });
    tracker.fault = fault;
    // The crash throws out of the send, as a sender that ends leaves nothing behind but the entry.
    await send(store, tracker, id).catch(() => null);
    expect(await drain(store, tracker)).toMatchObject([{ id, status: "sent", remote: { id: 1001 } }]);
    expect(bodies(tracker)).toEqual([`Run ended.\n\n<!-- cedarloom-outbox:${id} -->`]);
  },
);

test("a refused write fails until the owner retries it, while an outage keeps its entry and the ones after it queued", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const [one, two] = ["One.", "Two."].map((body) => queue(store, body, { kind: "comment", issue, body }));
  tracker.fault = "refuse";
  expect(await drain(store, tracker)).toMatchObject([
    { id: one, status: "failed", finding: { code: "tracker.refused", params: { status: 404 } } },
    { id: two, status: "sent" },
  ]);
  const [three, four] = ["Three.", "Four."].map((body) => queue(store, body, { kind: "comment", issue, body }));
  tracker.fault = "outage";
  expect(await drain(store, tracker)).toMatchObject([
    { id: three, status: "pending", finding: { code: "tracker.unavailable" } },
  ]);
  expect(await drain(store, tracker)).toMatchObject([
    { id: three, status: "sent" },
    { id: four, status: "sent" },
  ]);
  expect(bodies(tracker).map((body) => body.split("\n")[0])).toEqual(["Two.", "Three.", "Four."]);
});

test("a retried comment is sent behind the entries queued while it waited, and posted once though its write went through", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const one = queue(store, "one", { kind: "comment", issue, body: "One." });
  tracker.fault = "garble";
  expect(await drain(store, tracker)).toMatchObject([
    { id: one, status: "failed", finding: { code: "tracker.invalid-answer" } },
  ]);
  const two = queue(store, "two", { kind: "comment", issue, body: "Two." });
  expect(store.retry(one)).toMatchObject({ ok: true, value: { id: one, status: "pending", finding: null } });
  expect(await drain(store, tracker)).toMatchObject([
    { id: two, status: "sent" },
    { id: one, status: "sent", remote: { id: 1001 } },
  ]);
  expect(bodies(tracker)).toEqual([
    `One.\n\n<!-- cedarloom-outbox:${one} -->`,
    `Two.\n\n<!-- cedarloom-outbox:${two} -->`,
  ]);
  expect(store.retry(one)).toEqual({
    ok: false,
    finding: { code: "outbox.status", params: { id: one, status: "sent" } },
  });
});

test("a retried label is read again, so its undo leaves the label someone added while it waited", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const id = queue(store, "add", { kind: "label", issue, label: "agent:review" });
  tracker.fault = "refuse";
  await drain(store, tracker);
  tracker.issue(issue).labels.add("agent:review");
  store.retry(id);
  expect(await drain(store, tracker)).toMatchObject([{ id, status: "sent" }]);
  expectNoUndo(store, id);
});

test("an entry a live sender holds is left to it with the ones after it, and due again once that sender ends", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const one = queue(store, "one", { kind: "comment", issue, body: "One." });
  const two = queue(store, "two", { kind: "comment", issue, body: "Two." });
  const claim = store.claim(one);
  if (!claim.ok) throw new Error(claim.finding.code);
  expect(await drain(store, tracker)).toEqual([]);
  expect(await send(store, tracker, one)).toEqual({
    ok: false,
    finding: { code: "outbox.status", params: { id: one, status: "sending" } },
  });
  claim.value.release();
  expect(await drain(store, tracker)).toMatchObject([
    { id: one, status: "sent" },
    { id: two, status: "sent" },
  ]);
});

test("an entry for another repository than the hub fails and writes nothing", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const elsewhere: IssueRef = { repo: "acme/public-app", number: 7 };
  const id = queue(store, "mirror", { kind: "comment", issue: elsewhere, body: "Run ended." });
  const label = queue(store, "label", { kind: "create-label", repo: "acme/public-app", label: "bug", color: "d73a4a" });
  expect(await drain(store, tracker)).toMatchObject([
    { id, status: "failed", finding: { code: "outbox.not-hub", params: { id, repo: "acme/public-app" } } },
    {
      id: label,
      status: "failed",
      finding: { code: "outbox.not-hub", params: { id: label, repo: "acme/public-app" } },
    },
  ]);
  expect(bodies(tracker)).toEqual([]);
  expect([...tracker.hubLabels]).toEqual([]);
});

test("a label's undo removes it only when the send added it, also when the send's answer was lost", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  tracker.issue(issue).labels.add("ready-for-agent");
  const added = queue(store, "add", { kind: "label", issue, label: "agent:review" });
  const kept = queue(store, "keep", { kind: "label", issue, label: "ready-for-agent" });
  tracker.fault = "lose-answer";
  await drain(store, tracker);
  await drain(store, tracker);
  expect(compensate(store, kept, "")).toEqual({
    ok: false,
    finding: { code: "outbox.not-undoable", params: { id: kept, reason: "unchanged" } },
  });
  const back: Intent = { kind: "unlabel", issue, label: "agent:review" };
  expect(compensate(store, added, intentHash(back))).toMatchObject({ ok: true, value: { key: `undo:${added}` } });
  await drain(store, tracker);
  expect([...tracker.issue(issue).labels]).toEqual(["ready-for-agent"]);
});

test("a hub label that exists in any case at send is left as it is, and its undo has nothing to do", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  tracker.hubLabels.set("Bug", "d73a4a");
  const id = queue(store, "bug", { kind: "create-label", repo: "acme/tracker", label: "bug", color: "00ff00" });
  expect(await drain(store, tracker)).toMatchObject([{ id, status: "sent" }]);
  expect([...tracker.hubLabels]).toEqual([["Bug", "d73a4a"]]);
  expect(compensate(store, id, "")).toEqual({
    ok: false,
    finding: { code: "outbox.not-undoable", params: { id, reason: "unchanged" } },
  });
});

test("a hub label's undo deletes the label the send created, and the delete has no undo", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const intent: Intent = { kind: "create-label", repo: "acme/tracker", label: "agent:review", color: "fef2c0" };
  const id = queue(store, "new", intent);
  await drain(store, tracker);
  await sendUndo(store, tracker, id, { kind: "delete-label", repo: "acme/tracker", label: "agent:review" });
  expect([...tracker.hubLabels]).toEqual([]);
});

test("a hub label found by the send's own create, as after a lost answer, is kept by its undo", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const id = queue(store, "new", { kind: "create-label", repo: "acme/tracker", label: "deferred", color: "c5def5" });
  tracker.fault = "lose-answer";
  await drain(store, tracker);
  expect(await drain(store, tracker)).toMatchObject([{ id, status: "sent" }]);
  expectNoUndo(store, id);
  expect([...tracker.hubLabels]).toEqual([["deferred", "c5def5"]]);
});

test("a comment's undo deletes it, and that deletion has no undo", async () => {
  const [store, tracker] = [fresh(), new FakeTracker([issue])];
  const id = queue(store, "mirror", { kind: "comment", issue, body: "Run ended." });
  await drain(store, tracker);
  await sendUndo(store, tracker, id, { kind: "uncomment", issue, comment: 1001 });
  expect(bodies(tracker)).toEqual([]);
});
