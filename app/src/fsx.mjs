import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const exists = (p) => existsSync(p) || isLink(p);
export const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
export const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
export const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
// A folder's entries; none when it cannot be read (missing, a dangling link, an unmounted drive).
export const listDir = (d) => { try { return readdirSync(d); } catch { return []; } };

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

// Calls visit(entry, path) for each entry under dir that is not a folder to go into: folders are entered depth levels
// down. An unreadable folder is skipped.
export function walkDir(dir, depth, visit) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory() && depth > 0) walkDir(p, depth - 1, visit);
    else visit(e, p);
  }
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
    // On disk before it replaces the file: a power loss must not leave the ledger or a settings file empty.
    const fd = openSync(tmp, 'r+'); // Windows fsync needs write access
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, p);
  } catch (e) { rmSync(tmp, { force: true }); throw e; }
}

// Moves a file or folder, across devices too.
export function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  try { renameSync(from, to); } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    // Across devices the source goes only after the copy hashes as the source did.
    const before = hashPath(from);
    cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    if (hashPath(to) !== before) { rmSync(to, { recursive: true, force: true }); throw new Error(`the copy of ${from} differs from the original`); }
    rmSync(from, { recursive: true, force: true });
  }
}

// A new path is written beside it and renamed in: a failed or interrupted copy never leaves a half-written file or folder
// that looks complete. shortcut: onto an existing path (a link that writes go through, a folder that is merged) it writes in place.
export function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  const into = exists(to) ? to : `${to}.benchkeeper-${randomBytes(6).toString('hex')}`;
  try {
    // cpSync follows a top-level link, which fails for a dangling one.
    if (isLink(from)) symlinkSync(readlinkSync(from), into);
    else cpSync(from, into, { recursive: true, verbatimSymlinks: true });
    if (into !== to) renameSync(into, to);
  } catch (e) { if (into !== to) rmSync(into, { recursive: true, force: true }); throw e; }
}

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

// True when p, after resolving the links of its existing ancestors, lies inside one of the roots.
export function inside(p, roots, follow = true) {
  const real = realish(p, follow);
  return roots.some((r) => {
    const root = realish(r);
    return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
  });
}
