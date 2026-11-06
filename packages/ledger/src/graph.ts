import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { canonicalJson, GraphRun, JournalEvent, type Result } from "@cedarloom/contracts";
import { filesystemType } from "./filesystem.ts";
import { sha256 } from "./hash.ts";
import { connect, now, stateDir, transaction } from "./store.ts";

/** What a run starts from; the ledger adds its id, status, epoch and times. */
export type NewGraphRun = Pick<GraphRun, "definition" | "inputs" | "trigger" | "mode" | "parentRun" | "parentNode">;
const NewGraphRun = GraphRun.pick({
  definition: true,
  inputs: true,
  trigger: true,
  mode: true,
  parentRun: true,
  parentNode: true,
});

/** How long a runner holds a run without a heartbeat; it renews the lease every 10 s. */
const LEASE_MS = 60_000;
const leaseEnd = (): string => new Date(Date.now() + LEASE_MS).toISOString();
const ACTIVE = new Set(["running", "waiting"]);
const COLUMNS = `id, definition, definitionHash, inputs, "trigger", mode, status, parentRun, parentNode, epoch, startedAt, finishedAt`;

type Attempt = Extract<JournalEvent, { type: "ended" | "applying" }>;
// An end or a link needs its attempt running; anything else is the executor's mistake, and nothing of it is kept.
const mustRun = (changes: number | bigint, { node, attempt }: Attempt): void => {
  if (Number(changes) === 0) throw new Error(`attempt ${attempt} of node ${node} is not running`);
};

/**
 * The graph runs of a state folder. It takes no store lock: each write is one short `BEGIN IMMEDIATE` transaction, so
 * runs append events while another process applies a plan under the lock. A run is written only by the runner that
 * holds its lease; another runner takes it over once the lease has run out.
 */
