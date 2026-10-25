// The Rules view: owners, load states, the size budget, the switch (plan, apply, undo) and what stays out of reports.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { hashPath } from '../src/fsx.mjs';
import { exportProfile } from '../src/profile.mjs';
import { addProject } from '../src/projects.mjs';
import { BUDGET_TOKENS, globRegex, ruleChanges, ruleStates, ruleText, rulesView, tokensOf } from '../src/rules.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { projectCtx } from '../src/steps/project.mjs';

const TMP = realpathSync(tmpdir());
const SHOWN = join('~', '.claude/rules/20-team.md');
const SECRET = 'text-of-a-rule-file-not-for-reports';
const run = (argv) => ({ code: argv[0] === 'npm' ? 1 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' });
const write = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const machine = () => context({ home: mkdtempSync(join(TMP, 'bk-rules-')), run });
const project = (name = 'bk-proj-') => {
  const dir = mkdtempSync(join(TMP, name));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  return dir;
};
const view = (ctx, agent, dir) => rulesView(ctx, { agents: [agent], dir }).agents[0];
const row = (ctx, agent, file, dir) => view(ctx, agent, dir).rows.find((r) => r.path === file);
const decide = (ctx, opts, rctx = ctx) => apply(preview(ruleChanges(ctx, opts)), rctx, { scope: opts.dir ?? 'global' });
const output = () => { let text = ''; return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } }; };

test('the view lists each file with scope, owner, size and load state; a file BenchKeeper did not write is yours', () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, `# Team\n\n${SECRET}\n`);
  write(join(ctx.home, '.claude/rules/30-scoped.md'), '---\npaths:\n  - "src/**"\n---\n\nonly for src\n');
  write(join(ctx.home, '.codex/AGENTS.override.md'), 'personal notes\n');
  const dir = project();
  write(join(dir, 'CLAUDE.md'), 'project rules\n');
  write(join(dir, 'CLAUDE.local.md'), 'my own\n');
  const claude = view(ctx, 'claude');
  const found = claude.rows.find((r) => r.path === team);
  assert.deepEqual([found.scope, found.owner, found.load, found.bytes, found.tokens], ['global', 'yours', 'always', Buffer.byteLength(`# Team\n\n${SECRET}\n`), tokensOf(Buffer.byteLength(`# Team\n\n${SECRET}\n`))]);
  assert.equal(claude.rows.find((r) => r.path.endsWith('30-scoped.md')).load, 'path-scoped');
  assert.equal(row(ctx, 'codex', join(ctx.home, '.codex/AGENTS.override.md')).owner, 'yours');
  const inProject = view(ctx, 'claude', dir).rows;
  assert.deepEqual(inProject.filter((r) => r.scope !== 'global').map((r) => [r.shown, r.scope, r.owner]), [['CLAUDE.md', 'project', 'project'], ['CLAUDE.local.md', 'local', 'yours']]);
  assert.deepEqual(inProject.map((r) => r.order), inProject.map((_, i) => i + 1), 'the load order of the chosen project');
});

test('a Doctor run is quiet about a rule file of yours, and warns when an override hides the Codex rules', () => {
  const ctx = machine();
  write(join(ctx.home, '.claude/rules/20-team.md'), 'mine\n');
  write(join(ctx.home, '.codex/AGENTS.override.md'), 'mine too\n');
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })), ctx);
  const quiet = doctor(ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(quiet.filter((i) => /rules/.test(i.check) || /20-team|override/.test(i.message)), []);
  assert.ok(!globalPlan({ ctx, agents: ['claude', 'codex'], devcontainerCli: '1.0.0' }).some((c) => c.kind === 'remove' && /rules/.test(c.step) && /20-team|override/.test(c.path)));
  apply(preview(globalPlan({ ctx, agents: ['claude', 'codex'], devcontainerCli: '1.0.0' })), ctx);
  const hidden = doctor(ctx, { agents: ['claude', 'codex'], env: {}, devcontainerCli: '1.0.0' }).filter((i) => i.check === 'rules');
  assert.equal(hidden.length, 1);
  assert.match(hidden[0].message, /AGENTS\.md is not read: AGENTS\.override\.md in the same folder replaces it, so BenchKeeper's Codex rules do not load/);
  assert.ok(!JSON.stringify(hidden).includes('mine too'));
});

