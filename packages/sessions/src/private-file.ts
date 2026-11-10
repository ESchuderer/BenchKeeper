import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes a JSON value for this user only (0600 in a 0700 folder), flushed and renamed into place, so no reader sees
 * half a file; one that cannot be written is tried again at the next read.
 */
export const writePrivate = (file: string, value: unknown): void => {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flush: true });
    renameSync(temp, file);
  } catch {
    try {
      rmSync(temp, { force: true });
    } catch {
      // A temp file Windows still locks is left behind: the write never throws.
    }
  }
};
