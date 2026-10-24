// One test per limit of docs/security.md that no other test file covers. Each fails when its control is removed.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';
import { machineContext } from '../src/cli.mjs';
import { inside, writeAtomic } from '../src/fsx.mjs';
import { clean, githubRemote } from '../src/git.mjs';
import { runId } from '../src/ledger.mjs';
import { loadCases } from '../src/cases.mjs';
import { ownPacks, removePack } from '../src/packs.mjs';
import { remoteHead } from '../src/projects.mjs';
import { apply, context, preview, runCommand, undo } from '../src/runner.mjs';
import { recordSession } from '../src/session.mjs';
import { newest } from '../src/steps/global.mjs';
import { projectCtx } from '../src/steps/project.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'bk-sec-'));
const write = (c, path, after, extra = {}) => ({ id: `w-${path}`, step: 's', title: path, kind: 'write', path: join(c.home, path), after, ...extra });
const mode = (p) => statSync(p).mode & 0o777;
const repo = () => {
  const dir = home();
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

test('the ledger, its backups and run files are private to the user, whatever the umask', () => {
  const before = process.umask(0o022);
  try {
    const c = context({ home: home() });
    writeFileSync(join(c.home, 'settings.json'), 'old');
    const run = apply([write(c, 'settings.json', 'new')], c);
    assert.equal(mode(join(c.config, 'ledger')), 0o700);
    assert.equal(mode(join(c.config, 'ledger', `${run.id}.json`)), 0o600);
    for (let d = join(c.config, 'backup', run.id); d !== join(c.config, 'backup'); d = join(d, '..')) assert.equal(mode(d), 0o700, d);
  } finally { process.umask(before); }
});

test('an atomic write that fails leaves no temporary file, and a new file with a mode never exists with another', () => {
  const d = home();
  mkdirSync(join(d, 'x'));
  assert.throws(() => writeAtomic(join(d, 'x'), 'text'));
  assert.deepEqual(readdirSync(d), ['x']);
  const before = process.umask(0o022);
  try {
    writeAtomic(join(d, 'secret'), 'token', 0o600);
    assert.equal(mode(join(d, 'secret')), 0o600);
  } finally { process.umask(before); }
});

test('run ids do not repeat in one second', () => {
  const now = new Date();
  mock.method(Math, 'random', () => 0.5);
  try { assert.notEqual(runId(now), runId(now)); } finally { mock.restoreAll(); }
});

test('a path through a dangling link that leaves the root is outside it', () => {
  const root = home();
  const out = home();
  symlinkSync(join(out, 'missing'), join(root, 'evil'));
  assert.equal(inside(join(root, 'evil', 'x'), [root]), false);
  assert.equal(inside(join(root, 'fine', 'x'), [root]), true);
});

test('an empty BENCHKEEPER_HOME is not the working directory', () => {
  assert.equal(machineContext({ BENCHKEEPER_HOME: '' }).home, homedir());
});

test('a command that fails after its snapshot is taken can still be undone', () => {
  const dir = home();
  const c = context({ home: dir, run: () => { writeFileSync(join(dir, 'skill'), 'half'); return { code: 1, stdout: '', stderr: 'boom' }; } });
  writeFileSync(join(dir, 'skill'), 'before');
  const run = apply([{ id: 'c', step: 's', title: 'c', kind: 'command', argv: ['x'], cwd: dir, snapshot: [join(dir, 'skill')] }], c);
  assert.equal(run.entries[0].status, 'failed');
  assert.equal(undo(run.id, c).status, 'done');
  assert.equal(readFileSync(join(dir, 'skill'), 'utf8'), 'before');
});

test('an undo of a snapshot command records each file and its backup before it moves anything', () => {
  const dir = home();
  const c = context({ home: dir, run: () => { writeFileSync(join(dir, 'skill'), 'after'); return { code: 0, stdout: '', stderr: '' }; } });
  writeFileSync(join(dir, 'skill'), 'before');
  const run = apply([{ id: 'c', step: 's', title: 'c', kind: 'command', argv: ['x'], cwd: dir, snapshot: [join(dir, 'skill')] }], c);
  const saves = [];
  const save = c.ledger.save.bind(c.ledger);
  c.ledger.save = (r) => { if (r.kind === 'undo') saves.push(JSON.parse(JSON.stringify(r))); save(r); };
  undo(run.id, c);
  const first = saves.find((r) => r.entries[0]?.status === 'running');
  assert.equal(first.entries[0].files.length, 1);
  assert.ok(first.entries[0].files[0].backup);
});

test('a file changed between the preview and the apply is not overwritten with the old plan', () => {
  const c = context({ home: home() });
  const path = join(c.home, 'f');
  writeFileSync(path, 'old');
  const planned = preview([write(c, 'f', 'new')]);
  writeFileSync(path, 'edited by hand');
  const run = apply(planned, c);
  assert.equal(run.entries[0].status, 'failed');
  assert.match(run.entries[0].error, /changed since the plan/);
  assert.equal(readFileSync(path, 'utf8'), 'edited by hand');
});

test('two edits of one file in a plan still apply in order', () => {
  const c = context({ home: home() });
  writeFileSync(join(c.home, 'f'), 'a');
  const run = apply(preview([write(c, 'f', null, { id: '1', edit: (t) => `${t}b` }), write(c, 'f', null, { id: '2', edit: (t) => `${t}c` })]), c);
  assert.equal(run.status, 'done');
  assert.equal(readFileSync(join(c.home, 'f'), 'utf8'), 'abc');
});

test('a project run never writes into .git except the exclude list, also through a link', () => {
  const r = repo();
  symlinkSync('.git/config', join(r.dir, 'CLAUDE.local.md'));
  const pc = projectCtx(r.ctx, r.dir);
  const run = apply([
    { id: 'a', step: 'a', title: 'a', kind: 'write', path: join(r.dir, '.git/hooks/pre-commit'), after: 'x' },
    { id: 'b', step: 'b', title: 'b', kind: 'write', path: join(r.dir, 'CLAUDE.local.md'), after: '[core]\n\tfsmonitor = x\n' },
    { id: 'c', step: 'c', title: 'c', kind: 'write', path: join(r.dir, '.git/info/exclude'), after: '/x\n' },
    { id: 'd', step: 'd', title: 'd', kind: 'write', path: join(r.dir, 'ok.md'), after: 'ok' },
  ], pc);
  assert.deepEqual(run.entries.map((e) => e.status), ['failed', 'failed', 'done', 'done']);
  assert.equal(existsSync(join(r.dir, '.git/hooks/pre-commit')), false);
  assert.doesNotMatch(readFileSync(join(r.dir, '.git/config'), 'utf8'), /fsmonitor/);
});

test('a second run is refused while another process holds the lock; a lock of a dead process is taken over', () => {
  const c = context({ home: home() });
  mkdirSync(c.config, { recursive: true });
  writeFileSync(join(c.config, 'lock'), JSON.stringify({ pid: process.ppid }));
  assert.throws(() => apply([write(c, 'a', '1')], c), /another BenchKeeper run is in progress/);
  assert.throws(() => undo('20200101T000000Z-abcd', c), /another BenchKeeper run is in progress/);
  assert.equal(existsSync(join(c.home, 'a')), false);
  writeFileSync(join(c.config, 'lock'), JSON.stringify({ pid: spawnSync(process.execPath, ['-e', '']).pid }));
  assert.equal(apply([write(c, 'a', '1')], c).status, 'done');
  assert.equal(existsSync(join(c.config, 'lock')), false);
});

test('undo of a session whose snapshots are gone fails instead of reporting success', () => {
  const r = repo();
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'rm README.md && echo x > n']);
  r.git('prune', '--expire=now');
  const u = undo(run.id, r.ctx);
  assert.equal(u.status, 'failed');
  assert.match(u.entries[0].error, /snapshot/);
  assert.equal(existsSync(join(r.dir, 'README.md')), false);
});