test('turning a Claude Code file off and on writes claudeMdExcludes, leaves the file byte for byte, and each is a run with undo', () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, `# Team\n${SECRET}\n`);
  const before = hashPath(team);
  const off = decide(ctx, { agent: 'claude', file: team, on: false });
  assert.equal(off.status, 'done');
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.home, '.claude/settings.json'), 'utf8')).claudeMdExcludes, [team]);
  assert.equal(row(ctx, 'claude', team).load, 'off');
  assert.equal(hashPath(team), before);
  // Not offered twice, and the budget no longer counts it.
  assert.deepEqual(ruleChanges(ctx, { agent: 'claude', file: team, on: false }), []);
  assert.ok(!view(ctx, 'claude').budget.items.some((i) => i.label.includes('20-team')));
  const on = decide(ctx, { agent: 'claude', file: team, on: true });
  assert.equal(on.status, 'done');
  assert.equal(row(ctx, 'claude', team).load, 'always');
  assert.equal(hashPath(team), before);
  assert.notEqual(on.id, off.id);
  // Undo of the second run turns it off again, undo of the first then on: the file is never touched.
  assert.equal(undo(on.id, ctx).status, 'done');
  assert.equal(row(ctx, 'claude', team).load, 'off');
  assert.equal(undo(off.id, ctx).status, 'done');
  assert.equal(hashPath(team), before);
  assert.ok(!existsSync(join(ctx.home, '.claude/settings.json')), 'the settings file the first run made goes with its undo');
});

test('a switch for one project changes that project only: two projects, one global file', () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, 'shared by every project\n');
  const [a, b] = [project(), project()];
  decide(ctx, { agent: 'claude', file: team, dir: a, on: false }, projectCtx(ctx, a));
  assert.equal(row(ctx, 'claude', team, a).load, 'off');
  assert.equal(row(ctx, 'claude', team, a).by, 'local settings');
  assert.equal(row(ctx, 'claude', team, b).load, 'always');
  assert.equal(row(ctx, 'claude', team).load, 'always');
  assert.ok(existsSync(join(a, '.claude/settings.local.json')) && !existsSync(join(b, '.claude/settings.local.json')));
  assert.equal(readFileSync(team, 'utf8'), 'shared by every project\n');
  decide(ctx, { agent: 'claude', file: team, dir: a, on: true }, projectCtx(ctx, a));
  assert.equal(row(ctx, 'claude', team, a).load, 'always');
});

test('a file left out by a layer this view cannot write, or by another pattern, is not switched on here', () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, 'x\n');
  const dir = project();
  write(join(ctx.home, '.claude/settings.json'), JSON.stringify({ claudeMdExcludes: ['**/20-team.md'] }));
  assert.equal(row(ctx, 'claude', team).load, 'off');
  assert.throws(() => ruleChanges(ctx, { agent: 'claude', file: team, on: true }), /also left out by a pattern of the user settings/);
  assert.equal(row(ctx, 'claude', team, dir).switch.by, undefined);
  assert.match(row(ctx, 'claude', team, dir).switch.why, /turned off in the user settings/);
  assert.throws(() => ruleChanges(ctx, { agent: 'claude', file: team, dir, on: true }), /turned off in the user settings/);
});

