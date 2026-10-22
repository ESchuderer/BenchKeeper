import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { apply, context, preview, runCommand, undo } from '../src/runner.mjs';
import { recordSession } from '../src/session.mjs';
import { ENVS, STATE, projectPlan, readState, tryState } from '../src/steps/project.mjs';

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const home = mkdtempSync(join(tmpdir(), 'bk-home-'));
  const ctx = context({ home, roots: [home, dir], appVersion: '6.0.0' });
  return { dir, ctx, git };
}
const read = (p) => readFileSync(p, 'utf8');
const plan = (r, answers, plugins = { claude: [], codex: [] }) => projectPlan({ ctx: r.ctx, dir: r.dir, answers, plugins });

test('AGENTS.md block, CLAUDE.md import, own skill copies, pinned community skills, state file', () => {
  const r = repo();
  writeFileSync(join(r.dir, 'AGENTS.md'), '# Project\n\nmy notes\n');
  const { changes, prompts } = plan(r, { agents: ['claude', 'codex'], env: 'host-agent', packs: ['frontend'], tier: 'quick' });
  const run = apply(preview(changes), r.ctx, { scope: r.dir, select: changes.filter((c) => c.kind !== 'command').map((c) => c.id) });
  assert.equal(run.status, 'done');
  const agentsMd = read(join(r.dir, 'AGENTS.md'));
  assert.ok(agentsMd.startsWith('# Project\n\nmy notes\n'));
  assert.ok(agentsMd.includes(`- ${ENVS['host-agent']}`) && agentsMd.includes('- Default tier: quick') && agentsMd.includes('- UI screens and user-facing text: load the designing-technical-uis skill first.'));
  assert.equal(read(join(r.dir, 'CLAUDE.md')), '@AGENTS.md\n');
  for (const d of ['.claude/skills', '.agents/skills']) assert.ok(existsSync(join(r.dir, d, 'designing-technical-uis/SKILL.md')), d);
  const cmd = changes.find((c) => c.title.startsWith('skill frontend-design'));
  assert.deepEqual(cmd.argv.slice(3, 9), ['add', 'https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44', '-s', 'frontend-design', '-a', 'claude-code']);
  assert.ok(cmd.argv.includes('codex') && cmd.cwd === r.dir && cmd.env.DO_NOT_TRACK === '1' && cmd.env.npm_config_registry === 'https://registry.npmjs.org/' && cmd.undoArgv.includes('remove'));
  const state = readState(r.dir);
  assert.deepEqual([state.setupVersion, state.env, state.tier, state.packs], ['6.0.0', 'host-agent', 'quick', ['frontend']]);
  assert.deepEqual(state.skills.map((s) => s.name).sort(), ['accessibility', 'designing-technical-uis', 'frontend-design']);
  assert.match(prompts[0].prompt, /setting-up-projects/);
});

test('a community skill the state file records at another commit is added again at the pin', () => {
  const r = repo();
  const first = plan(r, { agents: ['claude'], packs: ['frontend'] }).changes;
  apply(preview(first), r.ctx, { scope: r.dir, select: first.filter((c) => c.kind !== 'command').map((c) => c.id) });
  for (const n of ['frontend-design', 'accessibility']) mkdirSync(join(r.dir, '.claude/skills', n), { recursive: true });
  const titles = () => plan(r, {}).changes.filter((c) => c.kind === 'command').map((c) => c.title);
  assert.deepEqual(titles(), []);
  const f = join(r.dir, STATE);
  const state = JSON.parse(read(f));
  state.skills.find((s) => s.name === 'frontend-design').ref = 'a'.repeat(40);
  writeFileSync(f, JSON.stringify(state));
  assert.deepEqual(titles(), ['skill frontend-design from anthropics/skills at dbd4588f9e10 (was aaaaaaaaaaaa)']);
  const repin = plan(r, {}).changes.find((c) => c.kind === 'command');
  assert.ok(repin.undoArgv.includes(`https://github.com/anthropics/skills/tree/${'a'.repeat(40)}`), 'undo adds the earlier commit back');
  state.skills.find((s) => s.name === 'frontend-design').ref = '../../x';
  writeFileSync(f, JSON.stringify(state));
  assert.deepEqual(titles(), [], 'a ref that is not a commit id is ignored');
});

