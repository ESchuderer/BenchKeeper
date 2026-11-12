import { isUtf8 } from "node:buffer";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Result } from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";

export const errorCode = (error: unknown): string =>
  error instanceof Error && "code" in error ? String(error.code) : String(error);

const changed = (): Error => Object.assign(new Error("the file changed during the write"), { code: "ECHANGED" });

// Whether the folders to `path` are still real: a folder swapped for a link since the plan is found (hub issue 141).
const realWay = (path: string): boolean => {
  let folder = dirname(path);
  while (lstatSync(folder, { throwIfNoEntry: false }) === undefined) folder = dirname(folder);
  return realpathSync.native(folder) === folder;
};

/** The file's bytes, or null when there is no file. */
export const readOrNull = (path: string): Buffer | null => {
  try {
    return readFileSync(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
};

export const hashFile = (path: string): string | null => {
  const bytes = readOrNull(path);
  return bytes === null ? null : sha256(bytes);
};

// No link and no wait on a FIFO: docs/agents/git-and-processes.md#files
const READ = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/** The file's status and, up to `limit` bytes, its bytes, from one open file; undefined: none there; null: no file. */
export const readRegular = (path: string, limit: number): { info: Stats; bytes: Buffer | null } | null | undefined => {
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
    return { info, bytes: info.size > limit ? null : readFileSync(file) };
  } finally {
    closeSync(file);
  }
};

export const isSymlink = (path: string): boolean =>
  lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/** The temporary file of one step, next to its target: recovery finds it from the journal after a crash. */
export const tempPath = (path: string, runId: string, index: number): string =>
  join(dirname(path), `.${basename(path)}.cedarloom-${runId}-${index}`);

/** Where a step moves the file it replaces or deletes while it checks it; recovery finds it from the journal too. */
export const asidePath = (path: string, runId: string, index: number): string => `${tempPath(path, runId, index)}.old`;

const flush = (path: string, flags: string): void => {
  const fd = openSync(path, flags);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const flushFolder = (path: string): void => {
  /* v8 ignore next -- Windows cannot open a folder to flush it; NTFS journals the rename */
  if (process.platform === "win32") return;
  flush(path, "r");
};

/** Copies the file to `dest` (mode 0600) and flushes it with its folders; returns the copy's hash (null: no file), mode and whether it is UTF-8. */
export const backUp = (path: string, dest: string): { hash: string | null; mode: number; text: boolean } => {
  try {
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    copyFileSync(path, dest);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { hash: null, mode: 0, text: true };
    throw error;
  }
  chmodSync(dest, 0o600);
  flush(dest, "r+");
  flushFolder(dirname(dest));
  flushFolder(dirname(dirname(dest)));
  const bytes = readFileSync(dest);
  return { hash: sha256(bytes), mode: statSync(path).mode & 0o7777, text: isUtf8(bytes) };
};

/** Links a new file in; a file that appeared at the path meanwhile is a change, not a write error. */
const link = (temp: string, path: string): void => {
  try {
    linkSync(temp, path);
  } catch (error) {
    throw errorCode(error) === "EEXIST" ? changed() : error;
  }
};

export interface Target {
  path: string;
  /** Hash the file must still have right before the write; null: it must not exist. */
  before: string | null;
  temp: string;
}

const writeTemp = (temp: string, content: string, mode: number | undefined): void => {
  const fd = openSync(temp, "wx", mode ?? 0o666);
  try {
    writeFileSync(fd, content);
    // Exact bits, not reduced by the umask: a restored 0600 file stays 0600.
    if (mode !== undefined) fchmodSync(fd, mode);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

/**
 * Writes through a flushed temporary file: a new file is linked in (refused when one appeared meanwhile), an existing
 * one is renamed over after one last hash check. The path holds the old bytes or the new ones, never a mix. For files
 * no other process writes, such as CedarLoom's own state; a run's steps use writeStep.
 */
export const writeAtomic = ({ path, before, temp }: Target, content: string, mode: number | undefined): void => {
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeTemp(temp, content, mode);
    if (before === null) link(temp, path);
    else if (hashFile(path) === before) renameSync(temp, path);
    else throw changed();
  } finally {
    rmSync(temp, { force: true });
  }
  flushFolder(dirname(path));
};

/** Puts a file that was set aside back at its path; when another process put a file there meanwhile, both stay. */
export const putBack = (aside: string, path: string): void => {
  let linked = true;
  try {
    linkSync(aside, path);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return;
    // Without hard links (FAT) a rename puts it back, as the path is free; any other error stops there too.
    renameSync(aside, path);
    linked = false;
  }
  if (linked) unlinkSync(aside);
  flushFolder(dirname(path));
};

// Moves the target aside and checks it there; a file no longer hashing as `before` goes back.
const setAside = (path: string, aside: string, before: string): void => {
  try {
    renameSync(path, aside);
  } catch (error) {
    throw errorCode(error) === "ENOENT" ? changed() : error;
  }
  // A folder or a link put at the path since the backup is not the step's file: it goes back unread.
  const file = lstatSync(aside).isFile();
  if (file && hashFile(aside) === before) return;
  if (file) putBack(aside, path);
  else renameSync(aside, path);
  throw changed();
};

/** Without hard links (FAT) the path is free, so the rename the old protocol used puts the new file in. */
const moveIn = (temp: string, path: string, aside: string): void => {
  try {
    renameSync(temp, path);
  } catch (error) {
    putBack(aside, path);
    throw error;
  }
  unlinkSync(aside);
};

/** Puts the new file in where the old one was set aside; refused when another process put a file there meanwhile. */
const putIn = (temp: string, path: string, aside: string): void => {
  try {
    link(temp, path);
  } catch (error) {
    if (errorCode(error) !== "ECHANGED") return moveIn(temp, path, aside);
    // Theirs stays. The old bytes, checked and in the run's backup, go.
    unlinkSync(aside);
    throw error;
  }
  unlinkSync(aside);
};

// Refuses a change another process made by path: docs/agents/cedarloom-rationale.md#write-step
export const writeStep = (
  target: Target & { aside: string; real: boolean },
  content: string,
  mode: number | undefined,
  onSetAside: () => void,
): void => {
  const { path, before, temp, aside } = target;
  // Checked before the missing folders are made, which would follow a link, and again right before the write.
  // shortcut: a swap after the second check still redirects the write; open each folder by handle once Node has openat.
  const way = (): void => {
    if (target.real && !realWay(path))
      throw Object.assign(new Error(`a link on the way to ${path}`), { code: "ELOOP" });
  };
  way();
  mkdirSync(dirname(path), { recursive: true });
  way();
  try {
    writeTemp(temp, content, mode);
    if (before !== null) setAside(path, aside, before);
    onSetAside();
    if (before === null) link(temp, path);
    else putIn(temp, path, aside);
  } finally {
    rmSync(temp, { force: true });
  }
  flushFolder(dirname(path));
};

/** A run step's delete: set aside and checked like a write, then removed. */
export const remove = (path: string, before: string, aside: string, onSetAside: () => void): void => {
  setAside(path, aside, before);
  onSetAside();
  unlinkSync(aside);
  flushFolder(dirname(path));
};

/** The document a file's text holds: `document.invalid` for text that is no JSON, else as `read` decides. */
export const parseDocument = <T>(text: string, read: (json: unknown) => Result<T>): Result<T> => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      finding: { code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } },
    };
  }
  return read(json);
};

/** Reads a JSON file with its text: `document.unreadable` when it cannot be read, `document.invalid` when it is no JSON. */
export const readJson = (path: string): Result<{ text: string; json: unknown }> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, finding: { code: "document.unreadable", params: { path, error: errorCode(error) } } };
  }
  return parseDocument(text, (json) => ({ ok: true, value: { text, json } }));
};

/** `readJson` with a missing file as null: only a missing file is none, and one the process cannot read is reported. */
export const readOptionalJson = (path: string): Result<{ text: string; json: unknown } | null> => {
  const file = readJson(path);
  if (file.ok) return file;
  const missing = file.finding.code === "document.unreadable" && file.finding.params.error === "ENOENT";
  return missing ? { ok: true, value: null } : file;
};