test('a transcript that cannot be read does not lose the recorded session', () => {
  const r = repo();
  const folder = join(r.ctx.home, '.claude/projects', r.dir.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(folder, { recursive: true });
  symlinkSync(join(r.ctx.home, 'missing'), join(folder, 'x.jsonl'));
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'echo x > n']);
  assert.equal(r.ctx.ledger.get(run.id).entries[0].files.length, 1);
});

test('a default branch named by origin is a plain branch name: no option, no refspec syntax', () => {
  const ok = (name) => ({ code: 0, stdout: `ref: refs/heads/${name}\tHEAD\n` });
  assert.equal(remoteHead({}, '/p', ok('main')), 'main');
  assert.equal(remoteHead({}, '/p', ok('release/1.2')), 'release/1.2');
  for (const bad of ['-x', '+x:refs/heads/main', 'a:b', 'a*', '../x']) {
    const ctx = { run: () => ({ code: 1, stdout: '', stderr: '' }) };
    assert.notEqual(remoteHead(ctx, '/p', ok(bad)), bad, bad);
  }
});

test('only a github.com origin is a GitHub remote', () => {
  const at = (url) => githubRemote({ run: () => ({ code: 0, stdout: `${url}\n` }) }, '/p');
  for (const url of ['https://github.com/o/r.git', 'git@github.com:o/r.git', 'ssh://git@github.com/o/r.git', 'https://user@github.com/o/r']) assert.equal(at(url), true, url);
  for (const url of ['https://git.example/github.com/o/r.git', 'ssh://git@evil.example/github.com/x.git', 'https://notgithub.com/o/r', '']) assert.equal(at(url), false, url);
});

