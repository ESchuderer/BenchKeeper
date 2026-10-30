import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { allowed, apply, applyAsync, claudeResult, context, legacyBackups, preview, restoreLegacy, runCommand, runCommandAsync, undo, undoable, windowsTool } from '../src/runner.mjs';
import { recordSession } from '../src/session.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'bk-home-'));
const ok = { code: 0, stdout: '', stderr: '' };
// A context whose commands are recorded and answered by answer(argv).
const stub = (answer = () => ok) => {
  const calls = [];
  const c = context({ home: home(), run: (argv, opts) => { calls.push({ argv, opts }); return answer(argv); } });
  return { c, calls };
};
// A git repository with a committed README.md, and a context whose roots hold it. Its folder is resolved because the
// session records paths under git's root, which has no links (macOS temp folders are under the link /var).
const repo = () => {
  const dir = realpathSync(home());
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const h = home();
  return { dir, git, ctx: context({ home: h, roots: [h, dir], run: runCommand }) };
};
const posix = { skip: process.platform === 'win32' };
const cmd = (id, argv, extra = {}) => ({ id, step: id, title: id, kind: 'command', argv, ...extra });

test('undoable: every planned form with a plain name, nothing longer, shorter or with another name', () => {
  for (const f of [['claude', 'plugin', 'install'], ['claude', 'plugin', 'uninstall'], ['claude', 'plugin', 'marketplace', 'remove'], ['codex', 'plugin', 'remove'], ['codex', 'plugin', 'add'], ['codex', 'plugin', 'marketplace', 'remove'], ['claude', 'plugin', 'install', '--scope', 'user'], ['claude', 'plugin', 'install', '--scope', 'local'], ['claude', 'plugin', 'uninstall', '--scope', 'user'], ['claude', 'plugin', 'uninstall', '--scope', 'local']]) {
    assert.equal(undoable([...f, 'a.b@c:d-e_f']), true, f.join(' '));
    assert.equal(undoable([...f, '-x']), false, f.join(' '));
    assert.equal(undoable([...f, '']), false, f.join(' '));
    assert.equal(undoable(f), false, f.join(' '));
  }
  assert.equal(undoable(['claude', 'plugin', 'install', 'a b']), false);
  assert.equal(undoable(['claude', 'plugin', 'install', 'a\nb']), false);
  assert.equal(undoable('claude plugin install a'), false);
  assert.equal(undoable(['claude', 'plugin', 'install', '--scope', 'project', 'a']), false);
});

test('allowed: inside a root and not denied, unless the root lies in the denied folder', () => {
  const h = home();
  const ctx = { roots: [h, join(h, '.git/info')], deny: [join(h, '.git')] };
  assert.equal(allowed(join(h, 'a'), ctx), true);
  assert.equal(allowed(join(h, '.git/config'), ctx), false);
  assert.equal(allowed(join(h, '.git/info/exclude'), ctx), true);
  assert.equal(allowed(join(tmpdir(), 'elsewhere'), ctx), false);
  assert.equal(allowed(join(h, 'a'), { roots: [h] }), true);
});

test('windowsTool and context defaults', () => {
  const root = process.env.SystemRoot;
  delete process.env.SystemRoot;
  assert.equal(windowsTool('System32', 'x.exe'), join('C:\\Windows', 'System32', 'x.exe'));
  process.env.SystemRoot = 'D:\\Win';
  assert.equal(windowsTool('x.exe'), join('D:\\Win', 'x.exe'));
  if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root;
  const h = home();
  const c = context({ home: h });
  assert.deepEqual([c.config, c.roots, c.appVersion, c.run, typeof c.runAsync, 'refuse' in c, 'undoable' in c], [join(h, '.config/benchkeeper'), [h], '0.0.0', runCommand, 'function', false, false]);
  const run = () => ok;
  const more = () => true;
  const d = context({ home: h, run, refuse: () => 'x', undoable: more, roots: [join(h, 'a')] });
  assert.deepEqual([d.runAsync, d.undoable, d.roots, typeof d.refuse], [undefined, more, [join(h, 'a')], 'function']);
});

