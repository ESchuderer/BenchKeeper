import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AccountSwitch,
  canonicalJson,
  type Finding,
  PLAN_SCHEMA_VERSION,
  Plan,
  Reading,
  type Result,
  Run,
  readDocument,
  Step,
} from "@cedarloom/contracts";
import { filesystemType, isNetworkFilesystem } from "./filesystem.ts";
import { planHash, sha256 } from "./hash.ts";
import { ACCOUNT_TABLES, TABLES } from "./rows.ts";

const SCHEMA = 2;
// The schema changes in order: the one at index i takes a store from schema i to i + 1.
const MIGRATIONS = [TABLES, ACCOUNT_TABLES];
const RUN_COLUMNS = "id, kind, undoes, planHash, status, epoch, startedAt, finishedAt";
const STEP_COLUMNS = `"index", path, before, after, state, mode`;

export interface RunDetail {
  run: Run;
  plan: Plan;
  steps: Step[];
}

const transaction = <T>(db: DatabaseSync, work: () => T): T => {
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

const now = (): string => new Date().toISOString();
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

  /** Where the backup of a step's file goes: inside this store's folder only, never a path from the journal. */
  backupPath(runId: string, index: number): string {
    return join(backupsOf(this.dir, runId), String(index));
  }

  /**
   * Runs `read` with whether a process holds the store. When none does, the probe keeps a shared lock until `read`
   * returns: a process opening the store for writing waits it out (see openRunStore), so a run cannot start between
   * the probe and the read and look interrupted.
   */
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
  /** Runs a process that died left running, marked `interrupted` when this store opened. */
  readonly interrupted: string[];

  constructor(dir: string, db: DatabaseSync, lock: DatabaseSync) {
    super(dir, db);
    this.#lock = lock;
    [this.epoch, this.interrupted] = transaction(db, () => {
      const epoch = Number(
        db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'epoch' RETURNING value").get()?.["value"],
      );
      const ids = db.prepare("UPDATE runs SET status = 'interrupted' WHERE status = 'running' RETURNING id").all();
      return [epoch, ids.map((row) => String(row["id"]))] as const;
    });
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
        step.run(id, index, op.path, op.before, op.kind === "write" ? sha256(op.content) : null);
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

  finish(runId: string, status: "applied" | "failed"): void {
    this.db.prepare("UPDATE runs SET status = ?, finishedAt = ? WHERE id = ?").run(status, now(), runId);
  }

  /**
   * Deletes the backups of runs started more than `days` days ago and blanks the file contents in their stored plans,
   * so a rotated secret stays in neither; paths and hashes remain, and undo of such a run reports the missing backup.
   * Each run is pruned once, all in one transaction.
   */
  prune(days: number): string[] {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return transaction(this.db, () => {
      const rows = this.db.prepare("SELECT id, plan FROM runs WHERE startedAt < ? AND pruned = 0").all(cutoff);
      const blank = this.db.prepare("UPDATE runs SET plan = ?, pruned = 1 WHERE id = ?");
      for (const row of rows) {
        const id = String(row["id"]);
        rmSync(backupsOf(this.dir, id), { recursive: true, force: true });
        const plan: unknown = JSON.parse(String(row["plan"]), (key, value: unknown) =>
          key === "content" ? "" : value,
        );
        blank.run(JSON.stringify(plan), id);
      }
      return rows.map((row) => String(row["id"]));
    });
  }

  /** Keeps the latest reading per account and window: a reading older than the stored one is dropped. */
  recordReading(reading: Reading): void {
    this.db
      .prepare(
        `INSERT INTO readings VALUES (?, ?, ?, ?, ?) ON CONFLICT (account, "window") DO UPDATE SET
         usedPercent = excluded.usedPercent, resetsAt = excluded.resetsAt, readAt = excluded.readAt
         WHERE excluded.readAt >= readings.readAt`,
      )
      .run(reading.account, reading.window, reading.usedPercent, reading.resetsAt, reading.readAt);
  }

  readings(): Reading[] {
    return this.db
      .prepare(`SELECT account, "window", usedPercent, resetsAt, readAt FROM readings ORDER BY account, "window"`)
      .all()
      .map((row) => Reading.parse(row));
  }

  /** Records a launch-time account choice, dated now. */
  recordSwitch(choice: Omit<AccountSwitch, "at">): void {
    this.db
      .prepare("INSERT INTO switches VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        now(),
        choice.task,
        choice.from,
        choice.to,
        choice.reason,
        JSON.stringify(choice.readings),
        JSON.stringify(choice.candidates),
      );
  }

  /** The account choices in the order they were made. */
  switches(): AccountSwitch[] {
    return this.db
      .prepare(
        `SELECT json_object('at', at, 'task', task, 'from', fromAccount, 'to', toAccount, 'reason', reason,
         'readings', json(readings), 'candidates', json(candidates)) AS row FROM switches ORDER BY rowid`,
      )
      .all()
      .map((row) => AccountSwitch.parse(JSON.parse(String(row["row"]))));
  }

  override close(): void {
    super.close();
    this.#lock.close();
  }
}

/**
 * How long a connection to runs.sqlite waits when another one briefly locks it out: a writer's last close cleans up
 * the WAL, and the next open recovers it. Without the wait, reads and opens alongside another process's runs fail
 * with "database is locked". As long as the store lock's own wait: 250 ms was too short on a loaded CI runner, where
 * runs in a tight loop kept a reader out longer. The lock file's probe does not wait (see #probe).
 */
const SETTLE_MS = 1000;

const versionOf = (db: DatabaseSync): number => Number(db.prepare("PRAGMA user_version").get()?.["user_version"]);

const refuse = (db: DatabaseSync, lock: DatabaseSync, found: number): Result<RunStore> => {
  db.close();
  lock.close();
  return { ok: false, finding: { code: "store.newer-schema", params: { found, known: SCHEMA } } };
};

/** Opens the run store in `dir` (created private): refused on a network filesystem, while another process holds it, or when a newer CedarLoom wrote it. */
export const openRunStore = (dir: string, detect = filesystemType): Result<RunStore> => {
  // A folder this call creates is private; one that existed keeps its mode (a store inside it is still private).
  mkdirSync(join(dir, "backups"), { recursive: true, mode: 0o700 });
  const fsType = detect(realpathSync.native(dir));
  if (fsType !== undefined && isNetworkFilesystem(fsType)) {
    return { ok: false, finding: { code: "store.network-filesystem", params: { dir, fsType } } };
  }
  // The OS releases this lock when the process exits, also on a crash: no stale lock file to take over. The wait
  // outlasts a reader's probe, whose read meets no WAL cleanup (writers close runs.sqlite first); others are refused.
  const lock = new DatabaseSync(join(dir, "lock.sqlite"));
  try {
    lock.exec("PRAGMA busy_timeout = 1000; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    return { ok: false, finding: { code: "store.busy", params: { dir } } };
  }
  // Every failure below releases the lock, else each later open in this process would answer "busy".
  try {
    const db = new DatabaseSync(join(dir, "runs.sqlite"), { timeout: SETTLE_MS });
    try {
      chmodSync(join(dir, "runs.sqlite"), 0o600);
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON");
      const version = versionOf(db);
      if (version > SCHEMA) return refuse(db, lock, version);
      // One transaction: a crash halfway through leaves no partial schema that blocks the next open.
      if (version < SCHEMA) {
        transaction(db, () => db.exec(`${MIGRATIONS.slice(version).join("")}; PRAGMA user_version = ${SCHEMA}`));
      }
      return { ok: true, value: new RunStore(dir, db, lock) };
    } catch (error) {
      db.close();
      throw error;
    }
  } catch (error) {
    lock.close();
    throw error;
  }
};

/** Opens a store for reading; null when no run was ever recorded in `dir`. */
export const openRunView = (dir: string): Result<RunView | null> => {
  if (!existsSync(join(dir, "runs.sqlite"))) return { ok: true, value: null };
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { readOnly: true, timeout: SETTLE_MS });
  const found = versionOf(db);
  if (found > 0 && found <= SCHEMA) return { ok: true, value: new RunView(dir, db) };
  db.close();
  // Version 0: a first open created the file but not (yet) its schema, so no run was ever recorded.
  if (found === 0) return { ok: true, value: null };
  return { ok: false, finding: { code: "store.newer-schema", params: { found, known: SCHEMA } } };
};