export class GraphStore {
  readonly #db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Records a run with its definition and inputs as they start, held by `runner`; returns the run's id. */
  create(input: NewGraphRun, runner: string): string {
    const run = NewGraphRun.parse(input);
    const id = randomUUID();
    const definition = canonicalJson(run.definition);
    this.#db
      .prepare(
        `INSERT INTO graph_runs (id, workflowId, definition, definitionHash, inputs, "trigger", mode, status, parentRun,
         parentNode, runner, leaseUntil, epoch, startedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        id,
        run.definition.metadata.id,
        definition,
        sha256(definition),
        canonicalJson(run.inputs),
        run.trigger,
        run.mode,
        run.parentRun,
        run.parentNode,
        runner,
        leaseEnd(),
        now(),
      );
    return id;
  }

  /** A run as it stands: one whose lease ran out while it was running or waiting is `interrupted`. */
  graphRun(id: string): GraphRun | undefined {
    const row = this.#db
      .prepare(`SELECT ${COLUMNS}, leaseUntil < ? AS expired FROM graph_runs WHERE id = ?`)
      .get(now(), id);
    if (row === undefined) return undefined;
    const status = ACTIVE.has(String(row["status"])) && row["expired"] === 1 ? "interrupted" : row["status"];
    const [definition, inputs] = [row["definition"], row["inputs"]].map((json) => JSON.parse(String(json)));
    return GraphRun.parse({ ...row, status, definition, inputs });
  }

  /**
   * Appends an event with its projection, in one transaction: a start or end of an attempt in `node_attempts`, an
   * apply run linked to its attempt, the run's end in `graph_runs`. Refused when the runner no longer holds the run
   * or it has ended; an apply run is never linked under a report run. Returns the event's sequence number.
   */
  append(runId: string, runner: string, input: JournalEvent): Result<number> {
    const event = JournalEvent.parse(input);
    return transaction(this.#db, () => {
      const held = this.#held(runId, runner);
      if (!held.ok) return held;
      if (event.type === "applying" && held.value === "report") {
        return { ok: false, finding: { code: "run.report-only-apply", params: { runId, applyRun: event.applyRun } } };
      }
      return { ok: true, value: this.#append(runId, event) };
    });
  }

  /** Renews the runner's lease; refused as `append` is, and then the runner stops writing to the run. */
  heartbeat(runId: string, runner: string): Result<void> {
    return transaction(this.#db, () => {
      const held = this.#held(runId, runner);
      if (!held.ok) return held;
      this.#db.prepare("UPDATE graph_runs SET leaseUntil = ? WHERE id = ?").run(leaseEnd(), runId);
      return { ok: true, value: undefined };
    });
  }

  /**
   * Takes over a run whose lease ran out: one transaction compares the lease, so of two runners only one wins. Raises
   * the run's epoch and appends `resumed`; returns the new epoch.
   */
  takeOver(runId: string, runner: string): Result<number> {
    return transaction(this.#db, () => {
      const run = this.#active(runId);
      if (!run.ok) return run;
      const { until } = run.value;
      if (until >= now()) return { ok: false, finding: { code: "run.lease-held", params: { runId, until } } };
      const epoch = this.#db
        .prepare("UPDATE graph_runs SET runner = ?, leaseUntil = ?, epoch = epoch + 1 WHERE id = ? RETURNING epoch")
        .get(runner, leaseEnd(), runId)?.["epoch"];
      this.#append(runId, { type: "resumed" });
      return { ok: true, value: Number(epoch) };
    });
  }

  /** The run's events in order, each checked against its schema before a replay may use it. */
  events(runId: string): Result<JournalEvent[]> {
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

  close(): void {
    this.#db.close();
  }

  // The lease and mode of a run that runs or waits; refused for an unknown or ended run.
  #active(runId: string): Result<{ runner: unknown; until: string; mode: GraphRun["mode"] }> {
    const row = this.#db.prepare("SELECT status, runner, leaseUntil, mode FROM graph_runs WHERE id = ?").get(runId);
    if (row === undefined) return { ok: false, finding: { code: "run.not-found", params: { runId } } };
    const status = String(row["status"]);
    if (!ACTIVE.has(status)) return { ok: false, finding: { code: "run.finished", params: { runId, status } } };
    const mode = GraphRun.shape.mode.parse(row["mode"]);
    return { ok: true, value: { runner: row["runner"], until: String(row["leaseUntil"]), mode } };
  }

  // The run's mode while `runner` holds its lease, also one that ran out and nobody took over.
  #held(runId: string, runner: string): Result<GraphRun["mode"]> {
    const run = this.#active(runId);
    if (!run.ok) return run;
    const { until, mode } = run.value;
    return run.value.runner === runner
      ? { ok: true, value: mode }
      : { ok: false, finding: { code: "run.lease-held", params: { runId, until } } };
  }

  #append(runId: string, event: JournalEvent): number {
    const at = now();
    const seq = Number(
      this.#db.prepare("SELECT coalesce(max(seq), 0) + 1 AS seq FROM run_events WHERE runId = ?").get(runId)?.["seq"],
    );
    const [node, attempt] = "attempt" in event ? [event.node, event.attempt] : [null, null];
    this.#db
      .prepare("INSERT INTO run_events VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(runId, seq, at, event.type, node, attempt, canonicalJson(event));
    this.#project(runId, event, at);
    return seq;
  }

  #project(runId: string, event: JournalEvent, at: string): void {
    const ofRunning = "WHERE runId = ? AND nodeId = ? AND attempt = ? AND state = 'running'";
    if (event.type === "started") {
      this.#db
        .prepare(
          "INSERT INTO node_attempts (runId, nodeId, attempt, state, pid, startedAt) VALUES (?, ?, ?, 'running', ?, ?)",
        )
        .run(runId, event.node, event.attempt, event.pid, at);
    } else if (event.type === "ended") {
      const { changes } = this.#db
        .prepare(`UPDATE node_attempts SET state = ?, outputs = ?, finishedAt = ? ${ofRunning}`)
        .run(event.outcome, canonicalJson(event.values ?? {}), at, runId, event.node, event.attempt);
      mustRun(changes, event);
    } else if (event.type === "applying") {
      const { changes } = this.#db
        .prepare(`UPDATE node_attempts SET applyRun = ? ${ofRunning}`)
        .run(event.applyRun, runId, event.node, event.attempt);
      mustRun(changes, event);
    } else if (event.type === "finished") {
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
  return refused === null ? connect(dir, (db) => new GraphStore(db)) : { ok: false, finding: refused };
};
