import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { projectChecks } from '../src/doctor.mjs';
import { appVersion, contentVersion } from '../src/content.mjs';
import { addProject, canon, gitCodeConfig, listProjects, prefetchOrigins, removeProject, scan, status, updateAll } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { STATE, projectPlan } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());

const home = () => mkdtempSync(join(TMP, 'bk-home-'));
// A project set up by an older setup version, committed on main, with a local bare origin (not GitHub).
function project(h) {
  const dir = mkdtempSync(join(TMP, 'bk-proj-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  const ctx = context({ home: h, roots: [h, dir] });
  apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', share: true } }).changes), ctx, { scope: dir });
  const state = JSON.parse(readFileSync(join(dir, STATE), 'utf8'));
  writeFileSync(join(dir, STATE), JSON.stringify({ ...state, appVersion: '5.0.0', contentVersion: '5.0.0' }));
  git('add', '-A');
  git('commit', '-qm', 'init');
  const origin = mkdtempSync(join(TMP, 'bk-origin-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  return { dir, git };
}

test('registry: add, list, remove; scan finds folders with an agent setup', () => {
  const h = home();
  const ctx = context({ home: h });
  const root = mkdtempSync(join(TMP, 'bk-scan-'));
  for (const d of ['a', 'b/c', 'node_modules/x']) { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, 'AGENTS.md'), '#\n'); }
  mkdirSync(join(root, 'e'));
  assert.deepEqual(scan(ctx, root).map((d) => d.slice(canon(root).length + 1)).sort(), ['a', 'b/c']);
  addProject(ctx, join(root, 'a'));
  addProject(ctx, join(root, 'a'));
  assert.deepEqual(listProjects(ctx).map((p) => p.path), [canon(join(root, 'a'))]);
  // A list with an unregistered folder removes none.
  assert.throws(() => removeProject(ctx, [join(root, 'a'), join(root, 'e')]), new RegExp(`${canon(join(root, 'e'))} is not a registered project`));
  assert.deepEqual(listProjects(ctx).map((p) => p.path), [canon(join(root, 'a'))]);
  removeProject(ctx, join(root, 'a'));
  assert.deepEqual(listProjects(ctx), []);
  assert.throws(() => removeProject(ctx, join(root, 'a')), /is not a registered project/);
  assert.throws(() => addProject(ctx, join(root, 'missing')), /does not exist/);
});

test('registry: a change waits for the run lock another process holds and keeps that process\'s entries', () => {
  const ctx = context({ home: home() });
  const root = mkdtempSync(join(TMP, 'bk-reg-'));
  for (const d of ['a', 'b', 'c']) mkdirSync(join(root, d));
  addProject(ctx, join(root, 'a'));
  // Another process (the parent is alive) holds the lock and adds c meanwhile.
  writeFileSync(join(ctx.config, 'lock'), JSON.stringify({ pid: process.ppid }));
  const theirs = [...listProjects(ctx), { path: canon(join(root, 'c')), added: new Date().toISOString() }];
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: theirs }));
  assert.throws(() => addProject(ctx, join(root, 'b')), /another BenchKeeper run is in progress/);
  assert.throws(() => removeProject(ctx, join(root, 'a')), /another BenchKeeper run is in progress/);
  rmSync(join(ctx.config, 'lock'));
  addProject(ctx, join(root, 'b'));
  assert.deepEqual(listProjects(ctx).map((p) => p.path), ['a', 'c', 'b'].map((d) => canon(join(root, d))));
  // Re-entrant: a caller inside a run of this process goes on.
  const release = ctx.ledger.lock();
  try { removeProject(ctx, join(root, 'c')); } finally { release(); }
  assert.deepEqual(listProjects(ctx).map((p) => p.path), ['a', 'b'].map((d) => canon(join(root, d))));
});

test('registry: a parsed file without a projects list is empty', () => {
  const ctx = context({ home: home() });
  mkdirSync(ctx.config, { recursive: true });
  for (const text of ['{}', '{"projects":{}}']) {
    writeFileSync(join(ctx.config, 'projects.json'), text);
    assert.deepEqual(listProjects(ctx), []);
  }
});

