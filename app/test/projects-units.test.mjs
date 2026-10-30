// Unit tests of the projects module: the registry file, merging, names and notes, relocate, git code config, the origin
// default branch and its prefetch, the skill counts, the Installs tab rows and the reasons of a stopped project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { libraryWith } from '../src/packs.mjs';
import { addProject, confirmGit, gitCodeConfig, listProjects, prefetchOrigins, projectInstalls, registeredEntry, registryProblem, relocateProject, remoteHead, renameProject, skillCounts, status, unconfirmedGit, unshare, updateAll } from '../src/projects.mjs';
import { apply, context, preview } from '../src/runner.mjs';
import { STATE, projectCtx, projectPlan } from '../src/steps/project.mjs';

const TMP = realpathSync(tmpdir());
const home = () => mkdtempSync(join(TMP, 'bk-home-'));
const folder = () => mkdtempSync(join(TMP, 'bk-dir-'));
const repo = () => {
  const dir = folder();
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  return dir;
};
const registry = (ctx) => join(ctx.config, 'projects.json');
const writeRegistry = (ctx, data) => { mkdirSync(ctx.config, { recursive: true }); writeFileSync(registry(ctx), typeof data === 'string' ? data : JSON.stringify(data)); };

test('registryProblem: none for a missing or good file, one reason each for unreadable, broken and listless files', () => {
  const ctx = context({ home: home() });
  assert.equal(registryProblem(ctx), null);
  writeRegistry(ctx, { projects: [] });
  assert.equal(registryProblem(ctx), null);
  writeRegistry(ctx, '{"projects": [');
  assert.equal(registryProblem(ctx), 'the registered projects file is not valid JSON');
  writeRegistry(ctx, { projects: {} });
  assert.equal(registryProblem(ctx), 'the registered projects file has no projects list');
  writeRegistry(ctx, 'null');
  assert.equal(registryProblem(ctx), 'the registered projects file has no projects list');
  const other = context({ home: home() });
  mkdirSync(registry(other), { recursive: true });
  assert.equal(registryProblem(other), 'the registered projects file cannot be read');
  assert.equal(listProjects(other).length, 0);
  // Writing over a file that cannot be read would drop every project.
  assert.throws(() => addProject(other, folder()), (e) => e.status === 409 && /cannot be read/.test(e.message));
});

test('listProjects: two paths of one folder merge; the first keeps its date and name, a later state fills a missing one', () => {
  const ctx = context({ home: home() });
  const dir = folder(), link = join(home(), 'link');
  symlinkSync(dir, link);
  writeRegistry(ctx, { projects: [
    { path: link, added: 'first', name: 'A' },
    { path: dir, added: 'second', name: 'B', state: { packs: ['x'] } },
    { path: `${dir}/`, added: 'third', state: { packs: ['y'] } },
  ] });
  assert.deepEqual(listProjects(ctx), [{ path: dir, added: 'first', name: 'A', state: { packs: ['x'] } }]);
  writeRegistry(ctx, { projects: [{ path: dir, added: 'a', state: { packs: ['x'] } }, { path: dir, added: 'b', state: { packs: ['y'] } }] });
  assert.deepEqual(listProjects(ctx)[0].state, { packs: ['x'] });
  writeRegistry(ctx, { projects: 'none' });
  assert.deepEqual(listProjects(ctx), []);
});

test('registeredEntry: the entry under the canonical path, or a refusal naming it', () => {
  const ctx = context({ home: home() });
  const dir = folder();
  addProject(ctx, dir);
  assert.equal(registeredEntry(ctx, `${dir}/.`).path, dir);
  const other = folder();
  assert.throws(() => registeredEntry(ctx, other), { message: `${other} is not a registered project` });
});

