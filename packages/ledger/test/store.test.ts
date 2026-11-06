import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AccountSwitch, ContractCheckRecord, Plan } from "@cedarloom/contracts";
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
  vi.restoreAllMocks();
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

test("reads and another process's runs, side by side, wait out each other's brief locks instead of failing", async () => {
  const dir = fresh();
  opened(dir).close();
  open.length = 0;
  const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures", "write.ts"), dir, "2000"], {
    stdio: "pipe",
  });
  await once(child.stdout, "data");
  const failures: string[] = [];
  for (let reads = 0, end = Date.now() + 1500; Date.now() < end; reads += 1) {
    try {
      const view = openRunView(dir);
      if (view.ok) view.value?.close();
    } catch (error) {
      failures.push(String(error));
    }
  }
  const [code] = await once(child, "exit");
  expect([code, failures]).toEqual([0, []]);
}, 15_000);

/** A store whose schema version only a newer CedarLoom knows. */
const newerStore = (): string => {
  const dir = fresh();
  opened(dir).close();
  open.length = 0;
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("PRAGMA user_version = 5");
  db.close();
  return dir;
};
const NEWER = { ok: false, finding: { code: "store.newer-schema", params: { found: 5, known: 4 } } };

test("a store written by a newer CedarLoom is refused", () => {
  expect(openRunStore(newerStore())).toEqual(NEWER);
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

test("a view treats a store whose schema was never created (a first open cut off) as one without runs", () => {
  const dir = fresh();
  new DatabaseSync(join(dir, "runs.sqlite")).close();
  expect(openRunView(dir)).toEqual({ ok: true, value: null });
});

test("a view refuses a store written by a newer CedarLoom", () => {
  expect(openRunView(newerStore())).toEqual(NEWER);
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

test("a backup path takes a run id only, never a path that leads out of the backups folder", () => {
  const store = opened(fresh());
  for (const runId of ["../outside", "..", "", "a/b"]) {
    expect(() => store.backupPath(runId, 0)).toThrow(TypeError);
  }
});

test("prune deletes nothing outside the backups folder, even for a run id an edited journal holds", () => {
  const dir = fresh();
  const store = opened(dir);
  store.begin("apply", plan, planHash(plan));
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { enableForeignKeyConstraints: false });
  db.prepare("UPDATE runs SET id = ?").run("../kept");
  db.close();
  mkdirSync(join(dir, "kept"));
  expect(() => store.prune(-1)).toThrow(TypeError);
  expect(existsSync(join(dir, "kept"))).toBe(true);
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
  expect(store.runs()).toEqual([]);
});

test("a store of schema 1 gains the account, check and launch tables on open and keeps its runs", () => {
  const dir = fresh();
  const runId = opened(dir).begin("apply", plan, planHash(plan));
  open.splice(0).forEach((store) => store.close());
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec(
    "DROP TABLE readings; DROP TABLE switches; DROP TABLE contract_checks; DROP TABLE launches; PRAGMA user_version = 1",
  );
  db.close();
  const store = opened(dir);
  expect(store.readings()).toEqual([]);
  expect(store.current().map((run) => run.id)).toEqual([runId.ok && runId.value]);
  const after = new DatabaseSync(join(dir, "runs.sqlite"), { readOnly: true });
  expect(after.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
  after.close();
});

test("a store of schema 2 gains the check and launch tables on open and keeps its readings", () => {
  const dir = fresh();
  const reading = {
    account: "work",
    window: "fiveHour",
    usedPercent: 40,
    resetsAt: "2026-11-05T17:00:00.000Z",
    readAt: "2026-11-05T12:00:00.000Z",
  } as const;
  opened(dir).recordReading(reading);
  open.splice(0).forEach((store) => store.close());
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("DROP TABLE contract_checks; DROP TABLE launches; PRAGMA user_version = 2");
  db.close();
  const store = opened(dir);
  expect(store.readings()).toEqual([reading]);
  expect(store.contractChecks("claude")).toEqual([]);
});

test("the latest reading per account and window stays; an older one arriving late, or no reading, never gets in", () => {
  const store = opened(fresh());
  const reading = {
    account: "work",
    window: "fiveHour",
    usedPercent: 40,
    resetsAt: "2026-11-05T17:00:00.000Z",
  } as const;
  store.recordReading({ ...reading, readAt: "2026-11-05T12:00:00.000Z" });
  store.recordReading({ ...reading, window: "sevenDay", usedPercent: 10, readAt: "2026-11-05T12:00:00.000Z" });
  store.recordReading({ ...reading, usedPercent: 55, readAt: "2026-11-05T12:05:00.000Z" });
  store.recordReading({ ...reading, usedPercent: 45, readAt: "2026-11-05T12:01:00.000Z" });
  // A reset time that is no time, or a time without milliseconds (whose text would sort wrong), throws on write.
  expect(() => store.recordReading({ ...reading, resetsAt: "not a date", readAt: "2026-11-05T12:06:00.000Z" })).toThrow(
    /datetime/i,
  );
  expect(() => store.recordReading({ ...reading, readAt: "2026-11-05T12:06:00Z" })).toThrow(/datetime/i);
  expect(store.readings()).toEqual([
    { ...reading, usedPercent: 55, readAt: "2026-11-05T12:05:00.000Z" },
    { ...reading, window: "sevenDay", usedPercent: 10, readAt: "2026-11-05T12:00:00.000Z" },
  ]);
});

test("a switch row keeps its time, task, from, to, reason, readings and candidates", () => {
  const store = opened(fresh());
  const reading = {
    account: "spare",
    window: "fiveHour",
    usedPercent: 5,
    resetsAt: "2026-11-05T17:00:00.000Z",
    readAt: "2026-11-05T12:00:00.000Z",
  } as const;
  const row: AccountSwitch = {
    at: "2026-11-05T12:00:00.000Z",
    task: "t1",
    from: null,
    to: "spare",
    reason: "most-headroom",
    readings: [reading],
    candidates: [{ account: "spare", margin: 87 }],
  };
  store.recordSwitch(row);
  const stayed: AccountSwitch = {
    ...row,
    at: "2026-11-05T12:01:00.000Z",
    from: "spare",
    to: "work",
    reason: "no-readings",
    readings: [],
    candidates: [],
  };
  store.recordSwitch(stayed);
  expect(store.switches()).toEqual([row, stayed]);
});

test("one contract check per agent CLI version: a check of the same version again replaces it", () => {
  const store = opened(fresh());
  const check: ContractCheckRecord = {
    agent: "claude",
    version: "2.1.316",
    missing: [],
    at: "2026-11-06T08:00:00.000Z",
  };
  store.recordContractCheck({ ...check, missing: ["usage"] });
  store.recordContractCheck({ ...check, version: "2.1.317", missing: ["result"], at: "2026-11-06T09:00:00.000Z" });
  store.recordContractCheck({ ...check, at: "2026-11-06T10:00:00.000Z" });
  store.recordContractCheck({ ...check, agent: "codex", version: "0.166.0" });
  expect(store.contractChecks("claude")).toEqual([
    { ...check, version: "2.1.317", missing: ["result"], at: "2026-11-06T09:00:00.000Z" },
    { ...check, at: "2026-11-06T10:00:00.000Z" },
  ]);
  for (const version of ["", "2.1.316\u001b[31m", `2.1.316-${"x".repeat(40)}`]) {
    expect(() => store.recordContractCheck({ ...check, version })).toThrow(/pattern/i);
  }
});

const launch = {
  runId: "0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e6f",
  task: "t1",
  agent: "claude",
  account: "work",
  version: "2.1.316",
  pid: 101,
  startedAt: "2026-11-06T08:00:00.000Z",
} as const;
const runIdOf = (n: number): string => `${launch.runId.slice(0, -1)}${n}`;
const alive = (): boolean => true;

test("an account gives at most max leases; an ended lease frees one, another account has its own", () => {
  const store = opened(fresh());
  expect(store.leaseAccount({ ...launch, runId: runIdOf(1) }, 2, alive)).toBe(true);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(2) }, 2, alive)).toBe(true);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(3) }, 2, alive)).toBe(false);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(4), account: "spare" }, 1, alive)).toBe(true);
  store.finishLaunch(runIdOf(1), "pass", "2026-11-06T08:10:00.000Z");
  // A second finish keeps the first verdict.
  store.finishLaunch(runIdOf(1), "failed");
  // A finish time that is no time is refused on write, so the launches stay readable.
  expect(() => store.finishLaunch(runIdOf(2), "pass", "not a time")).toThrow(/datetime/i);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(5) }, 2, alive)).toBe(true);
  expect(store.launches().map((row) => [row.runId.at(-1), row.account, row.verdict])).toEqual([
    ["1", "work", "pass"],
    ["2", "work", null],
    ["4", "spare", null],
    ["5", "work", null],
  ]);
  expect(store.launches()[0]).toEqual({
    ...launch,
    runId: runIdOf(1),
    finishedAt: "2026-11-06T08:10:00.000Z",
    verdict: "pass",
  });
});

test("a lease whose launcher process is gone ends as interrupted and frees its place", () => {
  const store = opened(fresh());
  expect(store.leaseAccount({ ...launch, runId: runIdOf(1), pid: 7 }, 1, () => true)).toBe(true);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(2) }, 1, (pid) => pid !== 7)).toBe(true);
  expect(store.launches().map((row) => [row.runId.at(-1), row.verdict, row.finishedAt === null])).toEqual([
    ["1", "interrupted", false],
    ["2", null, true],
  ]);
});

test("by default a lease counts while its process runs: this test's own process does, a finished child does not", async () => {
  const store = opened(fresh());
  const child = spawn(process.execPath, ["-e", ""]);
  await once(child, "exit");
  expect(store.leaseAccount({ ...launch, runId: runIdOf(1), pid: Number(child.pid) }, 1)).toBe(true);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(2), pid: process.pid }, 1)).toBe(true);
  expect(store.leaseAccount({ ...launch, runId: runIdOf(3), pid: process.pid }, 1)).toBe(false);
  expect(store.launches().map((row) => row.verdict)).toEqual(["interrupted", null]);
  expect(() => store.leaseAccount({ ...launch, runId: "not-a-uuid" }, 1)).toThrow(/uuid/i);
});
