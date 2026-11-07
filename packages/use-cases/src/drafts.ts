import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
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
  WorkflowId,
} from "@cedarloom/contracts";
import { errorCode, tempPath, writeAtomic } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { parseDocument } from "./use-cases.ts";

/** The largest draft file: a workflow at the schema's bounds (1000 nodes, 5000 edges) takes about 1 MB. */
export const DRAFT_LIMIT = 2 * 1024 * 1024;

// One lower-case file per workflow id, with a prefix: docs/agents/cedarloom-rationale.md#drafts
const FOLDER = "drafts";
const FILE = /^workflow-([a-z][a-z0-9_-]{0,63})\.json$/;
// The temporary file of a draft's write (engine's tempPath), which only a crash leaves behind.
const TEMP = /^\.workflow-[a-z][a-z0-9_-]{0,63}\.json\.cedarloom-[0-9a-f-]{36}-\d+$/;
const pathOf = (state: string, id: string): string => {
  const name = `workflow-${id.toLowerCase()}.json`;
  const folder = resolve(state, FOLDER);
  const path = resolve(folder, name);
  // Only a workflow id gets a path, in CodeQL's prefix form: docs/agents/cedarloom-rationale.md#drafts
  if (!WorkflowId.safeParse(id).success || !path.startsWith(folder + sep)) throw new Error(`not a workflow id: ${id}`);
  return path;
};

// The draft's base beside it: the stored blob it was opened from or last saved as, so a save sees a newer one (P3 a).
export const basePathOf = (state: string, id: string): string => pathOf(state, id).replace(/\.json$/, ".base");

const tooLarge = (id: string, bytes: number): Result<never> => ({
  ok: false,
  finding: { code: "draft.too-large", params: { id, bytes, limit: DRAFT_LIMIT } },
});

/** The workflow in `json`, refused when it is none or of another id: a draft holds the workflow of its own id only. */
const workflowOf = (json: unknown, id: string): Result<WorkflowDefinition> => {
  const read = readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, json);
  if (!read.ok || read.value.metadata.id.toLowerCase() === id.toLowerCase()) return read;
  const issues = [{ path: "metadata.id", code: "custom" }];
  return { ok: false, finding: { code: "document.invalid", params: { issues } } };
};

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
    const info = lstatSync(join(state, FOLDER, name), { throwIfNoEntry: false });
    if (id === undefined || info?.isFile() !== true) return [];
    return [{ id, savedAt: info.mtime.toISOString(), bytes: info.size }];
  });
  return drafts.toSorted((a, b) => b.savedAt.localeCompare(a.savedAt) || a.id.localeCompare(b.id));
};

// No link and no wait on a FIFO (why: docs/agents/cedarloom-rationale.md#drafts).
const READ = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

// The file's status and, under the draft limit, its bytes, from one open file; undefined: none there; null: no file.
export const load = (path: string): { info: Stats; bytes: Buffer | null } | null | undefined => {
  let file: number;
  try {
    file = openSync(path, READ);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    // ELOOP: a link, which O_NOFOLLOW does not open; EISDIR: a folder, where the platform refuses to open one.
    if (["ELOOP", "EISDIR"].includes(errorCode(error))) return null;
    throw error;
  }
  try {
    const info = fstatSync(file);
    if (!info.isFile()) return null;
    return { info, bytes: info.size > DRAFT_LIMIT ? null : readFileSync(file) };
  } finally {
    closeSync(file);
  }
};

/** A draft with its workflow; refused when there is none, when it is over the limit, or when it is no workflow. */
export const readDraft = (state: string, id: string): Result<Draft> => {
  const path = pathOf(state, id);
  let found: ReturnType<typeof load>;
  try {
    found = load(path);
  } catch (error) {
    const params = { path: join(FOLDER, basename(path)), error: errorCode(error) };
    return { ok: false, finding: { code: "document.unreadable", params } };
  }
  if (found === undefined || found === null) return { ok: false, finding: { code: "draft.not-found", params: { id } } };
  const { info, bytes } = found;
  if (bytes === null) return tooLarge(id, info.size);
  const read = parseDocument(bytes.toString("utf8"), (json) => workflowOf(json, id));
  if (!read.ok) return read;
  return {
    ok: true,
    value: { id: id.toLowerCase(), savedAt: info.mtime.toISOString(), hash: sha256(bytes), workflow: read.value },
  };
};

// The replaced draft's hash; a link, FIFO or oversize file at the name is no draft and goes, so the save can link in.
const current = (path: string): string | null => {
  const found = load(path);
  if (found === undefined) return null;
  if (found !== null && found.bytes !== null) return sha256(found.bytes);
  rmSync(path, { force: true });
  return null;
};

/** Writes a draft and returns the hash of the version it replaced; a write another process got ahead of runs once more. */
const write = (path: string, text: string): string | null => {
  for (let attempt = 0; ; attempt += 1) {
    const before = current(path);
    try {
      writeAtomic({ path, before, temp: tempPath(path, randomUUID(), attempt) }, text, 0o600);
      return before;
    } catch (error) {
      // writeAtomic reports a file that appeared at the name as ECHANGED too.
      if (attempt > 0 || errorCode(error) !== "ECHANGED") throw error;
    }
  }
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
  const path = pathOf(state, id);
  const read = workflowOf(workflow, id);
  if (!read.ok) return read;
  const text = formatWorkflow(read.value);
  const bytes = Buffer.byteLength(text);
  if (bytes > DRAFT_LIMIT) return tooLarge(id, bytes);
  // The folder and the files only for this user: a draft can hold prompts and commands.
  mkdirSync(join(state, FOLDER), { recursive: true, mode: 0o700 });
  const before = write(path, text);
  const overwrote = before !== null && before !== replaces;
  return { ok: true, value: { id: id.toLowerCase(), savedAt: savedAt(path), hash: sha256(text), bytes, overwrote } };
};

/** Removes a draft and its base: after an export, or when the user starts a new workflow or discards it. */
export const deleteDraft = (state: string, id: string): Result<null> => {
  rmSync(basePathOf(state, id), { force: true });
  try {
    unlinkSync(pathOf(state, id));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: false, finding: { code: "draft.not-found", params: { id } } };
    throw error;
  }
  return { ok: true, value: null };
};

/**
 * Removes the temporary files of draft writes that a crash left behind. Only those older than a minute: a write takes
 * milliseconds, so another process's write in progress keeps its file.
 */
export const sweepDrafts = (state: string): void => {
  const folder = join(state, FOLDER);
  try {
    for (const name of readdirSync(folder).filter((entry) => TEMP.test(entry))) {
      // lstat reads nothing and follows no link, so a file the user may not read is swept too.
      const info = lstatSync(join(folder, name), { throwIfNoEntry: false });
      if (info?.isFile() === true && Date.now() - info.mtimeMs > 60_000) rmSync(join(folder, name), { force: true });
    }
  } catch {
    // Housekeeping only: no folder yet, or one it cannot read, which the reads and saves report.
  }
};
