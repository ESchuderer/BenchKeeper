import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AccountName,
  AccountSwitch,
  canonicalJson,
  ContractCheckRecord,
  LaunchPlugins,
  LaunchRecord,
  type Finding,
  PLAN_SCHEMA_VERSION,
  ModeSwitch,
  UsageSample,
  Plan,
  Reading,
  type Result,
  Run,
  RunTotals,
  readDocument,
  Step,
} from "@cedarloom/contracts";
import { filesystemType, isNetworkFilesystem } from "./filesystem.ts";
import { planHash, sha256 } from "./hash.ts";
import {
  ACCOUNT_TABLES,
  CHECK_TABLES,
  GRAPH_TABLES,
  LAUNCH_TABLES,
  MODE_TABLES,
  TABLES,
  USAGE_TABLES,
} from "./rows.ts";

const FinishedLaunch = LaunchRecord.pick({ runId: true, finishedAt: true, verdict: true });
// The 0.1.0 schema, created at once in an empty store. Nothing from before 0.1.0 is carried over.
const BASELINE = [TABLES, ACCOUNT_TABLES, CHECK_TABLES, LAUNCH_TABLES, MODE_TABLES, USAGE_TABLES, GRAPH_TABLES];
// Its number follows every schema before 0.1.0 (1 to 16), so a store from before it is never read as this one.
const SCHEMA = 17;

// A JSON column's value; null for SQL NULL.
const column = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : null);

// A stored plan with every file content blanked; kinds, paths and hashes remain. The store's SQL calls it as blanked().
const blanked = (plan: unknown): string =>
  JSON.stringify(JSON.parse(String(plan), (key, value: unknown) => (key === "content" ? "" : value)));

// Runs `work` with secure_delete on, which zeroes what its updates leave behind, such as a blanked plan's content, which
// SQLite otherwise keeps on freed pages (https://www.sqlite.org/pragma.html#pragma_secure_delete). Only there: on every
// write it kept another process's appends out longer.
const zeroed = <T>(db: DatabaseSync, work: () => T): T => {
  db.exec("PRAGMA secure_delete = ON");
  try {
    return work();
  } finally {
    db.exec("PRAGMA secure_delete = OFF");
  }
};

// Moves the log into the database and empties it as the store closes, so the pages from before a blanking leave the
// log too; a checkpoint at each finish kept another process's appends out. It waits for nothing, and while another
// connection reads the store, such as a graph run's, it stops short without an error and the log keeps those pages
// until that connection closes (https://www.sqlite.org/pragma.html#pragma_wal_checkpoint).
const emptyLog = (db: DatabaseSync): void => {
  db.exec("PRAGMA busy_timeout = 0");
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.exec(`PRAGMA busy_timeout = ${SETTLE_MS}`);
  }
};

const LAUNCH_COLUMNS =
  "runId, task, agent, account, version, pid, startedAt, finishedAt, verdict, labels, plugins, totals";

// A launch row with its JSON columns read.
const launchOf = (row: Record<string, unknown>): LaunchRecord =>
  LaunchRecord.parse({
    ...row,
    labels: column(row["labels"]),
    plugins: column(row["plugins"]),
    totals: column(row["totals"]),
  });

/** A launch as its lease takes it, with the settings it runs with. */
export type Lease = Omit<LaunchRecord, "finishedAt" | "verdict" | "plugins" | "totals">;

/** A launch's hold on its lease: the launcher keeps it while the worker runs, and the OS releases it on any exit. */
export interface LeaseLock {
  release(this: void): void;
}

const leaseLockPath = (dir: string, name: string): string => join(dir, "leases", `${name}.lock`);

// The lock of a check of an account's login, such as `claude auth status`, which may renew it.
const checkLockPath = (dir: string, account: string): string => join(dir, "checks", `${account}.lock`);

// The locks of the leases this process holds. A lock the garbage collector takes closes its database and so lets go of
// the lease: each stays referenced here until its release, whatever the launcher keeps.
const heldLocks = new Set<DatabaseSync>();

// Takes a run's lock without waiting, as the store lock is taken: an exclusive SQLite lock the OS releases when the
// process ends, also on a crash. null when another connection holds it.
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

// Whether a launcher holds the run's lock; a lock nobody holds is removed.
const lockHeld = (path: string): boolean => {
  const probe = takeLock(path);
  if (probe === null) return true;
  probe.close();
  removeLock(path);
  return false;
};

