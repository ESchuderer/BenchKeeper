import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  canonicalJson,
  Finding,
  Intent,
  IssueLink,
  type IssueRef,
  OutboxEntry,
  RemoteComment,
  type Result,
} from "@cedarloom/contracts";
import { filesystemType } from "./filesystem.ts";
import { sha256 } from "./hash.ts";
import { column, connect, type LeaseLock, leaseHeld, newLease, now, stateDir, transaction } from "./store.ts";

/** The hash an approval of an intent names: SHA-256 of its canonical JSON. */
export const intentHash = (intent: Intent): string => sha256(canonicalJson(Intent.parse(intent)));

/** How a send ends: sent, with the comment a comment intent made; failed on a refusal; pending again after an outage. */
export type Settled =
  | { status: "sent"; remote: RemoteComment | null }
  | { status: "failed" | "pending"; finding: Finding };

/** A sender's hold on an entry: the entry as claimed, and its lease, which the OS releases when the sender ends. */
export interface OutboxClaim extends LeaseLock {
  entry: OutboxEntry;
}

const COLUMNS = `id, "key", intent, intentHash, approvedBy, status, attempts, unchanged, remote, finding, createdAt, settledAt`;
// Each attempt takes a lease of its own: a probe or a release removes a lease's file, which a second taker would miss.
const leaseOf = (id: string, attempt: number): string => `outbox-${id}.${attempt}`;
const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

/**
 * The outbox of writes to hub issues and the runs linked to hub issues, in the run store's database. It takes no store
 * lock: each write is one short transaction, so a send waits on the tracker without holding anything but its entry's
 * lease, and a process that ends while sending leaves the entry due again.
 */
export class WorkItemStore {
  readonly #dir: string;
  readonly #db: DatabaseSync;

  constructor(dir: string, db: DatabaseSync) {
    this.#dir = dir;
    this.#db = db;
  }

