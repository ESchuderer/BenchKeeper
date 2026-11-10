import { randomUUID } from "node:crypto";
import { type Finding, Intent, LABEL_MAX, type OutboxEntry, type Result } from "@cedarloom/contracts";
import type { z } from "zod";
import { intentHash, openWorkItemStore, type WorkItemStore } from "@cedarloom/ledger";
import { folderRemotes, originRepos, sshHostName } from "@cedarloom/orchestration";
import type { Resolved } from "@cedarloom/profiles";
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

const hubParts = ({ profile, on }: Resolved) =>
  Object.entries(profile.workspace).flatMap(([id, part]) =>
    part.type === "hub" && on.has(`workspace.${id}`) ? [part] : [],
  );

/** Whether a hub part of this machine's profile is on. */
export const hubOn = (config: string, app: string | undefined): boolean => {
  const resolved = selectedProfile(config, app, undefined);
  return resolved.ok && hubParts(resolved.value).length > 0;
};

// The origin's repository in lower case, never the folder's name: worktrees are named after their task.
const originOf = (project: string): Result<string> => {
  const repos = [...new Set(originRepos(project, folderRemotes, sshHostName).map((repo) => repo.toLowerCase()))];
  const [repo = ""] = repos;
  return repos.length === 1
    ? { ok: true, value: repo }
    : refuse({ code: "work-items.no-project-name", params: { project } });
};

type Label = [name: string, { color: string; description?: string | undefined }];
// The origin is read only when a label needs it, so a folder without one is refused only then.
const wantedLabels = (resolved: Resolved, project: string | undefined): Result<Label[]> => {
  const parts = hubParts(resolved);
  const own = parts.flatMap(({ labels }): Label[] => Object.entries(labels));
  const named = parts.flatMap(({ projectLabel, projectNames = {} }) =>
    projectLabel === undefined ? [] : [{ ...projectLabel, projectNames }],
  );
  if (project === undefined || named.length === 0) return { ok: true, value: own };
  const origin = originOf(project);
  if (!origin.ok) return origin;
  const repo = origin.value;
  // For a repository the profile does not name: its name in lower case with hyphens, "" when no letter or digit is left.
  const fallback = repo
    .slice(repo.indexOf("/") + 1)
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  const names = named.map(({ prefix, color, projectNames }) => ({
    prefix,
    color,
    name: projectNames[repo] ?? fallback,
  }));
  if (names.some(({ name }) => name === "")) return refuse({ code: "work-items.no-project-name", params: { project } });
  const projectLabels = names.map(({ prefix, color, name }): Label => [prefix + name, { color }]);
  const long = projectLabels.find(([label]) => label.length > LABEL_MAX);
  if (long !== undefined)
    return refuse({ code: "work-items.label-too-long", params: { label: long[0], limit: LABEL_MAX } });
  return { ok: true, value: [...own, ...projectLabels] };
};

/**
 * The labels that the hub parts that are on name and the hub lacks, compared without case, each as an intent to create
 * it with the hash its approval names. A label the hub has is left as it is, also when its color differs. With a
 * project, also its project label, named by the profile for its origin's GitHub repository, else by that repository's
 * name in lower case with hyphens.
 */
export const previewHubLabels = async (
  config: string,
  tracker: Pick<Tracker, "labels">,
  { app, project }: { app?: string | undefined; project?: string | undefined } = {},
): Promise<Result<{ intent: Intent; hash: string }[]>> => {
  const hub = hubOf(config);
  if (!hub.ok) return hub;
  const resolved = selectedProfile(config, app, undefined);
  if (!resolved.ok) return resolved;
  const wanted = wantedLabels(resolved.value, project);
  if (!wanted.ok) return wanted;
  const have = await tracker.labels();
  if (!have.ok) return have;
  const known = new Set(have.value.map((name) => name.toLowerCase()));
  const missing: { intent: Intent; hash: string }[] = [];
  for (const [label, { color, description }] of wanted.value) {
    if (known.has(label.toLowerCase())) continue;
    known.add(label.toLowerCase());
    const read = Intent.safeParse({ kind: "create-label", repo: hub.value, label, color, description });
    if (!read.success) return invalid(read.error);
    missing.push({ intent: read.data, hash: intentHash(read.data) });
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
