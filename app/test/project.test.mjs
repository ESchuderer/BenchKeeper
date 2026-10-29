import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, win32 } from 'node:path';
import { test } from 'node:test';
import { apply, context, preview, runCommand, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { recordSession } from '../src/session.mjs';
import { appVersion, contentDir, library } from '../src/content.mjs';
import { projectChecks } from '../src/doctor.mjs';
import { harnessTest } from '../src/harness.mjs';
import { SKILLS_SPEC } from '../src/steps/global.mjs';
import { ENVS, STATE, projectCtx, projectPlan, readState, slashRel, suggest, tryState } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());

function repo() {
  const dir = mkdtempSync(join(TMP, 'bk-proj-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const home = mkdtempSync(join(TMP, 'bk-home-'));
  const ctx = context({ home, roots: [home, dir], appVersion: '6.0.0' });
  return { dir, ctx, git };
}
const read = (p) => readFileSync(p, 'utf8');
const plan = (r, answers, plugins = { claude: [], codex: [] }) => projectPlan({ ctx: r.ctx, dir: r.dir, answers, plugins });

test('shared: AGENTS.md block, CLAUDE.md import, own skill copies, community skills, state file', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'AGENTS.md'), '# Project\n\nmy notes\n');
  // No registry answer: the skills CLI is the app's minimum, whatever the live registry has published.
  const real = r.ctx.run;
  r.ctx.run = (argv, o) => (argv[0] === 'npm' && argv[1] === 'view' ? { code: 1, stdout: '', stderr: 'offline' } : real(argv, o));
  const { changes, prompts } = plan(r, { agents: ['claude', 'codex'], env: 'host-agent', packs: ['frontend'], tier: 'quick', share: true });
  const run = apply(preview(changes), r.ctx, { scope: r.dir, select: changes.filter((c) => c.kind !== 'command').map((c) => c.id) });
  assert.equal(run.status, 'done');
  const agentsMd = read(join(r.dir, 'AGENTS.md'));
  assert.ok(agentsMd.startsWith('# Project\n\nmy notes\n'));
  assert.ok(agentsMd.includes(`- ${ENVS['host-agent']}`) && agentsMd.includes('- Default tier: quick') && agentsMd.includes('- UI screens and user-facing text: load the designing-technical-uis skill first.'));
  assert.equal(read(join(r.dir, 'CLAUDE.md')), '@AGENTS.md\n');
  for (const d of ['.claude/skills', '.agents/skills']) assert.ok(existsSync(join(r.dir, d, 'designing-technical-uis/SKILL.md')), d);
  const cmd = changes.find((c) => c.title.startsWith('skill frontend-design'));
  // An alias spec: npx never takes a skills package from the project's node_modules.
  assert.deepEqual(cmd.argv.slice(0, 3), ['npx', '-y', SKILLS_SPEC]);
  assert.deepEqual(cmd.argv.slice(3, 9), ['add', 'https://github.com/anthropics/skills', '-s', 'frontend-design', '-a', 'claude-code']);
  assert.ok(cmd.argv.includes('codex') && cmd.cwd === r.dir && cmd.env.DO_NOT_TRACK === '1' && cmd.env.npm_config_registry === 'https://registry.npmjs.org/' && Math.abs(Date.parse(cmd.env.npm_config_before) - (Date.now() - 7 * 864e5)) < 60e3 && cmd.snapshot.includes(join(r.dir, 'skills-lock.json')));
  const state = readState(r.dir);
  assert.deepEqual([state.contentVersion, state.env, state.tier, state.packs], [appVersion, 'host-agent', 'quick', ['frontend']]);
  assert.deepEqual(state.skills.map((s) => s.name).sort(), ['accessibility', 'designing-technical-uis', 'frontend-design']);
  assert.match(prompts[0].prompt, /setting-up-projects/);
});

test('local (the default): CLAUDE.local.md imports AGENTS.md, AGENTS.override.md carries it, git ignores it all; shared moves it back', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'AGENTS.md'), '# Project\n\nmy notes\n');
  r.git('add', '-A');
  r.git('commit', '-qm', 'agents');
  const { changes } = plan(r, { agents: ['claude', 'codex'], env: 'host-agent', packs: ['frontend'], tier: 'quick' });
  assert.equal(apply(preview(changes), r.ctx, { scope: r.dir, select: changes.filter((c) => c.kind !== 'command').map((c) => c.id) }).status, 'done');
  assert.equal(read(join(r.dir, 'AGENTS.md')), '# Project\n\nmy notes\n');
  assert.ok(!existsSync(join(r.dir, 'CLAUDE.md')));
  const local = read(join(r.dir, 'CLAUDE.local.md'));
  assert.ok(local.startsWith('@AGENTS.md\n\n') && local.includes('- Default tier: quick'), local);
  const override = read(join(r.dir, 'AGENTS.override.md'));
  assert.ok(override.startsWith('# Project\n\nmy notes\n') && override.includes('- Default tier: quick'), override);
  assert.equal(readState(r.dir).share, false);
  const exclude = read(join(r.dir, '.git/info/exclude'));
  for (const p of ['/.benchkeeper/', '/CLAUDE.local.md', '/AGENTS.override.md', '/.claude/skills/designing-technical-uis/', '/.agents/skills/designing-technical-uis/']) assert.ok(exclude.includes(`\n${p}\n`), p);
  assert.equal(r.git('status', '--porcelain').toString(), '');

  apply(preview(plan(r, { share: true }).changes), r.ctx, { scope: r.dir });
  assert.match(read(join(r.dir, 'AGENTS.md')), /- Default tier: quick/);
  assert.equal(read(join(r.dir, 'CLAUDE.md')), '@AGENTS.md\n');
  assert.ok(!existsSync(join(r.dir, 'CLAUDE.local.md')));
  assert.ok(!existsSync(join(r.dir, 'AGENTS.override.md')));
  assert.ok(!read(join(r.dir, '.git/info/exclude')).includes('BenchKeeper'));
  assert.match(r.git('status', '--porcelain').toString(), /\.benchkeeper\//);
});

