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
import { apply, context, preview } from '../src/runner.mjs';
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
  execFileSync('git', ['init', '-q', '--bare', origin]);
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
  // A second run finds the branch current; a branch with commits of its own stops that project.
  assert.equal(updateAll(ctx)[0].status, 'current');
  p.git('checkout', '-q', r.branch);
  writeFileSync(join(p.dir, 'mine.txt'), 'x\n');
  p.git('add', '-A');
  p.git('commit', '-qm', 'my work');
  p.git('checkout', '-q', 'main');
  assert.match(updateAll(ctx)[0].reason, /has other commits \(my work\)/);
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
