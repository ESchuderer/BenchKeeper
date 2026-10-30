// Dev containers by their workspace label: the doctor's counts and the user key quota each running container draws on, and
// benchkeeper containers reconcile, which removes the containers of folders in the home folder that no longer exist. Linux only.
import { lstatSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { inside, readText } from './fsx.mjs';

const LABEL = 'devcontainer.local_folder';
// A hung engine must not hang doctor or the UI; reconcile runs unattended and may wait longer (hundreds of containers take minutes).
const DOCTOR = 30e3, RECONCILE = 5 * 60e3, VERSION = 5e3;
const KEY_WARN = 0.8;

export const containerEngine = (ctx) => ['podman', 'docker'].find((e) => ctx.run([e, '--version'], { timeout: VERSION }).code === 0);

// [{ id, running, folder }] of every container, folder '' without the workspace label; null when the engine cannot list them.
function listContainers(ctx, engine, timeout = DOCTOR) {
  const ps = ctx.run([engine, 'ps', '-a', '-q'], { timeout });
  if (ps.code !== 0) return null;
  const ids = ps.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return [];
  // shortcut: a container removed between ps and inspect fails the whole list, the next run reads it again.
  // The label as JSON: a folder name may hold a tab or a line break. Podman refuses a format that starts with {{json.
  const r = ctx.run([engine, 'container', 'inspect', '--format', `{{.Id}}\t{{.State.Running}}\t{{json (index .Config.Labels "${LABEL}")}}`, ...ids], { timeout });
  if (r.code !== 0) return null;
  try {
    return r.stdout.split('\n').filter((l) => l.trim()).map((l) => {
      const [id, running, folder] = l.split('\t');
      return { id, running: running === 'true', folder: JSON.parse(folder) ?? '' };
    }).filter((c) => ids.some((s) => c.id.startsWith(s)));
  } catch { return null; }
}

// true only when lstat says the path does not exist; null when it cannot tell (permission denied, an I/O error).
const missing = (p) => { try { lstatSync(p); return false; } catch (e) { return e.code === 'ENOENT' ? true : null; } };
// Only an absolute folder inside the home folder is checked: another label may name a folder of another user, of another
// system (a Windows path) or of a remote engine's host.
const checkable = (c, home) => isAbsolute(c.folder) && inside(c.folder, [home]);
// The folder is gone but its parent is there: a removed worktree. A parent that is gone too may be an unmounted drive.
const orphaned = (home) => (c) => Boolean(c.folder) && checkable(c, home) && missing(c.folder) === true && missing(dirname(c.folder)) === false;
const unchecked = (home) => (c) => Boolean(c.folder) && (!checkable(c, home) || missing(c.folder) === null);

// Keys the user holds and the per-user maximum, from /proc/key-users (uid: usage nkeys/nikeys qnkeys/maxkeys ...) and
// kernel.keys.maxkeys; null when either cannot be read.
export function keyQuota(proc = '/proc', uid = process.getuid?.()) {
  const line = (readText(join(proc, 'key-users')) ?? '').split('\n').find((l) => l.trim().startsWith(`${uid}:`));
  const used = Number(line?.trim().split(/\s+/)[3]?.split('/')[0]);
  const max = Number(readText(join(proc, 'sys/kernel/keys/maxkeys'))?.trim());
  return Number.isInteger(used) && max > 0 ? { used, max } : null;
}

const issue = (level, message, fix) => ({ level, check: 'containers', message, fix });
const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Counts only, no container names or folders in the text.
export function containerChecks(ctx, engine, { platform = process.platform, proc = '/proc' } = {}) {
  if (platform !== 'linux') return [issue('info', `the dev container check is skipped: it reads Linux /proc files, this system is ${platform}`, 'nothing to do')];
  const out = [];
  const list = listContainers(ctx, engine);
  if (!list) out.push(issue('info', `${engine} cannot list the containers, so orphaned ones are not counted`, `run ${engine} ps -a to see why`));
  else {
    const gone = orphaned(ctx.home), orphans = list.filter(gone), running = orphans.filter((c) => c.running).length;
    const idle = list.filter((c) => c.folder && !c.running && !gone(c)).length, unlabelled = list.filter((c) => !c.folder).length;
    const notChecked = list.filter(unchecked(ctx.home)).length;
    if (orphans.length) out.push(issue('warning', `${n(orphans.length, 'dev container')} of folders that no longer exist (${running} running)`, 'benchkeeper containers reconcile removes them (--dry-run lists them)'));
    if (idle) out.push(issue('info', `${n(idle, 'dev container')} stopped but not removed`, `remove the ones of finished worktrees with ${engine} rm`));
    if (notChecked) out.push(issue('info', `${n(notChecked, 'dev container')} whose folder could not be checked (outside the home folder, not a path of this system or not readable), which reconcile leaves alone`, `check them with ${engine} ps -a`));
    if (unlabelled) out.push(issue('info', `${n(unlabelled, 'container')} without a dev container workspace label, which reconcile leaves alone`, `check them with ${engine} ps -a`));
  }
  const keys = keyQuota(proc);
  if (keys && keys.used >= keys.max * KEY_WARN) out.push(issue('warning', `user key quota: ${keys.used} of ${keys.max} keys used (warning from ${KEY_WARN * 100} percent); each running container holds keys and new ones fail at the limit`, 'benchkeeper containers reconcile, then stop containers you do not need, or raise kernel.keys.maxkeys'));
  return out;
}

// The orphaned containers with removed: true or false, or removed undefined for a dry run. engine rm -f stops and removes
// a container and keeps its volumes. Throws when the engine cannot list the containers.
export function reconcile(ctx, engine, { dryRun = false } = {}) {
  const list = listContainers(ctx, engine, RECONCILE);
  if (!list) throw new Error(`${engine} cannot list the containers: run ${engine} ps -a to see why`);
  // Checked again right before each removal: a folder may be back by then.
  const gone = orphaned(ctx.home);
  return list.filter(gone).map((c) => (dryRun ? c : { ...c, removed: gone(c) && ctx.run([engine, 'rm', '-f', c.id], { timeout: RECONCILE }).code === 0 }));
}