test('globs: ** crosses folders, * stays inside one, braces and classes work', () => {
  assert.ok(globRegex('**/rules/*.md').test('/work/agent/rules/a.md'));
  assert.ok(!globRegex('/work/*.md').test('/work/x/a.md'));
  assert.ok(globRegex('/work/{a,b}.md').test('/work/b.md'));
  assert.ok(globRegex('/work/[ab].md').test('/work/a.md'));
  assert.ok(!globRegex('/work/a.md').test('/work/axmd'));
  assert.ok(!globRegex('/work/[').test('/work/['), 'an invalid pattern matches nothing');
});

test('a global Codex file moves to the app folder and back, byte for byte, as two runs with undo; a project file only shows', () => {
  const ctx = machine();
  const override = join(ctx.home, '.codex/AGENTS.override.md');
  write(override, `notes\n${SECRET}\n`);
  const before = hashPath(override);
  const off = decide(ctx, { agent: 'codex', file: override, on: false });
  assert.equal(off.status, 'done');
  assert.ok(!existsSync(override));
  const parked = row(ctx, 'codex', override);
  assert.deepEqual([parked.load, parked.exists, parked.shown.endsWith('AGENTS.override.md')], ['off', false, true]);
  assert.equal(hashPath(join(ctx.config, 'disabled-rules/.codex/AGENTS.override.md')), before);
  const on = decide(ctx, { agent: 'codex', file: override, on: true });
  assert.equal(on.status, 'done');
  assert.equal(hashPath(override), before);
  assert.ok(!existsSync(join(ctx.config, 'disabled-rules/.codex/AGENTS.override.md')));
  // Undo of both runs: the file ends where the user had it.
  assert.equal(undo(on.id, ctx).status, 'done');
  assert.ok(!existsSync(override));
  assert.equal(undo(off.id, ctx).status, 'done');
  assert.equal(hashPath(override), before);
  const dir = project();
  write(join(dir, 'AGENTS.md'), 'repository rules\n');
  assert.match(row(ctx, 'codex', join(dir, 'AGENTS.md'), dir).switch.why, /shared with the repository/);
  assert.match(row(ctx, 'codex', override, dir).switch.why, /no per-project setting/);
  assert.throws(() => ruleChanges(ctx, { agent: 'codex', file: join(dir, 'AGENTS.md'), dir, on: false }), /shared with the repository/);
});

test('an override shadows the AGENTS.md of its folder; BenchKeeper files have no switch', () => {
  const ctx = machine();
  const own = join(ctx.home, '.codex/AGENTS.md');
  apply(preview(globalPlan({ ctx, agents: ['codex'], devcontainerCli: '1.0.0' })), ctx);
  assert.equal(row(ctx, 'codex', own).owner, 'BenchKeeper');
  assert.match(row(ctx, 'codex', own).switch.why, /BenchKeeper wrote it/);
  assert.throws(() => ruleChanges(ctx, { agent: 'codex', file: own, on: false }), /BenchKeeper wrote it/);
  write(join(ctx.home, '.codex/AGENTS.override.md'), 'x\n');
  assert.equal(row(ctx, 'codex', own).load, 'shadowed');
  assert.ok(!view(ctx, 'codex').budget.items.some((i) => i.label === row(ctx, 'codex', own).shown));
});