test('renameProject: limits and characters of names and notes', () => {
  const ctx = context({ home: home() });
  const dir = folder();
  addProject(ctx, dir);
  renameProject(ctx, dir, { name: 'x'.repeat(80), notes: `${'n'.repeat(1998)}\t\n` });
  assert.equal(listProjects(ctx)[0].name.length, 80);
  assert.equal(listProjects(ctx)[0].notes, 'n'.repeat(1998));
  assert.throws(() => renameProject(ctx, dir, { notes: 'n'.repeat(2001) }), { message: 'the notes is longer than 2000 characters' });
  assert.throws(() => renameProject(ctx, dir, { name: 'a\tb' }), { message: 'the name has control characters' });
  assert.throws(() => renameProject(ctx, dir, { notes: 'a\u007fb' }), { message: 'the notes has control characters' });
  assert.throws(() => renameProject(ctx, dir, { notes: 'a\rb' }), { message: 'the notes has control characters' });
  assert.throws(() => renameProject(ctx, dir, { name: 'a\u001fb' }), /control characters/);
  assert.throws(() => renameProject(ctx, dir, { name: 7 }), { message: 'the name must be text' });
  // Characters at the edge of the control range pass.
  renameProject(ctx, dir, { name: ' ~ ', notes: '   ' });
  assert.equal(listProjects(ctx)[0].name, '~');
  assert.equal(listProjects(ctx)[0].notes, undefined);
  // Only the named entry changes.
  const second = folder();
  addProject(ctx, second);
  renameProject(ctx, second, { name: 'Two' });
  assert.deepEqual(listProjects(ctx).map((p) => p.name), ['~', 'Two']);
  renameProject(ctx, second, { name: null });
  assert.deepEqual(listProjects(ctx).map((p) => p.name), ['~', undefined]);
});

test('relocateProject: refuses a file, the same folder and a registered one; moves only the entry and the history', () => {
  const ctx = context({ home: home() });
  const dir = folder(), other = folder(), dest = folder();
  addProject(ctx, dir);
  addProject(ctx, other);
  writeFileSync(join(dest, 'f'), '');
  assert.throws(() => relocateProject(ctx, dir, join(dest, 'f')), { message: `${join(dest, 'f')} is not a folder` });
  assert.throws(() => relocateProject(ctx, dir, join(dest, 'gone')), { message: `${join(dest, 'gone')} is not a folder` });
  assert.throws(() => relocateProject(ctx, dir, dir), { message: `${dir} is the folder already registered` });
  assert.throws(() => relocateProject(ctx, dir, other), { message: `${other} is registered already: remove one of the two first` });
  const moved = [];
  ctx.ledger.relocate = (from, to) => moved.push([from, to]);
  assert.equal(relocateProject(ctx, dir, dest), dest);
  assert.deepEqual(listProjects(ctx).map((p) => p.path), [dest, other]);
  assert.deepEqual(moved, [[dir, dest]]);
});

test('relocateProject: a registry write that fails moves the history back', () => {
  const ctx = context({ home: home() });
  const dir = folder(), dest = folder();
  addProject(ctx, dir);
  const moved = [];
  ctx.ledger.relocate = (from, to) => { moved.push([from, to]); if (moved.length === 1) writeRegistry(ctx, '{'); };
  assert.throws(() => relocateProject(ctx, dir, dest), /not valid JSON/);
  assert.deepEqual(moved, [[dir, dest], [dest, dir]]);
});

