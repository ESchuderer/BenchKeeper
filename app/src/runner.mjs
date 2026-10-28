// Plans, applies and undoes changes. A change is one of:
//   { kind: 'write', path, after | edit | from }   after null deletes, edit maps the current text, from copies a file or
//                                           folder; existing content goes to the backup first
//   { kind: 'remove', path }                moves a file or folder to the backup
//   { kind: 'command', argv, cwd, undoArgv } runs an agent's own command; undoArgv reverses it when one exists
// Every change has id, step, title, and destructive (confirmed separately, off by default).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { childEnv } from './childenv.mjs';
import { diffLines } from './diff.mjs';
import { copy, exists, hashPath, hashText, inside, isDir, listFiles, move, readText, real, writeAtomic } from './fsx.mjs';
import { blob, fileMode, hasTree } from './git.mjs';
import { Ledger, SCHEMA, runId } from './ledger.mjs';
import { mask } from './redact.mjs';

// New files that agents fill with tokens later are created for their user alone.
const PRIVATE_NEW = /[\\/]\.(claude|codex|gemini|copilot)[\\/](settings(\.local)?\.json|config\.(toml|json)|hooks\.json)$|[\\/]\.claude\.json$/;
// A Windows system tool by its full path, so the PATH search does not decide which program runs.
export const windowsTool = (...parts) => join(process.env.SystemRoot ?? 'C:\\Windows', ...parts);
// The last lines of a failed command's output, as stored in the ledger and shown: tokens masked.
const failure = (r, lines = 3) => mask((r.stderr || r.stdout || '').trim().split('\n').slice(-lines).join(' ')) || `exit ${r.code}`;

// The undo commands plans produce: the plugin and marketplace commands of the two agents, with a plain name. A ledger file
// that names anything else is not run (the ledger is a file the user's other processes can write).
const NAME = /^[A-Za-z0-9][\w.@:-]*$/;
const UNDO_FORMS = [['claude', 'plugin', 'uninstall'], ['claude', 'plugin', 'install'], ['claude', 'plugin', 'marketplace', 'remove'], ['codex', 'plugin', 'remove'], ['codex', 'plugin', 'add'], ['codex', 'plugin', 'marketplace', 'remove']];
// Claude Code's plugin install and uninstall also take a scope that stays inside the project (a framework install): never user.
const PROJECT_SCOPES = ['project', 'local'];
const named = (argv, f) => f.every((x, i) => argv[i] === x) && NAME.test(argv[f.length]);
export const undoable = (argv) => Array.isArray(argv) && UNDO_FORMS.some((f) => (argv.length === f.length + 1 && named(argv, f))
  || (f.length === 3 && f[0] === 'claude' && argv.length === 6 && argv[4] === '--scope' && PROJECT_SCOPES.includes(argv[5]) && named(argv, f)));

// A path a run may change: inside a root, and not inside ctx.deny unless that root itself lies in the denied folder
// (a project's .git is denied, its info/exclude list is a root of its own).
export const allowed = (path, ctx, follow = true) => ctx.roots.some((r) => inside(path, [r], follow) && !(ctx.deny ?? []).some((d) => inside(path, [d], follow) && !inside(r, [d])));

export function context({ home, config = `${home}/.config/benchkeeper`, roots = [home], appVersion = '0.0.0', run = runCommand } = {}) {
  return { home: resolve(home), config: resolve(config), roots: roots.map((r) => resolve(r)), appVersion, run, ...(run === runCommand ? { runAsync: runCommandAsync } : {}), ledger: new Ledger(resolve(config), resolve(home)) };
}

// runCommand without blocking; onOutput gets stdout and stderr as they come, interleaved. Each keeps its last keep
// characters. onStart(stdin) gives the command a pipe as its input (a sign-in that asks for a pasted code). A command
// still running after timeout ms, or when signal aborts, gets SIGTERM, grace ms later SIGKILL, and fails.
// Agents start helpers that outlive their parent, so each command runs in a process group of its own and a stop reaches
// the whole group. Groups still running when the app ends are killed: Ctrl+C no longer reaches them through the terminal.
const groups = new Set();
const ownGroup = process.platform !== 'win32';
const signalTree = (p, sig) => {
  try {
    if (ownGroup) process.kill(-p.pid, sig);
    else if (sig === 'SIGKILL') spawnSync(windowsTool('System32', 'taskkill.exe'), ['/pid', String(p.pid), '/T', '/F']);
    else p.kill(sig);
  } catch { /* already gone */ }
};
let handlers = false;
const watchExit = () => {
  if (handlers) return;
  handlers = true;
  process.on('exit', () => { for (const p of groups) signalTree(p, 'SIGKILL'); });
  for (const [sig, n] of [['SIGINT', 2], ['SIGTERM', 15], ['SIGHUP', 1]]) process.once(sig, () => process.exit(128 + n));
};

