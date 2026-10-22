// Plans, applies and undoes changes. A change is one of:
//   { kind: 'write', path, after | from }   after null deletes, from copies a file or folder; existing content goes to the backup first
//   { kind: 'remove', path }                moves a file or folder to the backup
//   { kind: 'command', argv, cwd, undoArgv } runs an agent's own command; undoArgv reverses it when one exists
// Every change has id, step, title, and destructive (confirmed separately, off by default).
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diffLines } from './diff.mjs';
import { copy, exists, hashPath, hashText, inside, listFiles, move, readText, writeAtomic } from './fsx.mjs';
import { Ledger, SCHEMA, runId } from './ledger.mjs';

export function context({ home, config = `${home}/.config/benchkeeper`, roots = [home], appVersion = '0.0.0', run = runCommand } = {}) {
  return { home: resolve(home), config: resolve(config), roots: roots.map((r) => resolve(r)), appVersion, run, ledger: new Ledger(resolve(config), resolve(home)) };
}

export function runCommand(argv, { cwd, input, env } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, input, env: env ?? process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error ? 127 : r.status ?? 1, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : r.stderr ?? '' };
}

// Adds what the preview needs: the diff of each write, and whether a change is needed at all.
export function preview(changes) {
  return changes.map((c) => {
    if (c.kind === 'write') {
      const before = readText(c.path);
      if (c.from) return { ...c, diff: `copy ${c.from}`, noop: hashPath(c.path) === hashPath(c.from) };
      return { ...c, diff: diffLines(before, c.after, c.path), noop: before === c.after };
    }
    if (c.kind === 'remove') return { ...c, destructive: true, noop: !exists(c.path) };
    return { ...c, noop: false };
  }).filter((c) => !c.noop).map((c) => ({ selected: !c.destructive, ...c }));
}

export function apply(changes, ctx, { scope = 'global', select } = {}) {
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'apply', scope, entries: [] };
  const failedSteps = new Set();
  for (const c of changes) {
    if (select ? !select.includes(c.id) : !(c.selected ?? !c.destructive)) continue;
    const entry = { id: c.id, step: c.step, title: c.title, kind: c.kind };
    run.entries.push(entry);
    if (failedSteps.has(c.step)) { entry.status = 'skipped'; entry.reason = 'an earlier change of this step failed'; continue; }
    try {
      if (c.kind === 'command') {
        Object.assign(entry, { argv: c.argv, cwd: c.cwd, undoArgv: c.undoArgv ?? null });
        const r = ctx.run(c.argv, { cwd: c.cwd });
        entry.exit = r.code;
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `exit ${r.code}`);
      } else {
        const path = resolve(c.path);
        if (!inside(path, ctx.roots)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
        Object.assign(entry, { path, existed: exists(path), hashBefore: hashPath(path) });
        if (entry.existed) {
          entry.backup = ctx.ledger.backupPath(run.id, path);
          // A failed backup stops the step before any write.
          if (c.kind === 'remove') move(path, entry.backup);
          else {
            copy(path, entry.backup);
            if (hashPath(entry.backup) !== entry.hashBefore) throw new Error(`backup of ${path} differs from the original`);
          }
        }
        if (c.kind === 'write') {
          if (entry.existed) rmSync(path, { recursive: true, force: true });
          if (c.from) copy(c.from, path);
          else if (c.after != null) writeAtomic(path, c.after);
        }
        entry.hashAfter = hashPath(path);
        const expected = c.from ? hashPath(c.from) : hashText(c.after);
        if (c.kind === 'write' && entry.hashAfter !== expected) throw new Error(`${path} differs after writing`);
      }
      entry.status = 'done';
    } catch (e) {
      entry.status = 'failed';
      entry.error = e.message;
      failedSteps.add(c.step);
    }
    ctx.ledger.save(run);
  }
  run.status = run.entries.some((e) => e.status === 'failed') ? 'failed' : 'done';
  ctx.ledger.save(run);
  return run;
}

// Undoes a run, or one step of it, newest change first. Undo is a run of its own, so it can be undone too.
export function undo(id, ctx, { step } = {}) {
  const source = ctx.ledger.get(id);
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'undo', of: id, scope: source.scope, entries: [] };
  for (const e of [...source.entries].reverse()) {
    if (e.status !== 'done' || e.undone || (step && e.step !== step)) continue;
    const entry = { id: e.id, step: e.step, title: `undo: ${e.title}`, kind: e.kind };
    run.entries.push(entry);
    try {
      if (e.kind === 'command') {
        if (!e.undoArgv) { entry.status = 'manual'; entry.reason = `no undo command for ${e.argv.join(' ')}`; continue; }
        Object.assign(entry, { argv: e.undoArgv, cwd: e.cwd });
        const r = ctx.run(e.undoArgv, { cwd: e.cwd });
        entry.exit = r.code;
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `exit ${r.code}`);
      } else {
        if (!inside(e.path, ctx.roots)) throw new Error(`${e.path} is outside ${ctx.roots.join(', ')}`);
        Object.assign(entry, { path: e.path, existed: exists(e.path), hashBefore: hashPath(e.path) });
        // The current state goes to this run's backup, so the undo is reversible as well.
        if (entry.existed) { entry.backup = ctx.ledger.backupPath(run.id, e.path); move(e.path, entry.backup); }
        if (e.existed) copy(e.backup, e.path);
        entry.hashAfter = hashPath(e.path);
        entry.kind = 'write';
      }
      entry.status = 'done';
      e.undone = run.id;
    } catch (err) {
      entry.status = 'failed';
      entry.error = err.message;
    }
  }
  run.status = run.entries.some((x) => x.status === 'failed') ? 'failed' : 'done';
  ctx.ledger.save(run);
  ctx.ledger.save(source);
  return run;
}

// current: matches the setup; outdated: as installed, the setup has changed; modified: edited after install;
// removed: installed, now missing; foreign: present, not installed by the app; absent: neither.
export function itemState(path, desired, ctx) {
  const now = hashPath(path);
  const last = ctx.ledger.last(path);
  if (now == null) return last ? 'removed' : 'absent';
  if (now === (typeof desired === 'string' ? hashText(desired) : desired)) return 'current';
  if (!last) return 'foreign';
  return now === last.hashAfter ? 'outdated' : 'modified';
}

// Backups of setup.sh (<config>/backup/<date>/, paths below HOME) without a ledger run: copied back as a recorded run.
export function legacyBackups(ctx) {
  const runs = new Set(ctx.ledger.list().map((r) => r.id));
  let names = [];
  try { names = readdirSync(ctx.ledger.backups); } catch { return []; }
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(n) && !runs.has(n)).sort().reverse();
}

export function restoreLegacy(name, ctx) {
  if (!legacyBackups(ctx).includes(name)) throw new Error(`no setup.sh backup ${name}`);
  const dir = join(ctx.ledger.backups, name);
  const changes = listFiles(dir).map((rel, i) => ({ id: `restore-${i}`, step: 'restore', title: `restore ${rel}`, kind: 'write', path: join(ctx.home, rel), from: join(dir, rel) }));
  return apply(changes, ctx, { scope: 'global', select: changes.map((c) => c.id) });
}
