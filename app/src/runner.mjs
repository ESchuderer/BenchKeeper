// Plans, applies and undoes changes. A change is one of:
//   { kind: 'write', path, after | edit | from }   after null deletes, edit maps the current text, from copies a file or
//                                           folder; existing content goes to the backup first
//   { kind: 'remove', path }                moves a file or folder to the backup
//   { kind: 'command', argv, cwd, undoArgv } runs an agent's own command; undoArgv reverses it when one exists
// Every change has id, step, title, and destructive (confirmed separately, off by default).
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { diffLines } from './diff.mjs';
import { copy, exists, hashPath, hashText, inside, isDir, listFiles, move, readText, real, writeAtomic } from './fsx.mjs';
import { blob, fileMode } from './git.mjs';
import { Ledger, SCHEMA, runId } from './ledger.mjs';

export function context({ home, config = `${home}/.config/benchkeeper`, roots = [home], appVersion = '0.0.0', run = runCommand } = {}) {
  return { home: resolve(home), config: resolve(config), roots: roots.map((r) => resolve(r)), appVersion, run, ...(run === runCommand ? { runAsync: runCommandAsync } : {}), ledger: new Ledger(resolve(config), resolve(home)) };
}

// runCommand without blocking; onOutput gets stdout and stderr as they come, interleaved.
export function runCommandAsync(argv, { cwd, env, onOutput = () => {} } = {}) {
  return new Promise((done) => {
    let stdout = '', stderr = '';
    const p = spawn(argv[0], argv.slice(1), { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; onOutput(d); });
    p.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; onOutput(d); });
    p.on('error', (e) => done({ code: 127, stdout, stderr: e.message }));
    p.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

export function runCommand(argv, { cwd, input, env, buffer, stdio } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, input, env: env ?? process.env, stdio, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.error ? 127 : r.status ?? 1, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : String(r.stderr ?? '') };
}

// Adds what the preview needs: the diff of each write, and whether a change is needed at all.
// Edits ({ edit: text => text }) of one file build on each other in plan order.
export function preview(changes) {
  const planned = new Map();
  const current = (p) => (planned.has(p) ? planned.get(p) : readText(p));
  return changes.map((c) => {
    if (c.kind === 'write') {
      if (c.from) return { ...c, diff: `copy ${c.from}`, noop: hashPath(c.path) === hashPath(c.from) };
      const before = current(c.path);
      let after;
      try { after = c.edit ? c.edit(before) : c.after; } catch (e) { return { ...c, error: e.message, diff: '', noop: false, selected: false }; }
      planned.set(c.path, after);
      return { ...c, after, diff: diffLines(before, after, c.path), noop: before === after };
    }
    if (c.kind === 'remove') return { ...c, destructive: true, noop: !exists(c.path) };
    return { ...c, noop: false };
  }).filter((c) => !c.noop).map((c) => ({ selected: !c.destructive, ...c }));
}

// One loop for both drivers: it yields each command ({ argv, opts, entry }) for the driver to run and gets its result
// back, and yields { saved } after each change, so the async driver can let a server answer progress requests.
function* applySteps(changes, ctx, { scope = 'global', select, note } = {}) {
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'apply', scope, ...(note ? { note } : {}), entries: [] };
  yield { run };
  const failedSteps = new Set();
  for (const c of changes) {
    if (select ? !select.includes(c.id) : !(c.selected ?? !c.destructive)) continue;
    const entry = { id: c.id, step: c.step, title: c.title, kind: c.kind };
    run.entries.push(entry);
    if (failedSteps.has(c.step)) { entry.status = 'skipped'; entry.reason = 'an earlier change of this step failed'; continue; }
    try {
      if (c.kind === 'command') {
        Object.assign(entry, { argv: c.argv, cwd: c.cwd, undoArgv: c.undoArgv ?? null });
        const r = yield { argv: c.argv, opts: { cwd: c.cwd, env: c.env && { ...process.env, ...c.env } }, entry };
        entry.exit = r.code;
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `exit ${r.code}`);
      } else {
        const path = c.kind === 'write' && !c.from ? real(c.path) : resolve(c.path);
        if (!inside(path, ctx.roots)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
        Object.assign(entry, { path, existed: exists(path), hashBefore: hashPath(path) });
        // Edits apply to the file as it is now, so a deselected earlier edit is not carried along.
        const after = c.kind === 'write' && c.edit ? c.edit(readText(path)) : c.after;
        if (entry.existed) {
          entry.backup = ctx.ledger.backupPath(run.id, run.entries.length, path);
          // A failed backup stops the step before any write.
          if (c.kind === 'remove') move(path, entry.backup);
          else {
            copy(path, entry.backup);
            if (hashPath(entry.backup) !== entry.hashBefore) throw new Error(`backup of ${path} differs from the original`);
          }
        }
        // From here the original is only in the backup, so a failure is undone too.
        entry.touched = true;
        if (c.kind === 'write') {
          if (entry.existed && (c.from || isDir(path) || after == null)) rmSync(path, { recursive: true, force: true });
          if (c.from) copy(c.from, path);
          else if (after != null) writeAtomic(path, after);
        }
        entry.hashAfter = hashPath(path);
        const expected = c.from ? hashPath(c.from) : hashText(after);
        if (c.kind === 'write' && entry.hashAfter !== expected) throw new Error(`${path} differs after writing`);
      }
      entry.status = 'done';
    } catch (e) {
      entry.status = 'failed';
      entry.error = e.message;
      failedSteps.add(c.step);
    }
    ctx.ledger.save(run);
    yield { saved: entry };
  }
  run.status = run.entries.some((e) => e.status === 'failed') ? 'failed' : 'done';
  ctx.ledger.save(run);
  return run;
}

