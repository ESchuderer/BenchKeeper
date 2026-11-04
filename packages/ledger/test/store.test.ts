import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Plan } from "@cedarloom/contracts";
import {
  filesystemType,
  isNetworkFilesystem,
  mountType,
  openRunStore,
  parseMounts,
  planHash,
  type RunStore,
  sha256,
} from "@cedarloom/ledger";
import { afterEach, expect, test, vi } from "vitest";

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
  const id = store.begin("apply", plan, planHash(plan));
  const runId = id.ok ? id.value : "";
  expect(store.backupPath(runId, 0)).toBe(join(store.dir, "backups", runId, "0"));
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

test("a backup path takes a run id only, never a path that leads out of the backups folder", () => {
  const store = opened(fresh());
  for (const runId of ["../outside", "..", "", "a/b"]) {
    expect(() => store.backupPath(runId, 0)).toThrow(TypeError);
  }
});

test("a failed open releases the lock, also when the store it finds is broken", () => {
  const dir = fresh();
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("PRAGMA user_version = 1");
  db.close();
  expect(() => openRunStore(dir)).toThrow(/no such table/);
  expect(() => openRunStore(dir)).toThrow(/no such table/);
});

test("a commit SQLite already rolled back (disk full, I/O error) reports that error, and nothing is recorded", () => {
  const store = opened(fresh());
  const failure = new Error("database or disk is full");
  // COMMIT fails the way SQLite fails it on a full disk: the transaction is already rolled back.
  vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (this: DatabaseSync, sql) {
    this.prepare(sql === "COMMIT" ? "ROLLBACK" : sql).run();
    if (sql === "COMMIT") throw failure;
  });
  expect(() => store.begin("apply", plan, planHash(plan))).toThrow(failure);
  vi.restoreAllMocks();
  expect(store.runs()).toEqual([]);
});