test('registry: one folder is one project, also through a symlink, in the registry and in the scan', async () => {
  const h = home();
  const ctx = context({ home: h });
  const real = mkdtempSync(join(TMP, 'bk-real-'));
  mkdirSync(join(real, 'app'));
  writeFileSync(join(real, 'app', 'AGENTS.md'), '#\n');
  const link = join(mkdtempSync(join(TMP, 'bk-link-')), 'Projects');
  symlinkSync(real, link);
  addProject(ctx, join(real, 'app'));
  addProject(ctx, join(link, 'app'));
  assert.deepEqual(listProjects(ctx).map((p) => p.path), [canon(join(real, 'app'))]);
  // A registry written before paths were canonical: both entries merge, and a kept state survives.
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [
    { path: join(real, 'app'), added: '2026-01-01T00:00:00.000Z' }, { path: join(link, 'app'), added: '2026-02-01T00:00:00.000Z', state: { setupVersion: '6.0.0' } }] }));
  const merged = listProjects(ctx);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].added, '2026-01-01T00:00:00.000Z');
  assert.equal(merged[0].state.setupVersion, '6.0.0');
  // The scan below the symlink does not offer the registered folder, and removal through either path removes it.
  const found = scan(ctx, link).filter((d) => !listProjects(ctx).some((p) => p.path === canon(d)));
  assert.deepEqual(found, []);
  // The command prints the path the registry stored, not the one given.
  let shown = '';
  assert.equal(await main(['projects', 'remove', join(link, 'app')], { out: new Writable({ write(c, _, done) { shown += c; done(); } }), ctx }), 0);
  assert.equal(shown, `removed ${canon(join(real, 'app'))}\n`);
  assert.deepEqual(listProjects(ctx), []);
});

test('Update all runs the hooks of the checkout, not those of the fetched tree', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const mark = join(h, 'hook-ran');
  const hook = (who, name = 'pre-commit') => { mkdirSync(join(p.dir, '.githooks'), { recursive: true }); writeFileSync(join(p.dir, '.githooks', name), `#!/bin/sh\necho ${who} > '${mark}-${name}'\n`, { mode: 0o755 }); };
  hook('fetched');
  hook('fetched', 'post-checkout');
  p.git('add', '-A');
  p.git('commit', '-qm', 'hooks');
  p.git('push', '-q', 'origin', 'main');
  p.git('reset', '-q', '--hard', 'HEAD~1');
  hook('local');
  hook('local', 'post-checkout');
  writeFileSync(join(p.dir, '.git/info/exclude'), '.githooks/\n');
  p.git('config', 'core.hooksPath', '.githooks');
  addProject(ctx, p.dir);
  const [r] = updateAll(ctx, { push: false });
  assert.equal(r.status, 'committed', r.reason);
  assert.equal(readFileSync(`${mark}-pre-commit`, 'utf8'), 'local\n');
  // git finds a relative hook from the checkout but runs it in the new worktree: without the override, worktree add
  // would run the fetched post-checkout.
  assert.equal(readFileSync(`${mark}-post-checkout`, 'utf8'), 'local\n');
});

test('Update all runs no hook of the fetched tree for add and status in the worktree', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const mark = join(h, 'index-hook-ran');
  // A global core.hooksPath of .githooks would run the hook during the fixture's own add and commit.
  p.git('config', 'core.hooksPath', join(h, 'no-hooks'));
  mkdirSync(join(p.dir, '.githooks'), { recursive: true });
  writeFileSync(join(p.dir, '.githooks', 'post-index-change'), `#!/bin/sh\necho fetched > '${mark}'\n`, { mode: 0o755 });
  p.git('add', '-A');
  p.git('commit', '-qm', 'hooks');
  p.git('push', '-q', 'origin', 'main');
  p.git('reset', '-q', '--hard', 'HEAD~1');
  p.git('config', 'core.hooksPath', '.githooks');
  addProject(ctx, p.dir);
  const [r] = updateAll(ctx, { push: false });
  assert.equal(r.status, 'committed', r.reason);
  assert.equal(existsSync(mark), false);
});

