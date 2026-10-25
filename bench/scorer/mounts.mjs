// The paths a scorer script takes on its command line are those of its container, or in tests folders of the temp folder.
// The argument only selects one of the allowed paths, it is never used as a path itself.
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function choose(arg, allowed) {
  const hit = typeof arg === 'string' ? allowed.find((a) => a === resolve(arg)) : undefined;
  if (!hit) throw new Error(`not one of ${allowed.slice(0, 3).join(', ')}`);
  return hit;
}

export const tempFolders = () => readdirSync(tmpdir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(tmpdir(), e.name));

export const appFolder = (arg) => choose(arg, [resolve('/app'), ...tempFolders()]);