test('runCommand: exit code, output, input and a missing program', () => {
  assert.deepEqual(runCommand(['node', '-e', 'process.stdin.pipe(process.stdout); process.stderr.write("e"); process.exitCode = 3'], { input: 'in' }), { code: 3, stdout: 'in', stderr: 'e' });
  const missing = runCommand(['bk-no-such-program-x']);
  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /ENOENT/);
  assert.equal(missing.stdout, '');
  assert.deepEqual(runCommand(['node', '-e', ''], { stdio: 'ignore' }), { code: 0, stdout: '', stderr: '' });
  assert.ok(Buffer.isBuffer(runCommand(['node', '-e', 'process.stdout.write("b")'], { buffer: true }).stdout));
});

test('preview: a copy is a no-op when equal, an edit that throws is not selected, always keeps an equal write', () => {
  const h = home();
  writeFileSync(join(h, 'src'), 'x');
  writeFileSync(join(h, 'same'), 'x');
  writeFileSync(join(h, 'other'), 'y');
  const w = (id, path, extra) => ({ id, step: 's', title: id, kind: 'write', path: join(h, path), ...extra });
  const p = preview([w('copy-same', 'same', { from: join(h, 'src') }), w('copy-other', 'other', { from: join(h, 'src') }), w('bad', 'b', { edit: () => { throw new Error('no parse'); } }), w('always', 'same', { after: 'x', always: true }), { id: 'c', step: 's', title: 'c', kind: 'command', argv: ['x'] }]);
  assert.deepEqual(p.map((x) => [x.id, x.selected]), [['copy-other', true], ['bad', false], ['always', true], ['c', true]]);
  assert.equal(p[0].diff, `copy ${join(h, 'src')}`);
  assert.deepEqual([p[1].error, p[1].diff, p[1].noop], ['no parse', '', false]);
  assert.equal(typeof p[2].planHash, 'string');
  assert.equal(p[3].noop, false);
  // Edits of one file build on each other in plan order.
  const e = preview([w('e1', 'other', { edit: (t) => `${t}1` }), w('e2', 'other', { edit: (t) => `${t}2` })]);
  assert.deepEqual(e.map((x) => x.after), ['y1', 'y12']);
  assert.ok(!('planHash' in e[0]));
});

test('apply: a whole-file write refuses a file changed since the plan, not one an earlier change of the run wrote', () => {
  const c = context({ home: home() });
  const path = join(c.home, 'f');
  writeFileSync(path, 'old');
  const planned = preview([{ id: 'w', step: 's', title: 'w', kind: 'write', path, after: 'new' }]);
  writeFileSync(path, 'mine');
  const run = apply(planned, c);
  assert.equal(run.status, 'failed');
  assert.match(run.entries[0].error, /changed since the plan: make the plan again/);
  assert.equal(readFileSync(path, 'utf8'), 'mine');
  const two = preview([{ id: 'a', step: 'a', title: 'a', kind: 'write', path, after: 'one' }]).concat(preview([{ id: 'b', step: 'b', title: 'b', kind: 'write', path, after: 'two' }]));
  assert.equal(apply(two, c).status, 'done');
  assert.equal(readFileSync(path, 'utf8'), 'two');
});

test('apply: a new agent settings file is private, others and existing ones keep the default mode; mode wins', { skip: process.platform === 'win32' }, () => {
  const c = context({ home: home() });
  writeFileSync(join(c.home, '.claude.json'), '{}');
  const w = (id, path, extra) => ({ id, step: id, title: id, kind: 'write', path: join(c.home, path), after: `{"${id}":1}`, ...extra });
  apply([w('s', '.claude/settings.json'), w('l', '.claude/settings.local.json'), w('t', '.codex/config.toml'), w('h', '.codex/hooks.json'), w('cj', '.claude.json'), w('md', '.claude/CLAUDE.md'), w('m', 'script.sh', { mode: 0o755 })], c);
  const mode = (p) => statSync(join(c.home, p)).mode & 0o777;
  for (const p of ['.claude/settings.json', '.claude/settings.local.json', '.codex/config.toml', '.codex/hooks.json']) assert.equal(mode(p), 0o600, p);
  assert.notEqual(mode('.claude/CLAUDE.md'), 0o600);
  assert.notEqual(mode('.claude.json'), 0o600, 'an existing file keeps its mode');
  assert.equal(mode('script.sh'), 0o755);
});