test('Update all commits the new setup on a branch in a worktree and leaves the checkout alone', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  addProject(ctx, p.dir);
  const s = status(ctx, p.dir);
  assert.deepEqual([s.setupVersion, s.clean, s.branch], ['5.0.0', true, 'main']);
  assert.ok(s.changes.some((c) => c.path.endsWith(STATE)));
  const [r] = updateAll(ctx);
  assert.equal(r.status, 'committed', r.reason);
  assert.equal(p.git('branch', '--show-current').trim(), 'main');
  assert.match(readFileSync(join(p.dir, STATE), 'utf8'), /"5\.0\.0"/);
  assert.equal(JSON.parse(p.git('show', `${r.branch}:${STATE}`)).contentVersion, appVersion);
  assert.equal(p.git('log', '--format=%s', '-1', r.branch).trim(), `chore: agent setup ${appVersion}`);
  assert.equal(p.git('worktree', 'list').trim().split('\n').length, 1);
  assert.equal(existsSync(join(h, '.cache/benchkeeper/worktrees')) && p.git('worktree', 'list').includes('.cache'), false);
  // Its report diffs from the commit: the worktree is gone.
  const report = api(ctx)['GET /api/run'](new URLSearchParams({ id: r.run }));
  assert.match(report.entries.find((e) => e.path?.endsWith(STATE)).diff, new RegExp(`\\+  "contentVersion": "${appVersion}"`));
  // A second run finds the branch current; a branch with commits of its own stops that project.
  assert.equal(updateAll(ctx)[0].status, 'current');
  p.git('checkout', '-q', r.branch);
  writeFileSync(join(p.dir, 'mine.txt'), 'x\n');
  p.git('add', '-A');
  p.git('commit', '-qm', 'my work');
  p.git('checkout', '-q', 'main');
  assert.match(updateAll(ctx)[0].reason, /has other commits \(my work\)/);
  assert.throws(() => undo(r.run, ctx), /Update all commit on chore\/agent-setup/);
  writeFileSync(join(p.dir, STATE), '{ broken');
  assert.match(status(ctx, p.dir).error, /state\.json/);
});

test('Update all adds to its own unmerged branch, refuses an amended commit, and keeps a failed worktree', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const [r] = updateAll(ctx, { paths: [p.dir] });
  const first = p.git('rev-parse', r.branch).trim();
  // Changed answers: one more commit on top, so a push stays fast-forward.
  const [r2] = updateAll(ctx, { paths: [p.dir], answers: { [p.dir]: { tier: 'quick' } } });
  assert.equal(r2.status, 'committed', r2.reason);
  assert.equal(p.git('rev-parse', `${r.branch}~1`).trim(), first);
  // An amended commit keeps the subject but is not one Update all made.
  p.git('checkout', '-q', r.branch);
  writeFileSync(join(p.dir, 'mine.txt'), 'x\n');
  p.git('add', '-A');
  p.git('commit', '-q', '--amend', '--no-edit');
  p.git('checkout', '-q', 'main');
  assert.match(updateAll(ctx, { paths: [p.dir] })[0].reason, /has other commits \(chore: agent setup/);
  p.git('branch', '-D', r.branch);
  // A plan that fails wrote nothing: no worktree and no branch stay.
  const unplanned = updateAll(ctx, { paths: [p.dir], answers: { [p.dir]: { agents: ['claude'], env: 'host-agent', packs: ['nope'] } } })[0];
  assert.equal(unplanned.status, 'stopped');
  assert.equal(unplanned.worktree, undefined);
  assert.equal(p.git('branch', '--list', r.branch), '');
  // A failed apply keeps its worktree, and the next run names it instead of deleting it.
  const bad = updateAll({ ...ctx, run: (argv, o) => (argv[0] === 'npx' ? { code: 1, stdout: '', stderr: 'offline' } : ctx.run(argv, o)) }, { paths: [p.dir], answers: { [p.dir]: { agents: ['claude'], env: 'host-agent', packs: ['frontend'] } } })[0];
  assert.equal(bad.status, 'stopped');
  assert.ok(bad.worktree && existsSync(bad.worktree), bad.reason);
  assert.match(updateAll(ctx, { paths: [p.dir] })[0].reason, /an earlier failed run left/);
});

test('a project with changes, without a state file or outside git stops alone; the others continue', () => {
  const h = home();
  const ctx = context({ home: h });
  const dirty = project(h);
  writeFileSync(join(dirty.dir, 'README.md'), 'edited\n');
  const ok = project(h);
  const plain = mkdtempSync(join(TMP, 'bk-plain-'));
  const res = updateAll(ctx, { paths: [dirty.dir, plain, ok.dir] });
  assert.deepEqual(res.map((r) => r.status), ['stopped', 'stopped', 'committed']);
  assert.match(res[0].reason, /working tree has changes/);
  assert.match(res[1].reason, /no \.benchkeeper\/state\.json/);
  assert.equal(readFileSync(join(dirty.dir, 'README.md'), 'utf8'), 'edited\n');
});