test('gitCodeConfig: local code keys and executable hooks only; none outside a repository', () => {
  const ctx = context({ home: home() });
  assert.deepEqual(gitCodeConfig(ctx, folder()), []);
  const dir = repo();
  const set = (k, v) => execFileSync('git', ['-C', dir, 'config', k, v]);
  set('core.sshCommand', 'ssh -i key');
  set('credential.https://x.example.helper', 'store');
  set('remote.origin.url', 'https://x.example/r.git');
  set('filter.lfs.smudge', 'lfs smudge');
  set('url.https://y.example/.insteadOf', 'z:');
  set('user.name', 'plain');
  set('core.editor', 'vi');
  set('include.path', join(dir, 'missing.inc'));
  const keys = gitCodeConfig(ctx, dir).map((x) => x.key);
  assert.deepEqual(keys.filter((k) => !k.startsWith('hook ')).sort(), ['core.sshcommand', 'credential.https://x.example.helper', 'filter.lfs.smudge', 'include.path', 'remote.origin.url', 'url.https://y.example/.insteadof']);
  assert.equal(gitCodeConfig(ctx, dir).find((x) => x.key === 'core.sshcommand').value, 'ssh -i key');
  // A value over several lines stays whole.
  set('core.sshCommand', 'a\nb');
  assert.equal(gitCodeConfig(ctx, dir).find((x) => x.key === 'core.sshcommand').value, 'a\nb');
  const hooks = join(dir, '.git/hooks');
  writeFileSync(join(hooks, 'pre-push'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(hooks, 'post-merge'), 'plain\n', { mode: 0o644 });
  writeFileSync(join(hooks, 'commit-msg.sample'), '#!/bin/sh\n', { mode: 0o755 });
  mkdirSync(join(hooks, 'dir.d'), { mode: 0o755 });
  assert.deepEqual(gitCodeConfig(ctx, dir).filter((x) => x.key.startsWith('hook ')), [{ key: 'hook pre-push', value: '#!/bin/sh\n' }]);
});

test('unconfirmedGit: the keys added, removed or changed since confirmGit, sorted', () => {
  const ctx = context({ home: home() });
  const dir = repo();
  const set = (k, v) => execFileSync('git', ['-C', dir, 'config', k, v]);
  set('remote.origin.url', 'https://x.example/r.git');
  set('core.sshCommand', 'ssh');
  addProject(ctx, dir);
  assert.deepEqual(unconfirmedGit(ctx, dir), ['core.sshcommand', 'remote.origin.url']);
  const confirmed = confirmGit(ctx, dir);
  assert.equal(confirmed.length, 2);
  assert.match(confirmed[0], /^core\.sshcommand=[0-9a-f]{16}$/);
  assert.deepEqual(listProjects(ctx)[0].gitConfirmed, confirmed);
  // The registry keeps no value, only its hash.
  assert.doesNotMatch(readFileSync(registry(ctx), 'utf8'), /x\.example/);
  assert.deepEqual(unconfirmedGit(ctx, dir), []);
  set('remote.origin.url', 'https://y.example/r.git');
  execFileSync('git', ['-C', dir, 'config', '--unset', 'core.sshCommand']);
  set('filter.a.clean', 'c');
  assert.deepEqual(unconfirmedGit(ctx, dir), ['core.sshcommand', 'filter.a.clean', 'remote.origin.url']);
  assert.throws(() => confirmGit(ctx, folder()), /not a registered project/);
});

test('remoteHead: the branch origin names, else the local main or master', () => {
  const ctx = context({ home: home() });
  const dir = repo();
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'i'], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' } });
  assert.equal(remoteHead(ctx, dir, { code: 0, stdout: 'ref: refs/heads/trunk\tHEAD\nabc\tHEAD\n' }), 'trunk');
  assert.equal(remoteHead(ctx, dir, { code: 0, stdout: 'abc\tHEAD\nref: refs/heads/dev\tHEAD\n' }), 'dev');
  assert.equal(remoteHead(ctx, dir, { code: 2, stdout: 'ref: refs/heads/trunk\tHEAD\n' }), 'main');
  assert.equal(remoteHead(ctx, dir, { code: 0, stdout: 'ref: refs/heads/trunk\tHEADX\n' }), 'main');
  assert.equal(remoteHead(ctx, dir, { code: 0, stdout: 'xref: refs/heads/trunk\tHEAD\n' }), 'main');
});