test('apply refuses content the app is too old for, before the lock; undo is not refused', async () => {
  const c = context({ home: home(), refuse: () => 'needs app 9' });
  assert.throws(() => apply([], c), /needs app 9/);
  await assert.rejects(applyAsync([], c), /needs app 9/);
  assert.equal(c.ledger.list().length, 0);
  const ok2 = context({ home: c.home, refuse: () => undefined });
  assert.equal(apply([{ id: 'a', step: 'a', title: 'a', kind: 'write', path: join(c.home, 'a'), after: 'a' }], ok2).status, 'done');
});

test('a signature check runs once per run in the command environment; a failed one runs nothing', () => {
  const { c, calls } = stub((argv) => (argv[0] === 'verify-bad' ? { code: 1, stdout: '', stderr: 'bad sig' } : ok));
  const run = apply([
    cmd('a', ['npx', 'one'], { verify: ['verify', 'x'], env: { K: 'v' } }),
    cmd('b', ['npx', 'two'], { verify: ['verify', 'x'] }),
    cmd('c', ['npx', 'three'], { verify: ['verify-bad'] }),
  ], c);
  assert.deepEqual(calls.map((x) => x.argv.join(' ')), ['verify x', 'npx one', 'npx two', 'verify-bad']);
  assert.equal(calls[0].opts.env.K, 'v');
  assert.equal(calls[0].opts.cwd, c.home);
  assert.deepEqual(run.entries.map((e) => [e.status, e.touched]), [['done', undefined], ['done', undefined], ['failed', undefined]]);
  assert.equal(run.entries[2].error, 'npx was not run, the signature check failed: bad sig');
});

test('a command: cwd, undo note, outcome, and the failure text from stderr, a JSON error or the exit code', () => {
  const answers = { a: { code: 0, stdout: 'id=7', stderr: '' }, b: { code: 2, stdout: '{"error":{"message":"no such plugin"}}', stderr: '' }, c: { code: 4, stdout: '', stderr: '' }, d: { code: 1, stdout: 'l1\nl2\nl3\nl4', stderr: '' }, e: { code: 1, stdout: '{"error":{"message":5}}', stderr: '' } };
  const { c, calls } = stub((argv) => answers[argv[1]] ?? ok);
  const run = apply([
    cmd('a', ['x', 'a'], { cwd: join(c.home, 'w'), undoNote: 'remove it by hand', outcome: (r) => ({ result: r.stdout.slice(3), undoArgv: ['claude', 'plugin', 'uninstall', 'p7'] }) }),
    cmd('b', ['x', 'b']), cmd('c', ['x', 'c']), cmd('d', ['x', 'd']), cmd('e', ['x', 'e']),
  ], c);
  assert.equal(calls[0].opts.cwd, join(c.home, 'w'));
  assert.equal(calls[1].opts.cwd, c.home);
  assert.deepEqual([run.entries[0].result, run.entries[0].undoArgv, run.entries[0].undoNote, run.entries[0].exit], ['7', ['claude', 'plugin', 'uninstall', 'p7'], 'remove it by hand', 0]);
  assert.deepEqual(run.entries.slice(1).map((e) => e.error), ['no such plugin', 'exit 4', 'l2 l3 l4', '{"error":{"message":5}}']);
  assert.equal(run.entries[1].undoArgv, null);
  assert.equal(run.status, 'failed');
  const u = undo(run.id, c);
  assert.equal(u.entries[0].status, 'done', u.entries[0].error);
  assert.deepEqual(calls.at(-1).argv, ['claude', 'plugin', 'uninstall', 'p7']);
  assert.equal(calls.at(-1).opts.cwd, join(c.home, 'w'));
});

