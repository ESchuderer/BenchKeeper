import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson, GraphRun, JournalEvent, NodeAttempt, type Result } from "@cedarloom/contracts";
import { filesystemType } from "./filesystem.ts";
import { sha256 } from "./hash.ts";
import {
  connect,
  GRAPH_SCHEMA,
  type LeaseLock,
  leaseHeld,
  leaseSeen,
  newLease,
  now,
  openReadOnly,
  PROJECT_SCHEMA,
  stateDir,
  transaction,
} from "./store.ts";

/** What a run starts from; the ledger adds its id, status, epoch and times. */
export type NewGraphRun = Pick<
  GraphRun,
  "definition" | "inputs" | "trigger" | "mode" | "parentRun" | "parentNode" | "project"
>;
const NewGraphRun = GraphRun.pick({
  definition: true,
  inputs: true,
  trigger: true,
  mode: true,
  parentRun: true,
  parentNode: true,
  project: true,
});

/** A runner's hold on a graph run: its writes carry the epoch it took the run at, and the OS releases it on any exit. */
export interface RunLease extends LeaseLock {
  runId: string;
  epoch: number;
}

const ACTIVE = new Set(["running", "waiting"]);
const COLUMNS = `id, definition, definitionHash, inputs, "trigger", mode, status, parentRun, parentNode, project, epoch, startedAt, finishedAt`;

// A projection that changes no row is the executor's mistake, and nothing of its event is kept.
const must = (changes: number | bigint, mistake: string): void => {
  if (Number(changes) === 0) throw new Error(mistake);
};
const leaseHeldBy = (runId: string, pid: number): Result<never> => ({
  ok: false,
  finding: { code: "run.lease-held", params: { runId, pid } },
});

/**
 * The graph runs of a state folder. It takes no store lock: each write is one short `BEGIN IMMEDIATE` transaction, so
 * runs append events while another process applies a plan under the lock. A runner holds its run through a lease lock
 * per epoch (`leases/<id>.<epoch>.lock`, as a launch does), which the OS releases when the runner's process ends, so a
 * crashed run can be taken over at once. A hung runner keeps its run until it is killed. Writes carry the epoch the runner took
 * the run at: once another runner has taken it over, the old one's writes are refused.
 */
export class GraphStore {
  readonly #dir: string;
  readonly #db: DatabaseSync;
  readonly #probe: typeof leaseHeld;
  readonly #columns: string;

  // A view probes leases without taking them, and reads a store of schema 8, before the project folder, too.
  constructor(dir: string, db: DatabaseSync, view?: { readonly schema: number }) {
    this.#dir = dir;
    this.#db = db;
    this.#probe = view === undefined ? leaseHeld : leaseSeen;
    this.#columns =
      (view?.schema ?? PROJECT_SCHEMA) < PROJECT_SCHEMA ? COLUMNS.replace("project", "NULL AS project") : COLUMNS;
  }