/**
 * Takes the lease lock `name` (a launch's run id, or a graph run's id and epoch) until its release. Each name is taken
 * once: a probe or a release removes the file after letting go, which would strand a second taker on a removed file.
 */
export const newLease = (dir: string, name: string): LeaseLock => {
  mkdirSync(join(dir, "leases"), { recursive: true, mode: 0o700 });
  const held = hold(leaseLockPath(dir, name));
  if (held === null) throw new Error(`the lease ${name} is held already`);
  return held;
};

/** Whether a process holds the lease lock `name` in the store `dir`. */
export const leaseHeld = (dir: string, name: string): boolean => lockHeld(leaseLockPath(dir, name));

/** `leaseHeld` for a read: a shared lock is tried and given back, and no file is made or removed. */
export const leaseSeen = (dir: string, name: string): boolean => {
  const path = leaseLockPath(dir, name);
  if (!existsSync(path)) return false;
  const probe = new DatabaseSync(path, { readOnly: true });
  try {
    probe.exec("PRAGMA busy_timeout = 0; BEGIN; SELECT count(*) FROM sqlite_master");
    return false;
  } catch {
    return true;
  } finally {
    probe.close();
  }
};
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

  /** The latest switch of the level for running work, made at `since` or later when given; null when there is none. */
  modeSwitch(since: string | null = null): ModeSwitch | null {
    const row = this.db
      .prepare("SELECT at, level FROM mode_switches WHERE at >= ? ORDER BY rowid DESC LIMIT 1")
      .get(since ?? "");
    return row === undefined ? null : ModeSwitch.parse(row);
  }

  /** One launch by its run id; undefined for none. */
  launch(runId: string): LaunchRecord | undefined {
    const row = this.db.prepare(`SELECT ${LAUNCH_COLUMNS} FROM launches WHERE runId = ?`).get(runId);
    return row === undefined ? undefined : launchOf(row);
  }

  /** The plugins of the latest launch whose init line named them; null when none has. */
  latestPlugins(): LaunchPlugins | null {
    const row = this.db
      .prepare("SELECT plugins FROM launches WHERE plugins IS NOT NULL ORDER BY startedAt DESC, rowid DESC LIMIT 1")
      .get();
    return row === undefined ? null : LaunchPlugins.parse(JSON.parse(String(row["plugins"])));
  }

  /** The latest readings; a row the contract refuses, written before a bound or by hand, is left out. */
  readings(): Reading[] {
    return this.db
      .prepare(
        `SELECT account, "window", usedPercent, resetsAt, readAt, source FROM readings ORDER BY account, "window"`,
      )
      .all()
      .flatMap((row) => {
        const reading = Reading.safeParse(row);
        return reading.success ? [reading.data] : [];
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

  /**
   * Keeps the latest reading per account and window, whichever source read it: a reading older than the stored one is
   * dropped. A reading that is no Reading throws here, so one bad row cannot break every later choice.
   */
  recordReading(input: Reading): void {
    const r = Reading.parse(input);
    this.db
      .prepare(
        `INSERT INTO readings VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (account, "window") DO UPDATE SET
         usedPercent = excluded.usedPercent, resetsAt = excluded.resetsAt, readAt = excluded.readAt, source = excluded.source
         WHERE excluded.readAt >= readings.readAt`,
      )
      .run(r.account, r.window, r.usedPercent, r.resetsAt, r.readAt, r.source);
  }

  /**
   * Keeps usage samples as history, in one transaction with the latest readings they update: a sample with a quota, a
   * share and a reset updates its account's reading. A sample that is no UsageSample throws, and nothing is kept.
   */
  recordSamples(input: readonly UsageSample[]): void {
    const samples = input.map((sample) => UsageSample.parse(sample));
    transaction(this.db, () => {
      const insert = this.db.prepare("INSERT INTO usage_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const s of samples) {
        insert.run(
          s.account,
          s.agent,
          s.agentVersion,
          s.window,
          s.quota,
          s.usedPercent,
          s.resetsAt,
          s.readAt,
          s.runId,
          s.raw,
        );
        const { quota: window, usedPercent, resetsAt } = s;
        if (window !== null && usedPercent !== null && resetsAt !== null) {
          this.recordReading({ account: s.account, window, usedPercent, resetsAt, readAt: s.readAt, source: "worker" });
        }
      }
    });
  }

  /** The usage samples, oldest first: of one account, and read at `since` or later, when given. */
  usageSamples({ account, since }: { account?: string; since?: string } = {}): UsageSample[] {
    return (
      this.db
        .prepare(
          `SELECT account, agent, agentVersion, "window", quota, usedPercent, resetsAt, readAt, runId, raw FROM usage_samples
         WHERE account = coalesce(?, account) AND readAt >= coalesce(?, '') ORDER BY readAt, rowid`,
        )
        // Compared as a time: the stored times carry milliseconds, and a since without them would sort after its second.
        .all(account ?? null, since === undefined ? null : new Date(since).toISOString())
        .map((row) => UsageSample.parse(row))
    );
  }

  /** Records a switch of the automation level for running work; it takes effect at each run's next gate. */
  recordModeSwitch(input: ModeSwitch): void {
    const change = ModeSwitch.parse(input);
    this.db.prepare("INSERT INTO mode_switches VALUES (?, ?)").run(change.at, change.level);
  }

  /** Records a launch-time account choice, dated when its readings were judged; one that is no AccountSwitch throws. */
  recordSwitch(input: AccountSwitch): void {
    const choice = AccountSwitch.parse(input);
    this.db
      .prepare("INSERT INTO switches VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        choice.at,
        choice.task,
        choice.from,
        choice.to,
        choice.reason,
        JSON.stringify(choice.readings),
        JSON.stringify(choice.candidates),
      );
  }

  /** Records the contract check of an agent CLI version, replacing an earlier check of that version. */
  recordContractCheck(input: ContractCheckRecord): void {
    const check = ContractCheckRecord.parse(input);
    this.db
      .prepare("INSERT OR REPLACE INTO contract_checks VALUES (?, ?, ?, ?)")
      .run(check.agent, check.version, JSON.stringify(check.missing), check.at);
  }

  /** The contract checks of an agent's CLI versions, oldest first. */
  contractChecks(agent: ContractCheckRecord["agent"]): ContractCheckRecord[] {
    return this.db
      .prepare(
        `SELECT json_object('agent', agent, 'version', version, 'missing', json(missing), 'at', at) AS row
         FROM contract_checks WHERE agent = ? ORDER BY at, version`,
      )
      .all(agent)
      .map((row) => ContractCheckRecord.parse(JSON.parse(String(row["row"]))));
  }

  // Ends the leases whose launcher let go of the run's lock without a finish (a crash, a kill) as interrupted, and counts
  // the others per account.
  #countLive(): Map<string, number> {
    const counts = new Map<string, number>();
    const end = this.db.prepare("UPDATE launches SET finishedAt = ?, verdict = 'interrupted' WHERE runId = ?");
    for (const row of this.db.prepare("SELECT runId, account FROM launches WHERE finishedAt IS NULL").all()) {
      const [runId, account] = [String(row["runId"]), String(row["account"])];
      if (leaseHeld(this.dir, runId)) counts.set(account, (counts.get(account) ?? 0) + 1);
      else end.run(now(), runId);
    }
    // An account whose login is being checked counts as full, so no worker starts beside the check.
    const checks = join(this.dir, "checks");
    for (const file of existsSync(checks) ? readdirSync(checks) : []) {
      // SQLite keeps a journal beside a held lock; only the locks name accounts.
      if (file.endsWith(".lock") && lockHeld(join(checks, file)))
        counts.set(file.slice(0, -5), Number.POSITIVE_INFINITY);
    }
    return counts;
  }

  /**
   * The running leases per account, Infinity for an account whose login is being checked; a lease whose launcher let go
   * of it without a finish is ended first.
   */
  liveLeases(): Map<string, number> {
    return transaction(this.db, () => this.#countLive());
  }

  /**
   * Holds `account` for a check of its login, which may renew it: null while a worker runs on it or another check holds
   * it. Until the release the account counts as full, so no worker starts beside the check.
   */
  checkAccount(account: string): LeaseLock | null {
    const path = checkLockPath(this.dir, AccountName.parse(account));
    mkdirSync(join(this.dir, "checks"), { recursive: true, mode: 0o700 });
    return transaction(this.db, () => (this.#countLive().has(account) ? null : hold(path)));
  }

  /**
   * Takes one of the account's `max` leases for a launch, in one transaction; null when all are taken. The launcher holds
   * the returned lock until it has finished the launch: a lease whose lock nobody holds counts as interrupted.
   */
  leaseAccount(input: Lease, max: number): LeaseLock | null {
    const launch = LaunchRecord.parse({
      ...input,
      finishedAt: null,
      verdict: null,
      plugins: null,
      totals: null,
    });
    const lock = newLease(this.dir, launch.runId);
    let taken: boolean;
    try {
      taken = transaction(this.db, () => {
        if ((this.#countLive().get(launch.account) ?? 0) >= max) return false;
        this.db
          .prepare(
            `INSERT INTO launches (runId, task, agent, account, version, pid, startedAt, labels)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            launch.runId,
            launch.task,
            launch.agent,
            launch.account,
            launch.version,
            launch.pid,
            launch.startedAt,
            canonicalJson(launch.labels),
          );
        return true;
      });
    } catch (error) {
      // A row that cannot be written, such as a run id that has one, lets go of the lock before the error goes up.
      lock.release();
      throw error;
    }
    if (taken) return lock;
    lock.release();
    return null;
  }

  /** Ends a launch's lease with its verdict. */
  finishLaunch(runId: string, verdict: NonNullable<LaunchRecord["verdict"]>, at: string = now()): void {
    // Checked on write, so a malformed time never makes every later read of the launches fail.
    const end = FinishedLaunch.parse({ runId, finishedAt: at, verdict });
    this.db
      .prepare("UPDATE launches SET finishedAt = ?, verdict = ? WHERE runId = ? AND finishedAt IS NULL")
      .run(end.finishedAt, end.verdict, end.runId);
  }

  /** Keeps the plugins the run's init line named; ones that are no LaunchPlugins throw. */
  recordPlugins(runId: string, input: LaunchPlugins): void {
    const plugins = LaunchPlugins.parse(input);
    this.db.prepare("UPDATE launches SET plugins = ? WHERE runId = ?").run(canonicalJson(plugins), runId);
  }

  /** The launches, oldest first. */
  launches(): LaunchRecord[] {
    return this.db.prepare(`SELECT ${LAUNCH_COLUMNS} FROM launches ORDER BY startedAt, rowid`).all().map(launchOf);
  }

  /** Keeps the totals the session's result reported; ones that are no RunTotals throw. */
  recordTotals(runId: string, input: RunTotals): void {
    const totals = RunTotals.parse(input);
    this.db.prepare("UPDATE launches SET totals = ? WHERE runId = ?").run(canonicalJson(totals), runId);
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
    try {
      emptyLog(this.db);
    } finally {
      super.close();
      this.#lock.close();
    }
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

/** Creates the state folder private, or refuses it on a network filesystem, where SQLite's locks do not hold. */
export const stateDir = (dir: string, detect: typeof filesystemType): Finding | null => {
  // A folder this call creates is private; one that existed keeps its mode (a store inside it is still private).
  mkdirSync(join(dir, "backups"), { recursive: true, mode: 0o700 });
  const fsType = detect(realpathSync.native(dir));
  return fsType !== undefined && isNetworkFilesystem(fsType)
    ? { code: "store.network-filesystem", params: { dir, fsType } }
    : null;
};

// A store at a schema other than this CedarLoom's: one from before 0.1.0 is not carried over, one a newer CedarLoom
// wrote is not read.
const otherSchema = (dir: string, found: number): Finding =>
  found < SCHEMA
    ? { code: "store.older-schema", params: { dir, found, known: SCHEMA } }
    : { code: "store.newer-schema", params: { found, known: SCHEMA } };

/**
 * Opens runs.sqlite in `dir` at this CedarLoom's schema and hands it to `use`: an empty store gets the schema in one
 * transaction, so a crash halfway leaves none to block the next open; a store at another schema is refused.
 */
export const connect = <T>(dir: string, use: (db: DatabaseSync) => T): Result<T> => {
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { timeout: SETTLE_MS });
  try {
    chmodSync(join(dir, "runs.sqlite"), 0o600);
    db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON");
    // Read again in the transaction: a graph store opens without the store lock, so another process may create it first.
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
export const openReadOnly = (dir: string): Result<DatabaseSync | null> => {
  if (!existsSync(join(dir, "runs.sqlite"))) return { ok: true, value: null };
  const db = new DatabaseSync(join(dir, "runs.sqlite"), { readOnly: true, timeout: SETTLE_MS });
  const found = versionOf(db);
  if (found === SCHEMA) return { ok: true, value: db };
  db.close();
  // Version 0: a first open created the file but not (yet) its schema, so no run was ever recorded.
  return found === 0 ? { ok: true, value: null } : { ok: false, finding: otherSchema(dir, found) };
};