test('a project without a state file is set up on the branch from answers; the checkout stays as it was', () => {
  const h = home();
  const ctx = context({ home: h });
  const dir = mkdtempSync(join(TMP, 'bk-fresh-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# Fresh\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  assert.match(updateAll(ctx, { paths: [dir] })[0].reason, /no \.benchkeeper\/state\.json: set the project up first/);
  const [r] = updateAll(ctx, { paths: [dir], answers: { [dir]: { agents: ['claude'], env: 'host-agent', tier: 'standard', share: true } } });
  assert.equal(r.status, 'committed');
  const state = JSON.parse(git('show', `${r.branch}:${STATE}`));
  assert.deepEqual([state.agents, state.env, state.tier], [['claude'], 'host-agent', 'standard']);
  assert.equal(existsSync(join(dir, STATE)), false);
  assert.equal(git('branch', '--show-current').trim(), 'main');
});

test('a changed setup lands on the branch with its cleanups; an empty tier clears the saved one', () => {
  const h = home();
  const ctx = context({ home: h });
  const dir = mkdtempSync(join(TMP, 'bk-change-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  const pctx = context({ home: h, roots: [dir] });
  apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude', 'codex'], env: 'container', sandbox: true, tier: 'quick', share: true } }).changes), pctx, { scope: dir });
  git('add', '-A');
  git('commit', '-qm', 'setup');
  const [r] = updateAll(ctx, { paths: [dir], answers: { [dir]: { agents: ['codex'], sandbox: false, tier: null } } });
  assert.equal(r.status, 'committed');
  const state = JSON.parse(git('show', `${r.branch}:${STATE}`));
  assert.deepEqual([state.agents, state.sandbox, state.tier], [['codex'], false, null]);
  assert.throws(() => git('show', `${r.branch}:CLAUDE.md`));
  assert.deepEqual(JSON.parse(git('show', `${r.branch}:.claude/settings.json`)), {});
  // A sandbox the user turned on is offered for removal, not counted as pending.
  const own = mkdtempSync(join(TMP, 'bk-own-'));
  mkdirSync(join(own, '.claude'));
  writeFileSync(join(own, '.claude/settings.json'), '{ "sandbox": { "enabled": true } }\n');
  const octx = context({ home: h, roots: [own] });
  apply(preview(projectPlan({ ctx: octx, dir: own, answers: { agents: ['claude'] } }).changes).filter((c) => c.selected), octx, { scope: own });
  assert.deepEqual(status(ctx, own).changes, []);
});

test('a GitHub origin gets a push and a pull request', () => {
  const h = home();
  const p = project(h);
  const calls = [];
  const base = context({ home: h });
  const ctx = context({ home: h, run: (argv, o) => {
    if (argv[0] === 'gh') { calls.push(argv); return { code: 0, stdout: 'https://github.com/o/r/pull/1\n', stderr: '' }; }
    if (argv.includes('get-url')) return { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' };
    if (argv.includes('push')) calls.push(argv);
    return base.run(argv, o);
  } });
  assert.equal(status(ctx, p.dir).github, true);
  assert.equal(status(base, p.dir).github, false);
  const [r] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(r.status, 'pull request', r.reason);
  assert.equal(r.pr, 'https://github.com/o/r/pull/1');
  assert.deepEqual(calls.map((a) => a.filter((x) => ['push', 'origin', r.branch, 'gh', 'create'].includes(x)).join(' ')), [`push origin ${r.branch}`, `gh create ${r.branch}`]);
  assert.equal(p.git('ls-remote', 'origin', r.branch).includes(r.branch), true);
  assert.equal(updateAll(context({ home: h }), { paths: [p.dir], push: false })[0].status, 'current');
});

test('projects update shows the plan, asks once, and --yes --no-push commits without pushing', async () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args, answers = '') => main(args, { out, ctx, input: Readable.from([answers]) });
  assert.equal(await exec(['projects', 'add', p.dir]), 0);
  assert.equal(await exec(['projects', 'update'], 'n\n'), 1);
  assert.match(text, new RegExp(`${p.dir}  setup 5\\.0\\.0  \\d+ changes`));
  assert.match(text, /Update 1 projects: .*git push and gh pr create/);
  assert.equal(p.git('branch', '--list', 'chore/*').trim(), '');
  text = '';
  assert.equal(await exec(['projects', 'update']), 1, 'end of input is no');
  assert.match(text, /Update 1 projects: .*git push and gh pr create/);
  assert.equal(p.git('branch', '--list', 'chore/*').trim(), '');
  assert.equal(await exec(['projects', 'update', '--yes', '--no-push']), 0);
  assert.match(text, new RegExp(`committed +${p.dir}`));
});

test('projects update with directories updates only those, honours --dry-run and --baseline, refuses an unregistered one', async () => {
  const h = home();
  const ctx = context({ home: h });
  const a = project(h), b = project(h), other = project(h);
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args) => main(args, { out, ctx, input: Readable.from(['']) });
  assert.equal(await exec(['projects', 'add', a.dir, b.dir]), 0);
  text = '';
  assert.equal(await exec(['projects', 'update', '--dry-run', a.dir]), 0);
  assert.match(text, new RegExp(`${a.dir}  setup`));
  assert.doesNotMatch(text, new RegExp(b.dir));
  assert.match(text, /dry run: 1 projects would be updated, nothing changed/);
  text = '';
  assert.equal(await exec(['projects', 'update', other.dir]), 2);
  assert.equal(text, `${other.dir}: not a registered project (benchkeeper projects add <dir>)\n`);
  text = '';
  assert.equal(await exec(['projects', 'update', '--yes', '--no-push', a.dir]), 0);
  assert.match(text, new RegExp(`committed +${a.dir}`));
  assert.doesNotMatch(text, new RegExp(b.dir));
  assert.equal(a.git('branch', '--list', 'chore/*').trim() !== '', true);
  assert.equal(b.git('branch', '--list', 'chore/*').trim(), '');
});

test('status counts the skills each chosen agent reads in the project; turned-off ones and folders without SKILL.md not', () => {
  const dir = mkdtempSync(join(TMP, 'bk-skills-'));
  for (const d of ['.claude/skills/a', '.agents/skills/a', '.agents/skills/b', '.benchkeeper/disabled/c']) {
    mkdirSync(join(dir, d), { recursive: true });
    writeFileSync(join(dir, d, 'SKILL.md'), '---\nname: x\n---\n');
  }
  mkdirSync(join(dir, '.agents/skills/no-skill-file'));
  writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ agents: ['claude', 'codex'] }));
  assert.deepEqual(status(context({ home: home() }), dir).skills, { claude: 1, codex: 2 });
});

