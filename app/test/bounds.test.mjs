// Bounds of Update all, project registration, the ledger and undo (docs/security.md, #202, #203, #205, #206).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { parseAdvice } from '../src/advise.mjs';
import { addCase } from '../src/cases.mjs';
import { appVersion } from '../src/content.mjs';
import { doctor } from '../src/doctor.mjs';
import { runEval } from '../src/eval.mjs';
import { integrity, ledgerIssues } from '../src/integrity.mjs';
import { removePack } from '../src/packs.mjs';
import { transcript } from '../src/session.mjs';
import { scanSessions } from '../src/sessions.mjs';
import { copy, hashPath, hashText } from '../src/fsx.mjs';
import { clean, git as runGit, repoEnv, safeBranch, snapshot } from '../src/git.mjs';
import { importChoices, importPlan, readProfile } from '../src/profile.mjs';
import { MAX_PROJECTS, addProject, scan, updateAll } from '../src/projects.mjs';
import { api } from '../src/server.mjs';
import { apply, context, preview, runCommand, undo, undoable } from '../src/runner.mjs';
import { STATE, projectCtx, projectPlan, scopeCtx } from '../src/steps/project.mjs';

const TMP = realpathSync(tmpdir());
const home = () => mkdtempSync(join(TMP, 'bk-bound-'));
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
const repo = () => {
  const dir = home();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init');
  return dir;
};
// A shared-setup project at an old setup version with a local bare origin; dir is the repository root unless sub is set.
function project(h, sub = '') {
  const root = repo();
  const dir = sub ? join(root, sub) : root;
  mkdirSync(dir, { recursive: true });
  const ctx = context({ home: h, roots: [h, dir] });
  apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', share: true } }).changes), ctx, { scope: dir });
  const state = JSON.parse(readFileSync(join(dir, STATE), 'utf8'));
  writeFileSync(join(dir, STATE), JSON.stringify({ ...state, setupVersion: '5.0.0' }));
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'setup');
  const origin = home();
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  return { root, dir };
}
const write = (c, path, after) => ({ id: `w-${path}`, step: 's', title: path, kind: 'write', path: join(c.home, path), after });
const cmd = (c, over = {}) => ({ id: 'c', step: 'c', title: 'c', kind: 'command', argv: ['claude', 'plugin', 'install', 'x'], undoArgv: ['claude', 'plugin', 'uninstall', 'x'], ...over });
const editRun = (c, id, f) => { const file = join(c.ledger.dir, `${id}.json`); const run = JSON.parse(readFileSync(file, 'utf8')); f(run); writeFileSync(file, JSON.stringify(run)); };

test('safeBranch takes the names git allows and refuses option and refspec syntax', () => {
  for (const n of ['main', 'feat/x', 'release@1', 'a+b', 'ünï', 'v1.0', 'x.y/z']) {
    assert.equal(safeBranch(n), n, n);
    assert.equal(spawnSync('git', ['check-ref-format', '--branch', n]).status, 0, `git takes ${n}`);
  }
  for (const n of ['+x', '-x', '@', 'a..b', 'a@{1}', 'a//b', 'x.lock', 'x/', 'x.', 'a b', 'a:b', 'a*b', 'a\\b', '', null]) assert.equal(safeBranch(n), null, String(n));
});

