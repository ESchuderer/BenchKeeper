import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  type Finding,
  formatWorkItemsConfig,
  Intent,
  type IssueLink,
  type IssueRef,
  type OutboxEntry,
  PLAN_SCHEMA_VERSION,
  type Plan,
  readDocument,
  type Result,
  WORK_ITEMS_SCHEMA_VERSION,
  WorkItemsConfig,
} from "@cedarloom/contracts";
import type { z } from "zod";
import { intentHash, openWorkItemStore, sha256, type WorkItemStore } from "@cedarloom/ledger";
import { originRepos } from "@cedarloom/orchestration";
import { compensate, drain, inverse, type Tracker } from "@cedarloom/work-items";
import { readSelection } from "./profiles.ts";
import { readOptionalJson } from "./use-cases.ts";

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

/** Links a recorded run to an issue of the hub; the run's links. */
export const linkRun = (state: string, config: string, runId: string, issue: IssueRef): Promise<Result<IssueLink[]>> =>
  withOutbox(state, (store) => {
    const hub = onHub(config, issue);
    return hub.ok ? store.link(runId, issue) : hub;
  });

const settingsPath = (config: string): string => join(config, "work-items.json");
const NONE: WorkItemsConfig = { schemaVersion: WORK_ITEMS_SCHEMA_VERSION, kind: "cedarloom.work-items", mirroring: [] };

const readSettings = (config: string): Result<{ text: string | null; settings: WorkItemsConfig }> => {
  const file = readOptionalJson(settingsPath(config));
  if (!file.ok || file.value === null) return file.ok ? { ok: true, value: { text: null, settings: NONE } } : file;
  const read = readDocument(WorkItemsConfig, WORK_ITEMS_SCHEMA_VERSION, file.value.json);
  return read.ok ? { ok: true, value: { text: file.value.text, settings: read.value } } : read;
};

// The repositories whose linked runs post to their hub issues.
const mirrored = (config: string): Result<string[]> => {
  const read = readSettings(config);
  return read.ok ? { ok: true, value: read.value.settings.mirroring } : read;
};

/** The plan that switches mirroring on or off for a project repository (A36 a: off unless switched on). */
export const planMirroring = (config: string, repo: string, on: boolean): Result<Plan> => {
  const read = readSettings(config);
  if (!read.ok) return read;
  const { text, settings } = read.value;
  const others = settings.mirroring.filter((each) => each.toLowerCase() !== repo.toLowerCase());
  const next = WorkItemsConfig.safeParse({ ...settings, mirroring: (on ? [...others, repo] : others).toSorted() });
  if (!next.success) return invalid(next.error);
  const content = formatWorkItemsConfig(next.data);
  // The hash of the text read here, so a change made since is found at apply, not written over.
  const write = {
    kind: "write" as const,
    path: settingsPath(config),
    before: text === null ? null : sha256(text),
    content,
  };
  return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, operations: [write] } };
};

// One comment per run and issue, approved by the repository's opt-in; a run outside every mirrored repository gets none.
const queueMirrors = (store: WorkItemStore, repos: ReadonlySet<string>): void => {
  const reposOf = new Map<string, string[]>();
  for (const { runId, issue, project, ended } of store.endedLinks()) {
    const own = reposOf.get(project) ?? originRepos(project);
    reposOf.set(project, own);
    if (!own.some((repo) => repos.has(repo.toLowerCase()))) continue;
    const intent: Intent = { kind: "comment", issue, body: `CedarLoom run ${runId} ended: ${ended}.` };
    store.enqueue(`mirror:${runId}:${issue.repo}#${issue.number}`, intent, {
      by: "mirroring",
      hash: intentHash(intent),
    });
  }
};

/**
 * Queues the comment of each linked run that ended in a repository with mirroring on, once, then sends the due entries
 * through `tracker`; each entry as its send ended.
 */
export const sendOutbox = (state: string, config: string, tracker: Tracker): Promise<Result<OutboxEntry[]>> =>
  withOutbox(state, async (store) => {
    const repos = mirrored(config);
    if (!repos.ok) return repos;
    if (repos.value.length > 0) queueMirrors(store, new Set(repos.value.map((repo) => repo.toLowerCase())));
    return { ok: true, value: await drain(store, tracker) };
  });
