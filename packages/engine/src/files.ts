import { isUtf8 } from "node:buffer";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { sha256 } from "@cedarloom/ledger";

export const errorCode = (error: unknown): string =>
  error instanceof Error && "code" in error ? String(error.code) : String(error);

const changed = (): Error => Object.assign(new Error("the file changed during the write"), { code: "ECHANGED" });

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

export const isSymlink = (path: string): boolean =>
  lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

/** The temporary file of one step, next to its target: recovery finds it from the journal after a crash. */
export const tempPath = (path: string, runId: string, index: number): string =>
  join(dirname(path), `.${basename(path)}.cedarloom-${runId}-${index}`);

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

/**
 * Writes through a flushed temporary file: a new file is linked in (refused when one appeared meanwhile), an existing
 * one is renamed over after one last hash check. The path holds the old bytes or the new ones, never a mix.
 */
export const writeAtomic = ({ path, before, temp }: Target, content: string, mode: number | undefined): void => {
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(temp, "wx", mode ?? 0o666);
    try {
      writeFileSync(fd, content);
      // Exact bits, not reduced by the umask: a restored 0600 file stays 0600.
      if (mode !== undefined) fchmodSync(fd, mode);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (before === null) link(temp, path);
    else if (hashFile(path) === before) renameSync(temp, path);
    else throw changed();
  } finally {
    rmSync(temp, { force: true });
  }
  flushFolder(dirname(path));
};

export const remove = (path: string, before: string): void => {
  if (hashFile(path) !== before) throw changed();
  unlinkSync(path);
  flushFolder(dirname(path));
};
