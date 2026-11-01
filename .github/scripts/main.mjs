// True when the module at `url` is the script Node was started with. Node resolves symlinks for import.meta.url but keeps
// process.argv[1] as typed, so both sides are compared as real paths: a script started through a symlinked folder
// (the macOS temporary folder, for one) still runs its command-line part.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(url) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}
