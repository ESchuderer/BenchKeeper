import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { appVersion } from '../src/content.mjs';
import { addProject, listProjects, removeProject, scan, status, updateAll } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { STATE, projectPlan } from '../src/steps/project.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'bk-home-'));
// A project set up by an older setup version, committed on main, with a local bare origin (not GitHub).
function project(h) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  const ctx = context({ home: h, roots: [h, dir] });
  apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent' } }).changes), ctx, { scope: dir });
  const state = JSON.parse(readFileSync(join(dir, STATE), 'utf8'));
  writeFileSync(join(dir, STATE), JSON.stringify({ ...state, setupVersion: '5.0.0' }));
  git('add', '-A');
  git('commit', '-qm', 'init');
  const origin = mkdtempSync(join(tmpdir(), 'bk-origin-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  return { dir, git };
}

test('registry: add, list, remove; scan finds folders with an agent setup', () => {
  const h = home();
  const ctx = context({ home: h });
  const root = mkdtempSync(join(tmpdir(), 'bk-scan-'));
  for (const d of ['a', 'b/c', 'node_modules/x']) { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, 'AGENTS.md'), '#\n'); }
  mkdirSync(join(root, 'e'));
  assert.deepEqual(scan(root).map((d) => d.slice(root.length + 1)).sort(), ['a', 'b/c']);
  addProject(ctx, join(root, 'a'));
  addProject(ctx, join(root, 'a'));
  assert.deepEqual(listProjects(ctx).map((p) => p.path), [join(root, 'a')]);
  removeProject(ctx, join(root, 'a'));
  assert.deepEqual(listProjects(ctx), []);
  assert.throws(() => addProject(ctx, join(root, 'missing')), /does not exist/);
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
  assert.equal(JSON.parse(p.git('show', `${r.branch}:${STATE}`)).setupVersion, appVersion);
  assert.equal(p.git('log', '--format=%s', '-1', r.branch).trim(), `chore: agent setup ${appVersion}`);
  assert.equal(p.git('worktree', 'list').trim().split('\n').length, 1);
  assert.equal(existsSync(join(h, '.cache/benchkeeper/worktrees')) && p.git('worktree', 'list').includes('.cache'), false);
  // Its report diffs from the commit: the worktree is gone.
  const report = api(ctx)['GET /api/run'](new URLSearchParams({ id: r.run }));
  assert.match(report.entries.find((e) => e.path?.endsWith(STATE)).diff, new RegExp(`\\+  "setupVersion": "${appVersion}"`));
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
  assert.match(updateAll(ctx, { paths: [p.dir] })[0].reason, /a failed Update all left/);
});

test('a project with changes, without a state file or outside git stops alone; the others continue', () => {
  const h = home();
  const ctx = context({ home: h });
  const dirty = project(h);
  writeFileSync(join(dirty.dir, 'README.md'), 'edited\n');
  const ok = project(h);
  const plain = mkdtempSync(join(tmpdir(), 'bk-plain-'));
  const res = updateAll(ctx, { paths: [dirty.dir, plain, ok.dir] });
  assert.deepEqual(res.map((r) => r.status), ['stopped', 'stopped', 'committed']);
  assert.match(res[0].reason, /working tree has changes/);
  assert.match(res[1].reason, /no \.benchkeeper\/state\.json/);
  assert.equal(readFileSync(join(dirty.dir, 'README.md'), 'utf8'), 'edited\n');
});

test('a project without a state file is set up on the branch from answers; the checkout stays as it was', () => {
  const h = home();
  const ctx = context({ home: h });
  const dir = mkdtempSync(join(tmpdir(), 'bk-fresh-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# Fresh\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  assert.match(updateAll(ctx, { paths: [dir] })[0].reason, /no \.benchkeeper\/state\.json: set the project up first/);
  const [r] = updateAll(ctx, { paths: [dir], answers: { [dir]: { agents: ['claude'], env: 'host-agent', tier: 'standard' } } });
  assert.equal(r.status, 'committed');
  const state = JSON.parse(git('show', `${r.branch}:${STATE}`));
  assert.deepEqual([state.agents, state.env, state.tier], [['claude'], 'host-agent', 'standard']);
  assert.equal(existsSync(join(dir, STATE)), false);
  assert.equal(git('branch', '--show-current').trim(), 'main');
});

test('a changed setup lands on the branch with its cleanups; an empty tier clears the saved one', () => {
  const h = home();
  const ctx = context({ home: h });
  const dir = mkdtempSync(join(tmpdir(), 'bk-change-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  const pctx = context({ home: h, roots: [dir] });
  apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude', 'codex'], env: 'container', sandbox: true, tier: 'quick' } }).changes), pctx, { scope: dir });
  git('add', '-A');
  git('commit', '-qm', 'setup');
  const [r] = updateAll(ctx, { paths: [dir], answers: { [dir]: { agents: ['codex'], sandbox: false, tier: null } } });
  assert.equal(r.status, 'committed');
  const state = JSON.parse(git('show', `${r.branch}:${STATE}`));
  assert.deepEqual([state.agents, state.sandbox, state.tier], [['codex'], false, null]);
  assert.throws(() => git('show', `${r.branch}:CLAUDE.md`));
  assert.deepEqual(JSON.parse(git('show', `${r.branch}:.claude/settings.json`)), {});
  // A sandbox the user turned on is offered for removal, not counted as pending.
  const own = mkdtempSync(join(tmpdir(), 'bk-own-'));
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
  const [r] = updateAll(ctx, { paths: [p.dir] });
  assert.equal(r.status, 'pull request', r.reason);
  assert.equal(r.pr, 'https://github.com/o/r/pull/1');
  assert.deepEqual(calls.map((a) => a.filter((x) => ['push', 'origin', r.branch, 'gh', 'create'].includes(x)).join(' ')), [`push origin ${r.branch}`, `gh create ${r.branch}`]);
  assert.equal(p.git('ls-remote', 'origin', r.branch).includes(r.branch), true);
  assert.equal(updateAll(context({ home: h }), { paths: [p.dir], push: false })[0].status, 'current');
});

test('update-all shows the plan, asks once, and --yes --no-push commits without pushing', async () => {
  const h = home();
  const ctx = context({ home: h });
  const p = project(h);
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args, answers = '') => main(args, { out, ctx, input: Readable.from([answers]) });
  assert.equal(await exec(['projects', 'add', p.dir]), 0);
  assert.equal(await exec(['update-all'], 'n\n'), 1);
  assert.match(text, new RegExp(`${p.dir}  setup 5\\.0\\.0  \\d+ changes`));
  assert.match(text, /Update 1 projects: .*git push and gh pr create/);
  assert.equal(p.git('branch', '--list', 'chore/*').trim(), '');
  assert.equal(await exec(['update-all', '--yes', '--no-push']), 0);
  assert.match(text, new RegExp(`committed +${p.dir}`));
});

test('status counts the skills each chosen agent reads in the project; turned-off ones and folders without SKILL.md not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-skills-'));
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
  const other = mkdtempSync(join(tmpdir(), 'bk-clone-'));
  execFileSync('git', ['clone', '-q', '-b', 'main', p.git('remote', 'get-url', 'origin').trim(), other]);
  const state = JSON.parse(readFileSync(join(other, STATE), 'utf8'));
  writeFileSync(join(other, STATE), JSON.stringify({ ...state, setupVersion: appVersion }));
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
  writeFileSync(join(ahead.dir, STATE), JSON.stringify({ ...state, setupVersion: '5.9.0' }));
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