test('status and Update all read the state file on the fetched default branch when the checkout is not current', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  // The setup merged on origin from another clone; this checkout has not fetched or pulled it.
  const other = mkdtempSync(join(TMP, 'bk-clone-'));
  execFileSync('git', ['clone', '-q', '-b', 'main', p.git('remote', 'get-url', 'origin').trim(), other]);
  const state = JSON.parse(readFileSync(join(other, STATE), 'utf8'));
  writeFileSync(join(other, STATE), JSON.stringify({ ...state, appVersion: appVersion, contentVersion: appVersion }));
  execFileSync('git', ['-C', other, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'setup']);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'main']);
  const s = status(ctx, p.dir);
  assert.deepEqual([s.setupVersion, s.current, s.checkout, s.origin, s.changes], [appVersion, true, '5.0.0', 'origin/main', null]);
  // A checkout without a state file: the one on origin counts, so Update all builds on it without answers.
  p.git('rm', '-q', STATE);
  p.git('commit', '-qm', 'drop state');
  assert.deepEqual([status(ctx, p.dir).setupVersion, status(ctx, p.dir).checkout], [appVersion, null]);
  assert.equal(updateAll(ctx, { paths: [p.dir], push: false })[0].status, 'committed');
  // A checkout ahead of origin keeps its own setup and its pending changes.
  const ahead = project(h);
  writeFileSync(join(ahead.dir, STATE), JSON.stringify({ ...state, appVersion: '5.9.0', contentVersion: '5.9.0' }));
  const a = status(ctx, ahead.dir);
  assert.deepEqual([a.setupVersion, a.checkout, a.origin], ['5.9.0', '5.9.0', 'origin/main']);
  assert.ok(a.changes.length);
  // No origin/HEAD here (the remote was added, not cloned): origin is asked for its default branch.
  const nohead = project(h);
  assert.equal(status(ctx, nohead.dir).origin, 'origin/main');
  // The fetch fails: an old tracking ref is not origin's state.
  const offline = project(h);
  offline.git('fetch', '-q', 'origin');
  offline.git('remote', 'set-url', 'origin', join(h, 'gone.git'));
  assert.deepEqual([status(ctx, offline.dir).origin, status(ctx, offline.dir).checkout], [null, '5.0.0']);
});

test('status takes origin\'s state when only its app version is newer (same content version)', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const state = JSON.parse(readFileSync(join(p.dir, STATE), 'utf8'));
  writeFileSync(join(p.dir, STATE), JSON.stringify({ ...state, appVersion: '5.0.0', contentVersion }));
  p.git('commit', '-qam', 'content current');
  p.git('push', '-q', 'origin', 'main');
  const other = mkdtempSync(join(TMP, 'bk-clone-'));
  execFileSync('git', ['clone', '-q', '-b', 'main', p.git('remote', 'get-url', 'origin').trim(), other]);
  writeFileSync(join(other, STATE), JSON.stringify({ ...state, appVersion, contentVersion }));
  execFileSync('git', ['-C', other, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'app-only setup']);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'main']);
  const s = status(ctx, p.dir);
  assert.deepEqual([s.current, s.origin, s.changes], [true, 'origin/main', null]);
});