test('exclude lines use forward slashes for Windows paths: a backslash escapes the next character in Git', () => {
  assert.equal(slashRel('C:\\work\\shop', 'C:\\work\\shop\\.claude\\skills\\foo', win32), '.claude/skills/foo');
});
test('the dev container wrapper and the worktree files: offered by what the project has, named once written, undone', () => {
  const r = repo();
  const opts = { agents: ['claude'], env: 'host-agent' };
  const steps = (answers) => plan(r, answers).changes.map((c) => c.step);
  assert.ok(!steps(opts).includes('dc') && !steps(opts).includes('worktrees'));
  mkdirSync(join(r.dir, '.devcontainer'));
  writeFileSync(join(r.dir, 'package-lock.json'), '{}\n');
  // A dispatched worker session the board scan cached for this repository.
  mkdirSync(join(r.ctx.home, '.cache/benchkeeper'), { recursive: true });
  writeFileSync(join(r.ctx.home, '.cache/benchkeeper/sessions.json'), JSON.stringify({ schema: 1, files: { '/w.jsonl': { key: 'k', kind: 'claude', d: { orca: true, repo: r.dir } } } }));
  const { changes } = plan(r, opts);
  const shown = preview(changes);
  const dc = shown.find((c) => c.step === 'dc'), files = shown.filter((c) => c.step === 'worktrees');
  assert.ok(dc.selected && dc.title.startsWith('scripts/dc:'));
  assert.deepEqual(files.map((c) => [basename(c.path), c.selected]), [['orca.yaml', false], ['.worktreeinclude', false]]);
  assert.match(files[0].after, /\n {4}scripts\/dc up && scripts\/dc npm ci\n/);
  assert.match(files[0].title, /setup hook: npm ci \(package-lock\.json\), through scripts\/dc/);
  for (const p of ['CLAUDE.local.md', '.benchkeeper', 'scripts/dc', 'orca.yaml']) assert.ok(files[1].after.split('\n').includes(p), p);
  assert.match(shown.find((c) => c.step === 'local-claude').diff, /scripts\/dc <command>/);

  const run = apply(shown, r.ctx, { scope: r.dir, select: shown.map((c) => c.id) });
  assert.equal(run.status, 'done');
  assert.ok(statSync(join(r.dir, 'scripts/dc')).mode & 0o100);
  assert.match(read(join(r.dir, 'CLAUDE.local.md')), /`scripts\/dc <command>`/);
  for (const p of ['/scripts/dc', '/orca.yaml', '/.worktreeinclude']) assert.ok(read(join(r.dir, '.git/info/exclude')).split('\n').includes(p), p);
  assert.equal(r.git('status', '--porcelain').toString(), '?? package-lock.json\n');
  assert.equal(undo(run.id, r.ctx).status, 'done');
  for (const p of ['scripts/dc', 'orca.yaml', '.worktreeinclude']) assert.ok(!existsSync(join(r.dir, p)), p);

  // Not chosen: the block and the exclude list leave it out.
  const again = preview(plan(r, opts).changes);
  apply(again, r.ctx, { scope: r.dir, select: again.filter((c) => c.step !== 'dc').map((c) => c.id) });
  assert.ok(!existsSync(join(r.dir, 'scripts/dc')));
  assert.ok(!read(join(r.dir, 'CLAUDE.local.md')).includes('scripts/dc') && !read(join(r.dir, '.git/info/exclude')).includes('scripts/dc'));
});

