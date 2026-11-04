import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, PLAN_SCHEMA_VERSION, Plan, type Result, readDocument } from "@cedarloom/contracts";
import { filesystemType, isNetworkFilesystem } from "./filesystem.ts";
import { planHash, sha256 } from "./hash.ts";
import { Run, Step, TABLES } from "./rows.ts";

const SCHEMA = 1;
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
    db.exec("ROLLBACK");
    throw error;
  }
};

const now = (): string => new Date().toISOString();

/** The run store of one state folder. One process holds it at a time; closing it or exiting releases it. */
export class RunStore {
  readonly #db: DatabaseSync;
  readonly #lock: DatabaseSync;
  readonly dir: string;
  /** Raised each time a process opens the store; every run records the epoch it ran under. */
  readonly epoch: number;
  /** Runs a process that died left running, marked `interrupted` when this store opened. */
  readonly interrupted: string[];

  constructor(dir: string, db: DatabaseSync, lock: DatabaseSync) {
    this.dir = dir;
    this.#db = db;
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
    transaction(this.#db, () => {
      this.#db
        .prepare("INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, NULL)")
        .run(id, kind, undoes, canonicalJson(plan), hash, approvedHash, this.epoch, now());
      const step = this.#db.prepare("INSERT INTO steps VALUES (?, ?, ?, ?, ?, 'pending', NULL)");
      plan.operations.forEach((op, index) => {
        step.run(id, index, op.path, op.before, op.kind === "write" ? sha256(op.content) : null);
      });
    });
    return { ok: true, value: id };
  }

  /** Journals a step as started, with the mode of the file it replaces; its backup is `backupPath(runId, index)`. */
  start(runId: string, index: number, mode: number | null): void {
    this.#db
      .prepare(`UPDATE steps SET state = 'running', mode = ? WHERE runId = ? AND "index" = ?`)
      .run(mode, runId, index);
  }

  settle(runId: string, index: number, state: "done" | "skipped"): void {
    this.#db.prepare(`UPDATE steps SET state = ? WHERE runId = ? AND "index" = ?`).run(state, runId, index);
  }

  finish(runId: string, status: "applied" | "failed"): void {
    this.#db.prepare("UPDATE runs SET status = ?, finishedAt = ? WHERE id = ?").run(status, now(), runId);
  }

  runs(): Run[] {
    return this.#db
      .prepare(`SELECT ${RUN_COLUMNS} FROM runs ORDER BY startedAt DESC, rowid DESC`)
      .all()
      .map((row) => Run.parse(row));
  }

  run(id: string): RunDetail | undefined {
    const row = this.#db.prepare(`SELECT ${RUN_COLUMNS}, plan FROM runs WHERE id = ?`).get(id);
    if (row === undefined) return undefined;
    const plan = readDocument(Plan, PLAN_SCHEMA_VERSION, JSON.parse(String(row["plan"])));
    if (!plan.ok) throw new Error(`run ${id}: stored plan unreadable (${plan.finding.code})`);
    const steps = this.#db.prepare(`SELECT ${STEP_COLUMNS} FROM steps WHERE runId = ? ORDER BY "index"`).all(id);
    return {
      run: Run.parse(row),
      plan: plan.value,
      steps: steps.map((step) => Step.parse(step)),
    };
  }

  /** Where the backup of a step's file goes: inside this store's folder only, never a path from the journal. */
  backupPath(runId: string, index: number): string {
    return join(this.dir, "backups", runId, String(index));
  }

  /**
   * Deletes the backups of runs started more than `days` days ago and blanks the file contents in their stored plans,
   * so a rotated secret stays in neither; paths and hashes remain, and undo of such a run reports the missing backup.
   */
  prune(days: number): string[] {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = this.#db.prepare("SELECT id, plan FROM runs WHERE startedAt < ?").all(cutoff);
    const blank = this.#db.prepare("UPDATE runs SET plan = ? WHERE id = ?");
    for (const row of rows) {
      const id = String(row["id"]);
      rmSync(join(this.dir, "backups", id), { recursive: true, force: true });
      const plan: unknown = JSON.parse(String(row["plan"]), (key, value: unknown) => (key === "content" ? "" : value));
      blank.run(JSON.stringify(plan), id);
    }
    return rows.map((row) => String(row["id"]));
  }

  close(): void {
    this.#db.close();
    this.#lock.close();
  }
}

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
  // The OS releases this lock when the process exits, also on a crash: no stale lock file to take over.
  const lock = new DatabaseSync(join(dir, "lock.sqlite"));
  try {
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    return { ok: false, finding: { code: "store.busy", params: { dir } } };
  }
  const db = new DatabaseSync(join(dir, "runs.sqlite"));
  try {
    chmodSync(join(dir, "runs.sqlite"), 0o600);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON");
    const version = versionOf(db);
    if (version > SCHEMA) return refuse(db, lock, version);
    // One transaction: a crash halfway through leaves no partial schema that blocks the next open.
    if (version === 0) transaction(db, () => db.exec(`${TABLES}; PRAGMA user_version = ${SCHEMA}`));
  } catch (error) {
    db.close();
    lock.close();
    throw error;
  }
  return { ok: true, value: new RunStore(dir, db, lock) };
};
