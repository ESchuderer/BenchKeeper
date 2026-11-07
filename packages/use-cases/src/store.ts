import { readFileSync, writeFileSync } from "node:fs";
import {
  type DraftSaved,
  type Finding,
  findingInfo,
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
const fileOf = (id: string): string => {
  if (!WorkflowId.safeParse(id).success) throw new Error(`not a workflow id: ${id}`);
  return `workflows/workflow-${id.toLowerCase()}.json`;
};

const storedVersion = (store: Store, blob: string): Result<string> => {
  const bytes = store.read(blob);
  if (!bytes.ok) return bytes;
  const read = parseDocument(bytes.value.toString("utf8"), (json) =>
    readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json),
  );
  return read.ok ? { ok: true, value: read.value.metadata.version } : read;
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
  // An extension not installed here yet does not stop a save: the stored workflow runs once it is.
  const error = validateWorkflow(workflow).find(
    (finding) => findingInfo[finding.code].severity === "error" && finding.code !== "workflow.extension-missing",
  );
  if (error !== undefined) return refuse(error);
  const store = storeOf(state);
  const head = store.head();
  const stored = head === null ? null : store.blob(head, fileOf(id));
  if (!onTop && stored !== baseOf(state, id)) return refuse({ code: "store.conflict", params: { id: draft.value.id } });
  const { version } = workflow.metadata;
  const was = risen(store, stored, draft.value.id, version);
  if (!was.ok) return was;
  // One line per stored workflow, which the history reads.
  const made = store.commit(head, fileOf(id), formatWorkflow(workflow), `${draft.value.id} ${version}\n`);
  if (!made.ok) return made;
  const base = basePathOf(state, id);
  const operations: Plan["operations"] = [
    { kind: "store.update", ref: STORE_REF, before: head, after: made.value.commit },
    { kind: "write", path: base, before: hashFile(base), content: `${made.value.blob}\n`, mode: 0o600 },
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
