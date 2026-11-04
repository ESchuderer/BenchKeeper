import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plan } from "@cedarloom/contracts";
import {
  filesystemType,
  isNetworkFilesystem,
  mountType,
  openRunStore,
  openRunView,
  parseMounts,
  planHash,
  type RunStore,
  sha256,
} from "@cedarloom/ledger";
import { afterEach, expect, test } from "vitest";

const plan: Plan = {
  schemaVersion: 1,
  operations: [
    { kind: "write", path: "/a", before: null, content: "a\n" },
    { kind: "delete", path: "/b", before: sha256("b\n") },
  ],
};
const open: RunStore[] = [];
const fresh = (): string => mkdtempSync(join(tmpdir(), "cedarloom-store-"));
const opened = (dir: string): RunStore => {
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  open.push(store.value);
  return store.value;
};
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

test("the store runs in WAL mode with synchronous FULL", () => {
  const dir = fresh();
  opened(dir).close();
  open.length = 0;
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
  db.close();
});

test.skipIf(process.platform === "win32")("the store folder, its backups and the database are private", () => {
  const store = opened(fresh());
  expect(store.backupPath("run", 0)).toBe(join(store.dir, "backups", "run", "0"));
  expect(statSync(store.dir).mode & 0o777).toBe(0o700);
  expect(statSync(join(store.dir, "backups")).mode & 0o777).toBe(0o700);
  expect(statSync(join(store.dir, "runs.sqlite")).mode & 0o777).toBe(0o600);
});

test("one process holds the store at a time; the epoch rises with each open", () => {
  const dir = fresh();
  const first = opened(dir);
  expect(openRunStore(dir)).toEqual({ ok: false, finding: { code: "store.busy", params: { dir } } });
  first.close();
  open.length = 0;
  expect(opened(dir).epoch).toBe(first.epoch + 1);
});

test("a killed process releases the store, and its running run is marked interrupted", async () => {
  const dir = fresh();
  const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures", "hold.ts"), dir], { stdio: "pipe" });
  await once(child.stdout, "data");
  expect(openRunStore(dir)).toMatchObject({ ok: false, finding: { code: "store.busy" } });
  child.kill("SIGKILL");
  await once(child, "exit");
  const store = opened(dir);
  expect(store.interrupted).toHaveLength(1);
  expect(store.runs()).toMatchObject([{ id: store.interrupted[0], status: "interrupted" }]);
});

test("a store written by a newer CedarLoom is refused", () => {
  const dir = fresh();
  opened(dir).close();
  open.length = 0;
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("PRAGMA user_version = 2");
  db.close();
  expect(openRunStore(dir)).toEqual({
    ok: false,
    finding: { code: "store.newer-schema", params: { found: 2, known: 1 } },
  });
});

test("a network filesystem is refused for the run store", () => {
  const dir = fresh();
  expect(openRunStore(dir, () => "nfs4")).toEqual({
    ok: false,
    finding: { code: "store.network-filesystem", params: { dir, fsType: "nfs4" } },
  });
  expect(openRunStore(dir, () => "apfs").ok).toBe(true);
});

test("mount tables of Linux and macOS give the type of the mount that holds a folder", () => {
  const linux = parseMounts("/dev/sda1 / ext4 rw 0 0\nserver:/home /home/me\\040x\\011y nfs4 rw 0 0\n");
  expect(mountType("/home/me x\ty/state", linux)).toBe("nfs4");
  expect(mountType("/home/other", linux)).toBe("ext4");
  const mac = parseMounts("/dev/disk3s1 on / (apfs, local)\n//me@nas/share on /Volumes/share (smbfs, nodev)\n");
  expect(mountType("/Volumes/share/state", mac)).toBe("smbfs");
  expect(mountType("/Volumes/sharez", mac)).toBe("apfs");
  expect(parseMounts("map -hosts on /net (autofs)\n")).toEqual([["/net", "autofs"]]);
  // A hostile line parses in linear time (CodeQL js/polynomial-redos on an earlier regex).
  const started = performance.now();
  expect(parseMounts(`${"a on ".repeat(50_000)}x`)).toHaveLength(1);
  expect(performance.now() - started).toBeLessThan(500);
  expect(isNetworkFilesystem("smbfs")).toBe(true);
  expect(isNetworkFilesystem("apfs")).toBe(false);
  expect(filesystemType("\\\\nas\\share\\state")).toBe("smb");
  expect(filesystemType(tmpdir())).not.toBe("smb");
});

test("a run records its plan, approval and pending steps together; another plan's approval is refused", () => {
  const store = opened(fresh());
  expect(store.begin("apply", plan, sha256("other"))).toEqual({
    ok: false,
    finding: { code: "plan.not-approved", params: { planHash: planHash(plan), approvedHash: sha256("other") } },
  });
  const id = store.begin("apply", plan, planHash(plan));
  if (!id.ok) throw new Error(id.finding.code);
  expect(store.run(id.value)).toMatchObject({
    run: { kind: "apply", status: "running", undoes: null, epoch: store.epoch },
    plan,
    steps: [
      { index: 0, path: "/a", before: null, after: sha256("a\n"), state: "pending" },
      { index: 1, path: "/b", before: sha256("b\n"), after: null, state: "pending" },
    ],
  });
  store.start(id.value, 0, null);
  store.settle(id.value, 0, "done");
  store.start(id.value, 1, 0o644);
  store.settle(id.value, 1, "skipped");
  store.finish(id.value, "failed");
  expect(store.run(id.value)).toMatchObject({
    run: { status: "failed" },
    steps: [
      { state: "done", mode: null },
      { state: "skipped", mode: 0o644 },
    ],
  });
  expect(store.run("missing")).toBeUndefined();
});

