import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DraftSaved,
  EXPORT_SCHEMA_VERSION,
  ExportIndex,
  type ExtensionLock,
  type Finding,
  findingInfo,
  formatExport,
  formatLock,
  formatWorkflow,
  isExtensionType,
  LOCK_SCHEMA_VERSION,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  readDocument,
  STORE_REF,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
  WorkflowId,
} from "@cedarloom/contracts";
import { errorCode, hashFile, validateWorkflow } from "@cedarloom/engine";
import type { Store } from "@cedarloom/git";
import { basePathOf, listDrafts, readDraft, saveDraft } from "./drafts.ts";
import { installedExtensions } from "./extensions.ts";
import { parseDocument, storeOf } from "./use-cases.ts";

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// A workflow's file in the store, as the export layout names it.
const fileOf = (id: string): string => {
  if (!WorkflowId.safeParse(id).success) throw new Error(`not a workflow id: ${id}`);
  return `workflows/workflow-${id.toLowerCase()}.json`;
};

const identifier = (a: string, b: string): number => {
  const [x, y] = [/^\d+$/.test(a), /^\d+$/.test(b)];
  if (x && y) return Number(a) - Number(b);
  if (x !== y) return x ? -1 : 1;
  return a < b ? -1 : Number(a > b);
};

// The core and the pre-release identifiers; the contracts' semver has no build metadata.
const identifiers = (version: string): [string[], string[]] => {
  const dash = version.indexOf("-");
  if (dash < 0) return [version.split("."), []];
  return [version.slice(0, dash).split("."), version.slice(dash + 1).split(".")];
};

/** Whether `a` is above `b` in SemVer 2.0.0 precedence (https://semver.org/#spec-item-11). */
const above = (a: string, b: string): boolean => {
  const [coreA, preA] = identifiers(a);
  const [coreB, preB] = identifiers(b);
  const core = coreA.map((part, index) => identifier(part, coreB[index] ?? "0")).find((order) => order !== 0);
  if (core !== undefined) return core > 0;
  // A release is above its pre-releases; of two pre-releases, the first differing identifier decides, else the longer.
  if (preA.length === 0 || preB.length === 0) return preA.length === 0 && preB.length > 0;
  const pre = preA.map((part, index) => (index < preB.length ? identifier(part, preB[index] ?? "") : 1));
  return (pre.find((order) => order !== 0) ?? preA.length - preB.length) > 0;
};

// A stored workflow: its file's text, which an export writes byte for byte, and the workflow.
const readStored = (store: Store, blob: string): Result<{ text: string; workflow: WorkflowDefinition }> => {
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
  if (!read.ok || above(version, read.value)) return read;
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

// The extensions a workflow's nodes use: the id before an extension action's `/`.
const extensionsOf = (workflow: WorkflowDefinition): string[] =>
  workflow.nodes.flatMap(({ type }) => (isExtensionType(type) ? [type.slice(0, type.indexOf("/"))] : []));

/** The lock of `ids`, each pinned as it is installed here; an extension not installed cannot be pinned. */
const lockOf = (state: string, ids: Set<string>): Result<ExtensionLock> => {
  const installed = installedExtensions(state);
  if (!installed.ok) return installed;
  const extensions: ExtensionLock["extensions"] = {};
  for (const id of [...ids].toSorted((a, b) => a.localeCompare(b))) {
    const pin = installed.value.find((entry) => entry.id === id);
    if (pin === undefined) return refuse({ code: "extension.unknown", params: { extension: id } });
    extensions[id] = { version: pin.version, source: pin.source, digest: pin.digest };
  }
  return { ok: true, value: { schemaVersion: LOCK_SCHEMA_VERSION, kind: "cedarloom.lock", extensions } };
};

type Stored = { files: [string, string][]; ids: string[]; used: Set<string> };

/** The stored files of `ids` by their paths in the export layout, their ids as stored, and the extensions they use. */
const storedFiles = (state: string, ids: string[]): Result<Stored> => {
  const store = storeOf(state);
  const head = store.head();
  const stored: Stored = { files: [], ids: [], used: new Set() };
  for (const id of ids) {
    const blob = head === null ? null : store.blob(head, fileOf(id));
    if (blob === null) return refuse({ code: "store.not-found", params: { id, commit: null } });
    const read = readStored(store, blob);
    if (!read.ok) return read;
    stored.files.push([fileOf(id), read.value.text]);
    stored.ids.push(read.value.workflow.metadata.id);
    for (const extension of extensionsOf(read.value.workflow)) stored.used.add(extension);
  }
  return { ok: true, value: stored };
};

// A link anywhere inside the folder, which a shared clone can hold, would redirect the write: from `workflows` into
// the state folder's drafts, say. Apply refuses a link at the file itself; this refuses one on the way to it too.
const linkIn = (folder: string, path: string): string | undefined => {
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

/** A planned export: the plan, and the extensions its lock pins. */
export type ExportPlan = { plan: Plan; extensions: string[] };

/**
 * Plans writing stored workflows into `folder` in the export layout (P4 a: the user commits and pushes it with their
 * own Git): the index, each workflow's stored file byte for byte, and the lock of the extensions they use, pinned as
 * installed here. Files already there are replaced under the plan's checks; others stay.
 */
export const planExport = (
  state: string,
  ids: string[],
  folder: string,
  about: Pick<ExportIndex, "name" | "license">,
): Result<ExportPlan> => {
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
  const lock = lockOf(state, stored.value.used);
  if (!lock.ok) return lock;
  const files: [string, string][] = [
    ["cedarloom-export.json", formatExport(index.value)],
    ["cedarloom.lock.json", formatLock(lock.value)],
    ...stored.value.files,
  ];
  const operations: Plan["operations"] = [];
  for (const file of files) {
    const write = writeOf(folder, file);
    if (!write.ok) return write;
    operations.push(write.value);
  }
  const extensions = Object.keys(lock.value.extensions);
  return { ok: true, value: { plan: { schemaVersion: PLAN_SCHEMA_VERSION, operations }, extensions } };
};