export function runCommandAsync(argv, { cwd, env, onOutput = () => {}, onStart, timeout = 15 * 60e3, keep = 65536, grace = 10e3, signal } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', timedOut = false, settled = false, cancelled = false;
    const done = (r) => { if (!settled) { settled = true; groups.delete(p); clearTimeout(term); clearTimeout(kill); signal?.removeEventListener('abort', stop); resolve(r); } };
    const tail = (t) => t.slice(-keep);
    const p = spawn(argv[0], argv.slice(1), { cwd, env: env ?? process.env, stdio: [onStart ? 'pipe' : 'ignore', 'pipe', 'pipe'], detached: ownGroup });
    if (p.pid) { groups.add(p); watchExit(); }
    // A command that ends first closes the pipe: a late write must not throw.
    if (onStart) { p.stdin.on('error', () => {}); onStart(p.stdin); }
    const stopped = () => (cancelled ? { code: 130, stdout, stderr: `${stderr}\ncancelled` } : { code: 124, stdout, stderr: `${stderr}\nstopped after ${timeout / 60e3} minutes` });
    let kill;
    const stop = () => {
      if (timedOut) return;
      timedOut = true;
      // What stopped it first names the result: a cancel during a timeout's grace period stays a timeout.
      cancelled = !!signal?.aborted;
      signalTree(p, 'SIGTERM');
      // A child that ignores SIGTERM, or grandchildren that hold the pipes open, must not keep the job running.
      kill = setTimeout(() => { signalTree(p, 'SIGKILL'); p.stdout.destroy(); p.stderr.destroy(); done(stopped()); }, grace);
    };
    const term = setTimeout(stop, timeout);
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop);
    p.stdout.setEncoding('utf8').on('data', (d) => { stdout = tail(stdout + d); onOutput(d); });
    p.stderr.setEncoding('utf8').on('data', (d) => { stderr = tail(stderr + d); onOutput(d); });
    p.on('error', (e) => done({ code: 127, stdout, stderr: e.message }));
    p.on('close', (code, signal) => done(timedOut ? stopped() : signal ? { code: 128, stdout, stderr: `${stderr}\nended by ${signal}` } : { code: code ?? 1, stdout, stderr }));
  });
}

export function runCommand(argv, { cwd, input, env, buffer, stdio, timeout } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, input, env: env ?? process.env, stdio, timeout, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' });
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
      return { ...c, after, diff: diffLines(before, after, c.path), noop: before === after && !c.always, ...(c.edit ? {} : { planHash: hashPath(real(c.path)) }) };
    }
    if (c.kind === 'remove') return { ...c, destructive: true, noop: !exists(c.path) };
    return { ...c, noop: false };
  }).filter((c) => !c.noop).map((c) => ({ selected: !c.destructive, ...c }))
    // A unit with a change that cannot be made is not selected at all.
    .map((c, _, all) => (c.error || (c.unit && all.some((x) => x.unit === c.unit && x.error)) ? { ...c, selected: false } : c));
}