test('skillCounts: per agent, the skill files below the folder that agent reads', () => {
  const dir = folder();
  for (const d of ['.claude/skills/a', '.claude/skills/b', '.agents/skills/c']) { mkdirSync(join(dir, d), { recursive: true }); writeFileSync(join(dir, d, 'SKILL.md'), '---\nname: x\n---\n'); }
  mkdirSync(join(dir, '.claude/skills-old/d'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills-old/d/SKILL.md'), '---\nname: d\n---\n');
  assert.deepEqual(skillCounts(dir, ['claude', 'codex']), { claude: 2, codex: 1 });
  assert.deepEqual(skillCounts(dir, []), {});
});

test('projectInstalls: per pack and skill the scope hint and the worst state on disk; global packs and skills', () => {
  const h = home(), dir = folder();
  const ctx = context({ home: h, roots: [h, dir] });
  apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', packs: ['frontend'] } }).changes), ctx, { scope: dir });
  const a = projectPlan({ ctx: projectCtx(ctx, dir), dir, answers: {} }).answers;
  const local = { state: 'installed', hint: 'only this project' };
  let rows = projectInstalls(ctx, dir, a);
  assert.deepEqual(rows.packs.frontend, { scope: 'projects', fixed: [], state: 'installed', owner: false, hint: 'only this project' });
  // One of the docs pack's two skills is here: the pack counts as not installed.
  assert.equal(rows.packs.docs.state, 'not installed');
  assert.deepEqual(rows.packs.ponytail, { scope: 'global', fixed: [], state: 'not installed', owner: false, hint: 'also global' });
  assert.equal(rows.packs['matt-pocock'].owner, true);
  assert.deepEqual(rows.skills, { 'frontend-design': local, 'designing-technical-uis': local, accessibility: local });
  assert.deepEqual(rows.global, { plugin: [], packs: [], skills: [{ agent: 'Claude Code', count: 0 }] });
  // Codex offers plugins for the user only: that scope is fixed, and the pack is also global.
  const codex = projectInstalls(ctx, dir, { ...a, agents: ['claude', 'codex'] }).packs.ponytail.fixed;
  assert.deepEqual(codex.map((f) => [f.agent, f.scope]), [['Codex', 'global']]);
  // An edited skill makes the pack modified; a removed one outranks that.
  writeFileSync(join(dir, '.claude/skills/accessibility/SKILL.md'), 'edited\n');
  rows = projectInstalls(ctx, dir, a);
  assert.deepEqual([rows.packs.frontend.state, rows.skills.accessibility.state], ['modified', 'modified']);
  rmSync(join(dir, '.claude/skills/frontend-design'), { recursive: true });
  rows = projectInstalls(ctx, dir, a);
  assert.deepEqual([rows.packs.frontend.state, rows.skills['frontend-design'].state], ['not installed', 'not installed']);
});

test('projectInstalls: a pack at global scope reads the user\'s skill folder; a turned-off skill is off', () => {
  const h = home(), dir = folder();
  const ctx = { ...context({ home: h, roots: [h, dir] }), packScopes: { frontend: 'global' } };
  const skill = (n) => { mkdirSync(join(h, '.claude/skills', n), { recursive: true }); writeFileSync(join(h, '.claude/skills', n, 'SKILL.md'), `---\nname: ${n}\n---\n`); };
  skill('frontend-design');
  skill('accessibility');
  const a = projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', packs: ['frontend'], disable: ['accessibility'] } }).answers;
  let rows = projectInstalls(ctx, dir, a);
  assert.deepEqual([rows.packs.frontend.state, rows.packs.frontend.hint], ['not installed', 'also global']);
  assert.deepEqual(rows.skills, {
    'frontend-design': { state: 'installed', hint: 'also global' },
    'designing-technical-uis': { state: 'not installed', hint: 'also global' },
    accessibility: { state: 'off', hint: 'also global' },
  });
  skill('designing-technical-uis');
  rows = projectInstalls(ctx, dir, a);
  assert.equal(rows.packs.frontend.state, 'installed');
  assert.deepEqual(rows.global.packs, []);
  assert.deepEqual(rows.global.skills, [{ agent: 'Claude Code', count: 3 }]);
  // Not selected here, installed for the user: the global block lists it.
  rows = projectInstalls(ctx, dir, { ...a, packs: [], disabled: [] });
  const title = libraryWith(ctx).packs.find((p) => p.id === 'frontend').title;
  assert.deepEqual(rows.global.packs, [{ id: 'frontend', title }]);
  assert.deepEqual(rows.skills, {});
});

test('status: a folder that is gone has no setup, branch or changes', () => {
  const dir = join(folder(), 'gone');
  assert.deepEqual(status(context({ home: home() }), dir), { path: dir, missing: true, setupVersion: null, current: false, checkout: null, origin: null, repo: false, branch: null, clean: null, changes: null, error: null, skills: {}, share: false, committed: false, github: false, agents: [], packs: [], tier: null });
});

test('prefetchOrigins: asks origin for its default branch, fetches it without prompts, and keeps both a minute', async () => {
  const ctx = context({ home: home() });
  const calls = [];
  ctx.runAsync = async (argv, opts) => { calls.push({ args: argv.slice(3), env: opts.env, timeout: opts.timeout }); return argv[3] === 'ls-remote' ? { code: 0, stdout: 'ref: refs/heads/trunk\tHEAD\n' } : { code: 0, stdout: '' }; };
  const dir = repo();
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', join(home(), 'origin.git')]);
  await prefetchOrigins(ctx, [dir, folder()]);
  assert.deepEqual(calls.map((c) => c.args), [['ls-remote', '--symref', 'origin', 'HEAD'], ['fetch', '-q', 'origin', 'trunk']]);
  assert.equal(calls[0].timeout, 20e3);
  assert.equal(calls[1].env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(calls[1].env.GIT_ASKPASS, '');
  if (!process.env.GIT_SSH_COMMAND) assert.equal(calls[1].env.GIT_SSH_COMMAND, 'ssh -o BatchMode=yes');
  calls.length = 0;
  await prefetchOrigins(ctx, [dir]);
  assert.deepEqual(calls, []);
  // origin/HEAD known: no question to origin; the repository's own ssh command stays.
  const other = repo();
  execFileSync('git', ['-C', other, 'remote', 'add', 'origin', join(home(), 'origin.git')]);
  execFileSync('git', ['-C', other, 'config', 'core.sshCommand', 'ssh -i k']);
  execFileSync('git', ['-C', other, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev']);
  await prefetchOrigins(ctx, [other]);
  assert.deepEqual(calls.map((c) => c.args), [['fetch', '-q', 'origin', 'dev']]);
  if (!process.env.GIT_SSH_COMMAND) assert.equal(calls[0].env.GIT_SSH_COMMAND, undefined);
  // Without an async runner nothing is fetched.
  calls.length = 0;
  const third = repo();
  execFileSync('git', ['-C', third, 'remote', 'add', 'origin', join(home(), 'origin.git')]);
  await prefetchOrigins({ ...ctx, runAsync: undefined }, [third]);
  assert.deepEqual(calls, []);
});

test('Update all names each failed step of a local setup with its error', () => {
  const h = home(), dir = folder();
  const ctx = context({ home: h, roots: [h, dir] });
  apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent' } }).changes), ctx, { scope: dir });
  const offline = { ...ctx, run: (argv, o) => (argv[0] === 'npx' ? { code: 1, stdout: '', stderr: 'offline' } : ctx.run(argv, o)) };
  const [r] = updateAll(offline, { paths: [dir], push: false, answers: { [dir]: { agents: ['claude'], env: 'host-agent', packs: ['frontend'] } } });
  assert.equal(r.status, 'stopped');
  const failed = ctx.ledger.get(r.run).entries.filter((e) => e.status === 'failed');
  assert.ok(failed.length);
  assert.equal(r.reason, failed.map((e) => `${e.title}: ${e.error}`).join('; '));
});

test('unshare keeps the answers in the registry first, registering the folder when needed, and leaves other entries alone', () => {
  const h = home(), dir = folder(), other = folder();
  const ctx = context({ home: h, roots: [h, dir] });
  apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent' } }).changes), ctx, { scope: dir });
  addProject(ctx, other);
  const state = JSON.parse(readFileSync(join(dir, STATE), 'utf8'));
  assert.deepEqual(unshare(ctx, dir), { path: dir, branch: 'chore/agent-setup-local', status: 'stopped', reason: 'not a git repository' });
  const [first, second] = listProjects(ctx);
  assert.deepEqual(Object.keys(first), ['path', 'added']);
  assert.deepEqual([second.path, second.state], [dir, state]);
  assert.match(second.added, /^\d{4}-\d\d-\d\dT/);
  unshare(ctx, dir);
  assert.equal(listProjects(ctx).length, 2);
});