test('prefetchOrigins reads origin without blocking and fills the cache status uses; a failed fetch counts as no origin', async () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const other = mkdtempSync(join(TMP, 'bk-clone-'));
  execFileSync('git', ['clone', '-q', '-b', 'main', p.git('remote', 'get-url', 'origin').trim(), other]);
  const state = JSON.parse(readFileSync(join(other, STATE), 'utf8'));
  writeFileSync(join(other, STATE), JSON.stringify({ ...state, appVersion: appVersion, contentVersion: appVersion }));
  execFileSync('git', ['-C', other, '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'setup']);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'main']);
  const offline = project(h);
  offline.git('remote', 'set-url', 'origin', join(h, 'gone.git'));
  // The event loop runs while the git commands do.
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  await prefetchOrigins(ctx, [p.dir, offline.dir]);
  clearInterval(timer);
  assert.ok(ticks > 0);
  // Origin gone now: status answers from the minute cache, without asking the network again.
  p.git('remote', 'set-url', 'origin', join(h, 'gone.git'));
  assert.deepEqual([status(ctx, p.dir).setupVersion, status(ctx, p.dir).origin], [appVersion, 'origin/main']);
  assert.deepEqual([status(ctx, offline.dir).origin, status(ctx, offline.dir).checkout], [null, '5.0.0']);
});

test('status: a version 1 state kept in the registry is read as version 2 and beats an older setup on origin', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  // Origin has the 5.0.0 setup; the checkout lost its state file and the registry kept a newer one, written by an earlier app.
  const { appVersion: _a, contentVersion: _c, schemaVersion: _s, ...v1 } = JSON.parse(readFileSync(join(p.dir, STATE), 'utf8'));
  p.git('rm', '-q', STATE);
  p.git('commit', '-qm', 'drop state');
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ path: canon(p.dir), added: '2026-01-01T00:00:00.000Z', state: { ...v1, setupVersion: '5.9.0' } }] }));
  const s = status(ctx, p.dir);
  assert.deepEqual([s.setupVersion, s.checkout, s.origin], ['5.9.0', '5.9.0', 'origin/main']);
});

test('a state kept in the registry above schema 2 stops the project in Update all and shows in status; it does not fall back to origin', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const other = project(h);
  p.git('rm', '-q', STATE);
  p.git('commit', '-qm', 'drop state');
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(join(ctx.config, 'projects.json'), JSON.stringify({ schemaVersion: 1, projects: [{ path: canon(p.dir), added: '2026-01-01T00:00:00.000Z', state: { schemaVersion: 3, appVersion: '9.0.0', contentVersion: '9.0.0', agents: ['claude'] } }, { path: canon(other.dir), added: '2026-01-01T00:00:00.000Z' }] }));
  assert.match(status(ctx, p.dir).error, /schemaVersion 3, this benchkeeper reads up to 2/);
  const [bad, good] = updateAll(ctx, { paths: [p.dir, other.dir], push: false });
  assert.equal(bad.status, 'stopped');
  assert.match(bad.reason, /schemaVersion 3/);
  assert.notEqual(good.status, 'stopped', good.reason);
  assert.ok(!existsSync(join(p.dir, STATE)));
});

