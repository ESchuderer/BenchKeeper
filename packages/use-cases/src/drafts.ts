import { randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  type Stats,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import {
  type Draft,
  type DraftInfo,
  type DraftSaved,
  formatWorkflow,
  type Result,
  readDocument,
  WORKFLOW_SCHEMA_VERSION,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { errorCode, hashFile, tempPath, writeAtomic } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { parseDocument } from "./use-cases.ts";

/** The largest draft file: a workflow at the schema's bounds (1000 nodes, 5000 edges) takes about 1 MB. */
export const DRAFT_LIMIT = 2 * 1024 * 1024;

// The drafts are the working copies of the workflows the editor has open: one file per workflow id, in the canonical
// file form, beside the run store. Lower case, since a case-insensitive file system (macOS, Windows) would join ids
// that differ in case only anyway; the prefix keeps a Windows device name (con, nul) from being the file's name.
const FOLDER = "drafts";
const FILE = /^workflow-([a-z][a-z0-9_-]{0,63})\.json$/;
const pathOf = (state: string, id: string): string => {
  const name = `workflow-${id.toLowerCase()}.json`;
  const folder = resolve(state, FOLDER);
  const path = resolve(folder, name);
  // The routes take workflow ids only; any other caller gets no path outside the folder either. The pattern alone
  // ensures that; the prefix check is the form CodeQL's path-injection query recognizes.
  if (!FILE.test(name) || !path.startsWith(folder + sep)) throw new Error(`not a workflow id: ${JSON.stringify(id)}`);
  return path;
};

const tooLarge = (id: string, bytes: number): Result<never> => ({
  ok: false,
  finding: { code: "draft.too-large", params: { id, bytes, limit: DRAFT_LIMIT } },
});

const savedAt = (path: string): string => statSync(path).mtime.toISOString();

/** The drafts in the state folder, newest first, without their contents. */
export const listDrafts = (state: string): DraftInfo[] => {
  let names: string[];
  try {
    names = readdirSync(join(state, FOLDER));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const drafts = names.flatMap((name): DraftInfo[] => {
    const id = FILE.exec(name)?.[1];
    const info = statSync(join(state, FOLDER, name), { throwIfNoEntry: false });
    if (id === undefined || info?.isFile() !== true) return [];
    return [{ id, savedAt: info.mtime.toISOString(), bytes: info.size }];
  });
  return drafts.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
};

/** The file's status and, under the limit, its bytes, both from one open file, so a save meanwhile is never mixed in. */
const load = (path: string): { info: Stats; bytes: Buffer | null } => {
  const file = openSync(path, "r");
  try {
    const info = fstatSync(file);
    return { info, bytes: info.size > DRAFT_LIMIT ? null : readFileSync(file) };
  } finally {
    closeSync(file);
  }
};

/** A draft with its workflow; refused when there is none, when it is over the limit, or when it is no workflow. */
export const readDraft = (state: string, id: string): Result<Draft> => {
  const path = pathOf(state, id);
  let info: Stats;
  let bytes: Buffer | null;
  try {
    ({ info, bytes } = load(path));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: false, finding: { code: "draft.not-found", params: { id } } };
    const params = { path: join(FOLDER, basename(path)), error: errorCode(error) };
    return { ok: false, finding: { code: "document.unreadable", params } };
  }
  if (bytes === null) return tooLarge(id, info.size);
  const read = parseDocument(bytes.toString("utf8"), (json) =>
    readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json),
  );
  if (!read.ok) return read;
  return {
    ok: true,
    value: { id: id.toLowerCase(), savedAt: info.mtime.toISOString(), hash: sha256(bytes), workflow: read.value },
  };
};

/**
 * Saves a draft in the canonical file form through a flushed temporary file, so the file holds the old version or the
 * new one, never a mix. The last save wins; `overwrote` tells the saver that another one (a second tab) saved since
 * the version `replaces` names.
 */
export const saveDraft = (
  state: string,
  id: string,
  workflow: unknown,
  replaces: string | null,
): Result<DraftSaved> => {
  const read = readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, workflow);
  if (!read.ok) return read;
  const text = formatWorkflow(read.value);
  const bytes = Buffer.byteLength(text);
  if (bytes > DRAFT_LIMIT) return tooLarge(id, bytes);
  const path = pathOf(state, id);
  // The folder and the files only for this user: a draft can hold prompts and commands.
  mkdirSync(join(state, FOLDER), { recursive: true, mode: 0o700 });
  const before = hashFile(path);
  writeAtomic({ path, before, temp: tempPath(path, randomUUID(), 0) }, text, 0o600);
  const overwrote = before !== null && before !== replaces;
  return { ok: true, value: { id: id.toLowerCase(), savedAt: savedAt(path), hash: sha256(text), bytes, overwrote } };
};

/** Removes a draft: after an export, or when the user starts a new workflow or discards it. */
export const deleteDraft = (state: string, id: string): Result<null> => {
  try {
    unlinkSync(pathOf(state, id));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: false, finding: { code: "draft.not-found", params: { id } } };
    throw error;
  }
  return { ok: true, value: null };
};
