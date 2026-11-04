import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  fchmodSync,
  fsyncSync,
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

const syncFile = (path: string): void => {
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

const syncFolder = (path: string): void => {
  /* v8 ignore next -- Windows cannot open a folder to flush it; NTFS journals the rename */
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};

/** Copies the file to `dest` (mode 0600) and flushes it; returns the hash of the copy (null: no file) and the file's mode. */
export const backUp = (path: string, dest: string): { hash: string | null; mode: number } => {
  try {
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    copyFileSync(path, dest);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { hash: null, mode: 0 };
    throw error;
  }
  chmodSync(dest, 0o600);
  syncFile(dest);
  return { hash: hashFile(dest), mode: statSync(path).mode & 0o777 };
};

/** Writes through a flushed temporary file and a rename: the path holds the old bytes or the new ones, never a mix. */
export const writeAtomic = (path: string, content: string, mode: number | undefined): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.cedarloom`);
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
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  syncFolder(dirname(path));
};

export const remove = (path: string): void => {
  unlinkSync(path);
  syncFolder(dirname(path));
};
