// Managing the project list: duplicates, display name and notes, relocate, a missing folder, and Remove BenchKeeper setup.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { hashPath, listFiles } from '../src/fsx.mjs';
import { addProject, checkAdd, listProjects, relocateProject, removeProject, removeSetup, renameProject, setupRemoval, status, updateAll } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { STATE, projectCtx, projectPlan } from '../src/steps/project.mjs';

const TMP = realpathSync(tmpdir());
const home = () => mkdtempSync(join(TMP, 'bk-home-'));
const repo = (name = 'bk-repo-') => {
  const dir = mkdtempSync(join(TMP, name));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  return { dir, git };
};
const OWN = '# Mine\n\nRun the tests with make.\n';
// A project with its own AGENTS.md text, docs/agents/, a dev container and an own skill, set up locally for two agents.
function localProject(h, answers = {}) {
  const p = repo();
  writeFileSync(join(p.dir, 'AGENTS.md'), OWN);
  mkdirSync(join(p.dir, 'docs/agents'), { recursive: true });
  writeFileSync(join(p.dir, 'docs/agents/issue-tracker.md'), 'tracker\n');
  mkdirSync(join(p.dir, '.devcontainer'));
  writeFileSync(join(p.dir, '.devcontainer/Dockerfile'), 'FROM scratch\n');
  mkdirSync(join(p.dir, '.claude/skills/mine'), { recursive: true });
  writeFileSync(join(p.dir, '.claude/skills/mine/SKILL.md'), '---\nname: mine\n---\n');
  p.git('add', '-A');
  p.git('commit', '-qm', 'init');
  const ctx = context({ home: h, roots: [h, p.dir] });
  apply(preview(projectPlan({ ctx, dir: p.dir, answers: { agents: ['claude', 'codex'], env: 'host-agent', sandbox: true, skills: ['designing-technical-uis'], ...answers } }).changes), ctx, { scope: p.dir });
  return { ...p, ctx };
}
// The project's files with their contents, the git exclude list included, nothing else of .git.
const tree = (dir) => Object.fromEntries([...listFiles(dir).filter((f) => !f.startsWith('.git/')), '.git/info/exclude'].map((f) => [f, hashPath(join(dir, f))]));
const writer = () => { const w = { text: '' }; w.out = new Writable({ write(c, _, done) { w.text += c; done(); } }); return w; };

test('adding: the same repository as a registered project (another worktree) is offered, a folder inside one is flagged', () => {
  const ctx = context({ home: home() });
  const a = repo();
  writeFileSync(join(a.dir, 'f'), 'x');
  a.git('add', '-A');
  a.git('commit', '-qm', 'x');
  const wt = join(mkdtempSync(join(TMP, 'bk-wt-')), 'wt');
  a.git('worktree', 'add', '-q', wt);
  mkdirSync(join(a.dir, 'sub'));
  addProject(ctx, a.dir);
  assert.deepEqual(checkAdd(ctx, wt), { path: wt, same: false, worktree: a.dir, inside: null });
  assert.throws(() => addProject(ctx, wt), /same repository as .* \(another worktree\)/);
  assert.deepEqual(listProjects(ctx).map((p) => p.path), [a.dir]);
  assert.equal(checkAdd(ctx, join(a.dir, 'sub')).inside, a.dir);
  // A folder of a monorepo is no worktree; the flagged one can be added; a worktree on request.
  assert.equal(checkAdd(ctx, join(a.dir, 'sub')).worktree, null);
  addProject(ctx, join(a.dir, 'sub'));
  addProject(ctx, wt, { worktree: true });
  assert.equal(listProjects(ctx).length, 3);
  // A registered folder is no duplicate of itself, whatever other worktrees are registered.
  assert.deepEqual([checkAdd(ctx, a.dir).same, checkAdd(ctx, a.dir).worktree], [true, null]);
  assert.equal(addProject(ctx, a.dir), a.dir);
  assert.equal(listProjects(ctx).length, 3);
  assert.throws(() => checkAdd(ctx, join(a.dir, 'missing')), /does not exist/);
  assert.throws(() => checkAdd(ctx, join(a.dir, 'f')), /is not a folder/);
});