  /** Records a run with its definition and inputs as they start, and returns this process's lease on it (epoch 1). */
  create(input: NewGraphRun): RunLease {
    const run = NewGraphRun.parse(input);
    const runId = randomUUID();
    const lock = newLease(this.#dir, `${runId}.1`);
    const definition = canonicalJson(run.definition);
    try {
      this.#db
        .prepare(
          `INSERT INTO graph_runs (id, workflowId, definition, definitionHash, inputs, "trigger", mode, status, parentRun,
           parentNode, project, pid, epoch, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, 1, ?)`,
        )
        .run(
          runId,
          run.definition.metadata.id,
          definition,
          sha256(definition),
          canonicalJson(run.inputs),
          run.trigger,
          run.mode,
          run.parentRun,
          run.parentNode,
          run.project,
          process.pid,
          now(),
        );
    } catch (error) {
      lock.release();
      throw error;
    }
    return { runId, epoch: 1, release: lock.release };
  }

  /** A run as it stands: one running or waiting while no process holds its lease is `interrupted`. */
  graphRun(id: string): GraphRun | undefined {
    const row = this.#db.prepare(`SELECT ${this.#columns} FROM graph_runs WHERE id = ?`).get(id);
    if (row === undefined) return undefined;
    const interrupted = ACTIVE.has(String(row["status"])) && !this.#probe(this.#dir, `${id}.${Number(row["epoch"])}`);
    const status = interrupted ? "interrupted" : row["status"];
    const [definition, inputs] = [row["definition"], row["inputs"]].map((json) => JSON.parse(String(json)));
    return GraphRun.parse({ ...row, status, definition, inputs });
  }

  /**
   * Appends an event with its projection, in one transaction: a start or end of an attempt in `node_attempts`, an
   * apply run linked to its attempt, the run's end in `graph_runs`. Refused when another runner took the run over
   * after `epoch` or it has ended; an apply run is never linked under a report run. Returns the event's sequence number.
   */
  append(runId: string, epoch: number, input: JournalEvent): Result<number> {
    const event = JournalEvent.parse(input);
    return transaction(this.#db, () => {
      const run = this.#active(runId);
      if (!run.ok) return run;
      if (run.value.epoch !== epoch) return leaseHeldBy(runId, run.value.pid);
      if (event.type === "applying" && run.value.mode === "report") {
        return { ok: false, finding: { code: "run.report-only-apply", params: { runId, applyRun: event.applyRun } } };
      }
      return { ok: true, value: this.#append(runId, event) };
    });
  }

  /**
   * Takes over a run whose lease no process holds, such as one whose runner crashed: refused while a runner holds it,
   * so of two runners only one wins. Raises the run's epoch and appends `resumed`; returns this process's lease.
   */
  takeOver(runId: string): Result<RunLease> {
    let lock = null as LeaseLock | null;
    try {
      return transaction(this.#db, () => {
        const run = this.#active(runId);
        if (!run.ok) return run;
        const epoch = run.value.epoch + 1;
        if (leaseHeld(this.#dir, `${runId}.${epoch - 1}`)) return leaseHeldBy(runId, run.value.pid);
        // A takeover whose COMMIT fails lets go of this lock after its ROLLBACK: one in that moment can meet it held.
        lock = newLease(this.#dir, `${runId}.${epoch}`);
        this.#db.prepare("UPDATE graph_runs SET pid = ?, epoch = ? WHERE id = ?").run(process.pid, epoch, runId);
        this.#append(runId, { type: "resumed" });
        return { ok: true, value: { runId, epoch, release: lock.release } };
      });
    } catch (error) {
      lock?.release();
      throw error;
    }
  }

  /** The run's events in order, each checked against its schema before a replay may use it. */
  events(runId: string): Result<JournalEvent[]> {
    if (this.#db.prepare("SELECT 1 FROM graph_runs WHERE id = ?").get(runId) === undefined) {
      return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    }
    const events: JournalEvent[] = [];
    const rows = this.#db.prepare("SELECT seq, payload FROM run_events WHERE runId = ? ORDER BY seq").all(runId);
    for (const row of rows) {
      const seq = Number(row["seq"]);
      let value: unknown;
      try {
        value = JSON.parse(String(row["payload"]));
      } catch {
        const issues = [{ path: "", code: "invalid_json" }];
        return { ok: false, finding: { code: "run.event-invalid", params: { runId, seq, issues } } };
      }
      const event = JournalEvent.safeParse(value);
      if (!event.success) {
        const issues = event.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }));
        return { ok: false, finding: { code: "run.event-invalid", params: { runId, seq, issues } } };
      }
      events.push(event.data);
    }
    return { ok: true, value: events };
  }

  /** The runs, newest first, each as it stands. */
  graphRuns(): GraphRun[] {
    const ids = this.#db.prepare("SELECT id FROM graph_runs ORDER BY startedAt DESC, id").all();
    return ids.flatMap((row) => this.graphRun(String(row["id"])) ?? []);
  }

  /** A run's attempts in the order they started. */
  attempts(runId: string): NodeAttempt[] {
    const rows = this.#db
      .prepare(
        `SELECT nodeId AS node, attempt, state, pid, startedAt, finishedAt FROM node_attempts WHERE runId = ?
         ORDER BY startedAt, rowid`,
      )
      .all(runId);
    return rows.map((row) => NodeAttempt.parse(row));
  }

