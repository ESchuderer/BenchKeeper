// Install scope per pack: defaults, the plan that moves a pack between all projects and selected projects, and its undo.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { globalDrift } from '../src/doctor.mjs';
import { libraryWith, packScope, packScopes, scopeFile } from '../src/packs.mjs';
import { addProject, scopePlan } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { projectPlan } from '../src/steps/project.mjs';

const TMP = realpathSync(tmpdir());
const pack = (ctx, id) => libraryWith(ctx).packs.find((p) => p.id === id);

// Claude Code with Ponytail installed for the user; plugin commands change installed_plugins.json, with the scope and folder.
// outside: the project lies in a folder of its own next to the home folder, not inside it.
function machine({ outside = false } = {}) {
  const home = mkdtempSync(join(TMP, 'bk-scope-'));
  const file = join(home, '.claude/plugins/installed_plugins.json');
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'ponytail@ponytail': [{ scope: 'user', version: '5.2.0' }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ ponytail: {} }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true } }));
  const calls = [];
  const run = (argv, opts = {}) => {
    calls.push(`${argv.join(' ')}${opts.cwd && opts.cwd !== home ? ` @${opts.cwd}` : ''}`);
    if (argv[0] === 'claude' && argv[1] === 'plugin' && ['install', 'uninstall'].includes(argv[2])) {
      const scope = argv.includes('--scope') ? argv[argv.indexOf('--scope') + 1] : 'user', id = argv.at(-1), doc = JSON.parse(readFileSync(file, 'utf8'));
      const at = (p) => p.scope === scope && (scope === 'user' || p.projectPath === opts.cwd);
      const rest = (doc.plugins[id] ?? []).filter((p) => !at(p));
      doc.plugins[id] = argv[2] === 'install' ? [...rest, { scope, version: '5.2.0', ...(scope === 'user' ? {} : { projectPath: opts.cwd }) }] : rest;
      writeFileSync(file, JSON.stringify(doc));
    }
    return argv[0] === 'npm' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '', stderr: '' };
  };
  const ctx = context({ home, run });
  // A registered project whose setup selects Ponytail and the frontend pack, with copies of the frontend skills.
  const dir = outside ? mkdtempSync(join(TMP, 'bk-scope-project-')) : join(home, 'p');
  mkdirSync(join(dir, '.benchkeeper'), { recursive: true });
  const skills = pack(ctx, 'frontend').skills;
  for (const s of skills) { mkdirSync(join(dir, '.claude/skills', s), { recursive: true }); writeFileSync(join(dir, '.claude/skills', s, 'SKILL.md'), 'x'); }
  writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 2, agents: ['claude'], env: 'host', packs: ['ponytail', 'frontend'], skills: skills.map((name) => ({ name })) }));
  addProject(ctx, dir);
  const installs = () => JSON.parse(readFileSync(file, 'utf8')).plugins['ponytail@ponytail'];
  return { home, ctx, dir, calls, installs };
}

test('scope defaults: plugin packs for all projects, skill packs per project; only a chosen scope is stored', () => {
  const { ctx } = machine();
  assert.equal(existsSync(scopeFile(ctx)), false);
  assert.deepEqual(['ponytail', 'matt-pocock', 'frontend', 'docs'].map((id) => packScope(ctx, pack(ctx, id))), ['global', 'global', 'projects', 'projects']);
  // The existing user install stays where it is: no removal and no doctor finding with no project selecting it.
  assert.deepEqual(globalPlan({ ctx, agents: ['claude'], options: { packsInUse: [] } }).filter((c) => /ponytail/.test(c.step)), []);
  assert.ok(!globalDrift(ctx, ['claude']).some((i) => /ponytail/.test(i.message)));
  writeFileSync(scopeFile(ctx), JSON.stringify({ scopes: { frontend: 'global', ponytail: 'elsewhere' } }));
  assert.deepEqual(['frontend', 'ponytail'].map((id) => packScope(ctx, pack(ctx, id))), ['global', 'global']);
  writeFileSync(scopeFile(ctx), 'not json');
  assert.equal(packScope(ctx, pack(ctx, 'frontend')), 'projects');
});

