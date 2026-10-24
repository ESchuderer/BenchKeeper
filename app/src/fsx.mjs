import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const exists = (p) => existsSync(p) || isLink(p);
export const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
export const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

// Hash of a file, or of a folder's relative paths and file contents; null when missing.
export function hashPath(p) {
  if (!exists(p)) return null;
  const h = createHash('sha256');
  if (isDir(p) && !isLink(p)) {
    for (const f of listFiles(p)) h.update(`${f}\0`).update(isLink(join(p, f)) ? `link:${readlinkSync(join(p, f))}` : readFileSync(join(p, f))).update('\0');
  } else h.update(isLink(p) ? `link:${readlinkSync(p)}` : readFileSync(p));
  return h.digest('hex');
}
export const hashText = (t) => (t == null ? null : createHash('sha256').update(t).digest('hex'));

export function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [relative(base, p)];
  });
}

// A link to a file stands for that file: writes go through it, so a dotfiles link stays a link.
export const real = (p) => (isLink(p) && existsSync(p) && !isDir(p) ? realpathSync(p) : resolve(p));

// Replaces a file in one rename and keeps the mode of the file it replaces.
export function writeAtomic(p, text, mode = existsSync(p) ? statSync(p).mode & 0o7777 : null) {
  mkdirSync(dirname(p), { recursive: true });
  // Random and created new (wx): a link planted at a guessable name must not be written through.
  const tmp = `${p}.benchkeeper-${randomBytes(6).toString('hex')}`;
  // The mode at creation: a settings file with tokens is never readable by others, not even before the chmod.
  writeFileSync(tmp, text, { flag: 'wx', ...(mode != null ? { mode } : {}) });
  try {
    if (mode != null) chmodSync(tmp, mode);
    renameSync(tmp, p);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

// Moves a file or folder, across devices too.
export function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    rmSync(from, { recursive: true, force: true });
  }
}

export function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  // cpSync follows a top-level link, which fails for a dangling one.
  if (isLink(from)) symlinkSync(readlinkSync(from), to);
  else cpSync(from, to, { recursive: true, verbatimSymlinks: true });
}

// True when p, after resolving the links of its existing ancestors, lies inside one of the roots.
// A path with its links resolved as far as it exists (macOS: /var is /private/var).
// follow false: a link as the last part of p stands for itself (removing it leaves its target alone).
export function realish(p, follow = true) {
  let probe = resolve(p), hops = 0;
  if (!follow && isLink(probe)) return join(realish(dirname(probe)), basename(probe));
  const rest = [];
  while (!existsSync(probe)) {
    // A dangling link stands for its target: a write through it creates the target.
    if (isLink(probe)) { if (++hops > 40) throw new Error(`too many links: ${p}`); probe = resolve(realish(dirname(probe)), readlinkSync(probe)); continue; }
    rest.unshift(probe.split(sep).pop());
    probe = dirname(probe);
  }
  return join(realpathSync(probe), ...rest);
}

export function inside(p, roots, follow = true) {
  const real = realish(p, follow);
  return roots.some((r) => {
    const root = realish(r);
    return real === root || real.startsWith(root + sep);
  });
}
