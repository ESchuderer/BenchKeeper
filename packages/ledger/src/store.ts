import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalJson,
  type Finding,
  PLAN_SCHEMA_VERSION,
  Plan,
  type Result,
  Run,
  readDocument,
  Step,
} from "@cedarloom/contracts";
import { filesystemType, isNetworkFilesystem } from "./filesystem.ts";
import { planHash, sha256 } from "./hash.ts";
import { OUTBOX_TABLES, TABLES } from "./rows.ts";

// The 0.1.0 schema, created at once in an empty store. Nothing from before 0.1.0 is carried over.
const BASELINE = [TABLES, OUTBOX_TABLES];
// Its number follows every schema before 0.1.0 (1 to 18), so a store from before it is never read as this one.
const SCHEMA = 19;

// A JSON column's value; null for SQL NULL.
export const column = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : null);

// A stored plan with every file content blanked; kinds, paths and hashes remain. The store's SQL calls it as blanked().
const blanked = (plan: unknown): string =>
  JSON.stringify(JSON.parse(String(plan), (key, value: unknown) => (key === "content" ? "" : value)));

// Runs `work` with secure_delete on, which zeroes freed pages, here only: docs/agents/cedarloom-rationale.md#sqlite
const zeroed = <T>(db: DatabaseSync, work: () => T): T => {
  db.exec("PRAGMA secure_delete = ON");
  try {
    return work();
  } finally {
    db.exec("PRAGMA secure_delete = OFF");
  }
};

// Empties the log as the store closes, pre-blanking pages too: docs/agents/cedarloom-rationale.md#sqlite
const emptyLog = (db: DatabaseSync): void => {
  db.exec("PRAGMA busy_timeout = 0");
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.exec(`PRAGMA busy_timeout = ${SETTLE_MS}`);
  }
};

/** A hold on a lease: its process keeps it while it works, and the OS releases it on any exit. */
export interface LeaseLock {
  release(this: void): void;
}

const leaseLockPath = (dir: string, name: string): string => join(dir, "leases", `${name}.lock`);

// The locks of this process's leases, kept referenced until release: a collected lock closes and lets the lease go.
const heldLocks = new Set<DatabaseSync>();

// Takes a run's lock without waiting: an exclusive SQLite lock the OS frees when the process ends; null if held.
const takeLock = (path: string): DatabaseSync | null => {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
    return db;
  } catch {
    db.close();
    return null;
  }
};

// The lock file goes with its lock; on Windows a checker may have it open for a moment, and then removes it itself.
const removeLock = (path: string): void => {
  try {
    rmSync(path, { force: true });
  } catch {
    // Left for the next check of the lease.
  }
};

// Holds the lock at `path` until its release, referenced in heldLocks so the garbage collector cannot let go of it.
const hold = (path: string): LeaseLock | null => {
  const lock = takeLock(path);
  if (lock === null) return null;
  heldLocks.add(lock);
  return {
    release: () => {
      heldLocks.delete(lock);
      lock.close();
      removeLock(path);
    },
  };
};

// Whether a process holds the lease's lock; a lock nobody holds is removed.
const lockHeld = (path: string): boolean => {
  const probe = takeLock(path);
  if (probe === null) return true;
  probe.close();
  removeLock(path);
  return false;
};

// Takes the lease lock `name` until release, once per name: a release removes the file a second taker would hold.
export const newLease = (dir: string, name: string): LeaseLock => {
  mkdirSync(join(dir, "leases"), { recursive: true, mode: 0o700 });
  const held = hold(leaseLockPath(dir, name));
  if (held === null) throw new Error(`the lease ${name} is held already`);
  return held;
};

/** Whether a process holds the lease lock `name` in the store `dir`. */
export const leaseHeld = (dir: string, name: string): boolean => lockHeld(leaseLockPath(dir, name));

const RUN_COLUMNS = "id, kind, undoes, planHash, status, epoch, startedAt, finishedAt";
const STEP_COLUMNS = `"index", path, before, after, state, mode`;

export interface RunDetail {
  run: Run;
  plan: Plan;
  steps: Step[];
}