test('each agent offers only its scopes: Codex plugins fixed at user scope, unverified', () => {
  const { ctx } = machine();
  assert.deepEqual(packScopes(pack(ctx, 'ponytail'), 'claude'), { scopes: ['global', 'projects'], fixed: null });
  assert.deepEqual(packScopes(pack(ctx, 'frontend'), 'codex'), { scopes: ['global', 'projects'], fixed: null });
  assert.equal(packScopes(pack(ctx, 'ponytail'), 'gemini'), null);
  assert.deepEqual(packScopes(pack(ctx, 'frontend'), 'gemini').scopes, ['projects']);
  const codex = packScopes(pack(ctx, 'ponytail'), 'codex');
  assert.deepEqual(codex.scopes, ['global']);
  assert.match(codex.fixed, /user only.*unverified/);
  // The move leaves Codex's install where it is: the plan only records the scope.
  assert.deepEqual(scopePlan(ctx, 'ponytail', 'projects', ['codex']).map((c) => c.step), ['scope:ponytail']);
  assert.throws(() => scopePlan(ctx, 'ponytail', 'nowhere', ['claude']), /scope must be one of global, projects/);
  assert.throws(() => scopePlan(ctx, 'nope', 'global', ['claude']), /unknown pack nope/);
  assert.deepEqual(scopePlan(ctx, 'ponytail', 'global', ['claude']), []);
});

test('a plugin pack moves to selected projects and back, each as one plan with both steps; undo restores the scope and the installs', () => {
  const { ctx, dir, calls, installs } = machine();
  const plan = preview(scopePlan(ctx, 'ponytail', 'projects', ['claude']));
  assert.deepEqual(plan.map((c) => [c.title, c.argv?.join(' ') ?? null, c.cwd ?? null]), [
    ['uninstall ponytail@ponytail for the user (now selected projects)', 'claude plugin uninstall --scope user ponytail@ponytail', null],
    ['Claude Code plugin ponytail@ponytail (selected projects)', 'claude plugin install --scope local ponytail@ponytail', dir],
    ['pack ponytail: selected projects (was all projects)', null, null],
  ]);
  assert.ok(plan.every((c) => c.selected));
  assert.match(plan[2].diff, /"ponytail": "projects"/);
  assert.equal(plan[1].installUnit.scope, 'project');
  const run = apply(plan, ctx);
  assert.equal(run.status, 'done');
  assert.deepEqual(installs(), [{ scope: 'local', version: '5.2.0', projectPath: dir }]);
  assert.equal(packScope(ctx, pack(ctx, 'ponytail')), 'projects');
  // The project's own plan keeps it there; the global plan neither installs it for the user nor offers a removal.
  assert.ok(!projectPlan({ ctx, dir, answers: {} }).changes.some((c) => c.step.startsWith('pack:ponytail')));
  assert.deepEqual(globalPlan({ ctx, agents: ['claude'], options: { packs: ['ponytail'], packsInUse: ['ponytail'] } }).filter((c) => c.step === 'plugin:claude:ponytail@ponytail' && c.kind === 'command'), []);
  undo(run.id, ctx);
  assert.deepEqual(installs(), [{ scope: 'user', version: '5.2.0' }]);
  assert.equal(existsSync(scopeFile(ctx)), false);
  assert.ok(calls.includes('claude plugin install --scope user ponytail@ponytail') && calls.includes(`claude plugin uninstall --scope local ponytail@ponytail @${dir}`));

  // And back: out of the project, in for the user.
  apply(preview(scopePlan(ctx, 'ponytail', 'projects', ['claude'])), ctx);
  const back = preview(scopePlan(ctx, 'ponytail', 'global', ['claude']));
  assert.deepEqual(back.map((c) => [c.title, c.argv?.join(' ') ?? null]), [
    [`uninstall ponytail@ponytail in ${dir} (local scope; now all projects)`, 'claude plugin uninstall --scope local ponytail@ponytail'],
    ['Ponytail level full', null],
    ['Claude Code plugin ponytail@ponytail (optional pack, all projects)', 'claude plugin install ponytail@ponytail'],
    ['pack ponytail: all projects (was selected projects)', null],
  ]);
  const again = apply(back, ctx);
  assert.deepEqual(installs(), [{ scope: 'user', version: '5.2.0' }]);
  assert.equal(packScope(ctx, pack(ctx, 'ponytail')), 'global');
  undo(again.id, ctx);
  assert.deepEqual(installs(), [{ scope: 'local', version: '5.2.0', projectPath: dir }]);
  assert.equal(packScope(ctx, pack(ctx, 'ponytail')), 'projects');
});

