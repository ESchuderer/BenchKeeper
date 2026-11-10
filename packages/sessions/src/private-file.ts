import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Writes text or bytes for this user only (0600; a folder it creates gets 0700), flushed and renamed into place, so no
 * reader sees half a file, and says whether it wrote; one that cannot be written is tried again at the next read.
 */
export const writePrivate = (file: string, data: string | Uint8Array): boolean => {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(temp, data, { mode: 0o600, flush: true });
    renameSync(temp, file);
    return true;
  } catch {
    try {
      rmSync(temp, { force: true });
    } catch {
      // A temp file Windows still locks is left behind: the write never throws.
    }
    return false;
  }
};