test('a second plan reads the answers from the state file', () => {
  const r = repo();
  const first = plan(r, { agents: ['claude'], tier: 'standard' }).changes;
  apply(preview(first), r.ctx, { scope: r.dir });
  assert.deepEqual(preview(plan(r, {}).changes).map((c) => c.title), []);
  assert.match(preview(plan(r, { tier: 'full' }).changes).map((c) => c.title).join(), /AGENTS.md/);
});

test('Codex-only skills need Codex; packs with plugins install them and list their prompts', () => {
  const r = repo();
  const p = plan(r, { agents: ['claude'], skills: ['docx'], packs: ['matt-pocock'] });
  assert.ok(!p.changes.some((c) => c.title.includes('docx')));
  assert.ok(p.changes.some((c) => c.argv?.join(' ') === 'claude plugin install mattpocock-skills@claude-plugins-official'));
  assert.ok(p.prompts.some((x) => x.prompt === '/mattpocock-skills:setup-matt-pocock-skills'));
  const installed = plan(r, { agents: ['claude'], packs: ['matt-pocock'] }, { claude: ['mattpocock-skills@claude-plugins-official'] });
  assert.ok(!installed.changes.some((c) => c.kind === 'command'));
  assert.throws(() => plan(r, { agents: ['claude'], packs: ['nope'] }), /unknown pack/);
  assert.throws(() => plan(r, { agents: ['claude'], env: 'vm' }), /env must be/);
});

test("Matt Pocock's Agent skills block moves to AGENTS.md when Codex is selected", () => {
  const r = repo();
  writeFileSync(join(r.dir, 'CLAUDE.md'), '@AGENTS.md\n\n## Agent skills\n\n### Issue tracker\n\nGitHub.\n');
  const { changes } = plan(r, { agents: ['claude', 'codex'], env: 'host' });
  apply(preview(changes), r.ctx, { scope: r.dir });
  assert.equal(read(join(r.dir, 'CLAUDE.md')), '@AGENTS.md\n');
  assert.match(read(join(r.dir, 'AGENTS.md')), /## Agent skills\n\n### Issue tracker\n\nGitHub\./);
});

test('Gemini CLI reads AGENTS.md; the sandbox option excludes devcontainer and podman', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude'));
  writeFileSync(join(r.dir, '.claude/settings.json'), '{ "permissions": { "allow": ["Bash(npm test)"] } }\n');
  apply(preview(plan(r, { agents: ['claude', 'gemini'], env: 'host-agent', sandbox: true }).changes), r.ctx, { scope: r.dir });
  assert.deepEqual(JSON.parse(read(join(r.dir, '.gemini/settings.json'))).context.fileName, ['AGENTS.md', 'GEMINI.md']);
  const st = JSON.parse(read(join(r.dir, '.claude/settings.json')));
  assert.deepEqual(st.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(st.sandbox, { enabled: true, excludedCommands: ['devcontainer exec *', 'podman *'] });
});

test('a recorded session lists its files; undo restores them, undo of the undo reapplies', () => {
  const r = repo();
  r.ctx.run = runCommand;
  const run = recordSession(r.ctx, r.dir, ['sh', '-c', 'echo new > added.txt && echo more >> README.md && mkdir -p d && echo x > d/f']);
  const e = run.entries[0];
  assert.equal(e.exit, 0);
  assert.deepEqual(e.files.map((f) => `${f.status} ${f.path}`).sort(), ['A added.txt', 'A d/f', 'M README.md']);
  const u = undo(run.id, r.ctx);
  assert.equal(u.status, 'done', JSON.stringify(u.entries));
  assert.equal(existsSync(join(r.dir, 'added.txt')), false);
  assert.equal(read(join(r.dir, 'README.md')), '# P\n');
  undo(u.id, r.ctx);
  assert.equal(read(join(r.dir, 'README.md')), '# P\nmore\n');
  assert.equal(read(join(r.dir, 'added.txt')), 'new\n');
});

test('recording needs a git repository', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-nogit-'));
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
  assert.ok(changes.every((c) => !c.path || c.path.startsWith(r.dir)), JSON.stringify(changes.map((c) => c.path)));
  assert.throws(() => plan(r, { paths: { accessibility: 'src/**\nname: evil' } }), /one line of globs/);
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