test('a plugin pack for selected projects switched off in a project leaves that project; undo installs it again', () => {
  const { ctx, dir, installs } = machine();
  apply(preview(scopePlan(ctx, 'ponytail', 'projects', ['claude'])), ctx);
  const off = preview(projectPlan({ ctx, dir, answers: { packOff: ['ponytail'] } }).changes).filter((c) => c.step === 'pack:ponytail:claude');
  assert.deepEqual(off.map((c) => [c.argv.join(' '), c.cwd, c.selected]), [['claude plugin uninstall --scope local ponytail@ponytail', dir, true]]);
  const run = apply(off, ctx, { scope: dir });
  assert.equal(run.status, 'done');
  assert.deepEqual(installs(), []);
  undo(run.id, ctx);
  assert.deepEqual(installs(), [{ scope: 'local', version: '5.2.0', projectPath: dir }]);
  // For all projects the plugin stays: other projects use it, and the global plan owns it.
  apply(preview(scopePlan(ctx, 'ponytail', 'global', ['claude'])), ctx);
  assert.ok(!projectPlan({ ctx, dir, answers: { packOff: ['ponytail'] } }).changes.some((c) => c.step.startsWith('pack:ponytail')));
});

test('a skill pack for all projects: global copies instead of the project ones, kept by the cleanup and the doctor, and back', () => {
  const { ctx, home, dir } = machine();
  const skills = pack(ctx, 'frontend').skills;
  const plan = preview(scopePlan(ctx, 'frontend', 'global', ['claude']));
  const global = plan.filter((c) => c.step === 'pack:frontend');
  assert.ok(global.some((c) => c.kind === 'write' && c.path === join(home, '.claude/skills/designing-technical-uis/SKILL.md') && c.title === 'global skill designing-technical-uis (pack frontend, all projects)'));
  assert.ok(global.some((c) => c.kind === 'command' && c.argv.includes('-g') && c.argv.includes('frontend-design')));
  // The project's copies come out in the same plan, preselected.
  const removed = plan.filter((c) => c.step.startsWith('remove:'));
  assert.deepEqual(new Set(removed.map((c) => c.step.split(':')[1])), new Set(skills));
  assert.ok(removed.every((c) => c.selected && c.id.startsWith(`${dir}:`)));
  assert.equal(plan.at(-1).title, 'pack frontend: all projects (was selected projects)');

  // Applied: the global copies are part of the setup (the stubbed skills CLI creates no folder), the project plan copies none.
  assert.equal(apply(plan, ctx).status, 'done');
  for (const s of skills) mkdirSync(join(home, '.claude/skills', s), { recursive: true });
  const full = globalPlan({ ctx, agents: ['claude'], devcontainerCli: '0.0.0', options: { level: 'full' } });
  assert.ok(!full.some((c) => c.step === 'other:claude:skill' && skills.some((s) => c.path.endsWith(s))));
  assert.ok(!projectPlan({ ctx, dir, answers: {} }).changes.some((c) => skills.some((s) => c.step === `skill:${s}`)));

  // Back to selected projects: the global copies the app installed go to the backup, preselected, the project gets its copies again.
  const back = preview(scopePlan(ctx, 'frontend', 'projects', ['claude']));
  assert.deepEqual(new Set(back.filter((c) => c.step === 'other:claude:skill').map((c) => c.path)), new Set(skills.map((s) => join(home, '.claude/skills', s))));
  assert.ok(back.filter((c) => c.step === 'other:claude:skill').every((c) => c.selected));
  assert.equal(back.at(-1).title, 'pack frontend: selected projects (was all projects)');
});