test("run ids do not repeat, and prune drops the backups of old runs only", () => {
  const store = opened(fresh());
  const ids = Array.from({ length: 50 }, () => store.begin("apply", plan, planHash(plan)));
  expect(new Set(ids.map((id) => (id.ok ? id.value : ""))).size).toBe(50);
  expect(store.runs()).toHaveLength(50);
  expect(store.prune(90)).toEqual([]);
  expect(store.prune(-1)).toHaveLength(50);
  expect(store.prune(-1)).toEqual([]);
  const first = ids[0]?.ok ? ids[0].value : "";
  expect(store.run(first)?.plan.operations[0]).toEqual({ kind: "write", path: "/a", before: null, content: "" });
});

test("a run that fails to record leaves nothing behind (one transaction)", () => {
  const store = opened(fresh());
  expect(() => store.begin("undo", plan, planHash(plan), "no-such-run")).toThrow(/FOREIGN KEY/);
  expect(store.runs()).toEqual([]);
});

test("a stored plan that no longer parses is an error, not a run without steps", () => {
  const dir = fresh();
  const store = opened(dir);
  const id = store.begin("apply", plan, planHash(plan));
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.prepare("UPDATE runs SET plan = ?").run('{"schemaVersion":1,"operations":[]}');
  db.close();
  expect(() => store.run(id.ok ? id.value : "")).toThrow(/stored plan unreadable \(document.invalid\)/);
});

test("a view reads the runs while another store holds them, changes no run data and tells whether the store is held", () => {
  const dir = fresh();
  expect(openRunView(dir)).toEqual({ ok: true, value: null });
  expect(existsSync(dir) && readdirSync(dir).length > 0).toBe(false);
  const store = opened(dir);
  const id = store.begin("apply", plan, planHash(plan));
  const view = openRunView(dir);
  if (!view.ok || view.value === null) throw new Error("no view");
  expect(view.value.runs()).toMatchObject([{ id: id.ok ? id.value : "", status: "running" }]);
  expect(view.value.held()).toBe(true);
  store.close();
  open.length = 0;
  expect(view.value.held()).toBe(false);
  expect(view.value.run(id.ok ? id.value : "")?.steps).toHaveLength(2);
  rmSync(join(dir, "lock.sqlite"));
  expect([view.value.held(), existsSync(join(dir, "lock.sqlite"))]).toEqual([false, false]);
  view.value.close();
  expect(opened(dir).epoch).toBe(store.epoch + 1);
});

test("a view refuses a store written by a newer CedarLoom", () => {
  const dir = fresh();
  opened(dir).close();
  open.length = 0;
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("PRAGMA user_version = 3");
  db.close();
  expect(openRunView(dir)).toEqual({
    ok: false,
    finding: { code: "store.newer-schema", params: { found: 3, known: 1 } },
  });
});

test("the schema is created in one transaction: a failure halfway leaves no partial schema to block the next open", () => {
  const dir = fresh();
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("CREATE TABLE steps (x)");
  db.close();
  expect(() => openRunStore(dir)).toThrow(/steps already exists/);
  const after = new DatabaseSync(join(dir, "runs.sqlite"));
  expect(after.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: "steps" }]);
  expect(after.prepare("PRAGMA user_version").get()).toEqual({ user_version: 0 });
  after.close();
  // The failed open released its lock: the next one meets the same schema error, not "busy".
  expect(() => openRunStore(dir)).toThrow(/steps already exists/);
});

test.skipIf(process.platform === "win32")(
  "a state folder that existed keeps its mode; the database in it is private",
  () => {
    const dir = fresh();
    chmodSync(dir, 0o755);
    opened(dir);
    expect([statSync(dir).mode & 0o777, statSync(join(dir, "runs.sqlite")).mode & 0o777]).toEqual([0o755, 0o600]);
  },
);

test("a view tells which runs are left to deal with: interrupted or failed, not undone, and undo runs whose target is not undone", () => {
  const dir = fresh();
  const store = opened(dir);
  const begin = (kind: "apply" | "undo", undoes: string | null = null): string => {
    const id = store.begin(kind, plan, planHash(plan), undoes);
    if (!id.ok) throw new Error(id.finding.code);
    return id.value;
  };
  const failed = begin("apply");
  store.finish(failed, "failed");
  const stopped = begin("undo", failed);
  store.close();
  open.length = 0;
  const view = openRunView(dir);
  if (!view.ok || view.value === null) throw new Error("no view");
  expect(view.value.current().map((run) => run.status)).toEqual(["interrupted", "failed"]);
  expect(view.value.problems()).toEqual([
    { code: "run.interrupted", params: { runId: stopped, undoes: failed } },
    { code: "run.failed", params: { runId: failed, undoes: null } },
  ]);
  const again = opened(dir);
  const undone = again.begin("undo", plan, planHash(plan), failed);
  again.finish(undone.ok ? undone.value : "", "applied");
  expect(view.value.problems()).toEqual([]);
  view.value.close();
});