export const transaction = <T>(db: DatabaseSync, work: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    // SQLite rolls back by itself on errors such as a full disk; a second ROLLBACK would hide the cause.
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
};

export const now = (): string => new Date().toISOString();
const RUN_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/** A run's backup folder: inside the store's folder only, also for an id read back from an edited journal. */
const backupsOf = (dir: string, runId: string): string => {
  if (!RUN_ID.test(runId)) throw new TypeError(`not a run id: ${JSON.stringify(runId)}`);
  return join(dir, "backups", runId);
};

/** Read access to a run store: takes no lock and writes no run, so it works while an apply holds the store. */
export class RunView {
  protected readonly db: DatabaseSync;
  readonly dir: string;

  constructor(dir: string, db: DatabaseSync) {
    this.dir = dir;
    this.db = db;
  }

  runs(): Run[] {
    return this.db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs ORDER BY startedAt DESC, rowid DESC`)
      .all()
      .map((row) => Run.parse(row));
  }

  run(id: string): RunDetail | undefined {
    const row = this.db.prepare(`SELECT ${RUN_COLUMNS}, plan FROM runs WHERE id = ?`).get(id);
    if (row === undefined) return undefined;
    const plan = readDocument(Plan, PLAN_SCHEMA_VERSION, JSON.parse(String(row["plan"])));
    if (!plan.ok) throw new Error(`run ${id}: stored plan unreadable (${plan.finding.code})`);
    const steps = this.db.prepare(`SELECT ${STEP_COLUMNS} FROM steps WHERE runId = ? ORDER BY "index"`).all(id);
    return {
      run: Run.parse(row),
      plan: plan.value,
      steps: steps.map((step) => Step.parse(step)),
    };
  }

  /** Each file under `folder` that a run wrote or deleted, with the hash its last done step left (null: deleted). */
  written(folder: string): Map<string, string | null> {
    const rows = this.db
      .prepare(
        `SELECT s.path, s.after FROM steps s JOIN runs r ON r.id = s.runId
         WHERE s.state = 'done' AND substr(s.path, 1, length(?1)) = ?1 ORDER BY r.startedAt, r.rowid, s."index"`,
      )
      .all(folder);
    return new Map(rows.map((row) => [String(row["path"]), row["after"] === null ? null : String(row["after"])]));
  }

  /** Where the backup of a step's file goes: inside this store's folder only, never a path from the journal. */
  backupPath(runId: string, index: number): string {
    return join(backupsOf(this.dir, runId), String(index));
  }

  // Runs `read` with whether a process holds the store; a shared lock meanwhile keeps a run from starting in between.
  #probe<T>(read: (held: boolean) => T): T {
    const path = join(this.dir, "lock.sqlite");
    if (!existsSync(path)) return read(false);
    const lock = new DatabaseSync(path, { readOnly: true });
    try {
      let held = false;
      try {
        lock.exec("PRAGMA busy_timeout = 0; BEGIN; SELECT count(*) FROM sqlite_master");
      } catch {
        held = true;
      }
      return read(held);
    } finally {
      lock.close();
    }
  }

  /** Whether a process holds the store now; when none does, a run still marked running was interrupted. */
  held(): boolean {
    return this.#probe((held) => held);
  }

  /** The runs, newest first, as they stand: one still marked running while no process holds the store is interrupted. */
  current(): Run[] {
    return this.#probe((held) =>
      this.runs().map((run) => (run.status === "running" && !held ? { ...run, status: "interrupted" } : run)),
    );
  }

  /**
   * Interrupted and failed runs left to deal with: not undone by an applied undo run, and for an undo run, its
   * target not undone by another one.
   */
  problems(): Finding[] {
    const runs = this.current();
    const undone = new Set(
      runs.filter((run) => run.kind === "undo" && run.status === "applied").map((run) => run.undoes),
    );
    return runs
      .filter((run) => !undone.has(run.id) && !(run.undoes !== null && undone.has(run.undoes)))
      .flatMap((run): Finding[] => {
        const params = { runId: run.id, undoes: run.undoes };
        if (run.status === "interrupted") return [{ code: "run.interrupted", params }];
        return run.status === "failed" ? [{ code: "run.failed", params }] : [];
      });
  }

  close(): void {
    this.db.close();
  }
}

/** The run store of one state folder. One process holds it at a time; closing it or exiting releases it. */
export class RunStore extends RunView {
  readonly #lock: DatabaseSync;
  /** Raised each time a process opens the store; every run records the epoch it ran under. */
  readonly epoch: number;
  /** Runs a process that died left running, marked `interrupted` when this store opened; their contents are blanked. */
  readonly interrupted: string[];

  constructor(dir: string, db: DatabaseSync, lock: DatabaseSync) {
    super(dir, db);
    this.#lock = lock;
    db.function("blanked", { deterministic: true, directOnly: true }, blanked);
    [this.epoch, this.interrupted] = zeroed(db, () =>
      transaction(db, () => {
        const epoch = Number(
          db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'epoch' RETURNING value").get()?.["value"],
        );
        const ids = db
          .prepare("UPDATE runs SET status = 'interrupted', plan = blanked(plan) WHERE status = 'running' RETURNING id")
          .all();
        return [epoch, ids.map((row) => String(row["id"]))] as const;
      }),
    );
  }

  /** Records the plan, its approval and its pending steps in one transaction; refuses an approval of another plan. */
  begin(kind: Run["kind"], plan: Plan, approvedHash: string, undoes: string | null = null): Result<string> {
    const hash = planHash(plan);
    if (hash !== approvedHash) {
      return { ok: false, finding: { code: "plan.not-approved", params: { planHash: hash, approvedHash } } };
    }
    const id = randomUUID();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO runs (id, kind, undoes, plan, planHash, approvedHash, status, epoch, startedAt)
           VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
        )
        .run(id, kind, undoes, canonicalJson(plan), hash, approvedHash, this.epoch, now());
      const step = this.db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, 'pending', NULL)");
      plan.operations.forEach((op, index) => {
        // A store update journals its branch and commits where a file step has its path and hashes.
        if (op.kind === "store.update") step.run(id, index, op.ref, op.before, op.after);
        else step.run(id, index, op.path, op.before, op.kind === "write" ? sha256(op.content) : null);
      });
    });
    return { ok: true, value: id };
  }

  /** Journals a step as started, with the mode of the file it replaces; its backup is `backupPath(runId, index)`. */
  start(runId: string, index: number, mode: number | null): void {
    this.db
      .prepare(`UPDATE steps SET state = 'running', mode = ? WHERE runId = ? AND "index" = ?`)
      .run(mode, runId, index);
  }

  settle(runId: string, index: number, state: "done" | "skipped"): void {
    this.db.prepare(`UPDATE steps SET state = ? WHERE runId = ? AND "index" = ?`).run(state, runId, index);
  }

  /**
   * Ends a run and blanks the file contents in its stored plan, so a secret a plan writes stays only in its target file
   * and the run's backup; undo and recovery need only the backups and hashes.
   */
  finish(runId: string, status: "applied" | "failed"): void {
    zeroed(this.db, () =>
      this.db
        .prepare("UPDATE runs SET status = ?, finishedAt = ?, plan = blanked(plan) WHERE id = ?")
        .run(status, now(), runId),
    );
  }

  /**
   * Deletes the backups of runs started more than `days` days ago and blanks the file contents in their stored plans,
   * so a rotated secret stays in neither; paths and hashes remain, and undo of such a run reports the missing backup.
   * Each run is pruned once, all in one transaction.
   */
  prune(days: number): string[] {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return transaction(this.db, () => {
      const rows = this.db.prepare("SELECT id FROM runs WHERE startedAt < ? AND pruned = 0").all(cutoff);
      const blank = this.db.prepare("UPDATE runs SET plan = blanked(plan), pruned = 1 WHERE id = ?");
      for (const row of rows) {
        const id = String(row["id"]);
        rmSync(backupsOf(this.dir, id), { recursive: true, force: true });
        blank.run(id);
      }
      return rows.map((row) => String(row["id"]));
    });
  }

  override close(): void {
    try {
      emptyLog(this.db);
    } finally {
      super.close();
      this.#lock.close();
    }
  }
}

// How long a connection waits while another briefly locks runs.sqlite: docs/agents/cedarloom-rationale.md#sqlite
const SETTLE_MS = 1000;

const versionOf = (db: DatabaseSync): number => Number(db.prepare("PRAGMA user_version").get()?.["user_version"]);

/** Creates the state folder private, or refuses it on a network filesystem, where SQLite's locks do not hold. */
export const stateDir = (dir: string, detect: typeof filesystemType): Finding | null => {
  // A folder this call creates is private; one that existed keeps its mode (a store inside it is still private).
  mkdirSync(join(dir, "backups"), { recursive: true, mode: 0o700 });
  const fsType = detect(realpathSync.native(dir));
  return fsType !== undefined && isNetworkFilesystem(fsType)
    ? { code: "store.network-filesystem", params: { dir, fsType } }
    : null;
};

// A store at another schema: one from before 0.1.0 is not carried over, one from a newer CedarLoom is not read.
const otherSchema = (dir: string, found: number): Finding =>
  found < SCHEMA
    ? { code: "store.older-schema", params: { dir, found, known: SCHEMA } }
    : { code: "store.newer-schema", params: { found, known: SCHEMA } };

// Opens runs.sqlite at this schema for `use`; an empty store gets it in one transaction, another schema is refused.
export const connect = <T>(dir: string, use: (db: DatabaseSync) => T): Result<T> => {
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { timeout: SETTLE_MS });
  try {
    chmodSync(join(dir, "runs.sqlite"), 0o600);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON");
    // Read again in the transaction: the outbox opens without the store lock, so another process may create it first.
    const created = (): number => {
      if (versionOf(db) === 0) db.exec(`${BASELINE.join("")} PRAGMA user_version = ${SCHEMA}`);
      return versionOf(db);
    };
    const version = versionOf(db);
    const found = version === 0 ? transaction(db, created) : version;
    if (found === SCHEMA) return { ok: true, value: use(db) };
    db.close();
    return { ok: false, finding: otherSchema(dir, found) };
  } catch (error) {
    db.close();
    throw error;
  }
};

/** Opens the run store in `dir` (created private): refused on a network filesystem, while another process holds it, or at another schema. */
export const openRunStore = (dir: string, detect = filesystemType): Result<RunStore> => {
  const refused = stateDir(dir, detect);
  if (refused !== null) return { ok: false, finding: refused };
  // Freed by the OS on exit or crash; it outlasts a probe, which meets no WAL cleanup as writers close runs.sqlite first.
  const lock = new DatabaseSync(join(dir, "lock.sqlite"));
  try {
    lock.exec("PRAGMA busy_timeout = 1000; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    return { ok: false, finding: { code: "store.busy", params: { dir } } };
  }
  // Every failure below releases the lock, else each later open in this process would answer "busy".
  try {
    const store = connect(dir, (db) => new RunStore(dir, db, lock));
    if (!store.ok) lock.close();
    return store;
  } catch (error) {
    lock.close();
    throw error;
  }
};

/** Opens a store for reading; null when no run was ever recorded in `dir`. */
export const openRunView = (dir: string): Result<RunView | null> => {
  const opened = openReadOnly(dir);
  if (!opened.ok) return opened;
  return { ok: true, value: opened.value === null ? null : new RunView(dir, opened.value) };
};

/** The store in `dir` opened for reading only; null when no run was ever recorded, refused at another schema. */
const openReadOnly = (dir: string): Result<DatabaseSync | null> => {
  if (!existsSync(join(dir, "runs.sqlite"))) return { ok: true, value: null };
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { readOnly: true, timeout: SETTLE_MS });
  const found = versionOf(db);
  if (found === SCHEMA) return { ok: true, value: db };
  db.close();
  // Version 0: a first open created the file but not (yet) its schema, so no run was ever recorded.
  return found === 0 ? { ok: true, value: null } : { ok: false, finding: otherSchema(dir, found) };
};
