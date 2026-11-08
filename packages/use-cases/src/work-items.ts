import { randomUUID } from "node:crypto";
import { type Finding, Intent, type IssueRef, type OutboxEntry, type Result } from "@cedarloom/contracts";
import type { z } from "zod";
import { intentHash, openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
import { compensate, drain, inverse, type Tracker } from "@cedarloom/work-items";
import { readSelection } from "./profiles.ts";

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });
const invalid = (error: z.ZodError): Result<never> =>
  refuse({
    code: "document.invalid",
    params: { issues: error.issues.map(({ path, code }) => ({ path: path.join("."), code })) },
  });

const withOutbox = async <T>(
  state: string,
  work: (store: WorkItemStore) => Result<T> | Promise<Result<T>>,
): Promise<Result<T>> => {
  const store = openWorkItemStore(state);
  if (!store.ok) return store;
  try {
    return await work(store.value);
  } finally {
    store.value.close();
  }
};

/** This machine's hub, the only tracker: `work-items.no-hub` while the profile binds none. */
export const hubOf = (config: string): Result<string> => {
  const read = readSelection(config);
  if (!read.ok) return read;
  const hub = read.value.selection?.bindings?.hub;
  return hub === undefined ? refuse({ code: "work-items.no-hub", params: {} }) : { ok: true, value: hub };
};

// GitHub names repositories without case.
const onHub = (config: string, issue: IssueRef): Result<string> => {
  const hub = hubOf(config);
  if (!hub.ok || issue.repo.toLowerCase() === hub.value.toLowerCase()) return hub;
  return refuse({ code: "work-items.not-hub", params: { repo: issue.repo, hub: hub.value } });
};

/** An intent of the owner's, checked, with the hash its approval names; refused for an issue outside the hub. */
export const previewIntent = (config: string, input: unknown): Result<{ intent: Intent; hash: string }> => {
  const read = Intent.safeParse(input);
  if (!read.success) return invalid(read.error);
  const hub = onHub(config, read.data.issue);
  return hub.ok ? { ok: true, value: { intent: read.data, hash: intentHash(read.data) } } : hub;
};

/** Queues an intent the owner approved by its hash, under a key of its own, so the same write can be asked again. */
export const queueIntent = (state: string, config: string, intent: Intent, approvedHash: string) =>
  withOutbox(state, (store) => {
    const hub = onHub(config, intent.issue);
    return hub.ok ? store.enqueue(`owner:${randomUUID()}`, intent, { by: "owner", hash: approvedHash }) : hub;
  });

export const outboxEntries = (state: string): Promise<Result<OutboxEntry[]>> =>
  withOutbox(state, (store) => ({ ok: true, value: store.entries() }));

/** Queues a failed entry again; the owner's step only, as nothing here tells who asks (owner, 2026-11-08). */
export const retryEntry = (state: string, id: string): Promise<Result<OutboxEntry>> =>
  withOutbox(state, (store) => store.retry(id));

/** The compensating intent of a sent entry, with the hash its approval names. */
export const previewEntryUndo = (state: string, id: string): Promise<Result<{ intent: Intent; hash: string }>> =>
  withOutbox(state, (store) => {
    const entry = store.entry(id);
    if (entry === undefined) return refuse({ code: "outbox.not-found", params: { id } });
    const back = inverse(entry);
    return back.ok ? { ok: true, value: { intent: back.value, hash: intentHash(back.value) } } : back;
  });

/** Queues the compensating intent of a sent entry, as the owner approved its hash. */
export const undoEntry = (state: string, id: string, approvedHash: string): Promise<Result<OutboxEntry>> =>
  withOutbox(state, (store) => compensate(store, id, approvedHash));

/** Sends the due entries through `tracker`; each entry as its send ended. */
export const sendOutbox = (state: string, tracker: Tracker): Promise<Result<OutboxEntry[]>> =>
  withOutbox(state, async (store) => ({ ok: true, value: await drain(store, tracker) }));