test('a command without an undo command is left to the user, with its note or its argv', () => {
  const { c } = stub();
  const run = apply([cmd('a', ['x', 'a'], { undoNote: 'remove it by hand' }), cmd('b', ['x', 'b'])], c);
  const u = undo(run.id, c);
  assert.deepEqual(u.entries.map((e) => [e.status, e.reason]), [['manual', 'no undo command for x b'], ['manual', 'remove it by hand']]);
  assert.equal(u.status, 'done');
});

test('undo of a command: an undo command the app does not plan, or a folder outside home, is not run; a failure keeps its last lines', () => {
  const { c, calls } = stub((argv) => (argv.includes('fails') ? { code: 1, stdout: '', stderr: Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n') } : ok));
  const run = apply([
    cmd('a', ['x', 'a'], { undoArgv: ['rm', '-rf', '/'] }),
    cmd('b', ['x', 'b'], { undoArgv: ['claude', 'plugin', 'uninstall', 'p'], cwd: '/elsewhere' }),
    cmd('c', ['x', 'c'], { undoArgv: ['claude', 'plugin', 'uninstall', 'fails'] }),
    cmd('d', ['x', 'd'], { undoArgv: ['own', 'undo'] }),
  ], c);
  const before = calls.length;
  const u = undo(run.id, c);
  const byId = Object.fromEntries(u.entries.map((e) => [e.id, e]));
  assert.match(byId.a.error, /^the undo command is not one this app plans, so it is not run: rm,-rf,\//);
  assert.equal(byId.b.error, `the undo command's folder /elsewhere is outside ${c.home}`);
  assert.equal(byId.c.error, Array.from({ length: 10 }, (_, i) => `l${i + 2}`).join(' '));
  assert.equal(byId.c.exit, 1);
  assert.match(byId.d.error, /not one this app plans/);
  assert.deepEqual(calls.slice(before).map((x) => [x.argv.join(' '), x.opts.timeout]), [['claude plugin uninstall fails', 5 * 60e3]]);
  assert.equal(u.status, 'failed');
  // A scheduler's own undo forms come through ctx.undoable, which gets the context too.
  const seen = [];
  const d = context({ home: c.home, run: (argv) => { calls.push({ argv }); return ok; }, undoable: (argv, ctx) => { seen.push(ctx); return argv[0] === 'own'; } });
  const u2 = undo(run.id, d);
  assert.equal(u2.entries.find((e) => e.id === 'd').status, 'done');
  assert.equal(seen[0], d);
});

test('undo refuses an Update all run on a branch; a local one undoes', () => {
  const c = context({ home: home() });
  const run = apply([{ id: 'a', step: 'a', title: 'a', kind: 'write', path: join(c.home, 'a'), after: 'a' }], c, { note: { updateAll: 'proj', branch: 'bk/update' }, scope: 'project' });
  assert.deepEqual([run.note, run.scope], [{ updateAll: 'proj', branch: 'bk/update' }, 'project']);
  assert.throws(() => undo(run.id, c), new RegExp(`run ${run.id} is an Update all commit on bk/update in proj: close its pull request or delete the branch`));
  const local = apply([{ id: 'b', step: 'b', title: 'b', kind: 'write', path: join(c.home, 'b'), after: 'b' }], c, { note: { updateAll: 'proj' } });
  const u = undo(local.id, c);
  assert.deepEqual([u.status, u.scope, u.of, u.kind], ['done', 'global', local.id, 'undo']);
  assert.equal(existsSync(join(c.home, 'b')), false);
});

test('a change replaced by another chosen one is not applied; the run lists its units', () => {
  const c = context({ home: home() });
  const run = apply([
    { id: 'old', step: 's', title: 'old', kind: 'write', path: join(c.home, 'old'), after: 'o' },
    { id: 'new', step: 's', title: 'new', kind: 'write', path: join(c.home, 'new'), after: 'n', replaces: 'old', installUnit: { id: 'skill:x', kind: 'skill', name: 'x' } },
  ], c);
  assert.deepEqual(run.entries.map((e) => [e.id, e.installUnit]), [['new', 'skill:x']]);
  assert.equal(existsSync(join(c.home, 'old')), false);
  assert.ok(Array.isArray(run.units) && run.units.length > 0);
  const kept = apply([{ id: 'o2', step: 's', title: 'o2', kind: 'write', path: join(c.home, 'o2'), after: 'o' }, { id: 'n2', step: 's', title: 'n2', kind: 'write', path: join(c.home, 'n2'), after: 'n', replaces: 'o2' }], c, { select: ['o2'] });
  assert.deepEqual(kept.entries.map((e) => e.id), ['o2']);
  assert.equal(kept.units, undefined);
});

test('applyAsync reports the run, the output of each command and each saved change', async () => {
  const c = context({ home: home(), run: () => ({ code: 0, stdout: 'out', stderr: '' }) });
  const events = [];
  mkdirSync(join(c.home, 'd'));
  const run = await applyAsync([cmd('a', ['x']), { id: 'w', step: 'w', title: 'w', kind: 'write', path: join(c.home, 'd/f'), after: 'f' }], c, {}, (e) => events.push(e));
  assert.equal(run.status, 'done');
  assert.deepEqual(events.map((e) => Object.keys(e).join()), ['run', 'saved', 'saved']);
  const asyncCtx = { ...context({ home: c.home }), runAsync: async (argv, o) => { o.onOutput('line'); return ok; } };
  const seen = [];
  await applyAsync([cmd('b', ['y'])], asyncCtx, {}, (e) => seen.push(e));
  assert.deepEqual(seen.find((e) => 'output' in e), { entry: seen.find((e) => e.saved).saved, output: 'line' });
});

test('an async command: input pipe, both outputs, exit code, a missing program, a signal, a cancel before the start', async () => {
  const seen = [];
  const r = await runCommandAsync(['node', '-e', 'process.stdin.on("data", (d) => { process.stdout.write("o" + d); process.stderr.write("e"); process.exitCode = 3; })'], { onStart: (stdin) => stdin.end('in'), onOutput: (d) => seen.push(d) });
  assert.deepEqual(r, { code: 3, stdout: 'oin', stderr: 'e' });
  assert.deepEqual(seen.sort(), ['e', 'oin']);
  const missing = await runCommandAsync(['bk-no-such-program-x']);
  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /ENOENT/);
  const killed = await runCommandAsync(['node', '-e', 'process.stdout.write("x"); process.kill(process.pid, "SIGKILL")']);
  assert.deepEqual(killed, { code: 128, stdout: 'x', stderr: '\nended by SIGKILL' });
  const ac = new AbortController();
  ac.abort();
  const early = await runCommandAsync(['node', '-e', 'setTimeout(() => {}, 5000)'], { signal: ac.signal });
  assert.deepEqual(early, { code: 130, stdout: '', stderr: '\ncancelled' });
  // Node may not have started yet under load, so the output before the stop is not checked.
  const slow = await runCommandAsync(['node', '-e', 'setTimeout(() => {}, 5000)'], { timeout: 600 });
  assert.deepEqual([slow.code, slow.stderr.endsWith('\nstopped after 0.01 minutes')], [124, true]);
});

test('claudeResult: the result document of a session, its error from is_error or the exit code, nothing for other output', () => {
  assert.deepEqual(claudeResult('{"result":"hi","is_error":false}'), { error: false, text: 'hi' });
  assert.deepEqual(claudeResult('{"result":"hi","is_error":true}'), { error: true, text: 'hi' });
  assert.deepEqual(claudeResult('{"result":"hi","is_error":false}', 1), { error: true, text: 'hi' });
  for (const s of ['{"result":1,"is_error":false}', '{"result":"hi","is_error":"no"}', '{"result":"hi"}', 'null', 'not json', '']) assert.equal(claudeResult(s), undefined, s);
});

test('apply: new settings files of every agent are private, a file of another name is not', posix, () => {
  const c = context({ home: home() });
  const paths = ['.gemini/settings.json', '.copilot/config.json', '.claude/settings.json.bak', '.claude/hooks.json', 'claude/settings.json'];
  apply(paths.map((p, i) => ({ id: `w${i}`, step: `w${i}`, title: p, kind: 'write', path: join(c.home, p), after: '{}' })), c);
  assert.deepEqual(paths.map((p) => (statSync(join(c.home, p)).mode & 0o777) === 0o600), [true, true, false, true, false]);
});

test('legacyBackups: only dated folders without a run of their name, newest first; restoreLegacy refuses others', () => {
  const c = context({ home: home() });
  assert.deepEqual(legacyBackups(c), []);
  for (const n of ['2026-10-20-120000', '2026-10-21-090000', '2026-10-21-09000', 'x2026-10-21-090000', '2026-10-21-0900001']) mkdirSync(join(c.ledger.backups, n, 'd'), { recursive: true });
  const run = apply([{ id: 'a', step: 'a', title: 'a', kind: 'write', path: join(c.home, 'a'), after: 'a' }], c);
  mkdirSync(join(c.ledger.backups, run.id), { recursive: true });
  assert.deepEqual(legacyBackups(c), ['2026-10-21-090000', '2026-10-20-120000']);
  writeFileSync(join(c.ledger.backups, '2026-10-20-120000', 'd', 'f'), 'old');
  const r = restoreLegacy('2026-10-20-120000', c);
  assert.deepEqual([r.scope, r.entries.map((e) => [e.id, e.step, e.title, e.status])], ['global', [['restore-0', 'restore', `restore ${join('d', 'f')}`, 'done']]]);
  assert.equal(readFileSync(join(c.home, 'd', 'f'), 'utf8'), 'old');
  assert.throws(() => restoreLegacy('2026-10-21-09000', c), /no setup\.sh backup 2026-10-21-09000/);
});

test('undo of a snapshot command refuses a path changed after the command and a changed backup', () => {
  const dir = home();
  let n = 0;
  const c = context({ home: dir, run: () => { writeFileSync(join(dir, 'skill'), `after${n++}`); return ok; } });
  writeFileSync(join(dir, 'skill'), 'before');
  const snap = () => apply([{ id: 'c', step: 's', title: 'c', kind: 'command', argv: ['x'], snapshot: [join(dir, 'skill'), join(dir, 'new')] }], c);
  const run = snap();
  const e = c.ledger.get(run.id).entries[0];
  assert.deepEqual(e.snapshot.map((x) => [x.existed, x.backup === null]), [[true, false], [false, true]]);
  writeFileSync(join(dir, 'skill'), 'mine');
  assert.match(undo(run.id, c).entries[0].error, /skill changed after this change: undo what changed it later first/);
  writeFileSync(join(dir, 'skill'), 'after0');
  writeFileSync(e.snapshot[0].backup, 'tampered');
  assert.match(undo(run.id, c).entries[0].error, /the backup .* is missing or changed/);
  writeFileSync(e.snapshot[0].backup, 'before');
  const u = undo(run.id, c);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  assert.equal(readFileSync(join(dir, 'skill'), 'utf8'), 'before');
  // The undo kept what the command left, so undoing it brings that back.
  assert.equal(undo(u.id, c).status, 'done');
  assert.equal(readFileSync(join(dir, 'skill'), 'utf8'), 'after0');
});

test('session undo: a deleted file, a new folder, a link and an executable come back; its undo puts the session state back', posix, () => {
  const r = repo();
  writeFileSync(join(r.dir, 'run.sh'), 'a\n');
  chmodSync(join(r.dir, 'run.sh'), 0o755);
  symlinkSync('README.md', join(r.dir, 'link'));
  r.git('add', '-A');
  r.git('commit', '-qm', 'more');
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'rm README.md link && echo b > run.sh && mkdir -p d/e && echo x > d/e/f && ln -s run.sh l2']);
  const u = undo(run.id, r.ctx);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  assert.equal(readFileSync(join(r.dir, 'README.md'), 'utf8'), '# P\n');
  assert.equal(readlinkSync(join(r.dir, 'link')), 'README.md');
  assert.equal(readFileSync(join(r.dir, 'run.sh'), 'utf8'), 'a\n');
  assert.equal(statSync(join(r.dir, 'run.sh')).mode & 0o777, 0o755);
  assert.deepEqual([existsSync(join(r.dir, 'd/e/f')), existsSync(join(r.dir, 'l2'))], [false, false]);
  const files = Object.fromEntries(u.entries[0].files.map((f) => [f.path.slice(r.dir.length + 1), f]));
  // Files the session deleted had nothing to set aside; the others did, each with its hash.
  assert.deepEqual([files['README.md'].backup, files.link.backup], [null, null]);
  assert.ok(files['run.sh'].backup && files['run.sh'].hashBackup && files['d/e/f'].backup);
  const again = undo(u.id, r.ctx);
  assert.equal(again.status, 'done', JSON.stringify(again.entries));
  assert.deepEqual([existsSync(join(r.dir, 'README.md')), readFileSync(join(r.dir, 'run.sh'), 'utf8'), readFileSync(join(r.dir, 'd/e/f'), 'utf8'), readlinkSync(join(r.dir, 'l2'))], [false, 'b\n', 'x\n', 'run.sh']);
});

test('undo of a session undo refuses a changed file, a path made since and a changed backup', () => {
  const r = repo();
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'echo b >> README.md && echo n > n']);
  const u = undo(run.id, r.ctx);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  writeFileSync(join(r.dir, 'README.md'), 'mine');
  assert.match(undo(u.id, r.ctx).entries[0].error, /README\.md changed after this change/);
  writeFileSync(join(r.dir, 'README.md'), '# P\n');
  const backup = u.entries[0].files.find((f) => f.path.endsWith('README.md')).backup;
  writeFileSync(backup, 'tampered');
  assert.match(undo(u.id, r.ctx).entries[0].error, /the backup .* is missing or changed/);
  assert.deepEqual([readFileSync(join(r.dir, 'README.md'), 'utf8'), existsSync(join(r.dir, 'n'))], ['# P\n', false]);
});