  /**
   * Queues an intent under an idempotency key, approved by the owner or a mirroring opt-in through its hash: refused
   * when the approval names another intent. A key queued before keeps its entry, which is returned again for the same
   * intent and refused for another one.
   */
  enqueue(key: string, input: Intent, approval: { by: OutboxEntry["approvedBy"]; hash: string }): Result<OutboxEntry> {
    const intent = Intent.parse(input);
    const hash = intentHash(intent);
    if (hash !== approval.hash) {
      return refuse({ code: "outbox.not-approved", params: { key, hash, approvedHash: approval.hash } });
    }
    return transaction(this.#db, () => {
      this.#db
        .prepare(
          `INSERT INTO outbox (id, "key", intent, intentHash, approvedHash, approvedBy, status, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT ("key") DO NOTHING`,
        )
        .run(randomUUID(), OutboxEntry.shape.key.parse(key), canonicalJson(intent), hash, hash, approval.by, now());
      const [entry] = this.#where(`"key" = ?`, key);
      if (entry === undefined) throw new Error(`no outbox entry under ${key}`);
      if (entry.intentHash !== hash) return refuse({ code: "outbox.key-taken", params: { key, id: entry.id } });
      return { ok: true, value: entry };
    });
  }

  entry(id: string): OutboxEntry | undefined {
    return this.#where("id = ?", id)[0];
  }

  /** The entries not sent yet, oldest first, with those a live sender holds, whose claim is refused. */
  unsent(): OutboxEntry[] {
    return this.#where("status IN ('pending', 'sending')");
  }

  /**
   * Takes a due entry for a send, as its next attempt: refused while another process sends it and once it has ended.
   * The sender settles it, then releases the claim.
   */
  claim(id: string): Result<OutboxClaim> {
    let lock = null as LeaseLock | null;
    try {
      return transaction(this.#db, () => {
        const entry = this.entry(id);
        if (entry === undefined) return refuse({ code: "outbox.not-found", params: { id } });
        const sending = entry.status === "sending" && leaseHeld(this.#dir, leaseOf(entry.id, entry.attempts));
        if (sending || !["pending", "sending"].includes(entry.status)) {
          return refuse({ code: "outbox.status", params: { id, status: entry.status } });
        }
        const attempts = entry.attempts + 1;
        // A claim whose COMMIT fails lets go of this lock after its ROLLBACK.
        lock = newLease(this.#dir, leaseOf(entry.id, attempts));
        this.#db.prepare("UPDATE outbox SET status = 'sending', attempts = ? WHERE id = ?").run(attempts, entry.id);
        return { ok: true, value: { entry: { ...entry, status: "sending", attempts }, release: lock.release } };
      });
    } catch (error) {
      lock?.release();
      throw error;
    }
  }

  /** Keeps whether the issue already was as a label intent asks, read before its first write; a later read keeps it. */
  observe(id: string, unchanged: boolean): void {
    this.#db
      .prepare("UPDATE outbox SET unchanged = ? WHERE id = ? AND status = 'sending' AND unchanged IS NULL")
      .run(unchanged ? 1 : 0, id);
  }

  /** Ends the send of a claimed entry, checked on write so a bad value never breaks a later read; the entry as it ended. */
  settle(id: string, settled: Settled): OutboxEntry {
    const remote = settled.status === "sent" && settled.remote !== null ? RemoteComment.parse(settled.remote) : null;
    const finding = settled.status === "sent" ? null : Finding.parse(settled.finding);
    this.#db
      .prepare(
        "UPDATE outbox SET status = ?, remote = ?, finding = ?, settledAt = ? WHERE id = ? AND status = 'sending'",
      )
      .run(
        settled.status,
        remote === null ? null : canonicalJson(remote),
        finding === null ? null : canonicalJson(finding),
        settled.status === "pending" ? null : now(),
        id,
      );
    const entry = this.entry(id);
    if (entry === undefined) throw new Error(`no outbox entry ${id}`);
    return entry;
  }

  /**
   * Queues a failed entry again, once the owner fixed what refused it, behind the entries queued while it waited. Its
   * attempts stay counted, so a comment whose write may have happened is looked up by its marker before it is posted;
   * a label is read again before its write, as the attempt that failed wrote nothing.
   */
  retry(id: string): Result<OutboxEntry> {
    return transaction(this.#db, () => {
      const entry = this.entry(id);
      if (entry === undefined) return refuse({ code: "outbox.not-found", params: { id } });
      if (entry.status !== "failed") return refuse({ code: "outbox.status", params: { id, status: entry.status } });
      // The queue's order is the rowid's.
      this.#db
        .prepare(
          `UPDATE outbox SET status = 'pending', unchanged = NULL, finding = NULL, settledAt = NULL,
           rowid = (SELECT max(rowid) + 1 FROM outbox) WHERE id = ?`,
        )
        .run(id);
      return { ok: true, value: { ...entry, status: "pending", unchanged: null, finding: null, settledAt: null } };
    });
  }

  /** Links a recorded run (a worker launch or a graph run) to a hub issue, once; the run's links. */
  link(runId: string, issue: IssueRef): Result<IssueLink[]> {
    const link = IssueLink.parse({ runId, issue, linkedAt: now() });
    const run = this.#db
      .prepare("SELECT 1 FROM launches WHERE runId = ?1 UNION ALL SELECT 1 FROM graph_runs WHERE id = ?1")
      .get(link.runId);
    if (run === undefined) return refuse({ code: "run.not-found", params: { runId } });
    this.#db
      .prepare("INSERT INTO issue_links VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(link.runId, link.issue.repo, link.issue.number, link.linkedAt);
    return { ok: true, value: this.links(link.runId) };
  }

  /** The hub issues a run is linked to, in the order they were linked. */
  links(runId: string): IssueLink[] {
    return this.#db
      .prepare("SELECT runId, repo, number, linkedAt FROM issue_links WHERE runId = ? ORDER BY linkedAt, rowid")
      .all(runId)
      .map(({ repo, number, ...row }) => IssueLink.parse({ ...row, issue: { repo, number } }));
  }

  close(): void {
    this.#db.close();
  }

  #where(condition: string, ...params: string[]): OutboxEntry[] {
    return this.#db
      .prepare(`SELECT ${COLUMNS} FROM outbox WHERE ${condition} ORDER BY rowid`)
      .all(...params)
      .map((row) =>
        OutboxEntry.parse({
          ...row,
          intent: column(row["intent"]),
          unchanged: row["unchanged"] === null ? null : row["unchanged"] === 1,
          remote: column(row["remote"]),
          finding: column(row["finding"]),
        }),
      );
  }
}

/**
 * Opens the outbox and issue links of the state folder `dir` (created private), without the store lock: refused on a
 * network filesystem or for a store at another schema.
 */
export const openWorkItemStore = (dir: string, detect = filesystemType): Result<WorkItemStore> => {
  const refused = stateDir(dir, detect);
  return refused === null ? connect(dir, (db) => new WorkItemStore(dir, db)) : refuse(refused);
};