test('a scope move preselects no removal of what the user owns and keeps held project changes held', () => {
  const { ctx, home, dir } = machine();
  const [uninstall] = scopePlan(ctx, 'ponytail', 'projects', ['claude']);
  assert.equal(uninstall.destructive, true);
  assert.equal(uninstall.impact, 'removing runs claude plugin uninstall --scope user ponytail@ponytail, which deletes the plugin and its data from Claude Code; claude plugin install --scope user ponytail@ponytail brings it back');

  // Global folders named like the pack's skills that the app never installed, and a project skill adopted earlier (held).
  const skills = pack(ctx, 'frontend').skills;
  writeFileSync(scopeFile(ctx), JSON.stringify({ scopes: { frontend: 'global' } }));
  for (const s of skills) mkdirSync(join(home, '.claude/skills', s), { recursive: true });
  writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 2, agents: ['claude'], env: 'host', packs: ['ponytail', 'frontend'], skills: skills.map((name) => ({ name, adopted: true })) }));
  const plan = scopePlan(ctx, 'frontend', 'projects', ['claude']);
  const removals = plan.filter((c) => c.step === 'other:claude:skill');
  assert.equal(removals.length, skills.length);
  assert.ok(removals.every((c) => c.selected === false));
  const held = plan.filter((c) => c.held);
  assert.ok(held.length && held.every((c) => c.step === 'skill:designing-technical-uis' && c.selected === false && c.project === dir));
});

test('the Installs tab: scope hint, fixed scope and state per row; global items only in the global block; a toggle plans this project only and undo restores it', () => {
  const { ctx, home, dir } = machine();
  const skills = pack(ctx, 'frontend').skills;
  writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 2, agents: ['claude', 'codex'], env: 'host', packs: ['ponytail', 'frontend'], skills: skills.map((name) => ({ name })) }));
  // Claude Code has Ponytail, Matt Pocock's skills (global, not selected here) and BenchKeeper's own plugin for the user.
  const ids = ['ponytail@ponytail', 'mattpocock-skills@claude-plugins-official', 'benchkeeper@benchkeeper'];
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: Object.fromEntries(ids.map((id) => [id, [{ scope: 'user', version: '1.0.0' }]])) }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: Object.fromEntries(ids.map((id) => [id, true])) }));
  const routes = api(ctx);
  const plan = (extra = []) => routes['GET /api/project-plan'](new URLSearchParams([['dir', dir], ...extra]));
  const p = plan();
  const row = (id) => p.packs.find((x) => x.id === id);
  assert.deepEqual(['ponytail', 'frontend', 'matt-pocock'].map((id) => [row(id).enabled, row(id).hint, row(id).state, row(id).owner]),
    [[true, 'also global', 'installed', false], [true, 'only this project', 'installed', false], [false, 'also global', 'installed', true]]);
  // Codex offers plugins for the user only: the row names it with the reason; a skill pack has no fixed scope for these agents.
  assert.deepEqual(row('ponytail').fixed.map((f) => [f.agent, f.scope]), [['Codex', 'global']]);
  assert.match(row('ponytail').fixed[0].reason, /user only/);
  assert.deepEqual(row('frontend').fixed, []);
  assert.deepEqual(p.chosen.map((s) => [s.name, s.hint, s.state]).sort(), skills.map((n) => [n, 'only this project', 'installed']).sort());
  assert.ok(p.files.length && p.files.every((f) => !f.on && f.state === 'not installed' && f.fixed === null));
  // The global block: what the project does not select, once, and the BenchKeeper plugin.
  assert.deepEqual(p.global.packs.map((x) => x.id), ['matt-pocock']);
  assert.deepEqual(p.global.plugin, ['Claude Code']);
  assert.ok(!p.packs.some((x) => x.enabled && p.global.packs.some((g) => g.id === x.id)));

  // A pack switched off: the plan changes only this project; applied, then undone, the project is as before.
  const off = plan([['pack-off', 'frontend']]);
  assert.ok(off.changes.length);
  assert.ok(off.changes.every((c) => [c.path, c.cwd].some((x) => x === dir || x?.startsWith(`${dir}/`))), off.changes.map((c) => c.path ?? c.cwd).join());
  const before = readFileSync(join(dir, '.benchkeeper/state.json'), 'utf8');
  const run = apply(preview(projectPlan({ ctx, dir, answers: { packOff: ['frontend'] } }).changes), ctx);
  assert.equal(run.status, 'done');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.benchkeeper/state.json'), 'utf8')).packs, ['ponytail']);
  undo(run.id, ctx);
  assert.equal(readFileSync(join(dir, '.benchkeeper/state.json'), 'utf8'), before);

  // An agent file switched on and off; one whose source needs an agent the project lacks says so.
  const [file] = p.files;
  assert.deepEqual(plan([['file-on', file.path]]).files.find((f) => f.path === file.path).on, true);
  assert.deepEqual(plan([['file-on', file.path], ['file-off', file.path]]).files.find((f) => f.path === file.path).on, false);
  writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 2, agents: ['codex'], env: 'host', packs: [] }));
  assert.match(plan().files[0].fixed, /installs for Claude Code only/);
});

