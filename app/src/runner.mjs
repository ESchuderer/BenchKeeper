// Plans, applies and undoes changes. A change is one of:
//   { kind: 'write', path, after | edit | from }   after null deletes, edit maps the current text, from copies a file or
//                                           folder; existing content goes to the backup first
//   { kind: 'remove', path }                moves a file or folder to the backup
//   { kind: 'command', argv, cwd, undoArgv } runs an agent's own command; undoArgv reverses it when one exists
// Every change has id, step, title, and destructive (confirmed separately, off by default).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { diffLines } from './diff.mjs';
import { copy, exists, hashPath, hashText, inside, isDir, listFiles, move, readText, real, writeAtomic } from './fsx.mjs';
import { blob, fileMode } from './git.mjs';
import { Ledger, SCHEMA, runId } from './ledger.mjs';

export function context({ home, config = `${home}/.config/benchkeeper`, roots = [home], appVersion = '0.0.0', run = runCommand } = {}) {
  return { home: resolve(home), config: resolve(config), roots: roots.map((r) => resolve(r)), appVersion, run, ...(run === runCommand ? { runAsync: runCommandAsync } : {}), ledger: new Ledger(resolve(config), resolve(home)) };
}

// runCommand without blocking; onOutput gets stdout and stderr as they come, interleaved. Each keeps its last 64 kB,
// and a command still running after timeout ms is stopped and fails.
export function runCommandAsync(argv, { cwd, env, onOutput = () => {}, timeout = 15 * 60e3 } = {}) {
  return new Promise((done) => {
    let stdout = '', stderr = '';
    const tail = (t) => t.slice(-65536);
    const p = spawn(argv[0], argv.slice(1), { cwd, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], timeout, killSignal: 'SIGTERM' });
    p.stdout.setEncoding('utf8').on('data', (d) => { stdout = tail(stdout + d); onOutput(d); });
    p.stderr.setEncoding('utf8').on('data', (d) => { stderr = tail(stderr + d); onOutput(d); });
    p.on('error', (e) => done({ code: 127, stdout, stderr: e.message }));
    p.on('close', (code, signal) => done(signal ? { code: 124, stdout, stderr: `${stderr}\nstopped after ${timeout / 60e3} minutes (${signal})` } : { code: code ?? 1, stdout, stderr }));
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
  }).filter((c) => !c.noop).map((c) => ({ selected: !c.destructive, ...c }))
    // A unit with a change that cannot be made is not selected at all.
    .map((c, _, all) => (c.error || (c.unit && all.some((x) => x.unit === c.unit && x.error)) ? { ...c, selected: false } : c));
}