export function apply(changes, ctx, opts) {
  const g = applySteps(changes, ctx, opts);
  for (let x = g.next(); ; ) {
    if (x.done) return x.value;
    x = g.next(x.value.argv ? ctx.run(x.value.argv, x.value.opts) : undefined);
  }
}

// The same apply without blocking: commands run through ctx.runAsync (stub contexts fall back to ctx.run).
// onEvent gets { run } once, { entry, output } while a command prints, and { saved } after each change.
export async function applyAsync(changes, ctx, opts, onEvent = () => {}) {
  const g = applySteps(changes, ctx, opts);
  const runAsync = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
  for (let x = g.next(); ; ) {
    if (x.done) return x.value;
    const v = x.value;
    if (!v.argv) { onEvent(v); await new Promise(setImmediate); x = g.next(); continue; }
    x = g.next(await runAsync(v.argv, { ...v.opts, onOutput: (output) => onEvent({ entry: v.entry, output }) }));
  }
}

// Undoes a run, or one step of it, newest change first. Undo is a run of its own, so it can be undone too.
export function undo(id, ctx, { step } = {}) {
  const source = ctx.ledger.get(id);
  // Update all worked in a worktree that is gone; its result is a branch and a pull request.
  if (source.note?.updateAll) throw new Error(`run ${id} is an Update all commit on ${source.note.branch} in ${source.note.updateAll}: close its pull request or delete the branch`);
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'undo', of: id, scope: source.scope, entries: [] };
  for (const e of [...source.entries].reverse()) {
    if (!(e.status === 'done' || (e.status === 'failed' && e.touched)) || e.undone || (step && e.step !== step)) continue;
    const entry = { id: e.id, step: e.step, title: `undo: ${e.title}`, kind: e.kind };
    run.entries.push(entry);
    try {
      if (e.kind === 'session') {
        // Files the session added are removed, changed or deleted ones come back from the snapshot before it.
        entry.files = [];
        for (const f of e.files) {
          const path = join(e.cwd, f.path);
          if (!inside(path, ctx.roots)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
          const backup = exists(path) ? ctx.ledger.backupPath(run.id, run.entries.length, path) : null;
          if (backup) copy(path, backup);
          const content = f.status === 'A' ? null : blob(ctx, e.cwd, e.before, f.path);
          if (content == null) rmSync(path, { force: true });
          else writeAtomic(path, content, fileMode(ctx, e.cwd, e.before, f.path) === '100755' ? 0o755 : undefined);
          entry.files.push({ path, backup });
        }
        entry.kind = 'restore';
      } else if (e.kind === 'restore') {
        // Undo of a session undo: the files go back to their state from that run's backups.
        entry.files = [];
        for (const f of e.files) {
          const backup = exists(f.path) ? ctx.ledger.backupPath(run.id, run.entries.length, f.path) : null;
          if (backup) move(f.path, backup);
          if (f.backup) copy(f.backup, f.path);
          entry.files.push({ path: f.path, backup });
        }
        entry.kind = 'restore';
      } else if (e.kind === 'command') {
        if (!e.undoArgv) { entry.status = 'manual'; entry.reason = `no undo command for ${e.argv.join(' ')}`; continue; }
        Object.assign(entry, { argv: e.undoArgv, cwd: e.cwd });
        const r = ctx.run(e.undoArgv, { cwd: e.cwd });
        entry.exit = r.code;
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `exit ${r.code}`);
      } else {
        if (!inside(e.path, ctx.roots)) throw new Error(`${e.path} is outside ${ctx.roots.join(', ')}`);
        // Only a file as the run left it goes back, so a later change (another step's, or the user's) is not lost.
        // A whole run is undone newest first, so its own later edits of the file are undone before.
        if (e.status === 'done' && hashPath(e.path) !== e.hashAfter) throw new Error(`${e.path} changed after this change: undo what changed it later first`);
        if (e.existed && hashPath(e.backup) !== e.hashBefore) throw new Error(`the backup ${e.backup} is missing or changed`);
        Object.assign(entry, { path: e.path, existed: exists(e.path), hashBefore: hashPath(e.path) });
        // The current state goes to this run's backup, so the undo is reversible as well.
        if (entry.existed) { entry.backup = ctx.ledger.backupPath(run.id, run.entries.length, e.path); move(e.path, entry.backup); entry.touched = true; }
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
  const now = hashPath(real(path));
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