test('the budget counts rule files, imports, skill descriptions and auto memory, and names the largest', () => {
  const ctx = machine();
  const dir = project();
  write(join(dir, 'CLAUDE.md'), '@docs/extra.md\n\nproject rules\n');
  write(join(dir, 'docs/extra.md'), 'x'.repeat(4000));
  write(join(ctx.home, '.claude/skills/helper/SKILL.md'), `---\nname: helper\ndescription: "${'d'.repeat(400)}"\n---\nbody that is not counted\n`);
  write(join(ctx.home, '.claude/skills/quiet/SKILL.md'), '---\nname: quiet\ndescription: "never offered"\ndisable-model-invocation: true\n---\n');
  const memory = join(ctx.home, '.claude/projects', dir.replace(/[^A-Za-z0-9]/g, '-'), 'memory/MEMORY.md');
  write(memory, `${Array.from({ length: 300 }, (_, i) => `- line ${i}`).join('\n')}\n`);
  const { budget } = view(ctx, 'claude', dir);
  const kinds = Object.fromEntries(budget.items.map((i) => [i.kind, i]));
  assert.equal(kinds.imports.bytes, 4000);
  assert.equal(kinds.skills.bytes, 'helper'.length + 400, 'a skill that is not offered to the model is left out');
  assert.equal(kinds.memory.bytes, Buffer.byteLength(Array.from({ length: 200 }, (_, i) => `- line ${i}`).join('\n')), 'the first 200 lines');
  assert.equal(budget.total, budget.items.reduce((n, i) => n + i.tokens, 0));
  assert.deepEqual(budget.largest, { label: 'docs/extra.md (imported)', tokens: 1000 });
  assert.equal(budget.over, budget.total > BUDGET_TOKENS);
  // Another project's memory and a switched-off file are not counted.
  assert.equal(view(ctx, 'claude', project()).budget.items.some((i) => i.kind === 'memory'), false);
});

test('auto memory of 25 KB is the most that counts, and a project turns it off in its settings', () => {
  const ctx = machine();
  const dir = project();
  write(join(ctx.home, '.claude/projects', dir.replace(/[^A-Za-z0-9]/g, '-'), 'memory/MEMORY.md'), `${'m'.repeat(60000)}\n`);
  assert.equal(view(ctx, 'claude', dir).budget.items.find((i) => i.kind === 'memory').bytes, 25 * 1024);
  write(join(dir, '.claude/settings.json'), JSON.stringify({ autoMemoryEnabled: false }));
  assert.equal(view(ctx, 'claude', dir).budget.items.some((i) => i.kind === 'memory'), false);
});

test('Codex stops at 32 KiB: the rest is a note and out of the total', () => {
  const ctx = machine();
  write(join(ctx.home, '.codex/AGENTS.override.md'), 'c'.repeat(40 * 1024));
  const { budget } = view(ctx, 'codex');
  assert.equal(budget.total, tokensOf(40 * 1024) - tokensOf(8 * 1024));
  assert.match(budget.notes[0], /stops adding files at 32 KiB/);
});

test('the profile lists rule files by path and state, never their text', () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, `# Team\n${SECRET}\n`);
  const dir = project();
  write(join(dir, 'CLAUDE.local.md'), `${SECRET} local\n`);
  addProject(ctx, dir);
  decide(ctx, { agent: 'claude', file: team, on: false });
  const text = exportProfile(ctx, { agents: ['claude'], packs: [] });
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes(ctx.home), 'paths below the home folder are written from it');
  const profile = JSON.parse(text);
  assert.deepEqual(profile.global.rules.find((r) => r.path.endsWith('20-team.md')), { agent: 'claude', scope: 'global', path: SHOWN, owner: 'yours', state: 'off' });
  assert.deepEqual(profile.projects[0].rules.map((r) => [r.path, r.state]).filter(([p]) => p === 'CLAUDE.local.md' || p.endsWith('20-team.md')), [[SHOWN, 'off'], ['CLAUDE.local.md', 'always']]);
  assert.deepEqual(ruleStates(ctx, { agents: ['claude'], dir }).filter((r) => r.scope === 'local').map((r) => r.owner), ['yours']);
});