test('projects unshare: a pull request without the committed setup; the checkout stays as it is until the pull, then Update all writes the local setup from the kept answers', async () => {
  const h = home();
  const p = project(h);
  // A setup from before 6.3, committed and pushed: its state file has no share key.
  const { share, ...old } = JSON.parse(readFileSync(join(p.dir, STATE), 'utf8'));
  writeFileSync(join(p.dir, STATE), JSON.stringify(old));
  p.git('commit', '-qam', 'old setup');
  p.git('push', '-q', 'origin', 'main');
  const ctx = context({ home: h });
  addProject(ctx, p.dir);
  assert.equal(status(ctx, p.dir).committed, true);
  const still = (d) => projectChecks(ctx, d).some((i) => /still has it committed/.test(i.message));
  assert.ok(still(p.dir));
  let out = '';
  const w = new Writable({ write(c, _, done) { out += c; done(); } });
  // A folder that is not registered, or does not exist, is refused before anything runs.
  const missing = join(TMP, 'bk-unshare-missing');
  await assert.rejects(main(['projects', 'unshare', p.dir, missing, '--yes', '--no-push'], { out: w, ctx, input: Readable.from(['']) }), { message: `${canon(missing)} is not a registered project` });
  assert.equal(out, '');
  assert.equal(await main(['projects', 'unshare', '--yes', '--no-push'], { out: w, ctx, input: Readable.from(['']) }), 0, out);
  assert.match(out, /^committed\s/m);
  assert.equal(p.git('ls-tree', '-r', '--name-only', 'chore/agent-setup-local'), 'README.md\n');
  // The checkout keeps the committed copies until the merge is pulled; the registry keeps the state file.
  assert.equal(p.git('status', '--porcelain'), '');
  assert.equal(listProjects(ctx)[0].state.agents[0], 'claude');
  // Update all before the merge: the pull request is there already.
  assert.equal(updateAll(ctx, { paths: [p.dir], push: false })[0].status, 'current');
  // Merged and pulled: the committed copies are gone; Update all writes the local setup from the kept answers.
  p.git('merge', '-q', '--ff-only', 'chore/agent-setup-local');
  assert.ok(!existsSync(join(p.dir, STATE)));
  assert.equal(status(ctx, p.dir).changes.length > 0, true);
  const [r] = updateAll(ctx, { paths: [p.dir], push: false });
  assert.equal(r.status, 'applied', r.reason);
  assert.equal(JSON.parse(readFileSync(join(p.dir, STATE), 'utf8')).share, false);
  assert.match(readFileSync(join(p.dir, 'CLAUDE.local.md'), 'utf8'), /benchkeeper:project start/);
  assert.equal(p.git('status', '--porcelain'), '');
  assert.equal(listProjects(ctx)[0].state, undefined);
  assert.equal(status(ctx, p.dir).committed, false);
  assert.ok(!still(p.dir));
  // A local Update all run changed the checkout itself, so it can be undone.
  assert.equal(undo(r.run, context({ home: h, roots: [h, p.dir] })).status, 'done');
  assert.ok(!existsSync(join(p.dir, 'CLAUDE.local.md')));
});