// One loop for both drivers: it yields each command ({ argv, opts, entry }) for the driver to run and gets its result
// back, and yields { saved } after each change, so the async driver can let a server answer progress requests.
// stop() true: the changes not started yet are skipped, the run is cancelled.
function* applySteps(changes, ctx, { scope = 'global', select, note, stop } = {}) {
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'apply', scope, ...(note ? { note } : {}), entries: [] };
  // Changes of one unit (a copy and the removal of its source, a marketplace and its plugin) go together or not at all.
  // A change that cannot be made (c.error) is never applied.
  // A change that replaces another (c.replaces is its id) wins when both are chosen: the replaced one is not applied.
  const chosen = (c) => !c.error && (select ? select.includes(c.id) : (c.selected ?? !c.destructive));
  const picked = (c) => chosen(c) && !changes.some((x) => x.replaces === c.id && chosen(x));
  for (const c of changes) {
    const unit = c.unit && changes.filter((x) => x.unit === c.unit);
    if (unit && unit.some(picked) && !unit.every(picked)) throw new Error(`${unit.map((x) => x.title).join(' and ')} go together: choose all of them or none`);
  }
  yield { run };
  const failedSteps = new Set(), startedUnits = new Set(), verified = new Set();
  for (const c of changes) {
    if (!picked(c)) continue;
    const entry = { id: c.id, step: c.step, title: c.title, kind: c.kind };
    run.entries.push(entry);
    // A cancel finishes the unit it lands in: half a unit is worse than all of it.
    if (stop?.() && !startedUnits.has(c.unit)) { entry.status = 'skipped'; entry.reason = 'cancelled'; continue; }
    if (c.unit) startedUnits.add(c.unit);
    if (failedSteps.has(c.step)) { entry.status = 'skipped'; entry.reason = 'an earlier change of this step failed'; continue; }
    try {
      if (c.kind === 'command') {
        // Journaled before it starts: a command cut off by a crash shows in history and can be undone.
        Object.assign(entry, { argv: c.argv, cwd: c.cwd, undoArgv: c.undoArgv ?? null, status: 'running', touched: true });
        // Paths the command changes (skill folders, a lockfile) are copied first; undo puts these copies back.
        if (c.snapshot) {
          entry.snapshot = c.snapshot.map((p, i) => {
            const path = resolve(p);
            if (!allowed(path, ctx)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
            return { path, existed: exists(path), hashBefore: hashPath(path), backup: exists(path) ? ctx.ledger.backupPath(run.id, `${run.entries.length}-${i}`, path) : null };
          });
          ctx.ledger.save(run);
          for (const x of entry.snapshot) if (x.backup) { copy(x.path, x.backup); if (hashPath(x.backup) !== x.hashBefore) throw new Error(`backup of ${x.path} differs from the original`); }
        }
        ctx.ledger.save(run);
        // c.verify: a command that checks the code this one fetches (signatures); once per run for the same check.
        if (c.verify && !verified.has(c.verify.join(' '))) {
          // The command's own environment: the check reads the registry the install will.
          const v = yield { argv: c.verify, opts: { cwd: ctx.home, env: childEnv(c.env) }, entry };
          // Nothing ran yet: the entry is not touched.
          if (v.code !== 0) { delete entry.touched; throw new Error(`${c.argv[0]} was not run, the signature check failed: ${failure(v)}`); }
          verified.add(c.verify.join(' '));
        }
        const r = yield { argv: c.argv, opts: { cwd: c.cwd ?? ctx.home, env: childEnv(c.env) }, entry };
        // Ended with an exit code: undone only when it succeeded, as before the journal.
        entry.exit = r.code;
        // A failed command with a snapshot may have changed those paths: undo still restores them.
        if (r.code === 0 || !entry.snapshot) delete entry.touched;
        for (const x of entry.snapshot ?? []) x.hashAfter = hashPath(x.path);
        if (r.code !== 0) throw new Error(failure(r));
      } else {
        const path = c.kind === 'write' && !c.from ? real(c.path) : resolve(c.path);
        if (!allowed(path, ctx, c.kind !== 'remove')) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`);
        Object.assign(entry, { path, existed: exists(path), hashBefore: hashPath(path) });
        // A whole-file write is what the preview showed only while the file is as it was then (an earlier change of this run excepted).
        if ('planHash' in c && !run.entries.some((x) => x.path === path && x.status === 'done') && entry.hashBefore !== c.planHash) throw new Error(`${path} changed since the plan: make the plan again`);
        // Edits apply to the file as it is now, so a deselected earlier edit is not carried along.
        // edit also gets the run so far, so a change can depend on how earlier ones went, and the context the run uses.
        const after = c.kind === 'write' && c.edit ? c.edit(readText(path), run, ctx) : c.after;
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
          else if (after != null) writeAtomic(path, after, !entry.existed && PRIVATE_NEW.test(path) ? 0o600 : undefined);
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
  run.status = run.entries.some((e) => e.status === 'failed') ? 'failed' : run.entries.some((e) => e.reason === 'cancelled') ? 'cancelled' : 'done';
  ctx.ledger.save(run);
  return run;
}

export function apply(changes, ctx, opts) {
  const release = ctx.ledger.lock();
  try {
    ctx.ledger.prune();
    const g = applySteps(changes, ctx, opts);
    for (let x = g.next(); ; ) {
      if (x.done) return x.value;
      x = g.next(x.value.argv ? ctx.run(x.value.argv, x.value.opts) : undefined);
    }
  } finally { release(); }
}

// The same apply without blocking: commands run through ctx.runAsync (stub contexts fall back to ctx.run).
// onEvent gets { run } once, { entry, output } while a command prints, and { saved } after each change.
export async function applyAsync(changes, ctx, opts, onEvent = () => {}) {
  const release = ctx.ledger.lock();
  try {
    ctx.ledger.prune();
    const g = applySteps(changes, ctx, opts);
    const runAsync = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
    for (let x = g.next(); ; ) {
      if (x.done) return x.value;
      const v = x.value;
      if (!v.argv) { onEvent(v); await new Promise(setImmediate); x = g.next(); continue; }
      x = g.next(await runAsync(v.argv, { ...v.opts, onOutput: (output) => onEvent({ entry: v.entry, output }) }));
    }
  } finally { release(); }
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
export function undo(id, ctx, opts) {
  const release = ctx.ledger.lock();
  try { return undoRun(id, ctx, opts); } finally { release(); }
}

function undoRun(id, ctx, { step } = {}) {
  const source = ctx.ledger.get(id);
  // Update all on a branch worked in a worktree that is gone; its result is a branch and a pull request. A local run
  // changed the checkout and undoes like any other.
  if (source.note?.updateAll && source.note.branch) throw new Error(`run ${id} is an Update all commit on ${source.note.branch} in ${source.note.updateAll}: close its pull request or delete the branch`);
  const run = { schema: SCHEMA, id: runId(), time: new Date().toISOString(), appVersion: ctx.appVersion, kind: 'undo', of: id, scope: source.scope, entries: [] };
  const save = () => { ctx.ledger.save(run); ctx.ledger.save(source); };
  const begin = (entry) => { Object.assign(entry, { status: 'running', touched: true }); save(); };
  const within = (path, follow = true) => { if (!allowed(path, ctx, follow)) throw new Error(`${path} is outside ${ctx.roots.join(', ')}`); };
  // A backup the ledger names lies in this config folder's backups: a changed ledger file must not copy any other file in.
  const stored = (backup) => { if (backup != null && !inside(backup, [ctx.ledger.backups])) throw new Error(`the backup ${backup} is not in ${ctx.ledger.backups}`); };
  // One backup per path that exists now, taken before anything moves. A path inside an earlier one of the list is in that
  // one's backup already: a second copy would hold what the first restore put back, not what is there now.
  const backups = (paths, n) => paths.map((p, i) => (exists(p) && !paths.slice(0, i).some((q) => resolve(p).startsWith(resolve(q) + sep)) ? ctx.ledger.backupPath(run.id, `${n}-${i}`, p) : null));
  // The current state of a path goes to its backup, with the hash it had: journaled before the move, so a later undo of this
  // undo knows the file was moved. A path that went with an earlier one and is not back yet has nothing left to move.
  const aside = (rec, path, copyOnly) => {
    if (!rec.backup) return;
    if (!exists(path)) { rec.backup = null; return; }
    rec.hashBackup = hashPath(path);
    save();
    if (copyOnly) { copy(path, rec.backup); if (hashPath(rec.backup) !== rec.hashBackup) throw new Error(`backup of ${path} differs from the original`); } else move(path, rec.backup);
  };
  for (const e of [...source.entries].reverse()) {
    if (!doneOrTouched(e) || e.undone || (step && e.step !== step)) continue;
    const entry = { id: e.id, step: e.step, title: `undo: ${e.title}`, kind: e.kind };
    run.entries.push(entry);
    try {
      if (e.kind === 'session') {
        // Files the session added are removed, changed or deleted ones come back from the snapshot before it, each
        // only while it is as the session left it.
        // A snapshot git has removed (gc drops unreferenced trees) must fail here: a missing tree reads as a deleted file.
        within(e.cwd);
        for (const tree of [e.before, e.after]) if (!hasTree(ctx, e.cwd, tree)) throw new Error(`the snapshot ${tree} of this session is gone from ${e.cwd}: its files cannot be restored`);
        const files = e.files.map((f) => ({ f, path: join(e.cwd, f.path) }));
        for (const { f, path } of files) {
          within(path);
          if (hashPath(path) !== treeHash(ctx, e.cwd, e.after, f.path)) throw new Error(`${path} changed after the session: undo what changed it later first`);
        }
        // Each file and its backup are journaled before the first one moves: after a crash undo finds them.
        const kept = backups(files.map(({ path }) => path), run.entries.length);
        Object.assign(entry, { kind: 'restore', files: files.map(({ path }, i) => ({ path, backup: kept[i] })) });
        begin(entry);
        files.forEach(({ f, path }, i) => {
          aside(entry.files[i], path, true);
          restoreFromTree(ctx, e.cwd, e.before, f.path, path);
          entry.files[i].hashAfter = hashPath(path);
        });
      } else if (e.kind === 'restore') {
        // Undo of a session undo: the files go back to that run's backups, while they are as it left them. A file a failed
        // undo never reached (no hash recorded) was not touched by it, so there is nothing to put back.
        // One whose set-aside did not happen (the move failed: its backup is missing, the file is as recorded) was not either.
        const reached = (f) => 'hashAfter' in f || 'hashBackup' in f;
        const moveFailed = (f) => !('hashAfter' in f) && f.backup && !exists(f.backup) && hashPath(f.path) === f.hashBackup;
        const files = e.files.filter((f) => reached(f) && !moveFailed(f));
        for (const f of files) {
          within(f.path);
          stored(f.backup);
          if ('hashAfter' in f && hashPath(f.path) !== f.hashAfter) throw new Error(`${f.path} changed after this change: undo what changed it later first`);
          // No post-change state recorded: the undo stopped at this file. It is moved away (nothing there) or not moved yet
          // (as recorded); anything else is a path someone made since, which a replay would overwrite.
          if (!('hashAfter' in f) && exists(f.path) && hashPath(f.path) !== f.hashBackup) throw new Error(`${f.path} changed after this change: undo what changed it later first`);
          if (f.backup && (!('hashBackup' in f) || hashPath(f.backup) !== f.hashBackup)) throw new Error(`the backup ${f.backup} is missing or changed`);
        }
        const kept = backups(files.map((f) => f.path), run.entries.length);
        Object.assign(entry, { kind: 'restore', files: files.map((f, i) => ({ path: f.path, backup: kept[i] })) });
        begin(entry);
        files.forEach((f, i) => {
          aside(entry.files[i], f.path);
          if (f.backup) copy(f.backup, f.path);
          entry.files[i].hashAfter = hashPath(f.path);
        });
      } else if (e.kind === 'command' && e.snapshot) {
        // The paths come back from the copies taken before the command, while they are as it left them.
        for (const x of e.snapshot) {
          within(x.path);
          stored(x.backup);
          // A command that failed also recorded how it left the paths: a later hand edit is not overwritten either.
          if ('hashAfter' in x && hashPath(x.path) !== x.hashAfter) throw new Error(`${x.path} changed after this change: undo what changed it later first`);
          if (x.existed && hashPath(x.backup) !== x.hashBefore) throw new Error(`the backup ${x.backup} is missing or changed`);
        }
        const kept = backups(e.snapshot.map((x) => x.path), run.entries.length);
        Object.assign(entry, { kind: 'restore', files: e.snapshot.map((x, i) => ({ path: x.path, backup: kept[i] })) });
        begin(entry);
        e.snapshot.forEach((x, i) => {
          aside(entry.files[i], x.path);
          if (x.existed) copy(x.backup, x.path);
          entry.files[i].hashAfter = hashPath(x.path);
        });
      } else if (e.kind === 'command') {
        if (!e.undoArgv) { entry.status = 'manual'; entry.reason = `no undo command for ${e.argv.join(' ')}`; continue; }
        if (!undoable(e.undoArgv)) throw new Error(`the undo command is not one this app plans, so it is not run: ${mask(String(e.undoArgv).slice(0, 120))}`);
        if (e.cwd != null && !inside(e.cwd, [ctx.home, ...ctx.roots])) throw new Error(`the undo command's folder ${e.cwd} is outside ${ctx.home}`);
        Object.assign(entry, { argv: e.undoArgv, cwd: e.cwd });
        begin(entry);
        const r = ctx.run(e.undoArgv, { cwd: e.cwd ?? ctx.home, env: childEnv(), timeout: 5 * 60e3 });
        entry.exit = r.code;
        if (r.code !== 0) throw new Error(failure(r, 10));
      } else {
        within(e.path, e.kind !== 'remove');
        // Only a file as the run left it goes back, so a later change (another step's, or the user's) is not lost.
        // A whole run is undone newest first, so its own later edits of the file are undone before.
        if (e.status === 'done' && hashPath(e.path) !== e.hashAfter) throw new Error(`${e.path} changed after this change: undo what changed it later first`);
        stored(e.backup);
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