// One loop for both drivers: it yields each command ({ argv, opts, entry }) for the driver to run and gets its result
// back, and yields { saved } after each change, so the async driver can let a server answer progress requests.
function* applySteps(changes, ctx, { scope = 'global', select, note } = {}) {
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'apply', scope, ...(note ? { note } : {}), entries: [] };
  // Changes of one unit (a copy and the removal of its source, a marketplace and its plugin) go together or not at all.
  // A change that cannot be made (c.error) is never applied.
  const picked = (c) => !c.error && (select ? select.includes(c.id) : (c.selected ?? !c.destructive));
  for (const c of changes) {
    const unit = c.unit && changes.filter((x) => x.unit === c.unit);
    if (unit && unit.some(picked) && !unit.every(picked)) throw new Error(`${unit.map((x) => x.title).join(' and ')} go together: choose all of them or none`);
  }
  yield { run };
  const failedSteps = new Set();
  for (const c of changes) {
    if (!picked(c)) continue;
    const entry = { id: c.id, step: c.step, title: c.title, kind: c.kind };
    run.entries.push(entry);
    if (failedSteps.has(c.step)) { entry.status = 'skipped'; entry.reason = 'an earlier change of this step failed'; continue; }
    try {
      if (c.kind === 'command') {
        // Journaled before it starts: a command cut off by a crash shows in history and can be undone.
        Object.assign(entry, { argv: c.argv, cwd: c.cwd, undoArgv: c.undoArgv ?? null, status: 'running', touched: true });
        // Paths the command changes (skill folders, a lockfile) are copied first; undo puts these copies back.
        if (c.snapshot) {
          entry.snapshot = c.snapshot.map((p, i) => {
            const path = resolve(p);
            if (!inside(path, ctx.roots)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
            return { path, existed: exists(path), hashBefore: hashPath(path), backup: exists(path) ? ctx.ledger.backupPath(run.id, `${run.entries.length}-${i}`, path) : null };
          });
          ctx.ledger.save(run);
          for (const x of entry.snapshot) if (x.backup) { copy(x.path, x.backup); if (hashPath(x.backup) !== x.hashBefore) throw new Error(`backup of ${x.path} differs from the original`); }
        }
        ctx.ledger.save(run);
        const r = yield { argv: c.argv, opts: { cwd: c.cwd, env: c.env && { ...process.env, ...c.env } }, entry };
        // Ended with an exit code: undone only when it succeeded, as before the journal.
        entry.exit = r.code;
        delete entry.touched;
        for (const x of entry.snapshot ?? []) x.hashAfter = hashPath(x.path);
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `exit ${r.code}`);
      } else {
        const path = c.kind === 'write' && !c.from ? real(c.path) : resolve(c.path);
        if (!inside(path, ctx.roots)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
        Object.assign(entry, { path, existed: exists(path), hashBefore: hashPath(path) });
        // Edits apply to the file as it is now, so a deselected earlier edit is not carried along.
        // edit also gets the run so far, so a change can depend on how earlier ones went.
        const after = c.kind === 'write' && c.edit ? c.edit(readText(path), run) : c.after;
        if (entry.existed) entry.backup = ctx.ledger.backupPath(run.id, run.entries.length, path);
        // Journaled before the first change: after a crash undo finds the backup (or refuses a missing one).
        Object.assign(entry, { status: 'running', touched: true });
        ctx.ledger.save(run);
        if (entry.existed) {
          // A failed backup stops the step before any write.
          if (c.kind === 'remove') move(path, entry.backup);
          else {
            copy(path, entry.backup);
            if (hashPath(entry.backup) !== entry.hashBefore) throw new Error(`backup of ${path} differs from the original`);
          }
        }
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

// Hash of a path as a git tree holds it (hashPath's form), or null when the tree does not have it.
function treeHash(ctx, root, tree, path) {
  const mode = fileMode(ctx, root, tree, path);
  if (!mode) return null;
  const content = blob(ctx, root, tree, path);
  return hashText(mode === '120000' ? `link:${content.toString()}` : content);
}

// Puts a path back as a git tree holds it: a file with its mode, a link, or nothing.
function restoreFromTree(ctx, root, tree, rel, path) {
  const mode = fileMode(ctx, root, tree, rel);
  rmSync(path, { recursive: true, force: true });
  if (!mode) return;
  const content = blob(ctx, root, tree, rel);
  if (mode === '120000') { mkdirSync(dirname(path), { recursive: true }); symlinkSync(content.toString(), path); } else writeAtomic(path, content, mode === '100755' ? 0o755 : 0o644);
}

const doneOrTouched = (e) => e.status === 'done' || ((e.status === 'failed' || e.status === 'running') && e.touched);

// Undoes a run, or one step of it, newest change first. Undo is a run of its own, so it can be undone too.
// Each entry is checked before it changes anything, journaled before the first change, and saved when it ends.
export function undo(id, ctx, { step } = {}) {
  const source = ctx.ledger.get(id);
  // Update all worked in a worktree that is gone; its result is a branch and a pull request.
  if (source.note?.updateAll) throw new Error(`run ${id} is an Update all commit on ${source.note.branch} in ${source.note.updateAll}: close its pull request or delete the branch`);
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'undo', of: id, scope: source.scope, entries: [] };
  const save = () => { ctx.ledger.save(run); ctx.ledger.save(source); };
  const begin = (entry) => { Object.assign(entry, { status: 'running', touched: true }); save(); };
  const within = (path) => { if (!inside(path, ctx.roots)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`); };
  for (const e of [...source.entries].reverse()) {
    if (!doneOrTouched(e) || e.undone || (step && e.step !== step)) continue;
    const entry = { id: e.id, step: e.step, title: `undo: ${e.title}`, kind: e.kind };
    run.entries.push(entry);
    try {
      if (e.kind === 'session') {
        // Files the session added are removed, changed or deleted ones come back from the snapshot before it, each
        // only while it is as the session left it.
        const files = e.files.map((f) => ({ f, path: join(e.cwd, f.path) }));
        for (const { f, path } of files) {
          within(path);
          if (hashPath(path) !== treeHash(ctx, e.cwd, e.after, f.path)) throw new Error(`${path} changed after the session: undo what changed it later first`);
        }
        Object.assign(entry, { kind: 'restore', files: [] });
        begin(entry);
        for (const { f, path } of files) {
          const backup = exists(path) ? ctx.ledger.backupPath(run.id, run.entries.length, path) : null;
          const rec = { path, backup };
          entry.files.push(rec);
          if (backup) { copy(path, backup); rec.hashBackup = hashPath(backup); if (rec.hashBackup !== hashPath(path)) throw new Error(`backup of ${path} differs from the original`); }
          restoreFromTree(ctx, e.cwd, e.before, f.path, path);
          rec.hashAfter = hashPath(path);
        }
      } else if (e.kind === 'restore') {
        // Undo of a session undo: the files go back to that run's backups, while they are as it left them.
        for (const f of e.files) {
          within(f.path);
          if (e.status === 'done' ? !('hashAfter' in f) || hashPath(f.path) !== f.hashAfter : false) throw new Error(`${f.path} changed after this change: undo what changed it later first`);
          if (f.backup && (!('hashBackup' in f) || hashPath(f.backup) !== f.hashBackup)) throw new Error(`the backup ${f.backup} is missing or changed`);
        }
        Object.assign(entry, { kind: 'restore', files: [] });
        begin(entry);
        for (const f of e.files) {
          const backup = exists(f.path) ? ctx.ledger.backupPath(run.id, run.entries.length, f.path) : null;
          const rec = { path: f.path, backup };
          entry.files.push(rec);
          if (backup) { move(f.path, backup); rec.hashBackup = hashPath(backup); }
          if (f.backup) copy(f.backup, f.path);
          rec.hashAfter = hashPath(f.path);
        }
      } else if (e.kind === 'command' && e.snapshot) {
        // The paths come back from the copies taken before the command, while they are as it left them.
        for (const x of e.snapshot) {
          within(x.path);
          if (e.status === 'done' && hashPath(x.path) !== x.hashAfter) throw new Error(`${x.path} changed after this change: undo what changed it later first`);
          if (x.existed && hashPath(x.backup) !== x.hashBefore) throw new Error(`the backup ${x.backup} is missing or changed`);
        }
        Object.assign(entry, { kind: 'restore', files: [] });
        begin(entry);
        for (const x of e.snapshot) {
          const backup = exists(x.path) ? ctx.ledger.backupPath(run.id, `${run.entries.length}-${entry.files.length}`, x.path) : null;
          const rec = { path: x.path, backup };
          entry.files.push(rec);
          if (backup) { move(x.path, backup); rec.hashBackup = hashPath(backup); }
          if (x.existed) copy(x.backup, x.path);
          rec.hashAfter = hashPath(x.path);
        }
      } else if (e.kind === 'command') {
        if (!e.undoArgv) { entry.status = 'manual'; entry.reason = `no undo command for ${e.argv.join(' ')}`; continue; }
        Object.assign(entry, { argv: e.undoArgv, cwd: e.cwd });
        begin(entry);
        const r = ctx.run(e.undoArgv, { cwd: e.cwd });
        entry.exit = r.code;
        if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `exit ${r.code}`);
      } else {
        within(e.path);
        // Only a file as the run left it goes back, so a later change (another step's, or the user's) is not lost.
        // A whole run is undone newest first, so its own later edits of the file are undone before.
        if (e.status === 'done' && hashPath(e.path) !== e.hashAfter) throw new Error(`${e.path} changed after this change: undo what changed it later first`);
        if (e.existed && hashPath(e.backup) !== e.hashBefore) throw new Error(`the backup ${e.backup} is missing or changed`);
        Object.assign(entry, { kind: 'write', path: e.path, existed: exists(e.path), hashBefore: hashPath(e.path) });
        // The current state goes to this run's backup, so the undo is reversible as well.
        if (entry.existed) entry.backup = ctx.ledger.backupPath(run.id, run.entries.length, e.path);
        begin(entry);
        if (entry.existed) move(e.path, entry.backup);
        if (e.existed) copy(e.backup, e.path);
        entry.hashAfter = hashPath(e.path);
      }
      entry.status = 'done';
      e.undone = run.id;
    } catch (err) {
      entry.status = 'failed';
      entry.error = err.message;
    }
    save();
  }
  run.status = run.entries.some((x) => x.status === 'failed') ? 'failed' : 'done';
  save();
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
