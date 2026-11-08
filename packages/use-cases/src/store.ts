import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DraftSaved,
  EXPORT_SCHEMA_VERSION,
  ExportIndex,
  type Finding,
  findingInfo,
  formatExport,
  formatWorkflow,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  readDocument,
  semverAbove,
  STORE_REF,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
  WorkflowId,
} from "@cedarloom/contracts";
import { errorCode, hashFile, validateWorkflow } from "@cedarloom/engine";
import type { Store } from "@cedarloom/git";
import { basePathOf, listDrafts, readDraft, saveDraft } from "./drafts.ts";
import { parseDocument, storeOf } from "./use-cases.ts";

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// A workflow's file in the store, as the export layout names it.
export const fileOf = (id: string): string => {
  if (!WorkflowId.safeParse(id).success) throw new Error(`not a workflow id: ${id}`);
  return `workflows/workflow-${id.toLowerCase()}.json`;
};

// A stored workflow: its file's text, which an export writes byte for byte, and the workflow.
export const readStored = (store: Store, blob: string): Result<{ text: string; workflow: WorkflowDefinition }> => {
  const bytes = store.read(blob);
  if (!bytes.ok) return bytes;
  const text = bytes.value.toString("utf8");
  const read = parseDocument(text, (json) => readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json));
  return read.ok ? { ok: true, value: { text, workflow: read.value } } : read;
};

const storedVersion = (store: Store, blob: string): Result<string> => {
  const read = readStored(store, blob);
  return read.ok ? { ok: true, value: read.value.workflow.metadata.version } : read;
};

/** The stored version a save replaces (null: none), refused unless `version` is above it. */
const risen = (store: Store, stored: string | null, id: string, version: string): Result<string | null> => {
  if (stored === null) return { ok: true, value: null };
  const read = storedVersion(store, stored);
  if (!read.ok || semverAbove(version, read.value)) return read;
  return refuse({ code: "store.version-not-higher", params: { id, stored: read.value, found: version } });
};