test('a pushed run fetches origin again even when status fetched it a moment ago', () => {
  const h = home();
  const p = project(h);
  let offline = false;
  const base = context({ home: h });
  const ctx = context({ home: h, run: (argv, o) => {
    if (argv.includes('get-url')) return { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' };
    if (argv.includes('fetch') && offline) return { code: 128, stdout: '', stderr: 'Could not resolve host: github.com' };
    return base.run(argv, o);
  } });
  // status fetches and caches it for a minute; origin is unreachable afterwards.
  assert.equal(status(ctx, p.dir).origin, 'origin/main');
  offline = true;
  const [r] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(r.status, 'stopped');
  assert.match(r.reason, /could not fetch origin\/main/);
  assert.equal(p.git('branch', '--list', r.branch).trim(), '');
});

test('unshare keeps the answers first; after a failed push, the next run pushes the commit and opens the pull request', () => {
  const h = home();
  const p = project(h);
  const { share, ...old } = JSON.parse(readFileSync(join(p.dir, STATE), 'utf8'));
  writeFileSync(join(p.dir, STATE), JSON.stringify(old));
  p.git('commit', '-qam', 'old setup');
  p.git('push', '-q', 'origin', 'main');
  let offline = true;
  const calls = [];
  const base = context({ home: h });
  const ctx = context({ home: h, run: (argv, o) => {
    if (argv[0] === 'gh') { calls.push('gh'); return { code: 0, stdout: 'https://github.com/o/r/pull/2\n', stderr: '' }; }
    if (argv.includes('get-url')) return { code: 0, stdout: 'git@github.com:o/r.git\n', stderr: '' };
    if (argv.includes('push') && offline) return { code: 128, stdout: '', stderr: 'Could not resolve host: github.com' };
    return base.run(argv, o);
  } });
  addProject(ctx, p.dir);
  const [first] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(first.status, 'stopped');
  assert.match(first.reason, /git push/);
  assert.equal(listProjects(ctx)[0].state.agents[0], 'claude');
  offline = false;
  const [second] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(second.status, 'pull request', second.reason);
  assert.equal(second.pr, 'https://github.com/o/r/pull/2');
  assert.deepEqual(calls, ['gh']);
});

test('projects update --unattended skips and lists a project whose own hooks or git config are not confirmed', async () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const quiet = new Writable({ write(_c, _e, done) { done(); } });
  const row = async (...args) => {
    let text = '';
    await main(['projects', 'update', '--dry-run', '--unattended', ...args, '--json'], { out: new Writable({ write(c, _, done) { text += c; done(); } }), err: quiet, ctx });
    return JSON.parse(text).projects[0];
  };
  addProject(ctx, p.dir);
  const hook = join(p.dir, '.git/hooks/pre-commit');
  writeFileSync(hook, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  p.git('config', 'credential.helper', '!echo marker-value');
  const skipped = await row();
  assert.equal(skipped.ready, false);
  assert.match(skipped.reason, /not confirmed \(credential\.helper, hook pre-commit, remote\.origin\.url\): benchkeeper projects confirm-git .*skipped/);
  let shown = '';
  const confirm = (answer, isTTY, flags = []) => main(['projects', 'confirm-git', p.dir, ...flags], { out: new Writable({ write(c, _, done) { shown += c; done(); } }), ctx, input: Object.assign(Readable.from([answer]), { isTTY }) });
  assert.equal(await confirm('y\n', true, ['--yes']), 2, '--yes confirms nothing');
  assert.match(shown, /--yes does not belong to projects confirm-git/);
  assert.equal(await confirm('y\n', false), 2, 'a piped yes confirms nothing');
  assert.match(shown, /asks in a terminal/);
  assert.equal(await confirm('n\n', true), 1, 'a no stores nothing');
  assert.equal((await row()).ready, false);
  assert.equal(await confirm('y\n', true), 0);
  assert.match(shown, /hook pre-commit\n/);
  assert.doesNotMatch(JSON.stringify(listProjects(ctx)), /marker-value/, 'the registry keeps a hash, not the value');
  assert.equal((await row()).ready, true);
  writeFileSync(hook, '#!/bin/sh\necho changed\n');
  assert.match((await row()).reason, /not confirmed \(hook pre-commit\)/);
  let plain = '';
  await main(['projects', 'update', '--dry-run'], { out: new Writable({ write(c, _, done) { plain += c; done(); } }), ctx });
  assert.match(plain, /1 projects would be updated/, 'without --unattended nothing is skipped');
});

test('a hook that links to a removed script is skipped; the other hooks are still listed', () => {
  const h = home();
  const p = project(h);
  writeFileSync(join(p.dir, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  symlinkSync(join(h, 'removed.sh'), join(p.dir, '.git/hooks/pre-push'));
  assert.deepEqual(gitCodeConfig(context({ home: h }), p.dir).filter((x) => x.key.startsWith('hook ')).map((x) => x.key), ['hook pre-commit']);
});

test('projects update --json: --dry-run lists the pending changes per project, --yes prints the result document, without it exit 2', async () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  const quiet = new Writable({ write(_c, _e, done) { done(); } });
  const json = async (args) => {
    let text = '';
    const code = await main([...args, '--json'], { out: new Writable({ write(c, _, done) { text += c; done(); } }), err: quiet, ctx, input: Readable.from(['']) });
    return { code, doc: JSON.parse(text) };
  };
  assert.equal(await main(['projects', 'add', p.dir], { out: quiet, ctx }), 0);
  const dry = await json(['projects', 'update', '--dry-run']);
  assert.deepEqual([dry.code, dry.doc.command, Object.keys(dry.doc).slice(2)], [0, 'projects update', ['runs', 'projects']]);
  const [row] = dry.doc.projects;
  assert.deepEqual([row.path, row.setupVersion, row.ready], [p.dir, '5.0.0', true]);
  assert.match(row.reason, /\d+ changes/);
  assert.ok(row.changes.length > 0 && row.changes.every((c) => c.title && !('diff' in c)));
  const asked = await json(['projects', 'update', '--no-push']);
  assert.deepEqual([asked.code, Object.keys(asked.doc).slice(2)], [2, ['error']]);
  assert.match(asked.doc.error, /add --yes/);
  assert.equal(p.git('branch', '--list', 'chore/*').trim(), '', 'the dry run and the refusal change nothing');
  const done = await json(['projects', 'update', '--yes', '--no-push']);
  assert.deepEqual([done.code, Object.keys(done.doc).slice(2)], [0, ['runs', 'projects']]);
  const [result] = done.doc.projects;
  assert.deepEqual([result.path, result.status], [p.dir, 'committed']);
  assert.deepEqual(done.doc.runs.map((r) => r.id), [result.run]);
  assert.ok(done.doc.runs[0].entries.every((e) => e.title && e.status && !('diff' in e)));
});