test('display name and notes live in projects.json only; empty clears, bad input is refused', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = repo();
  addProject(ctx, p.dir);
  const before = tree(p.dir);
  renameProject(ctx, p.dir, { name: ' Shop ', notes: 'line one\nline two' });
  assert.deepEqual([listProjects(ctx)[0].name, listProjects(ctx)[0].notes], ['Shop', 'line one\nline two']);
  renameProject(ctx, p.dir, { name: 'Shop 2' });
  assert.equal(listProjects(ctx)[0].notes, 'line one\nline two');
  renameProject(ctx, p.dir, { name: '', notes: '' });
  assert.deepEqual(Object.keys(listProjects(ctx)[0]).sort(), ['added', 'path']);
  assert.throws(() => renameProject(ctx, p.dir, { name: 'a\nb' }), /control characters/);
  assert.throws(() => renameProject(ctx, p.dir, { name: 'x'.repeat(81) }), /longer than 80/);
  assert.throws(() => renameProject(ctx, p.dir, { notes: 5 }), /must be text/);
  assert.throws(() => renameProject(ctx, join(p.dir, 'nope'), { name: 'x' }), /not a registered project/);
  assert.deepEqual(tree(p.dir), before);
});

test('relocate: the entry, its answers and the history follow the folder; undo of an earlier run still works', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = localProject(h);
  addProject(ctx, p.dir);
  renameProject(ctx, p.dir, { name: 'Shop', notes: 'n' });
  const first = ctx.ledger.list().find((r) => r.scope === p.dir);
  // An Update all run has a worktree as its scope and names the project in its note.
  ctx.ledger.save({ schema: 1, id: 'pr-run', time: new Date().toISOString(), kind: 'apply', scope: '/tmp/some-worktree', note: { updateAll: p.dir, branch: 'b' }, entries: [] });
  const moved = join(mkdtempSync(join(TMP, 'bk-moved-')), 'renamed');
  renameSync(p.dir, moved);
  assert.equal(status(ctx, p.dir).missing, true);
  const other = repo();
  addProject(ctx, other.dir);
  assert.throws(() => relocateProject(ctx, p.dir, other.dir), /is registered already/);
  assert.throws(() => relocateProject(ctx, p.dir, join(moved, 'nope')), /is not a folder/);
  assert.throws(() => relocateProject(ctx, join(moved, 'x'), moved), /not a registered project/);
  assert.equal(relocateProject(ctx, p.dir, moved), moved);
  const entry = listProjects(ctx).find((x) => x.path === moved);
  assert.deepEqual([entry.name, entry.notes], ['Shop', 'n']);
  assert.equal(listProjects(ctx).some((x) => x.path === p.dir), false);
  const s = status(ctx, moved);
  assert.equal(s.missing, undefined);
  assert.equal(s.setupVersion != null, true);
  // The run is under the new path, its backups stay where they were, and undo works in the new place.
  const run = ctx.ledger.get(first.id);
  assert.equal(run.scope, moved);
  assert.deepEqual(ctx.ledger.get('pr-run').note, { updateAll: moved, branch: 'b' });
  assert.ok(run.entries.every((e) => !e.path || e.path.startsWith(moved)));
  assert.ok(run.entries.filter((e) => e.backup).every((e) => e.backup.startsWith(ctx.config)));
  assert.equal(undo(first.id, projectCtx(ctx, moved)).status, 'done');
  assert.equal(existsSync(join(moved, STATE)), false);
});