test('undo of a session undo that stopped part way puts back only the files it reached and moved', () => {
  const r = repo();
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'echo b >> README.md && echo n > n && echo m > m']);
  const u = undo(run.id, r.ctx);
  const saved = r.ctx.ledger.get(u.id);
  const [first, second, third] = ['README.md', 'm', 'n'].map((p) => saved.entries[0].files.find((f) => f.path === join(r.dir, p)));
  // README.md was put back; the set-aside of m failed (no backup, the file as recorded); n was never reached.
  delete second.hashAfter;
  writeFileSync(second.path, 'm\n');
  rmSync(second.backup);
  for (const k of ['hashAfter', 'hashBackup']) delete third[k];
  Object.assign(saved.entries[0], { status: 'failed', touched: true });
  r.ctx.ledger.save(saved);
  const again = undo(u.id, r.ctx);
  assert.equal(again.status, 'done', JSON.stringify(again.entries));
  assert.deepEqual(again.entries[0].files.map((f) => f.path).sort(), [first.path]);
  assert.equal(readFileSync(first.path, 'utf8'), '# P\nb\n');
});

test('a unit with a change that cannot be made is not selected; a partial choice of a unit names its changes', () => {
  const c = context({ home: home() });
  const w = (id, extra) => ({ id, step: id, title: `t-${id}`, kind: 'write', path: join(c.home, id), after: id, ...extra });
  const p = preview([w('a', { unit: 'u' }), w('b', { unit: 'u', edit: () => { throw new Error('no'); } }), w('c', { unit: 'v' }), w('d')]);
  assert.deepEqual(p.map((x) => [x.id, x.selected]), [['a', false], ['b', false], ['c', true], ['d', true]]);
  assert.throws(() => apply([w('a', { unit: 'u' }), w('e', { unit: 'u' })], c, { select: ['a'] }), /^Error: t-a and t-e go together: choose all of them or none$/);
});