  /**
   * Blanks the outputs of ended runs started more than `days` days ago, in their attempts and their events, since a
   * command's output can hold a secret; the events stay valid. As `prune` of the run store does for plan contents.
   */
  prune(days: number): void {
    const old = `runId IN (SELECT id FROM graph_runs WHERE startedAt < ? AND status NOT IN ('running', 'waiting'))`;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    transaction(this.#db, () => {
      this.#db.prepare(`UPDATE node_attempts SET outputs = '{}' WHERE ${old} AND outputs <> '{}'`).run(cutoff);
      this.#db
        .prepare(
          `UPDATE run_events SET payload = json_remove(payload, '$.values')
           WHERE ${old} AND type = 'ended' AND json_type(payload, '$.values') IS NOT NULL`,
        )
        .run(cutoff);
      this.#db
        .prepare(
          `UPDATE run_events SET payload = json_set(payload, '$.outputs', json('{}'))
           WHERE ${old} AND type = 'finished' AND json_extract(payload, '$.outputs') <> '{}'`,
        )
        .run(cutoff);
    });
  }

  close(): void {
    this.#db.close();
  }

  // The epoch, holder and mode of a run that runs or waits; refused for an unknown or ended run.
  #active(runId: string): Result<{ epoch: number; pid: number; mode: GraphRun["mode"] }> {
    const row = this.#db.prepare("SELECT status, epoch, pid, mode FROM graph_runs WHERE id = ?").get(runId);
    if (row === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    const status = String(row["status"]);
    if (!ACTIVE.has(status)) return { ok: false, finding: { code: "run.finished", params: { runId, status } } };
    const mode = GraphRun.shape.mode.parse(row["mode"]);
    return { ok: true, value: { epoch: Number(row["epoch"]), pid: Number(row["pid"]), mode } };
  }

  #append(runId: string, event: JournalEvent): number {
    const at = now();
    const seq = Number(
      this.#db.prepare("SELECT coalesce(max(seq), 0) + 1 AS seq FROM run_events WHERE runId = ?").get(runId)?.["seq"],
    );
    this.#db
      .prepare("INSERT INTO run_events (runId, seq, at, type, nodeId, attempt, payload) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        runId,
        seq,
        at,
        event.type,
        "node" in event ? event.node : null,
        "attempt" in event ? event.attempt : null,
        canonicalJson(event),
      );
    this.#project(runId, event, at);
    return seq;
  }

  #project(runId: string, event: JournalEvent, at: string): void {
    const ofRunning = "WHERE runId = ? AND nodeId = ? AND attempt = ? AND state = 'running'";
    if (event.type === "started") {
      // A node of the run's workflow, and its next attempt: the one before has ended, since a node runs one at a time.
      const { changes } = this.#db
        .prepare(
          `INSERT INTO node_attempts (runId, nodeId, attempt, state, pid, startedAt)
           SELECT id, ?2, ?3, 'running', ?4, ?5 FROM graph_runs WHERE id = ?1
           AND ?2 IN (SELECT value ->> '$.id' FROM json_each(definition, '$.nodes'))
           AND ?3 = (SELECT count(*) + 1 FROM node_attempts WHERE runId = ?1 AND nodeId = ?2)
           AND NOT EXISTS (SELECT 1 FROM node_attempts WHERE runId = ?1 AND nodeId = ?2 AND state = 'running')`,
        )
        .run(runId, event.node, event.attempt, event.pid, at);
      must(changes, `node ${event.node} is not in the workflow, or ${event.attempt} is not its next attempt`);
    } else if (event.type === "ended") {
      const { changes } = this.#db
        .prepare(`UPDATE node_attempts SET state = ?, outputs = ?, finishedAt = ? ${ofRunning}`)
        .run(event.outcome, canonicalJson(event.values ?? {}), at, runId, event.node, event.attempt);
      must(changes, `attempt ${event.attempt} of node ${event.node} is not running`);
    } else if (event.type === "applying") {
      const { changes } = this.#db
        .prepare(`UPDATE node_attempts SET applyRun = ? ${ofRunning}`)
        .run(event.applyRun, runId, event.node, event.attempt);
      must(changes, `attempt ${event.attempt} of node ${event.node} is not running`);
    } else if (event.type === "finished") {
      // A run ends after its attempts: one left running could never be ended once the run refuses events.
      if (this.#db.prepare("SELECT 1 FROM node_attempts WHERE runId = ? AND state = 'running'").get(runId)) {
        throw new Error(`run ${runId} still has attempts running`);
      }
      this.#db.prepare("UPDATE graph_runs SET status = ?, finishedAt = ? WHERE id = ?").run(event.status, at, runId);
    }
  }
}

/**
 * Opens the graph runs of the state folder `dir` (created private), without the store lock: refused on a network
 * filesystem or when a newer CedarLoom wrote the store.
 */
export const openGraphStore = (dir: string, detect = filesystemType): Result<GraphStore> => {
  const refused = stateDir(dir, detect);
  return refused === null ? connect(dir, (db) => new GraphStore(dir, db)) : { ok: false, finding: refused };
};

/** Graph runs as `runs list` and `runs show` read them: no lock, no write, no migration. */
export type GraphView = Pick<GraphStore, "graphRun" | "graphRuns" | "attempts" | "close">;

/** Opens the graph runs of `dir` for reading; null while there are none, also in a store from before them. */
export const openGraphView = (dir: string): Result<GraphView | null> => {
  const opened = openReadOnly(dir);
  if (!opened.ok) return opened;
  if (opened.value === null || opened.value.version < GRAPH_SCHEMA) {
    opened.value?.db.close();
    return { ok: true, value: null };
  }
  return { ok: true, value: new GraphStore(dir, opened.value.db, { schema: opened.value.version }) };
};