test('a deleted folder is listed as missing, without errors, in the projects route', async () => {
  const h = home();
  const ctx = context({ home: h });
  const p = repo();
  addProject(ctx, p.dir);
  renameSync(p.dir, `${p.dir}-gone`);
  const [row] = await api(ctx)['GET /api/projects']();
  assert.deepEqual([row.path, row.missing, row.error, row.changes, row.name], [p.dir, true, null, null, null]);
});

test('unregistering changes only projects.json', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = localProject(h);
  addProject(ctx, p.dir);
  const before = tree(p.dir);
  const config = readFileSync(join(ctx.config, 'projects.json'), 'utf8');
  assert.match(config, /"projects"/);
  removeProject(ctx, [p.dir]);
  assert.deepEqual(listProjects(ctx), []);
  assert.deepEqual(tree(p.dir), before);
});

test('Remove BenchKeeper setup, local: exactly the recorded files go, nothing else changes, undo restores every byte', () => {
  const h = home();
  const p = localProject(h);
  const ctx = p.ctx;
  addProject(ctx, p.dir);
  const before = tree(p.dir);
  assert.ok(existsSync(join(p.dir, STATE)) && existsSync(join(p.dir, 'CLAUDE.local.md')) && existsSync(join(p.dir, 'AGENTS.override.md')));
  const plan = setupRemoval(ctx, p.dir);
  assert.equal(plan.shared, false);
  assert.deepEqual(plan.changes.map((c) => c.step).sort(), ['exclude', 'local-claude', 'local-codex', 'sandbox', 'skill:designing-technical-uis', 'skill:designing-technical-uis', 'state'].sort());
  const result = removeSetup(ctx, p.dir);
  assert.equal(result.status, 'removed', result.reason);
  const after = tree(p.dir);
  // What is left is the project's own: its files as they were before the setup, and the exclude list without our block.
  const own = ['AGENTS.md', 'README.md', 'docs/agents/issue-tracker.md', '.devcontainer/Dockerfile', '.claude/skills/mine/SKILL.md', '.git/info/exclude'].filter((f) => f in after);
  assert.deepEqual(Object.keys(after).sort(), own.sort());
  assert.equal(readFileSync(join(p.dir, 'AGENTS.md'), 'utf8'), OWN);
  assert.doesNotMatch(readFileSync(join(p.dir, '.git/info/exclude'), 'utf8'), /benchkeeper/);
  assert.equal(p.git('status', '--porcelain'), '');
  // The project stays registered, as not set up.
  assert.equal(listProjects(ctx)[0].path, p.dir);
  assert.equal(status(ctx, p.dir).setupVersion, null);
  assert.equal(removeSetup(ctx, p.dir).status, 'stopped');
  assert.equal(undo(result.run, projectCtx(ctx, p.dir)).status, 'done');
  assert.deepEqual(tree(p.dir), before);
});

test('Remove BenchKeeper setup keeps a hand-written CLAUDE.local.md and AGENTS.override.md', () => {
  const h = home();
  const p = localProject(h, { sandbox: false });
  addProject(p.ctx, p.dir);
  writeFileSync(join(p.dir, 'CLAUDE.local.md'), `my note\n\n${readFileSync(join(p.dir, 'CLAUDE.local.md'), 'utf8')}`);
  const plan = setupRemoval(p.ctx, p.dir);
  assert.ok(plan.changes.some((c) => c.step === 'local-claude' && c.kind === 'write'));
  removeSetup(p.ctx, p.dir);
  assert.equal(readFileSync(join(p.dir, 'CLAUDE.local.md'), 'utf8').trim().startsWith('my note'), true);
  assert.doesNotMatch(readFileSync(join(p.dir, 'CLAUDE.local.md'), 'utf8'), /benchkeeper:project/);
  // A project without any setup has nothing to remove.
  const empty = repo().dir;
  assert.match(removeSetup(p.ctx, empty).reason, /not a registered project/);
  addProject(p.ctx, empty);
  assert.equal(removeSetup(p.ctx, empty).reason, 'no BenchKeeper setup to remove');
});