test('the worktree setup hook: the install command of the one lockfile at the root, else a line to fill in', () => {
  const cases = [
    [['package-lock.json'], 'npm ci'], [['pnpm-lock.yaml'], 'pnpm install --frozen-lockfile'], [['uv.lock'], 'uv sync --locked'],
    [['yarn.lock'], 'yarn install --frozen-lockfile'], [['yarn.lock', '.yarnrc.yml'], 'yarn install --immutable'],
    [[], null], [['package-lock.json', 'yarn.lock'], null], [['app/package-lock.json'], null],
  ];
  for (const [files, command] of cases) {
    const r = repo();
    mkdirSync(join(r.ctx.home, '.cache/benchkeeper'), { recursive: true });
    writeFileSync(join(r.ctx.home, '.cache/benchkeeper/sessions.json'), JSON.stringify({ schema: 1, files: { '/w.jsonl': { key: 'k', kind: 'claude', d: { orca: true, repo: r.dir } } } }));
    for (const f of files) { mkdirSync(dirname(join(r.dir, f)), { recursive: true }); writeFileSync(join(r.dir, f), ''); }
    const yaml = plan(r, { agents: ['claude'], env: 'host-agent' }).changes.find((c) => basename(c.path ?? '') === 'orca.yaml');
    if (command) {
      assert.ok(yaml.after.includes(`\n    ${command}\n`), files.join());
      assert.ok(yaml.title.endsWith(`setup hook: ${command} (${files[0]})`), yaml.title);
    } else {
      assert.match(yaml.after, /# the install command from AGENTS\.md/, files.join());
      assert.ok(yaml.title.endsWith('setup hook: none found, fill in the comment line'), yaml.title);
    }
  }
});

test('scripts/dc runs the command in the dev container of its checkout with each argument as given', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  mkdirSync(join(r.dir, '.devcontainer'));
  const shown = preview(plan(r, { agents: ['claude'], env: 'host-agent' }).changes);
  apply(shown, r.ctx, { scope: r.dir, select: shown.filter((c) => c.step === 'dc').map((c) => c.id) });
  // A devcontainer stub that prints the compose project name, then each argument on a line of its own.
  const bin = mkdtempSync(join(TMP, 'bk-bin-'));
  writeFileSync(join(bin, 'devcontainer'), '#!/bin/sh\nprintf \'%s\\n\' "$COMPOSE_PROJECT_NAME"; for a in "$@"; do printf \'%s\\n\' "$a"; done\n');
  chmodSync(join(bin, 'devcontainer'), 0o755);
  mkdirSync(join(r.dir, 'web'));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  delete env.COMPOSE_PROJECT_NAME;
  const dc = (args, e = env) => execFileSync(join(r.dir, 'scripts/dc'), args, { cwd: join(r.dir, 'web'), env: e }).toString().split('\n');
  const [name, ...out] = dc(['sh', '-lc', "cd web && echo 'a  b' *"]);
  assert.deepEqual(out, ['exec', '--workspace-folder', r.dir, 'sh', '-lc', "cd web && echo 'a  b' *", '']);
  // Named after the folder and its path: a clone at another path with the same folder name gets another name.
  assert.match(name, new RegExp(`^\\d+-${basename(r.dir).toLowerCase().replace(/[^a-z0-9_-]/g, '')}$`));
  const twin = join(mkdtempSync(join(TMP, 'bk-twin-')), basename(r.dir), 'scripts');
  mkdirSync(twin, { recursive: true });
  writeFileSync(join(twin, 'dc'), read(join(r.dir, 'scripts/dc')), { mode: 0o755 });
  const twinName = execFileSync(join(twin, 'dc'), ['true'], { env }).toString().split('\n')[0];
  assert.ok(twinName !== name && twinName.endsWith(name.replace(/^\d+/, '')), twinName);
  assert.deepEqual(dc(['up', '--log-level', 'info']), [name, 'up', '--workspace-folder', r.dir, '--log-level', 'info', '']);
  // A name the user set is kept.
  assert.equal(dc(['true'], { ...env, COMPOSE_PROJECT_NAME: 'mine' })[0], 'mine');
  writeFileSync(join(r.dir, '.devcontainer/.env'), 'COMPOSE_PROJECT_NAME=fromenv\n');
  assert.equal(dc(['true'])[0], '');
});

test('local: two projects in one repository keep their own exclude blocks; a dropped agent loses its local file; a committed setup is refused', () => {
  const r = repo();
  for (const d of ['web', 'api']) mkdirSync(join(r.dir, d));
  const at = (d) => ({ ctx: projectCtx(r.ctx, join(r.dir, d)), dir: join(r.dir, d) });
  for (const d of ['web', 'api']) {
    const { ctx, dir } = at(d);
    assert.equal(apply(preview(projectPlan({ ctx, dir, answers: { agents: ['claude', 'codex'], env: 'host-agent' } }).changes), ctx, { scope: dir }).status, 'done');
  }
  const exclude = () => read(join(r.dir, '.git/info/exclude'));
  for (const p of ['/web/CLAUDE.local.md', '/api/CLAUDE.local.md', '/web/.benchkeeper/', '/api/AGENTS.override.md']) assert.ok(exclude().includes(`\n${p}\n`), p);
  assert.equal(r.git('status', '--porcelain').toString(), '');

  const web = at('web');
  apply(preview(projectPlan({ ctx: web.ctx, dir: web.dir, answers: { agents: ['claude'] } }).changes), web.ctx, { scope: web.dir });
  assert.ok(!existsSync(join(web.dir, 'AGENTS.override.md')));
  assert.ok(!exclude().includes('/web/AGENTS.override.md') && exclude().includes('/api/AGENTS.override.md'));

  const api = at('api');
  apply(preview(projectPlan({ ctx: api.ctx, dir: api.dir, answers: { share: true } }).changes), api.ctx, { scope: api.dir });
  assert.ok(!exclude().includes('/api/') && exclude().includes('/web/CLAUDE.local.md'));
  r.git('add', '-A');
  r.git('commit', '-qm', 'shared api setup');
  assert.throws(() => projectPlan({ ctx: api.ctx, dir: api.dir, answers: { share: false } }), /is committed: benchkeeper projects unshare/);
});

