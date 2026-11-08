import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import type { Intent, IssueRef } from "@cedarloom/contracts";
import { openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
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
  const first = store.enqueue("mirror:1", add, { by: "owner", hash: ADD_HASH });
  expect(first).toMatchObject({ ok: true, value: { key: "mirror:1", status: "pending", approvedBy: "owner" } });
  expect(store.enqueue("mirror:1", add, { by: "owner", hash: ADD_HASH })).toEqual(first);
  const other: Intent = { ...add, label: "ready-for-human" };
  expect(store.enqueue("mirror:1", other, { by: "owner", hash: OTHER_HASH })).toEqual({
    ok: false,
    finding: { code: "outbox.key-taken", params: { key: "mirror:1", id: first.ok ? first.value.id : "" } },
  });
});

// The garbage collector, which node exposes to a new context once the flag is set.
setFlagsFromString("--expose-gc");
const gc: unknown = runInNewContext("gc");
const collect = async (): Promise<void> => {
  for (const _ of [1, 2]) {
    if (typeof gc === "function") Reflect.apply(gc, undefined, []);
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test("a claim holds its lease for the send's life, also when its sender keeps no reference to it", async () => {
  const store = workItems(fresh());
  const queued = store.enqueue("mirror:1", add, { by: "owner", hash: ADD_HASH });
  if (!queued.ok) throw new Error(queued.finding.code);
  // Taken and dropped at once: nothing of the sender's refers to the lease any more.
  expect(store.claim(queued.value.id).ok).toBe(true);
  await collect();
  expect(typeof gc).toBe("function");
  expect(store.claim(queued.value.id)).toEqual({
    ok: false,
    finding: { code: "outbox.status", params: { id: queued.value.id, status: "sending" } },
  });
});

test("a claim counts while another process holds its lease, and the entry is due again once the OS releases it", async () => {
  const dir = fresh();
  const store = workItems(dir);
  const queued = store.enqueue("mirror:1", add, { by: "owner", hash: ADD_HASH });
  if (!queued.ok) throw new Error(queued.finding.code);
  const { id } = queued.value;
  const first = store.claim(id);
  if (!first.ok) throw new Error(first.finding.code);
  first.value.release();
  // Another process holds the first attempt's lease, as a sender that is still sending does.
  const lock = join(dir, "leases", `outbox-${id}.1.lock`);
  const script = `new (require("node:sqlite").DatabaseSync)(process.argv[1]).exec("BEGIN EXCLUSIVE"); console.log("held"); setInterval(() => {}, 1000);`;
  const holder = spawn(process.execPath, ["-e", script, lock], { stdio: ["ignore", "pipe", "inherit"] });
  await once(holder.stdout, "data");
  const held = store.claim(id);
  holder.kill("SIGKILL");
  await once(holder, "exit");
  const again = store.claim(id);
  if (again.ok) again.value.release();
  expect([held, again]).toMatchObject([
    { ok: false, finding: { code: "outbox.status", params: { id, status: "sending" } } },
    { ok: true, value: { entry: { status: "sending", attempts: 2 } } },
  ]);
}, 15_000);