test('Remove BenchKeeper setup leaves skills git tracks, and the exclude block another registered worktree uses', () => {
  const h = home();
  const p = localProject(h, { sandbox: false });
  addProject(p.ctx, p.dir);
  // The team committed this skill itself: it is in the lockfile and tracked, so it is theirs.
  mkdirSync(join(p.dir, '.claude/skills/team'), { recursive: true });
  writeFileSync(join(p.dir, '.claude/skills/team/SKILL.md'), '---\nname: team\n---\n');
  writeFileSync(join(p.dir, 'skills-lock.json'), JSON.stringify({ skills: { team: {} } }));
  p.git('add', '-f', '.claude/skills/team', 'skills-lock.json');
  p.git('commit', '-qm', 'team skill');
  const steps = setupRemoval(p.ctx, p.dir).changes.map((c) => c.step);
  assert.ok(!steps.includes('skill:team') && !steps.includes('lock'));
  assert.ok(steps.includes('exclude'));
  // Another registered folder of the repository keeps the shared exclude block.
  const wt = join(mkdtempSync(join(TMP, 'bk-wt-')), 'wt');
  p.git('worktree', 'add', '-q', wt);
  addProject(p.ctx, wt, { worktree: true });
  assert.ok(!setupRemoval(p.ctx, p.dir).changes.some((c) => c.step === 'exclude'));
  assert.equal(removeSetup(p.ctx, p.dir).status, 'removed');
  assert.ok(existsSync(join(p.dir, '.claude/skills/team/SKILL.md')) && existsSync(join(p.dir, 'skills-lock.json')));
  assert.match(readFileSync(join(p.dir, '.git/info/exclude'), 'utf8'), /benchkeeper:local/);
});

test('Update all stops at a project whose folder is gone', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = repo();
  addProject(ctx, p.dir);
  renameSync(p.dir, `${p.dir}-gone`);
  assert.match(updateAll(ctx, { paths: [p.dir], push: false })[0].reason, /folder not found/);
});