test('the -c settings of an outer git command pass only when no hook set the repository variables', () => {
  const env = { PATH: '/bin', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'a.b', GIT_CONFIG_VALUE_0: 'c', GIT_CONFIG_PARAMETERS: "'a.b=c'" };
  assert.deepEqual(Object.keys(repoEnv(env)).sort(), ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_VALUE_0', 'PATH']);
  assert.deepEqual(Object.keys(repoEnv({ ...env, GIT_DIR: '/x/.git' })), ['PATH']);
});

test('a repository that names a core.fsmonitor command does not run it for status and snapshots', () => {
  const dir = repo();
  const mark = join(home(), 'ran');
  const hook = join(home(), 'hook.sh');
  writeFileSync(hook, `#!/bin/sh\necho x >> '${mark}'\nprintf '\\0'\n`, { mode: 0o755 });
  git(dir, 'config', 'core.fsmonitor', hook);
  git(dir, 'status', '--porcelain');
  assert.equal(existsSync(mark), true, 'the hook runs under plain git');
  writeFileSync(mark, '');
  const c = context({ home: home(), run: runCommand });
  assert.equal(clean(c, dir), true);
  assert.match(snapshot(c, dir), /^[0-9a-f]{40,64}$/);
  assert.equal(readFileSync(mark, 'utf8'), '');
});

// A filter driver of the repository's own config runs a shell command for every path whose attributes name it.
function driverRepo(name, via = 'local') {
  const dir = repo();
  const mark = join(home(), 'ran');
  const script = join(home(), 'filter.sh');
  writeFileSync(script, `#!/bin/sh\necho "$1" >> '${mark}'\ncat\n`, { mode: 0o755 });
  writeFileSync(join(dir, '.gitattributes'), `* filter=${name}\n`);
  writeFileSync(join(dir, 'f.txt'), 'x\n');
  const target = via === 'include' ? join(home(), 'inc.cfg') : null;
  if (target) { git(dir, 'config', 'include.path', target); writeFileSync(target, ''); }
  const set = (k, v) => (target ? git(dir, 'config', '-f', target, `filter.${name}.${k}`, v) : git(dir, 'config', `filter.${name}.${k}`, v));
  for (const k of ['clean', 'smudge']) set(k, `${script} ${k}`);
  set('required', 'true');
  return { dir, mark };
}

test('a repository filter driver does not run for status, snapshots and worktree add, also under an odd name or through an include', () => {
  const c = context({ home: home(), run: runCommand });
  for (const [name, via] of [['evil', 'local'], ['a=b', 'local'], ['evil', 'include']]) {
    const { dir, mark } = driverRepo(name, via);
    git(dir, 'add', '-A');
    assert.equal(existsSync(mark), true, `the driver runs under plain git: ${name} ${via}`);
    git(dir, 'reset', '-q');
    rmSync(mark, { force: true });
    assert.equal(clean(c, dir), false, name);
    assert.match(snapshot(c, dir), /^[0-9a-f]{40,64}$/);
    assert.equal(existsSync(mark), false, `${name} ${via}: no driver ran for status and the snapshot`);
    assert.equal(runGit(c, dir, ['add', '-A']).code, 0, name);
    assert.equal(runGit(c, dir, ['commit', '-qm', 'files']).code, 0, name);
    assert.equal(existsSync(mark), false, `${name} ${via}: no driver ran for add and commit`);
    const tree = join(home(), 'wt');
    assert.equal(runGit(c, dir, ['worktree', 'add', '-q', tree, 'HEAD']).code, 0, name);
    assert.equal(existsSync(mark), false, `${name} ${via}: no driver ran for worktree add`);
  }
});

test('the git-lfs driver commands still run, any other command named git-lfs does not', () => {
  const bin = home(), mark = join(home(), 'ran');
  writeFileSync(join(bin, 'git-lfs'), `#!/bin/sh\necho "$@" >> '${mark}'\ncat\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  try {
    const c = context({ home: home(), run: runCommand });
    const dir = repo();
    writeFileSync(join(dir, '.gitattributes'), '* filter=lfs\n');
    writeFileSync(join(dir, 'f.txt'), 'x\n');
    git(dir, 'config', 'filter.lfs.clean', 'git-lfs clean -- %f');
    snapshot(c, dir);
    assert.match(readFileSync(mark, 'utf8'), /^clean -- /);
    rmSync(mark);
    git(dir, 'config', 'filter.lfs.clean', 'git-lfs clean -- %f; echo more');
    snapshot(c, dir);
    assert.equal(existsSync(mark), false);
  } finally { process.env.PATH = path; }
});

test('the root of a drive, the home folder, its parents and the config folder are no project', () => {
  const h = home();
  const c = context({ home: h });
  mkdirSync(join(c.config, 'ledger'), { recursive: true });
  for (const p of ['/', h, dirname(h), c.config, join(c.config, 'ledger')]) {
    assert.throws(() => addProject(c, p), /is the (root of a drive|home folder or a parent|BenchKeeper config)/, p);
    assert.throws(() => projectCtx(c, p), /a project is its own folder/, p);
  }
  mkdirSync(join(h, 'work'));
  assert.equal(addProject(c, join(h, 'work')), join(h, 'work'));
});

test('a scan walks no drive root and no config folder, and still scans the home folder and a folder holding it', () => {
  const h = home();
  const c = context({ home: h });
  mkdirSync(join(h, 'work', 'app'), { recursive: true });
  writeFileSync(join(h, 'work', 'app', 'AGENTS.md'), '#\n');
  for (const p of ['/', c.config]) assert.throws(() => scan(c, p), /root of a drive|config folder/, p);
  assert.deepEqual(scan(c, h), [join(h, 'work', 'app')]);
  assert.deepEqual(scan(c, join(h, 'work')), [join(h, 'work', 'app')]);
});

test('a profile import registers no home folder and gives it no plan', () => {
  const h = home();
  const c = context({ home: h });
  const dir = home();
  const p = readProfile(JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['claude'] }, projects: [{ path: h, answers: { agents: ['claude'] } }, { path: dir }] }));
  const done = importChoices(c, p);
  assert.deepEqual(done.projects, [dir]);
  assert.match(done.refused[0], /home folder/);
  assert.deepEqual(importPlan(c, p).projects.map((x) => x.path), [dir]);
});

test('undo takes the scope of a run from a folder that could be a project only', () => {
  const h = home();
  const c = context({ home: h });
  assert.equal(scopeCtx(c, 'global'), c);
  assert.throws(() => scopeCtx(c, h), /home folder/);
  assert.throws(() => scopeCtx(c, '/'), /root of a drive/);
  assert.throws(() => scopeCtx(c, join(h, 'gone')), /not a folder here/);
  assert.throws(() => scopeCtx(c, { path: '/' }), /not a folder here/);
});

test('Update all pushes to a bounded number of repositories and a project in a subfolder stops', () => {
  const h = home();
  const c = context({ home: h });
  assert.equal(MAX_PROJECTS, 25);
  // The cap counts the repositories a run pushes to (a GitHub origin and a pull request): local setups and a --no-push run are not bounded by it.
  const hub = context({ home: h, run: (argv, o) => (argv.includes('get-url') ? { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' } : c.run(argv, o)) });
  const paths = ['/a', '/b', '/c'];
  const answers = (share) => Object.fromEntries(paths.map((p) => [p, { share }]));
  assert.throws(() => updateAll(hub, { paths, max: 2, answers: answers(true) }), /3 repositories to push to: .* at most 2/);
  assert.equal(updateAll(hub, { paths, max: 2, push: false, answers: answers(true) }).length, 3);
  assert.equal(updateAll(hub, { paths, max: 2, answers: answers(false) }).length, 3);
  assert.equal(updateAll(c, { paths: ['/a', '/b', '/c'], max: 2 }).length, 3);
  const p = project(h, 'sub');
  addProject(c, p.dir);
  const [r] = updateAll(c, { paths: [p.dir], push: false });
  assert.equal(r.status, 'stopped');
  assert.match(r.reason, /subfolder of a repository/);
});

test('a failed fetch never starts a pushed branch at the local default branch', () => {
  const h = home();
  const p = project(h);
  writeFileSync(join(p.dir, 'unpushed.txt'), 'local only\n');
  git(p.dir, 'add', '-A');
  git(p.dir, 'commit', '-qm', 'unpushed');
  const base = context({ home: h });
  const calls = [];
  const ctx = context({ home: h, run: (argv, o) => {
    if (argv.includes('get-url')) return { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' };
    if (argv.includes('fetch')) return { code: 128, stdout: '', stderr: 'could not resolve host' };
    if (argv.includes('push') || argv[0] === 'gh') calls.push(argv);
    return base.run(argv, o);
  } });
  const [r] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(r.status, 'stopped');
  assert.match(r.reason, /could not fetch origin\/main/);
  assert.deepEqual(calls, []);
  assert.equal(git(p.dir, 'branch', '--list', 'chore/*').trim(), '');
  // Nothing is pushed: the local start is as before.
  const [local] = updateAll(ctx, { paths: [p.dir], push: false });
  assert.equal(local.status, 'committed', local.reason);
});

test('git push, ls-remote, commit, worktree add and gh pr create run with a time limit and no prompt', () => {
  const h = home();
  const p = project(h);
  const base = context({ home: h });
  const seen = {};
  const ctx = context({ home: h, run: (argv, o) => {
    if (argv[0] === 'gh') { seen.gh = o; return { code: 0, stdout: 'https://github.com/o/r/pull/1\n', stderr: '' }; }
    if (argv.includes('get-url')) return { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' };
    for (const k of ['push', 'ls-remote', 'commit']) if (argv.includes(k)) seen[k] = o;
    if (argv.includes('worktree') && argv.includes('add')) seen.worktree = o;
    return base.run(argv, o);
  } });
  const [r] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(r.status, 'pull request', r.reason);
  for (const k of ['push', 'ls-remote', 'commit', 'worktree', 'gh']) assert.ok(seen[k]?.timeout > 0, `${k} has a timeout`);
  for (const k of ['push', 'ls-remote']) assert.equal(seen[k].env.GIT_TERMINAL_PROMPT, '0', `${k} never prompts`);
});

test('Update all clears only its own stale worktree record, never the records of the user\'s other worktrees', () => {
  const h = home();
  const c = context({ home: h });
  const p = project(h);
  addProject(c, p.dir);
  const other = join(home(), 'other');
  git(p.dir, 'worktree', 'add', '-q', '-b', 'mine', other);
  execFileSync('rm', ['-rf', other]);
  // This app's own worktree: registered, its folder gone (a run that was cut off).
  const tree = join(h, '.cache/benchkeeper/worktrees', `${p.dir.split('/').pop()}-${hashText(p.dir).slice(0, 8)}-agent-setup-${appVersion}`);
  git(p.dir, 'worktree', 'add', '-q', '-B', `chore/agent-setup-${appVersion}`, tree);
  execFileSync('rm', ['-rf', tree]);
  const [r] = updateAll(c, { paths: [p.dir], push: false });
  assert.equal(r.status, 'committed', r.reason + r.worktree);
  assert.match(git(p.dir, 'worktree', 'list', '--porcelain'), new RegExp(`worktree ${other}[\\s\\S]*prunable`));
});

test('update-all --dry-run stops after the plan, --max must be a number, a cap stops the run', async () => {
  const h = home();
  const base = context({ home: h });
  const ctx = context({ home: h, run: (argv, o) => (argv.includes('get-url') ? { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' } : base.run(argv, o)) });
  const a = project(h), b = project(h);
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args, answers = '') => main(args, { out, ctx, input: Readable.from([answers]) });
  assert.equal(await exec(['projects', 'add', a.dir, b.dir]), 0);
  assert.equal(await exec(['update-all', '--dry-run']), 0);
  assert.match(text, /dry run: 2 projects would be updated, nothing changed/);
  assert.equal(git(a.dir, 'branch', '--list', 'chore/*').trim(), '');
  assert.equal(await exec(['update-all', '--max', 'x']), 2);
  assert.equal(await exec(['projects', 'unshare', '--max', '0']), 2);
  assert.equal(await exec(['update-all', '--yes', '--max', '1']), 1);
  assert.match(text, /2 repositories to push to: Update all pushes to at most 1 per run/);
  assert.equal(git(a.dir, 'branch', '--list', 'chore/*').trim(), '');
});

test('apply --all names the removals and asks once; restore lists its files and asks', async () => {
  const h = home();
  const ctx = context({ home: h, run: (argv) => (argv[0] === 'npm' ? { code: 1, stdout: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' }) });
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args, answers = '') => main(args, { out, ctx, input: Readable.from([answers]) });
  mkdirSync(join(h, '.claude'), { recursive: true });
  writeFileSync(join(h, '.claude/settings.json'), JSON.stringify({ permissions: { ask: ['Bash(mine *)'] } }));
  const asked = () => JSON.parse(readFileSync(join(h, '.claude/settings.json'), 'utf8')).permissions?.ask;
  assert.equal(await exec(['apply', '--agents', 'claude', '--all'], 'n\n'), 0);
  assert.match(text, /remove .*Bash\(mine \*\)/);
  assert.match(text, /Apply \d+ changes, 1 of them removals/);
  assert.deepEqual(asked(), ['Bash(mine *)']);
  assert.equal(existsSync(join(h, '.claude/rules/00-global.md')), false);
  assert.equal(await exec(['apply', '--agents', 'claude', '--all'], 'y\n'), 0);
  assert.equal(asked(), undefined);
  const name = '2024-01-01-000000';
  mkdirSync(join(ctx.ledger.backups, name), { recursive: true });
  writeFileSync(join(ctx.ledger.backups, name, 'restored.txt'), 'back\n');
  assert.equal(await exec(['restore', name], 'n\n'), 1);
  assert.match(text, /restore restored\.txt/);
  assert.equal(existsSync(join(h, 'restored.txt')), false);
  assert.equal(await exec(['restore', name, '--yes']), 0);
  assert.equal(readFileSync(join(h, 'restored.txt'), 'utf8'), 'back\n');
});

test('a dead lock is taken over under a guard; a reused pid is not the dead run; a fresh guard stops a second taker', () => {
  const c = context({ home: home() });
  mkdirSync(c.config, { recursive: true });
  const lock = join(c.config, 'lock');
  // A fresh takeover guard: another process is clearing a dead lock right now.
  writeFileSync(lock, JSON.stringify({ pid: spawnSync(process.execPath, ['-e', '']).pid }));
  writeFileSync(`${lock}.takeover`, '1');
  assert.throws(() => c.ledger.lock(), /another BenchKeeper run is in progress/);
  // An old guard is a crash's: removed, and the dead lock goes.
  const old = new Date(Date.now() - 60e3);
  utimesSync(`${lock}.takeover`, old, old);
  c.ledger.lock()();
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(`${lock}.takeover`), false);
  // The pid is alive but started at another time: a reused pid.
  if (existsSync('/proc/self/stat')) {
    writeFileSync(lock, JSON.stringify({ pid: process.ppid, start: '1' }));
    c.ledger.lock()();
    assert.equal(existsSync(lock), false);
  }
});

test('a ledger file that does not parse is named, not thrown as a parser error', () => {
  const c = context({ home: home() });
  apply([write(c, 'a', '1')], c);
  writeFileSync(join(c.ledger.dir, 'broken.json'), '{not json');
  assert.deepEqual(c.ledger.broken(), ['broken.json']);
  assert.throws(() => c.ledger.get('broken'), (e) => e.status === 500 && /ledger file of run broken is unreadable \(not valid JSON\)/.test(e.message) && !/Unexpected token/.test(e.message));
});

test('undo runs the plugin commands plans produce and nothing else a ledger file names', () => {
  assert.equal(undoable(['claude', 'plugin', 'uninstall', 'p@m']), true);
  assert.equal(undoable(['codex', 'plugin', 'marketplace', 'remove', 'm']), true);
  for (const a of [['sh', '-c', 'x'], ['claude', 'plugin', 'uninstall', '--all'], ['claude', 'plugin', 'uninstall'], ['claude', 'plugin', 'uninstall', 'a', 'b'], ['codex', 'mcp', 'remove', 'x'], 'claude plugin uninstall x', null]) assert.equal(undoable(a), false, String(a));
  const calls = [];
  const c = context({ home: home(), run: (argv) => { calls.push(argv.join(' ')); return { code: 0, stdout: '', stderr: '' }; } });
  const run = apply([cmd(c, { undoArgv: ['sh', '-c', 'touch pwned'] }), cmd(c, { id: 'd', step: 'd', undoArgv: ['claude', 'plugin', 'uninstall', 'y'], cwd: '/' })], c);
  const u = undo(run.id, c);
  assert.deepEqual(u.entries.map((e) => e.status), ['failed', 'failed']);
  assert.match(u.entries[0].error, /outside/);
  assert.match(u.entries[1].error, /not one this app plans/);
  assert.deepEqual(calls.filter((x) => /uninstall|touch/.test(x)), []);
});

test('undo restores from backups inside this config folder only', () => {
  const c = context({ home: home() });
  const outside = join(home(), 'secret');
  writeFileSync(outside, 'not a backup');
  writeFileSync(join(c.home, 'a'), 'old');
  const run = apply([write(c, 'a', 'new')], c);
  editRun(c, run.id, (r) => { r.entries[0].backup = outside; r.entries[0].hashBefore = hashPath(outside); });
  const u = undo(run.id, c);
  assert.equal(u.status, 'failed');
  assert.match(u.entries[0].error, /is not in /);
  assert.equal(readFileSync(join(c.home, 'a'), 'utf8'), 'new');
});

test('undo of a failed snapshot command keeps a later hand edit of its paths', () => {
  const h = home();
  const path = join(h, 'skills/x');
  const c = context({ home: h, run: () => { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'f'), 'by the command'); return { code: 1, stdout: '', stderr: 'boom' }; } });
  const run = apply([cmd(c, { snapshot: [path] })], c);
  assert.equal(run.status, 'failed');
  writeFileSync(join(path, 'f'), 'my edit');
  const u = undo(run.id, c);
  assert.equal(u.status, 'failed');
  assert.match(u.entries[0].error, /changed after this change/);
  assert.equal(readFileSync(join(path, 'f'), 'utf8'), 'my edit');
  // Untouched since the failure: the snapshot comes back.
  writeFileSync(join(path, 'f'), 'by the command');
  assert.equal(undo(run.id, c).status, 'done');
  assert.equal(existsSync(path), false);
});

test('an undo of overlapping snapshot paths completes, and the undo of that undo restores both', () => {
  const h = home();
  const dir = join(h, 'skills/x'), nested = join(dir, 'sub');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(dir, 'a'), 'a0');
  writeFileSync(join(nested, 'b'), 'b0');
  const c = context({ home: h, run: () => { writeFileSync(join(dir, 'a'), 'a1'); writeFileSync(join(nested, 'b'), 'b1'); return { code: 0, stdout: '', stderr: '' }; } });
  const run = apply([cmd(c, { snapshot: [dir, nested] })], c);
  const u = undo(run.id, c);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  assert.equal(readFileSync(join(nested, 'b'), 'utf8'), 'b0');
  const again = undo(u.id, c);
  assert.equal(again.status, 'done', JSON.stringify(again.entries));
  assert.equal(readFileSync(join(dir, 'a'), 'utf8'), 'a1');
  assert.equal(readFileSync(join(nested, 'b'), 'utf8'), 'b1');
});

test('an undo that fails midway can itself be undone: files it never reached are left alone', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const h = home();
  const a = join(h, 'one/a'), b = join(h, 'two/b');
  for (const p of [a, b]) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, 'old'); }
  const c = context({ home: h, run: () => { writeFileSync(a, 'new'); writeFileSync(b, 'new'); return { code: 0, stdout: '', stderr: '' }; } });
  const run = apply([cmd(c, { snapshot: [a, b] })], c);
  // The second file cannot be moved aside: its folder is read-only.
  chmodSync(dirname(b), 0o555);
  const u = undo(run.id, c);
  chmodSync(dirname(b), 0o755);
  assert.equal(u.status, 'failed');
  assert.equal(readFileSync(a, 'utf8'), 'old');
  assert.equal(readFileSync(b, 'utf8'), 'new');
  // Undoing the failed undo puts the first file back as the command left it and does not touch the second.
  const again = undo(u.id, c);
  assert.equal(again.status, 'done', JSON.stringify(again.entries));
  assert.equal(readFileSync(a, 'utf8'), 'new');
  assert.equal(readFileSync(b, 'utf8'), 'new');
});

test('an undo stopped before it recorded a file\'s state does not replace a path made since', () => {
  const h = home();
  const a = join(h, 'one/a');
  mkdirSync(dirname(a), { recursive: true });
  writeFileSync(a, 'old');
  const c = context({ home: h, run: () => { writeFileSync(a, 'new'); return { code: 0, stdout: '', stderr: '' }; } });
  const u = undo(apply([cmd(c, { snapshot: [a] })], c).id, c);
  assert.equal(u.status, 'done');
  // The journal of that undo ends after the set-aside: hashAfter is missing, the file was moved away.
  editRun(c, u.id, (r) => { delete r.entries[0].files[0].hashAfter; });
  writeFileSync(a, 'made by hand');
  const again = undo(u.id, c);
  assert.equal(again.status, 'failed');
  assert.match(again.entries[0].error, /changed after this change/);
  assert.equal(readFileSync(a, 'utf8'), 'made by hand');
  // Nothing at the path: the replay puts the file back.
  rmSync(a);
  assert.equal(undo(u.id, c).status, 'done');
  assert.equal(readFileSync(a, 'utf8'), 'new');
});

test('a ledger scope outside any project is refused by the CLI undo, and a link to a drive root is no project', async () => {
  const h = home();
  const c = context({ home: h });
  const dir = home();
  const pctx = projectCtx(c, dir);
  const run = apply([{ id: 'w', step: 's', title: 'f', kind: 'write', path: join(dir, 'f'), after: '1' }], pctx, { scope: dir });
  editRun(c, run.id, (r) => { r.scope = h; });
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  assert.equal(await main(['undo', run.id], { out, ctx: c, input: Readable.from(['']) }), 1);
  assert.match(text, /home folder/);
  assert.equal(readFileSync(join(dir, 'f'), 'utf8'), '1');
  symlinkSync('/', join(h, 'rootlink'));
  assert.throws(() => addProject(c, join(h, 'rootlink')), /root of a drive/);
});

test('doctor names an edited file, an unfinished run, an unreadable run file and an invalid pack file', () => {
  const h = home();
  const c = context({ home: h, run: () => ({ code: 0, stdout: '', stderr: '' }) });
  const run = apply([write(c, 'a', '1'), write(c, 'b', '1')], c);
  writeFileSync(join(h, 'a'), 'edited by hand');
  c.ledger.save({ schema: 1, id: '20200101T000000Z-aaaaaa', time: '2020-01-01T00:00:00.000Z', appVersion: '1.0.0', kind: 'apply', scope: 'global', entries: [] });
  writeFileSync(join(c.ledger.dir, 'broken.json'), '{');
  mkdirSync(join(c.config, 'packs'), { recursive: true });
  writeFileSync(join(c.config, 'packs', 'x.json'), 'nope');
  writeFileSync(join(c.config, 'packs', 'Bad Id.json'), JSON.stringify({ id: 'Bad Id', skills: [] }));
  const messages = integrity(c).map((i) => i.message);
  assert.deepEqual(messages.filter((m) => /changed since/.test(m)), [`${join(h, 'a')} changed since run ${run.id}`]);
  assert.ok(messages.includes('run 20200101T000000Z-aaaaaa did not finish'));
  assert.ok(messages.includes('ledger file broken.json is unreadable'));
  assert.ok(messages.includes('pack file x.json is not used: not valid JSON'));
  assert.ok(messages.includes('pack file Bad Id.json is not used: the id is not a plain id'));
  assert.deepEqual(ledgerIssues(c).map((i) => i.message).filter((m) => /pack/.test(m)), []);
  const found = doctor(c, { agents: [], env: {} }).filter((i) => i.check === 'ledger');
  assert.equal(found.length, 5);
  removePack(c, 'x.json');
  assert.equal(existsSync(join(c.config, 'packs', 'x.json')), false);
  assert.throws(() => removePack(c, '../x'), /no own pack/);
});

test('the transcript of a recorded session is the one of that agent, started in that folder', () => {
  const h = home(), dir = home(), other = home();
  const claude = join(h, '.claude/projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'c.jsonl'), '{}\n');
  const day = join(h, '.codex/sessions/2026/10/25');
  mkdirSync(day, { recursive: true });
  const rollout = (name, cwd) => { writeFileSync(join(day, name), `${JSON.stringify({ type: 'session_meta', payload: { cwd } })}\n`); return join(day, name); };
  const mine = rollout('rollout-a.jsonl', dir);
  rollout('rollout-b.jsonl', other);
  assert.equal(transcript(h, dir, 0, 'codex'), mine);
  assert.equal(transcript(h, dir, 0, 'claude'), join(claude, 'c.jsonl'));
  writeFileSync(join(day, 'rollout-c.jsonl'), `${JSON.stringify({ type: 'session_meta', payload: { cwd: 7 } })}\n`);
  assert.equal(transcript(h, dir, 0, 'codex'), mine);
  assert.equal(transcript(h, dir, 0, 'gemini'), null);
  assert.equal(transcript(h, other, 0, 'claude'), null);
});

test('a board scan survives a pr-link that is no string and a skill listing with other names', async () => {
  const h = home();
  const dir = join(h, '.claude/projects/p');
  mkdirSync(dir, { recursive: true });
  const line = (o) => JSON.stringify({ timestamp: '2026-10-20T10:00:00.000Z', cwd: '/work/x', ...o });
  writeFileSync(join(dir, 's.jsonl'), [line({ type: 'pr-link', prUrl: 42 }), line({ type: 'attachment', attachment: { type: 'skill_listing', names: [1, null, 'tdd'] } }), line({ type: 'ai-title', aiTitle: 't' })].join('\n'));
  const rows = await scanSessions(context({ home: h }));
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].prs, []);
});

test('advice names each pack and skill once', () => {
  const lib = { packs: [{ id: 'a' }], skills: [{ name: 's' }] };
  const r = parseAdvice('{"packs":[{"id":"a","reason":"x"},{"id":"a","reason":"y"}],"skills":[{"name":"s"},{"name":"s"},{"name":"zz"}]}', lib);
  assert.deepEqual([r.packs.length, r.skills.length], [1, 1]);
});

test('an answer of many opening braces and no closing one is rejected without a long scan', () => {
  const start = Date.now();
  assert.throws(() => parseAdvice('{'.repeat(200_000), { packs: [], skills: [] }), /no JSON/);
  assert.ok(Date.now() - start < 2000);
});

test('a query that starts with a dash is no eval case', async () => {
  const c = context({ home: home(), run: () => ({ code: 0, stdout: '', stderr: '' }) });
  assert.throws(() => addCase(c, { target: 'skill:x', expected: 'it triggers', query: '--help me' }), /starts with a dash/);
  await assert.rejects(runEval(c, [{ target: 'skill:x', agent: 'claude', cases: [{ id: 'k', query: '-p x', should: true }] }]), /starts with a dash/);
  await assert.rejects(runEval(c, [{ target: 'skill:x', agent: 'claude', cases: [{ id: 'k', query: '', should: true }] }]), /empty/);
});

test('a hand-edited AGENTS.override.md is offered for removal, not preselected; one as written is preselected', () => {
  const h = home(), dir = home();
  const c = context({ home: h, roots: [h, dir] });
  const share = () => preview(projectPlan({ ctx: c, dir, answers: { agents: ['codex'], env: 'host', share: true } }).changes).filter((x) => x.step === 'local-codex' && x.kind === 'remove');
  apply(preview(projectPlan({ ctx: c, dir, answers: { agents: ['codex'], env: 'host', share: false } }).changes), projectCtx(c, dir), { scope: dir });
  const [pristine] = share();
  assert.deepEqual([pristine.selected, pristine.destructive], [true, true]);
  writeFileSync(join(dir, 'AGENTS.override.md'), `my own notes\n\n${readFileSync(join(dir, 'AGENTS.override.md'), 'utf8')}`);
  const [edited] = share();
  assert.equal(edited.selected, false);
  assert.match(edited.title, /text of your own/);
});

test('the Update all dry run of the server leaves out file contents, like every plan route', () => {
  const h = home();
  const c = context({ home: h });
  const p = project(h);
  addProject(c, p.dir);
  const [row] = api(c)['POST /api/update-all']({ paths: [p.dir], dryRun: true });
  assert.ok(row.changes.length > 0);
  assert.equal(row.changes.some((x) => 'after' in x || 'edit' in x), false);
  assert.equal(git(p.dir, 'branch', '--list', 'chore/*').trim(), '');
});

test('a .git file or link that points at another repository gives the project no info/exclude root; a worktree and a submodule keep theirs', { skip: process.platform === 'win32' }, () => {
  const h = home();
  const c = context({ home: h, run: runCommand });
  const victim = repo();
  const planted = home();
  writeFileSync(join(planted, '.git'), `gitdir: ${join(victim, '.git')}\n`);
  assert.deepEqual(projectCtx(c, planted).roots, [planted]);
  const linked = home();
  symlinkSync(join(victim, '.git'), join(linked, '.git'));
  assert.deepEqual(projectCtx(c, linked).roots, [linked]);
  const main = repo();
  const wt = join(home(), 'wt');
  git(main, 'worktree', 'add', '-q', '-b', 'w', wt);
  assert.deepEqual(projectCtx(c, wt).roots, [wt, join(main, '.git', 'info', 'exclude')]);
  const sub = repo();
  git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'mod');
  assert.deepEqual(projectCtx(c, join(main, 'mod')).roots.length, 2);
});

test('doctor names a recorded file it cannot read and goes on', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const h = home();
  const c = context({ home: h, run: () => ({ code: 0, stdout: '', stderr: '' }) });
  apply([write(c, 'dir/a', '1'), write(c, 'b', '1')], c);
  writeFileSync(join(h, 'b'), 'edited by hand');
  mkdirSync(join(h, 'dir/sub'));
  chmodSync(join(h, 'dir/a'), 0);
  try {
    const messages = integrity(c).map((i) => i.message);
    assert.ok(messages.some((m) => m.startsWith(`${join(h, 'dir/a')} cannot be read`)));
    assert.ok(messages.some((m) => m.startsWith(`${join(h, 'b')} changed since`)));
  } finally { chmodSync(join(h, 'dir/a'), 0o644); }
});

test('a copy that fails midway leaves no half-written path and no temporary file', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const h = home();
  mkdirSync(join(h, 'from/sub'), { recursive: true });
  writeFileSync(join(h, 'from/a'), 'a');
  writeFileSync(join(h, 'from/sub/b'), 'b');
  chmodSync(join(h, 'from/sub/b'), 0);
  try {
    assert.throws(() => copy(join(h, 'from'), join(h, 'to')));
    assert.deepEqual(readdirSync(h), ['from']);
  } finally { chmodSync(join(h, 'from/sub/b'), 0o644); }
  copy(join(h, 'from'), join(h, 'to'));
  assert.equal(hashPath(join(h, 'to')), hashPath(join(h, 'from')));
  assert.deepEqual(readdirSync(h).sort(), ['from', 'to']);
});
