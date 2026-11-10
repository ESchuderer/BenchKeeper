import { randomUUID } from "node:crypto";
import { type Finding, Intent, type OutboxEntry, type Result } from "@cedarloom/contracts";
import type { z } from "zod";
import { intentHash, openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
import { compensate, drain, inverse, repoOf, type Tracker } from "@cedarloom/work-items";
import { readSelection, selectedProfile } from "./profiles.ts";

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
const onHub = (config: string, repo: string): Result<string> => {
  const hub = hubOf(config);
  if (!hub.ok || repo.toLowerCase() === hub.value.toLowerCase()) return hub;
  return refuse({ code: "work-items.not-hub", params: { repo, hub: hub.value } });
};

/** An intent of the owner's, checked, with the hash its approval names; refused for a repository other than the hub. */
export const previewIntent = (config: string, input: unknown): Result<{ intent: Intent; hash: string }> => {
  const read = Intent.safeParse(input);
  if (!read.success) return invalid(read.error);
  const hub = onHub(config, repoOf(read.data));
  return hub.ok ? { ok: true, value: { intent: read.data, hash: intentHash(read.data) } } : hub;
};

/**
 * The labels that the hub parts that are on name and the hub lacks, compared without case, each as an intent to create
 * it with the hash its approval names. A label the hub has is left as it is, also when its color differs.
 */
export const previewHubLabels = async (
  config: string,
  tracker: Pick<Tracker, "labels">,
): Promise<Result<{ intent: Intent; hash: string }[]>> => {
  const hub = hubOf(config);
  if (!hub.ok) return hub;
  const resolved = selectedProfile(config, undefined, undefined);
  if (!resolved.ok) return resolved;
  const have = await tracker.labels();
  if (!have.ok) return have;
  const known = new Set(have.value.map((name) => name.toLowerCase()));
  const { profile, on } = resolved.value;
  const missing: { intent: Intent; hash: string }[] = [];
  for (const [id, part] of Object.entries(profile.workspace)) {
    if (part.type !== "hub" || !on.has(`workspace.${id}`)) continue;
    for (const [label, { color, description }] of Object.entries(part.labels)) {
      if (known.has(label.toLowerCase())) continue;
      known.add(label.toLowerCase());
      const read = Intent.safeParse({ kind: "create-label", repo: hub.value, label, color, description });
      if (!read.success) return invalid(read.error);
      missing.push({ intent: read.data, hash: intentHash(read.data) });
    }
  }
  return { ok: true, value: missing };
};

/** Queues an intent the owner approved by its hash, under a key of its own, so the same write can be asked again. */
export const queueIntent = (state: string, config: string, intent: Intent, approvedHash: string) =>
  withOutbox(state, (store) => {
    const hub = onHub(config, repoOf(intent));
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