test('the text of a file is served for a listed file only, and appears in no plan, diff or run record', () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, `# Team\n${SECRET}\n`);
  write(join(ctx.home, 'notes.txt'), 'not a rule file\n');
  assert.equal(ruleText(ctx, { agent: 'claude', file: team }).text, `# Team\n${SECRET}\n`);
  assert.throws(() => ruleText(ctx, { agent: 'claude', file: join(ctx.home, 'notes.txt') }), /is not an instruction file/);
  assert.throws(() => ruleText(ctx, { agent: 'claude', file: join(ctx.home, '.claude/rules/../../notes.txt') }), /is not an instruction file/);
  assert.throws(() => ruleText(ctx, { file: '/etc/passwd' }), /is not an instruction file/);
  const plan = preview(ruleChanges(ctx, { agent: 'claude', file: team, on: false }));
  const done = apply(plan, ctx, { scope: 'global' });
  assert.ok(!JSON.stringify(plan.map(({ edit, ...c }) => c)).includes(SECRET));
  assert.ok(!JSON.stringify(done).includes(SECRET));
  assert.ok(!JSON.stringify(ctx.ledger.list()).includes(SECRET));
});

test('the routes: the view, the text, a plan applied through /api/apply; a path that is not listed is refused', async () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, `# Team\n${SECRET}\n`);
  const dir = project();
  addProject(ctx, dir);
  const routes = api(ctx);
  const q = (o) => new URLSearchParams(o);
  const listed = routes['GET /api/rules'](q({}));
  assert.ok(listed.agents.some((a) => a.rows.some((r) => r.path === team)));
  assert.equal(routes['GET /api/rule-text'](q({ agent: 'claude', file: team })).text, `# Team\n${SECRET}\n`);
  assert.throws(() => routes['GET /api/rule-text'](q({ agent: 'claude', file: join(ctx.home, 'notes.txt') })), (e) => e.status === 400);
  assert.throws(() => routes['GET /api/rules'](q({ dir: join(ctx.home, 'unregistered') })), /register the project first/);
  assert.throws(() => routes['POST /api/rules-plan']({ agent: 'claude', file: team }), /on must be true or false/);
  assert.throws(() => routes['POST /api/rules-plan']({ agent: 'gemini', file: team, on: false }), /agent must be one of/);
  const plan = routes['POST /api/rules-plan']({ agent: 'claude', file: team, on: false });
  assert.deepEqual(plan.changes.map((c) => c.title), [`turn off ${row(ctx, 'claude', team).shown} for Claude Code`]);
  assert.ok(!JSON.stringify(plan).includes(SECRET));
  const job = routes['POST /api/apply']({ planId: plan.planId });
  for (let i = 0; i < 50 && !routes['GET /api/job'](q({ id: job.job })).done; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(row(ctx, 'claude', team).load, 'off');
  const other = join(ctx.home, '.claude/rules/30-style.md');
  write(other, 'style\n');
  const local = routes['POST /api/rules-plan']({ agent: 'claude', file: other, dir, on: false });
  assert.match(local.changes[0].title, /in this project$/);
});

test('rules list, disable and enable on the command line', async () => {
  const ctx = machine();
  const team = join(ctx.home, '.claude/rules/20-team.md');
  write(team, `# Team\n${SECRET}\n`);
  const cli = async (...args) => { const o = output(); const code = await main(args, { out: o.stream, err: o.stream, ctx }); return { code, text: o.text }; };
  const listed = await cli('rules', 'list', '--agent', 'claude');
  assert.equal(listed.code, 0);
  assert.match(listed.text, /yours\s+always\s+\d+ tokens\s+\S*20-team\.md/);
  assert.match(listed.text, /at the start of a session: about \d+ tokens/);
  assert.ok(!listed.text.includes(SECRET));
  const off = await cli('rules', 'disable', team, '--yes');
  assert.equal(off.code, 0, off.text);
  assert.match(off.text, /turn off .*20-team\.md for Claude Code/);
  assert.equal(row(ctx, 'claude', team).load, 'off');
  assert.equal((await cli('rules', 'enable', team, '--yes')).code, 0);
  assert.equal(row(ctx, 'claude', team).load, 'always');
  assert.equal((await cli('rules', 'disable', join(ctx.home, 'notes.txt'), '--yes')).code, 1);
  assert.equal((await cli('rules', 'disable')).code, 2);
  assert.equal((await cli('rules', 'frob')).code, 2);
});