test('a recorded session in a local setup holds the skills git ignores, so undo restores them', () => {
  const r = repo();
  apply(preview(plan(r, { agents: ['claude'], env: 'host-agent' }).changes), r.ctx, { scope: r.dir });
  // The setup session installs a stack skill, then projects apply lists it in the exclude block (skills-lock.json).
  recordSession(r.ctx, r.dir, ['sh', '-c', 'mkdir -p .claude/skills/stack && echo s > .claude/skills/stack/SKILL.md && echo \'{"skills":{"stack":{}}}\' > skills-lock.json']);
  apply(preview(plan(r, {}).changes), r.ctx, { scope: r.dir });
  assert.match(read(join(r.dir, '.git/info/exclude')), /\n\/\.claude\/skills\/stack\/\n/);
  const again = recordSession(r.ctx, r.dir, ['sh', '-c', 'echo changed > .claude/skills/stack/SKILL.md']);
  assert.deepEqual(again.entries[0].files.map((f) => f.path), ['.claude/skills/stack/SKILL.md']);
  assert.equal(undo(again.id, r.ctx).status, 'done');
  assert.equal(read(join(r.dir, '.claude/skills/stack/SKILL.md')), 's\n');
});

test('local in a linked worktree: the exclude list of the main repository, outside the worktree, is written and undone', () => {
  const r = repo();
  const wt = join(mkdtempSync(join(TMP, 'bk-wt-')), 'wt');
  r.git('worktree', 'add', '-q', '-b', 'side', wt);
  const pctx = projectCtx(r.ctx, wt);
  const run = apply(preview(projectPlan({ ctx: pctx, dir: wt, answers: { agents: ['claude'], env: 'host-agent' } }).changes), pctx, { scope: wt });
  assert.equal(run.status, 'done', JSON.stringify(run.entries.filter((e) => e.error)));
  assert.match(read(join(r.dir, '.git/info/exclude')), /\n\/CLAUDE\.local\.md\n/);
  assert.equal(execFileSync('git', ['-C', wt, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  assert.equal(undo(run.id, pctx).status, 'done');
  assert.ok(!read(join(r.dir, '.git/info/exclude')).includes('BenchKeeper'));
});

test('a community skill is added again from the default branch only when an update asks for it', () => {
  const r = repo();
  const first = plan(r, { agents: ['claude'], packs: ['frontend'] }).changes;
  apply(preview(first), r.ctx, { scope: r.dir, select: first.filter((c) => c.kind !== 'command').map((c) => c.id) });
  for (const n of ['frontend-design', 'accessibility']) mkdirSync(join(r.dir, '.claude/skills', n), { recursive: true });
  const titles = (answers = {}) => plan(r, answers).changes.filter((c) => c.kind === 'command').map((c) => c.title);
  assert.deepEqual(titles(), []);
  const f = join(r.dir, STATE);
  const state = JSON.parse(read(f));
  state.skills.find((s) => s.name === 'frontend-design').ref = 'a'.repeat(40);
  writeFileSync(f, JSON.stringify(state));
  assert.deepEqual(titles(), [], 'a recorded commit alone does not trigger an install');
  assert.deepEqual(titles({ update: ['frontend-design'] }), ['skill frontend-design from anthropics/skills (installed aaaaaaaaaaaa)']);
  // Undo puts back the folder as it was before, local edits included, and the lockfile.
  const skill = join(r.dir, '.claude/skills/frontend-design/SKILL.md');
  writeFileSync(skill, 'old, edited locally\n');
  writeFileSync(join(r.dir, 'skills-lock.json'), '{"old":true}\n');
  const npx = { ...r.ctx, run: (argv) => { if (argv[0] === 'npx') { writeFileSync(skill, 'new\n'); writeFileSync(join(r.dir, 'skills-lock.json'), '{"new":true}\n'); } return { code: 0, stdout: `${'b'.repeat(40)}\tHEAD\n`, stderr: '' }; } };
  const updateRun = apply(preview(plan(r, { update: ['frontend-design'] }).changes.filter((c) => c.kind === 'command' || c.step === 'state')), npx, { scope: r.dir });
  assert.equal(read(skill), 'new\n');
  assert.equal(readState(r.dir).skills.find((s) => s.name === 'frontend-design').ref, 'b'.repeat(40), 'the state records the default branch commit');
  assert.equal(undo(updateRun.id, npx).status, 'done');
  assert.equal(read(skill), 'old, edited locally\n');
  assert.equal(read(join(r.dir, 'skills-lock.json')), '{"old":true}\n');
  state.skills.find((s) => s.name === 'frontend-design').ref = '../../x';
  writeFileSync(f, JSON.stringify(state));
  assert.deepEqual(titles({ update: ['frontend-design'] }), ['skill frontend-design from anthropics/skills'], 'a ref that is not a commit id is not shown');
});

test('a community skill without a recorded commit or behind its source is no drift for doctor or verify', () => {
  const r = repo();
  const first = plan(r, { agents: ['claude'], packs: ['frontend'] }).changes;
  apply(preview(first), r.ctx, { scope: r.dir, select: first.filter((c) => c.kind !== 'command').map((c) => c.id) });
  const f = join(r.dir, STATE);
  const state = JSON.parse(read(f));
  const community = state.skills.filter((s) => s.source !== 'own');
  assert.ok(community.length >= 2);
  community[0].ref = 'a'.repeat(40);
  delete community[1].ref;
  writeFileSync(f, JSON.stringify(state));
  writeFileSync(join(r.dir, 'skills-lock.json'), JSON.stringify({ skills: Object.fromEntries(community.map((s) => [s.name, { source: s.source }])) }));
  const ctx = { ...r.ctx, run: () => ({ code: 0, stdout: `${'b'.repeat(40)}\tHEAD\n`, stderr: '' }) };
  const names = community.map((s) => s.name);
  assert.deepEqual(projectChecks(ctx, r.dir, ['claude']).filter((i) => names.some((n) => i.message.includes(n))), []);
  assert.deepEqual(harnessTest(ctx, { agents: ['claude'], dir: r.dir }).at(-1).problems, []);
});

test('the state file records a community skill\'s commit only when its install ran', () => {
  const r = repo();
  const changes = plan(r, { agents: ['claude'], packs: ['frontend'] }).changes;
  const failing = { ...r.ctx, run: () => ({ code: 1, stdout: '', stderr: 'offline' }) };
  apply(preview(changes), failing, { scope: r.dir });
  const st = readState(r.dir);
  assert.ok(st.skills.filter((s) => s.source !== 'own').every((s) => !s.ref), JSON.stringify(st.skills));
  // Not claimed as installed: the next plan installs them again.
  assert.ok(plan(r, {}).changes.some((c) => c.title.startsWith('skill frontend-design from')));
  const ok = { ...r.ctx, run: () => ({ code: 0, stdout: `${'c'.repeat(40)}\tHEAD\n`, stderr: '' }) };
  apply(preview(plan(r, {}).changes), ok, { scope: r.dir });
  assert.equal(readState(r.dir).skills.find((s) => s.name === 'frontend-design').ref, 'c'.repeat(40));
  // The remote cannot be read: the install ran, but no commit is claimed.
  const r2 = repo();
  const quiet = { ...r2.ctx, run: () => ({ code: 0, stdout: '', stderr: '' }) };
  apply(preview(plan(r2, { agents: ['claude'], packs: ['frontend'] }).changes), quiet, { scope: r2.dir });
  assert.ok(!readState(r2.dir).skills.find((s) => s.name === 'frontend-design').ref);
});

test('suggestions name the packs the files of a project point to, with the reason', () => {
  const r = repo();
  assert.deepEqual(suggest(r.dir), { packs: [], devcontainer: false, env: null });
  writeFileSync(join(r.dir, 'package.json'), JSON.stringify({ dependencies: { react: '19' }, devDependencies: { '@playwright/test': '1' } }));
  writeFileSync(join(r.dir, 'requirements.txt'), 'pandas==2\nnumpy\n');
  mkdirSync(join(r.dir, '.github/workflows'), { recursive: true });
  mkdirSync(join(r.dir, '.devcontainer'));
  assert.deepEqual(suggest(r.dir), { devcontainer: true, env: null, packs: [
    { id: 'frontend', reason: 'package.json uses react' }, { id: 'testing', reason: 'package.json uses @playwright/test' },
    { id: 'security', reason: 'CI workflows in .github/workflows' }, { id: 'science', reason: 'Python uses numpy' }, { id: 'data', reason: 'Python uses pandas' }] });
  writeFileSync(join(r.dir, 'package.json'), '{broken');
  assert.ok(!suggest(r.dir).packs.some((p) => p.id === 'frontend'));
});

test('a second plan reads the answers from the state file', () => {
  const r = repo();
  const first = plan(r, { agents: ['claude'], tier: 'standard', share: true }).changes;
  apply(preview(first), r.ctx, { scope: r.dir });
  assert.deepEqual(preview(plan(r, {}).changes).map((c) => c.title), []);
  assert.match(preview(plan(r, { tier: 'full' }).changes).map((c) => c.title).join(), /AGENTS.md/);
  // --tier= (empty) clears the saved tier and its line.
  apply(preview(plan(r, { tier: '' }).changes), r.ctx, { scope: r.dir });
  assert.doesNotMatch(readFileSync(join(r.dir, 'AGENTS.md'), 'utf8'), /Default tier/);
  assert.equal(readState(r.dir).tier, '');
});

test('packs with plugins install them and list their prompts', () => {
  const r = repo();
  const p = plan(r, { agents: ['claude'], packs: ['matt-pocock'] });
  assert.ok(p.changes.some((c) => c.argv?.join(' ') === 'claude plugin install mattpocock-skills@claude-plugins-official'));
  assert.ok(p.prompts.some((x) => x.prompt === '/mattpocock-skills:setup-matt-pocock-skills'));
  const installed = plan(r, { agents: ['claude'], packs: ['matt-pocock'] }, { claude: ['mattpocock-skills@claude-plugins-official'] });
  assert.ok(!installed.changes.some((c) => c.kind === 'command'));
  assert.throws(() => plan(r, { agents: ['claude'], packs: ['nope'] }), /unknown pack/);
  assert.throws(() => plan(r, { agents: ['claude'], env: 'vm' }), /env must be/);
});

// The block of a pack's own setup in CLAUDE.md is not moved: that setup runs outside BenchKeeper's plan and undo.
test('a pack is named in the project text only when it is on: off, no mention; on, its pointer line', () => {
  const texts = (r) => ['AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.override.md'].map((f) => (existsSync(join(r.dir, f)) ? read(join(r.dir, f)) : '')).join('\n');
  for (const share of [false, true]) {
    const off = repo();
    writeFileSync(join(off.dir, 'CLAUDE.md'), '@AGENTS.md\n\n## Agent skills\n\n### Issue tracker\n\nGitHub.\n');
    apply(preview(plan(off, { agents: ['claude', 'codex'], env: 'host', share }).changes), off.ctx, { scope: off.dir });
    assert.equal(read(join(off.dir, 'CLAUDE.md')).includes('## Agent skills'), true, 'CLAUDE.md keeps its block');
    assert.doesNotMatch(texts(off).replace(/## Agent skills\n\n### Issue tracker\n\nGitHub\.\n/, ''), /pocock/i);
    const on = repo();
    apply(preview(plan(on, { agents: ['claude', 'codex'], env: 'host', share, packs: ['matt-pocock'] }, { claude: ['mattpocock-skills@claude-plugins-official'], codex: ['mattpocock-skills@mattpocock'] }).changes), on.ctx, { scope: on.dir });
    assert.match(texts(on), /- Matt Pocock's skills \(`mattpocock-skills:<name>`\) are installed/);
  }
});

test("doctor: a pack whose own setup writes docs/agents/ and AGENTS.md sections is named while they are missing", () => {
  assert.equal(library().packs.find((p) => p.id === 'matt-pocock').prompts[0].writes, 'docs/agents');
  const off = repo();
  apply(preview(plan(off, { agents: ['claude'], env: 'host' }).changes), off.ctx, { scope: off.dir });
  assert.deepEqual(projectChecks(off.ctx, off.dir, ['claude']).filter((i) => i.check === 'packs'), []);
  const r = repo();
  apply(preview(plan(r, { agents: ['claude'], env: 'host', packs: ['matt-pocock'] }, { claude: ['mattpocock-skills@claude-plugins-official'] }).changes), r.ctx, { scope: r.dir });
  const found = () => projectChecks(r.ctx, r.dir, ['claude']).filter((i) => i.check === 'packs').map((i) => [i.level, i.message, i.fix.split(' ').slice(0, 2).join(' ')]);
  assert.deepEqual(found(), [['warning', 'pack matt-pocock is on, but docs/agents/ does not exist', 'run /mattpocock-skills:setup-matt-pocock-skills']]);
  mkdirSync(join(r.dir, 'docs/agents'), { recursive: true });
  assert.deepEqual(found().map((i) => i[0]), ['info']);
  writeFileSync(join(r.dir, 'AGENTS.md'), '## Agent skills\n\n### Issue tracker\n\nGitHub.\n\n### Triage labels\n\nDefault.\n\n### Domain docs\n\nNone.\n');
  assert.deepEqual(found(), []);
});

test('Gemini CLI reads AGENTS.md; the sandbox option excludes devcontainer and podman', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude'));
  writeFileSync(join(r.dir, '.claude/settings.json'), '{ "permissions": { "allow": ["Bash(npm test)"] } }\n');
  apply(preview(plan(r, { agents: ['claude', 'gemini'], env: 'host-agent', sandbox: true, share: true }).changes), r.ctx, { scope: r.dir });
  assert.deepEqual(JSON.parse(read(join(r.dir, '.gemini/settings.json'))).context.fileName, ['AGENTS.md', 'GEMINI.md']);
  const st = JSON.parse(read(join(r.dir, '.claude/settings.json')));
  assert.deepEqual(st.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(st.sandbox, { enabled: true, excludedCommands: ['devcontainer exec *', 'podman *'] });
});

test('a choice taken back cleans up: sandbox off, dropped agents lose their files, folders other agents share stay', () => {
  const r = repo();
  const all = (answers) => { const p = plan(r, answers); apply(preview(p.changes), r.ctx, { scope: r.dir, select: p.changes.filter((c) => c.kind !== 'command').map((c) => c.id) }); return p; };
  mkdirSync(join(r.dir, '.claude'));
  writeFileSync(join(r.dir, '.claude/settings.json'), '{ "sandbox": { "excludedCommands": ["mine *"] } }\n');
  all({ agents: ['claude', 'codex', 'gemini'], env: 'container', sandbox: true, packs: ['frontend'], share: true });
  const p = plan(r, { agents: ['codex'], sandbox: false });
  const off = preview(p.changes).find((c) => c.step === 'sandbox');
  assert.ok(off.selected && off.title === 'Claude Code sandbox off');
  apply(preview(p.changes), r.ctx, { scope: r.dir, select: p.changes.filter((c) => c.kind !== 'command').map((c) => c.id) });
  assert.deepEqual(JSON.parse(read(join(r.dir, '.claude/settings.json'))), { sandbox: { excludedCommands: ['mine *'] } });
  assert.ok(!existsSync(join(r.dir, 'CLAUDE.md')) && !existsSync(join(r.dir, '.claude/skills/designing-technical-uis')));
  // Codex and Gemini CLI share .agents/skills: the copy stays for Codex.
  assert.ok(existsSync(join(r.dir, '.agents/skills/designing-technical-uis/SKILL.md')));
  assert.deepEqual(JSON.parse(read(join(r.dir, '.gemini/settings.json'))), {});
  // A sandbox this setup did not turn on: removal offered, not preselected.
  writeFileSync(join(r.dir, '.claude/settings.json'), '{ "sandbox": { "enabled": true } }\n');
  const own = preview(plan(r, {}).changes).find((c) => c.step === 'sandbox');
  assert.ok(!own.selected && own.title.includes('not turned on by BenchKeeper'));
});

test('hand-written text on where the agent runs: it sets the default environment, and only a contradiction warns', () => {
  const r = repo();
  const warned = (env) => plan(r, { agents: ['claude'], env }).warnings.some((w) => w.includes('outside the BenchKeeper block'));
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\n- Agents (Claude Code, Codex) run on the host; tests run in the dev container.\n- The gate runs on the host.\n');
  assert.equal(suggest(r.dir).env.id, 'host');
  mkdirSync(join(r.dir, '.devcontainer'));
  assert.equal(suggest(r.dir).env.id, 'host-agent');
  assert.equal(plan(r, { agents: ['claude'] }).answers.env, 'host-agent');
  assert.deepEqual([warned('container'), warned('sandbox'), warned('host-agent'), warned('host')], [true, true, false, false]);
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\nThe agent runs inside the dev container.\n');
  assert.equal(suggest(r.dir).env.id, 'container');
  assert.deepEqual([warned('container'), warned('host-agent')], [false, true]);
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\nThe agent runs in a sandbox (microVM).\n');
  assert.equal(suggest(r.dir).env.id, 'sandbox');
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\nThe agent runs in a Docker Sandboxes microVM.\n');
  assert.equal(suggest(r.dir).env.id, 'sandbox');
  // On the host with no word of the dev container: commands run on the host too, whatever folders exist.
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\nThe agent and the tests run on the Host.\n');
  assert.equal(suggest(r.dir).env.id, 'host');
  writeFileSync(join(r.dir, 'AGENTS.md'), "# P\n\nThe agent does not run on the host; the agent runs inside the dev container.\n");
  assert.equal(suggest(r.dir).env.id, 'container');
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\nThe agent runs in a sandbox (microVM).\n');
  assert.deepEqual([warned('sandbox'), warned('container'), warned('host-agent')], [false, true, true]);
  // Commands on the host, with no word on where the agent runs: nothing to compare.
  writeFileSync(join(r.dir, 'AGENTS.md'), '# P\n\nRun `scripts/check.sh` on the host.\n');
  assert.deepEqual([suggest(r.dir).env, warned('container')], [null, false]);
});

test('a recorded session lists its files; undo restores them, undo of the undo reapplies', () => {
  const r = repo();
  r.ctx.run = runCommand;
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'echo new > added.txt && echo more >> README.md && mkdir -p d && echo x > d/f']);
  const e = run.entries[0];
  assert.equal(e.exit, 0);
  assert.deepEqual(e.files.map((f) => `${f.status} ${f.path}`).sort(), ['A added.txt', 'A d/f', 'M README.md']);
  // The run report diffs each file between the snapshots.
  const diffs = Object.fromEntries(api(r.ctx)['GET /api/run'](new URLSearchParams({ id: run.id })).entries[0].files.map((f) => [f.path, f.diff]));
  assert.equal(diffs['README.md'], '--- README.md\n+++ README.md\n@@ -1,2 +1,3 @@\n # P\n+more\n ');
  assert.match(diffs['added.txt'], /^--- \/dev\/null\n\+\+\+ added.txt\n@@ -0,0 \+1,2 @@\n\+new/);
  const u = undo(run.id, r.ctx);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  assert.equal(existsSync(join(r.dir, 'added.txt')), false);
  assert.equal(read(join(r.dir, 'README.md')), '# P\n');
  undo(u.id, r.ctx);
  assert.equal(read(join(r.dir, 'README.md')), '# P\nmore\n');
  assert.equal(read(join(r.dir, 'added.txt')), 'new\n');
});

test('session undo refuses a file changed after the session and leaves every file as it was; links and modes come back', () => {
  const r = repo();
  r.ctx.run = runCommand;
  symlinkSync('README.md', join(r.dir, 'link'));
  writeFileSync(join(r.dir, 'plain.sh'), 'x\n');
  r.git('add', '-A');
  r.git('commit', '-qm', 'link');
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'rm link && echo y > plain.sh && chmod +x plain.sh && echo z > other.txt']);
  writeFileSync(join(r.dir, 'other.txt'), 'edited by hand\n');
  const refused = undo(run.id, r.ctx);
  assert.equal(refused.status, 'failed');
  assert.match(refused.entries[0].error, /other\.txt changed after the session/);
  assert.equal(read(join(r.dir, 'plain.sh')), 'y\n');
  writeFileSync(join(r.dir, 'other.txt'), 'z\n');
  const u = undo(run.id, r.ctx);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  assert.equal(readlinkSync(join(r.dir, 'link')), 'README.md');
  assert.equal(statSync(join(r.dir, 'plain.sh')).mode & 0o111, 0);
  // Undo of that undo: refused while a file differs from how the undo left it.
  writeFileSync(join(r.dir, 'plain.sh'), 'changed\n');
  assert.match(undo(u.id, r.ctx).entries[0].error, /plain\.sh changed after this change/);
});

test('a change journaled as running (a crash) can be undone from its backup', () => {
  const r = repo();
  const path = join(r.dir, 'README.md');
  const run = apply([{ id: 'w', step: 's', title: 'w', kind: 'write', path, after: 'new\n' }], r.ctx, { scope: r.dir });
  const saved = r.ctx.ledger.get(run.id);
  Object.assign(saved.entries[0], { status: 'running' });
  delete saved.entries[0].hashAfter;
  delete saved.status;
  r.ctx.ledger.save(saved);
  assert.equal(undo(run.id, r.ctx).status, 'done');
  assert.equal(read(path), '# P\n');
});

test('recording needs a git repository', () => {
  const dir = mkdtempSync(join(TMP, 'bk-nogit-'));
  const ctx = context({ home: dir });
  assert.throws(() => recordSession(ctx, dir, ['true']), /not a git repository/);
  assert.equal(existsSync(join(dir, STATE)), false);
});

test('skill names from a state file never reach paths outside the project', () => {
  const r = repo();
  const outside = join(r.ctx.home, 'outside');
  mkdirSync(join(outside, 'x'), { recursive: true });
  mkdirSync(join(r.dir, '.benchkeeper'));
  writeFileSync(join(r.dir, STATE), JSON.stringify({ agents: ['claude'], env: 'host', skills: [{ name: `../../../${basename(r.ctx.home)}/outside` }] }));
  mkdirSync(join(r.dir, '.claude/skills'), { recursive: true });
  const changes = preview(plan(r, {}).changes);
  // git names the exclude file by its real path (macOS: /private/var for /var).
  assert.ok(changes.every((c) => !c.path || c.path.startsWith(r.dir) || c.path.startsWith(realpathSync(r.dir))), JSON.stringify(changes.map((c) => c.path)));
  assert.throws(() => plan(r, { paths: { accessibility: 'src/**\nname: evil' } }), /one line of globs/);
});

test('a skill the library no longer lists is offered for removal, not preselected', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.benchkeeper'));
  writeFileSync(join(r.dir, STATE), JSON.stringify({ agents: ['claude', 'codex'], env: 'host', skills: [{ name: 'docx' }] }));
  mkdirSync(join(r.dir, '.agents/skills/docx'), { recursive: true });
  const gone = plan(r, {}).changes.filter((c) => c.step === 'remove:docx');
  assert.equal(gone.length, 1);
  assert.ok(!gone[0].selected && gone[0].kind === 'remove');
});

test('a session started in a subfolder records and undoes paths from the repository root', () => {
  const r = repo();
  r.ctx.run = runCommand;
  mkdirSync(join(r.dir, 'sub'));
  writeFileSync(join(r.dir, 'sub/run.sh'), '#!/bin/sh\n');
  chmodSync(join(r.dir, 'sub/run.sh'), 0o755);
  r.git('add', '-A');
  r.git('commit', '-qm', 'sub');
  const run = recordSession(r.ctx, join(r.dir, 'sub'), ['sh', '-c', 'echo x > x.txt && rm run.sh']);
  assert.deepEqual(run.entries[0].files.map((f) => `${f.status} ${f.path}`).sort(), ['A sub/x.txt', 'D sub/run.sh']);
  assert.equal(undo(run.id, { ...r.ctx, roots: [run.scope] }).status, 'done');
  assert.equal(existsSync(join(r.dir, 'sub/x.txt')), false);
  assert.equal(statSync(join(r.dir, 'sub/run.sh')).mode & 0o111, 0o111);
});

test('a broken state file is reported, not thrown at listings', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.benchkeeper'));
  writeFileSync(join(r.dir, STATE), '{ broken');
  assert.throws(() => readState(r.dir), /state\.json: /);
  assert.equal(tryState(r.dir), null);
});