test('packs scope prints the scope and each agent\'s offer, and applies a move', async () => {
  const { ctx, installs } = machine();
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args) => main(args, { out, ctx, input: Readable.from(['']) });
  assert.equal(await exec(['packs', 'scope', 'ponytail', '--agents', 'claude,codex']), 0);
  assert.match(text, /^ponytail: global \(all projects\)\n {2}Claude Code: global, projects\n {2}Codex: global only: Codex installs plugins for the user only/);
  assert.equal(await exec(['packs', 'scope', 'missing']), 2);
  assert.equal(await exec(['packs', 'scope', 'ponytail', 'projects', '--agents', 'claude', '--yes']), 0);
  assert.equal(installs()[0].scope, 'local');
  text = '';
  await exec(['packs', 'list']);
  assert.match(text, /ponytail +library projects/);
});

test('packs scope moves a project outside the home folder under its own bounds, as a run of its own that undo takes back', async () => {
  const { ctx, dir, installs } = machine({ outside: true });
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args) => main(args, { out, ctx, input: Readable.from(['']) });
  const runs = () => [...text.matchAll(/^run (\S+): undo/gm)].map((m) => m[1]);
  const undoAll = async () => { for (const id of runs().reverse()) assert.equal(await exec(['undo', id]), 0, text); };

  // A plugin pack: into the project's local scope and back out of it, the local uninstall run in the project.
  assert.equal(await exec(['packs', 'scope', 'ponytail', 'projects', '--agents', 'claude', '--yes']), 0, text);
  assert.deepEqual(installs(), [{ scope: 'local', version: '5.2.0', projectPath: dir }]);
  assert.equal(runs().length, 2);
  text = '';
  assert.equal(await exec(['packs', 'scope', 'ponytail', 'global', '--agents', 'claude', '--yes']), 0, text);
  assert.deepEqual(installs(), [{ scope: 'user', version: '5.2.0' }]);
  await undoAll();
  assert.deepEqual(installs(), [{ scope: 'local', version: '5.2.0', projectPath: dir }]);

  // A skill pack: the project's copy of BenchKeeper's own skill comes out (the others through the stubbed skills CLI), and undo puts it back.
  text = '';
  assert.equal(await exec(['packs', 'scope', 'frontend', 'global', '--agents', 'claude', '--yes']), 0, text);
  assert.equal(existsSync(join(dir, '.claude/skills/designing-technical-uis')), false, text);
  await undoAll();
  assert.ok(existsSync(join(dir, '.claude/skills/designing-technical-uis/SKILL.md')));
  assert.equal(packScope(ctx, pack(ctx, 'frontend')), 'projects');
});