test('a failing git status is not a clean tree', () => {
  assert.equal(clean({ run: () => ({ code: 128, stdout: '', stderr: 'fatal' }) }, '/p'), false);
});

test('git gets no variable that points it at another repository', () => {
  const a = repo(), b = repo();
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = join(a.dir, '.git');
  process.env.GIT_WORK_TREE = a.dir;
  try {
    assert.equal(clean(b.ctx, b.dir), true);
    const top = recordSession(b.ctx, b.dir, ['sh', '-c', 'echo x > n']);
    assert.deepEqual(top.entries[0].files.map((f) => f.path), ['n']);
    assert.equal(existsSync(join(a.dir, 'n')), false);
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test('commands without a folder of their own run in the home, not in the folder the app was started in', () => {
  const seen = [];
  const c = context({ home: home(), run: (argv, o) => { seen.push(o.cwd); return { code: 0, stdout: '', stderr: '' }; } });
  apply([{ id: 'c', step: 's', title: 'c', kind: 'command', argv: ['x'] }], c);
  const registry = [];
  newest({ home: c.home, run: (argv, o) => { registry.push(o.cwd); return { code: 1 }; } }, 'pkg');
  assert.deepEqual([...seen, ...registry], [c.home, c.home]);
});

test('a pack file whose id is not a plain id is ignored, so removing it cannot reach other files', () => {
  const c = context({ home: home() });
  mkdirSync(join(c.config, 'packs'), { recursive: true });
  writeFileSync(join(c.config, 'packs', 'a.json'), JSON.stringify({ kind: 'benchkeeper-pack', id: '../../victim', skills: [] }));
  writeFileSync(join(c.config, 'packs', 'b.json'), '{');
  writeFileSync(join(c.home, '.config', 'victim.json'), 'keep');
  assert.deepEqual(ownPacks(c), []);
  assert.throws(() => removePack(c, '../../victim'), /no own pack/);
  assert.equal(readFileSync(join(c.home, '.config', 'victim.json'), 'utf8'), 'keep');
});

test('an eval set with a target or case id that is a path is refused when read', () => {
  const c = context({ home: home() });
  mkdirSync(join(c.config, 'evals'), { recursive: true });
  const set = (target, id) => JSON.stringify({ kind: 'benchkeeper-evals', schemaVersion: 1, target, cases: [{ id, query: 'q', should: true }] });
  writeFileSync(join(c.config, 'evals', 'x.json'), set('skill:../../x', 'c1'));
  assert.throws(() => loadCases(c), /outside letters/);
  writeFileSync(join(c.config, 'evals', 'x.json'), set('rule:ok', '../../results'));
  assert.throws(() => loadCases(c), /outside letters/);
  writeFileSync(join(c.config, 'evals', 'x.json'), set('rule:ok', 'c1'));
  assert.ok(loadCases(c)['rule:ok']);
});
