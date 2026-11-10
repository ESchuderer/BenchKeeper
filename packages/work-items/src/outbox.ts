import type { Finding, Intent, OutboxEntry, RemoteComment, Result } from "@cedarloom/contracts";
import type { WorkItemStore } from "@cedarloom/ledger";
import type { Tracker } from "./tracker.ts";

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });
const notHub = (id: string, repo: string): Finding => ({ code: "outbox.not-hub", params: { id, repo } });

// The idempotency marker of a comment: an HTML comment, which GitHub keeps in the body and does not show.
const marker = (id: string): string => `<!-- cedarloom-outbox:${id} -->`;

/** The repository an intent writes to: its issue's, or its own for a write to the repository's labels. */
export const repoOf = (intent: Intent): string => ("issue" in intent ? intent.issue.repo : intent.repo);

// Read before the first write, without case; a label that exists is never written, so its color stays the owner's.
const performRepo = async (
  store: WorkItemStore,
  tracker: Tracker,
  entry: OutboxEntry,
  intent: Extract<Intent, { kind: "create-label" | "delete-label" }>,
): Promise<Result<null>> => {
  const create = intent.kind === "create-label";
  let unchanged = entry.unchanged;
  if (unchanged === null) {
    const labels = await tracker.labels();
    if (!labels.ok) return labels;
    unchanged = labels.value.some((name) => name.toLowerCase() === intent.label.toLowerCase()) === create;
    store.observe(entry.id, unchanged);
  }
  if (unchanged) return { ok: true, value: null };
  if (!create) return tracker.deleteLabel(intent.label);
  const created = await tracker.createLabel(intent.label, intent.color, intent.description);
  if (!created.ok) return created;
  // Found by its own answer, after a lost answer or another's create: no undo may delete a label it cannot tell it made.
  if (!created.value) store.observe(entry.id, true);
  return { ok: true, value: null };
};

// A comment maybe posted before is looked up by its marker first; a label is read before the first write, for its undo.
const perform = async (
  store: WorkItemStore,
  tracker: Tracker,
  entry: OutboxEntry,
): Promise<Result<RemoteComment | null>> => {
  const { intent } = entry;
  if (intent.kind === "create-label" || intent.kind === "delete-label")
    return performRepo(store, tracker, entry, intent);
  if (intent.kind === "uncomment") return tracker.deleteComment(intent.issue, intent.comment);
  if (intent.kind === "comment") {
    if (entry.attempts > 1) {
      const earlier = await tracker.findComment(intent.issue, marker(entry.id));
      if (!earlier.ok || earlier.value !== null) return earlier;
    }
    return tracker.comment(intent.issue, `${intent.body}\n\n${marker(entry.id)}`);
  }
  const on = intent.kind === "label";
  if (entry.unchanged === null) {
    const has = await tracker.hasLabel(intent.issue, intent.label);
    if (!has.ok) return has;
    store.observe(entry.id, has.value === on);
  }
  return tracker.setLabel(intent.issue, intent.label, on);
};

/**
 * Sends one due entry: sent, failed when the tracker refuses, or pending again while it is unavailable. A sender that
 * ends before it settles leaves the entry due, and the next send finds what it did.
 */
export const send = async (store: WorkItemStore, tracker: Tracker, id: string): Promise<Result<OutboxEntry>> => {
  const claim = store.claim(id);
  if (!claim.ok) return claim;
  try {
    const repo = repoOf(claim.value.entry.intent);
    // GitHub names repositories without case.
    if (repo.toLowerCase() !== tracker.hub.toLowerCase()) {
      return { ok: true, value: store.settle(id, { status: "failed", finding: notHub(id, repo) }) };
    }
    const done = await perform(store, tracker, claim.value.entry);
    if (done.ok) return { ok: true, value: store.settle(id, { status: "sent", remote: done.value }) };
    const status = done.finding.code === "tracker.unavailable" ? "pending" : "failed";
    return { ok: true, value: store.settle(id, { status, finding: done.finding }) };
  } finally {
    claim.value.release();
  }
};

/** Sends the due entries, oldest first, and stops at the first that finds the tracker unavailable; each as it ended. */
export const drain = async (store: WorkItemStore, tracker: Tracker): Promise<OutboxEntry[]> => {
  const ended: OutboxEntry[] = [];
  for (const { id } of store.unsent()) {
    const sent = await send(store, tracker, id);
    // Another process drains the outbox too: the rest is left to it, in its order.
    if (!sent.ok) break;
    ended.push(sent.value);
    if (sent.value.status === "pending") break;
  }
  return ended;
};

/**
 * The compensating intent of a sent entry: deleting the comment or hub label it made, or the issue's label as it was,
 * when it changed it. A deleted hub label has no undo: the issues it was on are not known.
 */
export const inverse = (entry: OutboxEntry): Result<Intent> => {
  const { id, intent } = entry;
  if (entry.status !== "sent") return refuse({ code: "outbox.status", params: { id, status: entry.status } });
  const noInverse = refuse({ code: "outbox.not-undoable", params: { id, reason: "no-inverse" } });
  if (intent.kind === "uncomment" || intent.kind === "delete-label") return noInverse;
  if (intent.kind === "comment") {
    const { remote } = entry;
    return remote === null
      ? noInverse
      : { ok: true, value: { kind: "uncomment", issue: intent.issue, comment: remote.id } };
  }
  if (entry.unchanged !== false) return refuse({ code: "outbox.not-undoable", params: { id, reason: "unchanged" } });
  if (intent.kind === "create-label") {
    return { ok: true, value: { kind: "delete-label", repo: intent.repo, label: intent.label } };
  }
  const kind = intent.kind === "label" ? "unlabel" : "label";
  return { ok: true, value: { kind, issue: intent.issue, label: intent.label } };
};

/** Queues the compensating intent of a sent entry once, under the key `undo:<id>`, as the owner approved its hash. */
export const compensate = (store: WorkItemStore, id: string, approvedHash: string): Result<OutboxEntry> => {
  const entry = store.entry(id);
  if (entry === undefined) return refuse({ code: "outbox.not-found", params: { id } });
  const back = inverse(entry);
  return back.ok ? store.enqueue(`undo:${id}`, back.value, { by: "owner", hash: approvedHash }) : back;
};