const baseOf = (state: string, id: string): string | null => {
  try {
    return readFileSync(basePathOf(state, id), "utf8").trim() || null;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
};

// An extension not installed here yet is no error: the stored workflow runs once it is.
export const unstorable = (workflow: WorkflowDefinition): Finding | undefined =>
  validateWorkflow(workflow).find(
    (finding) => findingInfo[finding.code].severity === "error" && finding.code !== "workflow.extension-missing",
  );

/** A planned save: the plan, the version it stores, and the stored version it follows (null: the first). */
export type SavePlan = { plan: Plan; version: string; stored: string | null };

/**
 * Plans storing a draft as a new version (P3 a). Its commit is made now and stays inert; the plan moves the branch to
 * it, only while the branch is where it was, and makes the stored blob the draft's base. A draft opened from another
 * stored version than the one there now is refused (`store.conflict`) unless `onTop`, and the version must rise.
 */
export const planSave = (state: string, id: string, { onTop = false } = {}): Result<SavePlan> => {
  const draft = readDraft(state, id);
  if (!draft.ok) return draft;
  // A draft read is a workflow already; the contract types its JSON form.
  const workflow = WorkflowDefinition.parse(draft.value.workflow);
  const error = unstorable(workflow);
  if (error !== undefined) return refuse(error);
  const store = storeOf(state);
  const head = store.head();
  const stored = head === null ? null : store.blob(head, fileOf(id));
  if (!onTop && stored !== baseOf(state, id)) return refuse({ code: "store.conflict", params: { id: draft.value.id } });
  const { version } = workflow.metadata;
  const was = risen(store, stored, draft.value.id, version);
  if (!was.ok) return was;
  // One line per stored workflow, which the history reads.
  const made = store.commit(head, [[fileOf(id), formatWorkflow(workflow)]], `${draft.value.id} ${version}\n`);
  if (!made.ok) return made;
  const base = basePathOf(state, id);
  const operations: Plan["operations"] = [
    { kind: "store.update", ref: STORE_REF, before: head, after: made.value.commit },
    { kind: "write", path: base, before: hashFile(base), content: `${made.value.blobs[0]}\n`, mode: 0o600 },
  ];
  return { ok: true, value: { plan: { schemaVersion: PLAN_SCHEMA_VERSION, operations }, version, stored: was.value } };
};

/** A stored version of a workflow: its commit, when and by whom it was saved, and its `metadata.version`. */
export type StoredVersion = { commit: string; savedAt: string; author: string; version: string | null };

/** The stored versions of a workflow, newest first; none before its first save. */
export const storeHistory = (state: string, id: string): Result<StoredVersion[]> => {
  const log = storeOf(state).log(fileOf(id));
  if (!log.ok) return log;
  const line = new RegExp(`^${id.toLowerCase()} (\\S+)$`, "m");
  const versions = log.value.map(({ commit, at, author, message }) => {
    return { commit, savedAt: at, author, version: line.exec(message)?.[1] ?? null };
  });
  return { ok: true, value: versions };
};

/**
 * Opens a stored version of a workflow as its draft, with that blob as the draft's base: the one at `commit` (the
 * commit or its first 7 or more characters from the history), else the latest. It never replaces a draft.
 */
export const openVersion = (state: string, id: string, commit?: string): Result<DraftSaved> => {
  if (listDrafts(state).some((draft) => draft.id === id.toLowerCase())) {
    return refuse({ code: "store.draft-exists", params: { id } });
  }
  const store = storeOf(state);
  const at = commit ?? store.head();
  // Only a commit's hex id reaches git, never an option or a revision expression.
  const blob = at !== null && /^[0-9a-f]{7,64}$/.test(at) ? store.blob(at, fileOf(id)) : null;
  if (blob === null) return refuse({ code: "store.not-found", params: { id, commit: commit ?? null } });
  const bytes = store.read(blob);
  if (!bytes.ok) return bytes;
  const json = parseDocument(bytes.value.toString("utf8"), (value) => ({ ok: true, value }));
  const saved = json.ok ? saveDraft(state, id, json.value, null) : json;
  if (saved.ok) writeFileSync(basePathOf(state, id), `${blob}\n`, { mode: 0o600 });
  return saved;
};

type Stored = { files: [string, string][]; ids: string[] };

/** The stored files of `ids` by their paths in the export layout, and their ids as stored. */
const storedFiles = (state: string, ids: string[]): Result<Stored> => {
  const store = storeOf(state);
  const head = store.head();
  const stored: Stored = { files: [], ids: [] };
  for (const id of ids) {
    const blob = head === null ? null : store.blob(head, fileOf(id));
    if (blob === null) return refuse({ code: "store.not-found", params: { id, commit: null } });
    const read = readStored(store, blob);
    if (!read.ok) return read;
    stored.files.push([fileOf(id), read.value.text]);
    stored.ids.push(read.value.workflow.metadata.id);
  }
  return { ok: true, value: stored };
};

// A link inside the folder (a shared clone can hold one) would redirect the write; apply refuses one at the file only.
export const linkIn = (folder: string, path: string): string | undefined => {
  const parts = path.split("/");
  return parts
    .map((_, depth) => join(folder, ...parts.slice(0, depth + 1)))
    .find((at) => lstatSync(at, { throwIfNoEntry: false })?.isSymbolicLink() === true);
};

const writeOf = (folder: string, [path, content]: [string, string]): Result<Plan["operations"][number]> => {
  const target = join(folder, ...path.split("/"));
  try {
    const link = linkIn(folder, path);
    if (link !== undefined) return refuse({ code: "apply.symlink", params: { path: link } });
    return { ok: true, value: { kind: "write", path: target, before: hashFile(target), content } };
  } catch (error) {
    // A folder at the file's place, or a file at its folder's place: apply would refuse it as well.
    return refuse({ code: "plan.not-a-file", params: { path: target, error: errorCode(error) } });
  }
};

/**
 * Plans writing stored workflows into `folder` in the export layout (P4 a: the user commits and pushes it with their
 * own Git): the index and each workflow's stored file byte for byte. Files already there are replaced under the plan's
 * checks; others stay.
 */
export const planExport = (
  state: string,
  ids: string[],
  folder: string,
  about: Pick<ExportIndex, "name" | "license">,
): Result<Plan> => {
  const indexOf = (workflows: string[]) =>
    readDocument(ExportIndex, EXPORT_SCHEMA_VERSION, {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      kind: "cedarloom.export",
      ...about,
      workflows,
    });
  // The ids as typed are checked before any path is built from them; the index lists them as stored.
  const typed = indexOf(ids);
  const stored = typed.ok ? storedFiles(state, ids) : typed;
  if (!stored.ok) return stored;
  const index = indexOf(stored.value.ids);
  if (!index.ok) return index;
  const files: [string, string][] = [["cedarloom-export.json", formatExport(index.value)], ...stored.value.files];
  const operations: Plan["operations"] = [];
  for (const file of files) {
    const write = writeOf(folder, file);
    if (!write.ok) return write;
    operations.push(write.value);
  }
  return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, operations } };
};