test('Remove BenchKeeper setup, shared: a pull request branch without the committed setup; the checkout stays', () => {
  const h = home();
  const ctx = context({ home: h });
  const p = localProject(h, { share: true });
  p.git('add', '-A');
  p.git('commit', '-qm', 'setup');
  const origin = mkdtempSync(join(TMP, 'bk-origin-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  p.git('remote', 'add', 'origin', origin);
  p.git('push', '-q', 'origin', 'main');
  addProject(ctx, p.dir);
  assert.equal(setupRemoval(ctx, p.dir).shared, true);
  const before = tree(p.dir);
  const r = removeSetup(ctx, p.dir, { push: false });
  assert.equal(r.status, 'committed', r.reason);
  assert.equal(r.branch, 'chore/remove-agent-setup');
  assert.deepEqual(tree(p.dir), before);
  const files = p.git('ls-tree', '-r', '--name-only', r.branch).split('\n').filter(Boolean);
  assert.ok(files.includes('docs/agents/issue-tracker.md') && files.includes('.devcontainer/Dockerfile') && files.includes('AGENTS.md') && files.includes('.claude/skills/mine/SKILL.md'));
  assert.ok(!files.includes(STATE) && !files.some((f) => f.includes('designing-technical-uis')));
  assert.equal(p.git('show', `${r.branch}:AGENTS.md`), OWN);
  assert.throws(() => undo(r.run, ctx), /close its pull request/);
});

test('server routes: the removal plan lists the files, remove-setup runs it, History undoes it; rename and relocate go through POST', async () => {
  const h = home();
  const p = localProject(h);
  const routes = api(p.ctx);
  routes['POST /api/projects']({ path: p.dir });
  const plan = routes['GET /api/remove-setup-plan'](new URLSearchParams({ dir: p.dir }));
  assert.equal(plan.shared, false);
  assert.ok(plan.changes.some((c) => c.path.endsWith('.benchkeeper') && c.destructive));
  assert.throws(() => routes['GET /api/remove-setup-plan'](new URLSearchParams({ dir: join(p.dir, 'x') })), /register the project first/);
  const list = routes['POST /api/projects']({ action: 'rename', path: p.dir, name: 'Shop', notes: 'n' });
  assert.equal(list[0].name, 'Shop');
  assert.throws(() => routes['POST /api/projects']({ action: 'rename', path: p.dir, name: 'a\nb' }), /control characters/);
  assert.throws(() => routes['POST /api/projects']({ action: 'bogus', path: p.dir }), /action must be/);
  assert.throws(() => routes['POST /api/projects']({ path: 'relative' }), /absolute/);
  const before = tree(p.dir);
  const [r] = routes['POST /api/remove-setup']({ paths: [p.dir, join(p.dir, 'unregistered')] });
  assert.equal(r.status, 'removed');
  assert.equal(status(p.ctx, p.dir).setupVersion, null);
  assert.equal(routes['POST /api/undo']({ run: r.run }).status, 'done');
  assert.deepEqual(tree(p.dir), before);
  const [row] = await routes['GET /api/projects']();
  assert.equal(row.name, 'Shop');
  assert.deepEqual(row.agents, ['claude', 'codex']);
  assert.equal(typeof row.last, 'string');
  // A run in a worktree counts for the project its note names.
  p.ctx.ledger.save({ schema: 1, id: '9999-pr-run', time: '2999-01-01T00:00:00.000Z', kind: 'apply', scope: '/tmp/some-worktree', note: { updateAll: p.dir, branch: 'b' }, entries: [] });
  assert.equal((await routes['GET /api/projects']())[0].last, '2999-01-01T00:00:00.000Z');
  const moved = `${p.dir}-moved`;
  renameSync(p.dir, moved);
  assert.equal(routes['POST /api/projects']({ action: 'relocate', path: p.dir, to: moved })[0].path, moved);
  routes['POST /api/projects']({ action: 'remove', paths: [moved] });
  assert.deepEqual(listProjects(p.ctx), []);
});

test('CLI: rename, relocate, and remove --setup listing every file before one question', async () => {
  const h = home();
  const p = localProject(h);
  const ctx = p.ctx;
  const w = writer();
  const exec = (args, answers = '') => main(args, { out: w.out, ctx, input: Readable.from([answers]) });
  assert.equal(await exec(['projects', 'add', p.dir]), 0);
  assert.equal(await exec(['projects', 'rename', p.dir, 'Shop', '--notes', 'hello']), 0);
  assert.deepEqual([listProjects(ctx)[0].name, listProjects(ctx)[0].notes], ['Shop', 'hello']);
  assert.equal(await exec(['projects', 'rename', p.dir]), 0);
  assert.equal(listProjects(ctx)[0].name, undefined);
  assert.equal(await exec(['projects', 'remove', p.dir, '--setup'], 'n\n'), 1);
  assert.match(w.text, /local setup: removed in the checkout/);
  assert.match(w.text, /remove \.benchkeeper\//);
  assert.match(w.text, /Remove the BenchKeeper setup of 1 project /);
  assert.ok(existsSync(join(p.dir, STATE)));
  assert.equal(await exec(['projects', 'remove', p.dir, '--setup', '--yes']), 0);
  assert.match(w.text, /removed +\S+ +undo: benchkeeper undo /);
  assert.equal(existsSync(join(p.dir, STATE)), false);
  assert.equal(listProjects(ctx).length, 1);
  const moved = `${p.dir}-moved`;
  renameSync(p.dir, moved);
  assert.equal(await exec(['projects', 'relocate', p.dir, moved]), 0);
  assert.equal(listProjects(ctx)[0].path, moved);
  assert.equal(await exec(['projects', 'relocate', p.dir]), 2);
  assert.equal(await exec(['projects', 'remove', moved]), 0);
  assert.deepEqual(listProjects(ctx), []);
});