test('a write of null deletes the file; a copy or a write onto a folder replaces it whole', () => {
  const c = context({ home: home() });
  const p = (x) => join(c.home, x);
  writeFileSync(p('gone'), 'x');
  mkdirSync(p('src'));
  writeFileSync(p('src/a'), 'a');
  mkdirSync(p('dst'));
  writeFileSync(p('dst/old'), 'old');
  mkdirSync(p('dir'));
  writeFileSync(p('dir/old'), 'old');
  const run = apply([
    { id: 'n', step: 'n', title: 'n', kind: 'write', path: p('gone'), after: null },
    { id: 'f', step: 'f', title: 'f', kind: 'write', path: p('dst'), from: p('src') },
    { id: 'd', step: 'd', title: 'd', kind: 'write', path: p('dir'), after: 'file' },
  ], c);
  assert.equal(run.status, 'done', JSON.stringify(run.entries));
  assert.deepEqual([existsSync(p('gone')), existsSync(p('dst/old')), readFileSync(p('dst/a'), 'utf8'), readFileSync(p('dir'), 'utf8')], [false, false, 'a', 'file']);
  assert.equal(undo(run.id, c).status, 'done');
  assert.deepEqual([readFileSync(p('gone'), 'utf8'), readFileSync(p('dst/old'), 'utf8'), existsSync(p('dst/a')), readFileSync(p('dir/old'), 'utf8')], ['x', 'old', false, 'old']);
});

