import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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
import { afterEach, expect, test, vi } from "vitest";
import { failCommits } from "./fail-commits.ts";

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

// A plan that writes `content` to one file that does not exist yet.
const writing = (content: string): Plan => ({
  schemaVersion: 1,
  operations: [{ kind: "write", path: "/work/a.md", before: null, content }],
});

test("a plan's hash covers what its writes write: two plans that differ only in content have different hashes", () => {
  // SHA-256 of the canonical JSON, keys sorted: {"operations":[{"before":null,"content":"hi\n",...}],"schemaVersion":1}.
  expect([planHash(writing("hi\n")), planHash(writing("ho\n"))]).toEqual([
    "0b6a7f4317071348c5957b94ca5d2a508554b168cf94bc541d36c97c14fe830e",
    "fac188cb945c2e144cd9a788193aa98b60767bb527dd1a1d0ef1f16056620e09",
  ]);
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
  // Its plan keeps no file content.
  expect(store.run(store.interrupted[0] ?? "")?.plan.operations).toEqual([
    { kind: "write", path: "/x", before: null, content: "" },
  ]);
});

test("a finished run's file content is in no file of the store once it closes, while another connection stays", () => {
  const dir = fresh();
  const store = opened(dir);
  // A connection that keeps the log from leaving with the store, as another process's does.
  const other = new DatabaseSync(join(dir, "runs.sqlite"));
  other.prepare("SELECT count(*) FROM runs").get();
  // About 3 KB, a size that stayed on a freed page without secure_delete.
  const marker = "secret-0b9f4c1e8d2a4c6b";
  const written: Plan = {
    schemaVersion: 1,
    operations: [{ kind: "write", path: "/a", before: null, content: `${marker}${"-".repeat(3000)}` }],
  };
  const id = store.begin("apply", written, planHash(written));
  store.finish(id.ok ? id.value : "", "applied");
  store.close();
  open.length = 0;
  const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((name) =>
    statSync(join(dir, name)).isFile(),
  );
  expect(files).toContain("runs.sqlite-wal");
  expect(files.filter((name) => readFileSync(join(dir, name)).includes(marker))).toEqual([]);
  other.close();
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

/** A store at schema `version`: 99, which only a newer CedarLoom knows, or 10, the last one before 0.1.0. */
const storeAt = (version: number): string => {
  const dir = fresh();
  opened(dir).close();
  open.length = 0;
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec(`PRAGMA user_version = ${version}`);
  db.close();
  return dir;
};
const NEWER = { ok: false, finding: { code: "store.newer-schema", params: { found: 99, known: expect.any(Number) } } };

test("a store written by a newer CedarLoom is refused, and one from before 0.1.0 too", () => {
  expect(openRunStore(storeAt(99))).toEqual(NEWER);
  // 18 is the last schema before 0.1.0, which had no outbox.
  const dir = storeAt(18);
  const older = {
    ok: false,
    finding: { code: "store.older-schema", params: { dir, found: 18, known: expect.any(Number) } },
  };
  expect([openRunStore(dir), openRunView(dir)]).toEqual([older, older]);
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
  // A hostile line parses: a super-linear regex would outlast the time limit (CodeQL js/polynomial-redos, earlier regex).
  expect(parseMounts(`${"a on ".repeat(50_000)}x`)).toHaveLength(1);
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
  expect(openRunView(storeAt(99))).toEqual(NEWER);
});

test("the schema is created in one transaction: a failure halfway leaves no partial schema to block the next open", () => {
  const dir = fresh();
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  db.exec("CREATE TABLE steps (x)");
  db.close();
  expect(() => openRunStore(dir)).toThrow(/steps already exists/);
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

test("a commit SQLite already rolled back (disk full, I/O error) reports that error, and nothing is recorded", () => {
  const store = opened(fresh());
  const failure = new Error("database or disk is full");
  failCommits(failure);
  expect(() => store.begin("apply", plan, planHash(plan))).toThrow(failure);
  expect(store.runs()).toEqual([]);
});