test('only a missing state file means no saved setup: an unreadable one throws with its path', () => {
  const r = repo();
  assert.equal(readState(r.dir), null);
  mkdirSync(join(r.dir, STATE), { recursive: true });
  assert.throws(() => readState(r.dir), /state\.json: /);
  assert.equal(tryState(r.dir), null);
});

test('a dangling state link is unreadable, not a missing setup', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.benchkeeper'));
  symlinkSync(join(r.dir, 'gone.json'), join(r.dir, STATE));
  assert.throws(() => readState(r.dir), /state\.json: a link to a missing file/);
});

test('the project block carries every rule that left the global file; bare skill names without plugin agents', () => {
  const before = read(new URL('./fixtures/rules-before-190.md', import.meta.url).pathname).split('\n').filter((l) => l.startsWith('- '));
  const global = read(join(contentDir, 'rules/global.md')).split('\n');
  const moved = before.filter((l) => !global.includes(l));
  assert.equal(moved.length, 3, 'workflow load, open questions and fix the cause moved');
  const r = repo();
  const { changes } = plan(r, { agents: ['claude'], env: 'host', share: true });
  assert.equal(apply(preview(changes), r.ctx, { scope: r.dir, select: changes.map((c) => c.id) }).status, 'done');
  const block = read(join(r.dir, 'AGENTS.md'));
  for (const l of moved) assert.ok(block.includes(l), l);
  const g = repo();
  const gp = plan(g, { agents: ['gemini'], env: 'host', share: true }).changes;
  apply(preview(gp), g.ctx, { scope: g.dir, select: gp.map((c) => c.id) });
  assert.match(read(join(g.dir, 'AGENTS.md')), /load the `workflow` skill/);
  const mixed = repo();
  const mp = plan(mixed, { agents: ['claude', 'gemini'], env: 'host', share: true }).changes;
  apply(preview(mp), mixed.ctx, { scope: mixed.dir, select: mp.map((c) => c.id) });
  assert.doesNotMatch(read(join(mixed.dir, 'AGENTS.md')), /benchkeeper:workflow/, 'one shared block, a name every chosen agent knows');
  assert.doesNotMatch(read(join(g.dir, 'AGENTS.md')), /benchkeeper:workflow/);
});