test('undo of one unit leaves the rest; an undo with one failure among done ones fails; nothing left names the unit', () => {
  const c = context({ home: home() });
  const w = (id, unit) => ({ id, step: 's', title: id, kind: 'write', path: join(c.home, id), after: id, installUnit: { id: unit } });
  const run = apply([w('a', 'skill:a'), w('b', 'skill:b'), w('c', 'skill:c')], c);
  assert.equal(undo(run.id, c, { unit: 'skill:a' }).entries.length, 1);
  assert.deepEqual([existsSync(join(c.home, 'a')), existsSync(join(c.home, 'b'))], [false, true]);
  assert.throws(() => undo(run.id, c, { unit: 'skill:a' }), new RegExp(`^Error: nothing to undo in run ${run.id} unit skill:a: its changes are undone already or were never made$`));
  writeFileSync(join(c.home, 'b'), 'mine');
  const u = undo(run.id, c);
  assert.deepEqual([u.status, u.entries.map((e) => e.status)], ['failed', ['done', 'failed']]);
});

test('a clone that fails is touched only when it left its folder', () => {
  const h = home();
  const dest = join(h, 'p');
  const c = context({ home: h, run: (argv) => { if (argv.includes('make')) mkdirSync(dest); return { code: 1, stdout: '', stderr: 'no access' }; } });
  const clone = (extra) => ({ id: 'c', step: 'c', title: 'c', kind: 'clone', path: dest, argv: ['git', 'clone', extra] });
  const none = apply([clone('x')], c);
  assert.deepEqual([none.entries[0].status, none.entries[0].touched, none.entries[0].error, none.entries[0].exit], ['failed', undefined, 'no access', 1]);
  const left = apply([clone('make')], c);
  assert.deepEqual([left.entries[0].touched, left.entries[0].existed, left.entries[0].cwd], [true, false, undefined]);
  assert.match(apply([clone('x')], c).entries[0].error, /p exists already$/);
  assert.match(apply([{ ...clone('x'), path: join(tmpdir(), 'bk-elsewhere') }], c).entries[0].error, /is outside/);
});
