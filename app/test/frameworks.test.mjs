import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { library } from '../src/content.mjs';
import { doctor } from '../src/doctor.mjs';
import { catalog, checkOwners, frameworkChecks, frameworkRows } from '../src/frameworks.mjs';
import { apply, context, preview, runCommand, undo, undoable } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { committedSetup, localSetup, projectPlan, readState, resolveAnswers } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());
const SP = 'superpowers@claude-plugins-official';
const FILE = 'engineering/engineering-frontend-developer.md';
const AGENT = '.claude/agents/engineering-frontend-developer.md';

// A project in a git repository, and a machine whose Claude Code and curl are stubbed: a plugin install enables the plugin
// in the settings file of its scope (cwd is the project), curl writes the file it is told to.
function repo() {
  const dir = mkdtempSync(join(TMP, 'bk-fw-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const home = mkdtempSync(join(TMP, 'bk-fwhome-'));
  const calls = [];
  const settings = (cwd, scope) => join(cwd, scope === 'project' ? '.claude/settings.json' : '.claude/settings.local.json');
  const toggle = (argv, cwd, on) => {
    const file = settings(cwd, argv[5]);
    mkdirSync(dirname(file), { recursive: true });
    const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    cur.enabledPlugins = { ...cur.enabledPlugins, [argv[3]]: on };
    writeFileSync(file, `${JSON.stringify(cur, null, 2)}\n`);
  };
  const run = (argv, o = {}) => {
    if (['claude', 'curl'].includes(argv[0])) calls.push({ argv, cwd: o.cwd });
    if (argv[0] === 'claude' && argv[1] === 'plugin' && ['install', 'uninstall'].includes(argv[2])) toggle(argv, o.cwd, argv[2] === 'install');
    if (argv[0] === 'curl') { mkdirSync(dirname(argv.at(-2)), { recursive: true }); writeFileSync(argv.at(-2), `---\nname: Frontend Developer\n---\nfrom ${argv.at(-1)}\n`); }
    return ['claude', 'curl'].includes(argv[0]) ? { code: 0, stdout: '', stderr: '' } : runCommand(argv, o);
  };
  return { dir, home, git, calls, ctx: context({ home, roots: [home, dir], appVersion: '6.0.0', run }) };
}
const plan = (r, answers) => projectPlan({ ctx: r.ctx, dir: r.dir, answers, plugins: {} });
// Plan and apply everything selected, commands included (they are stubbed).
const run = (r, answers) => {
  const p = plan(r, answers);
  const changes = preview(p.changes);
  return { ...p, changes, run: apply(changes, r.ctx, { scope: r.dir, select: changes.filter((c) => c.selected).map((c) => c.id) }) };
};
const frameworkSteps = (p) => p.changes.filter((c) => c.step.startsWith('framework:'));
const base = { agents: ['claude'], env: 'host' };
const sink = () => { let text = ''; return { out: new Writable({ write(c, _, done) { text += c; done(); } }), text: () => text }; };

test('the catalog: every framework has an evaluation file, a pack or pinned source, and at most one owner', () => {
  const lib = library();
  assert.deepEqual(catalog(lib).map((f) => f.id), ['superpowers', 'matt-pocock', 'ecc', 'agency-agents']);
  assert.deepEqual(catalog(lib).filter((f) => f.role === 'owner').map((f) => f.id), ['superpowers']);
  for (const f of catalog(lib)) {
    assert.ok(existsSync(new URL(`../../${f.evaluation}`, import.meta.url)), f.evaluation);
    if (f.install.kind === 'pack') assert.ok(lib.packs.some((p) => p.id === f.install.pack), f.id);
    if (f.install.kind === 'agents') {
      assert.match(f.install.ref, /^[0-9a-f]{40}$/);
      for (const { path } of f.install.files) assert.match(path, /^[a-z0-9-]+\/[a-z0-9-]+\.md$/);
    }
  }
  // ECC comes as single skills at a commit, not as its plugin.
  assert.ok(lib.skills.filter((s) => s.source === 'affaan-m/ECC').every((s) => /^[0-9a-f]{40}$/.test(s.ref)));
  assert.equal(frameworkRows().find((f) => f.id === 'agency-agents').files.length, 6);
});

test('Superpowers, local: a plugin enabled for this project only, the project block gives way, a second plan is empty, undo takes it out', () => {
  const r = repo();
  const p = run(r, { ...base, frameworks: ['superpowers'] });
  assert.equal(p.run.status, 'done');
  const install = r.calls.find((c) => c.argv[2] === 'install');
  assert.deepEqual(install.argv, ['claude', 'plugin', 'install', SP, '--scope', 'local']);
  assert.equal(install.cwd, r.dir);
  assert.ok(JSON.parse(readFileSync(join(r.dir, '.claude/settings.local.json'), 'utf8')).enabledPlugins[SP]);
  const block = readFileSync(join(r.dir, 'CLAUDE.local.md'), 'utf8');
  assert.match(block, /Workflow owner: Superpowers/);
  assert.ok(!/It picks the workflow and the tier/.test(block) && /ask all open questions/.test(block));
  assert.match(p.warnings.join('\n'), /Superpowers owns the workflow/);
  assert.match(p.warnings.join('\n'), /cost higher in every with\/without test but one/);
  assert.deepEqual(readState(r.dir).frameworks, ['superpowers']);
  assert.match(readFileSync(join(r.dir, '.git/info/exclude'), 'utf8'), /\/\.claude\/settings\.local\.json/);
  assert.equal(r.git('status', '--porcelain').toString(), '', 'git sees nothing');
  assert.deepEqual(frameworkSteps(plan(r, {})), [], 'a second plan has no framework change');
  // Undo runs the scoped uninstall in the project.
  assert.equal(undo(p.run.id, r.ctx).status, 'done');
  const out = r.calls.findLast((c) => c.argv[2] === 'uninstall');
  assert.deepEqual([out.argv.join(' '), out.cwd], [`claude plugin uninstall ${SP} --scope local`, r.dir]);
  assert.equal(JSON.parse(readFileSync(join(r.dir, '.claude/settings.local.json'), 'utf8')).enabledPlugins[SP], false);
});

test('Superpowers, shared: scope project, in the settings file the repository keeps; leaving it out uninstalls it', () => {
  const r = repo();
  run(r, { ...base, frameworks: ['superpowers'], share: true });
  assert.deepEqual(r.calls.find((c) => c.argv[2] === 'install').argv.slice(-2), ['--scope', 'project']);
  assert.ok(JSON.parse(readFileSync(join(r.dir, '.claude/settings.json'), 'utf8')).enabledPlugins[SP]);
  assert.match(readFileSync(join(r.dir, 'AGENTS.md'), 'utf8'), /Workflow owner: Superpowers/);
  // A setup that no longer names it: the plan uninstalls it and the block has its workflow rule back.
  const off = run(r, { frameworks: [] });
  assert.equal(off.run.status, 'done');
  assert.deepEqual(r.calls.findLast((c) => c.argv[2] === 'uninstall').argv.slice(-2), ['--scope', 'project']);
  assert.match(readFileSync(join(r.dir, 'AGENTS.md'), 'utf8'), /It picks the workflow and the tier/);
  assert.equal(readState(r.dir).frameworks, undefined);
});

test('removing a committed or local setup takes the framework out too', () => {
  const r = repo();
  run(r, { ...base, frameworks: ['superpowers', 'agency-agents'], agentFiles: [FILE] });
  const local = localSetup(r.ctx, r.dir);
  assert.ok(local.some((c) => c.step === 'framework' && c.kind === 'write' && c.path.endsWith('settings.local.json')));
  assert.ok(local.some((c) => c.step === 'framework' && c.kind === 'remove' && c.path.endsWith(AGENT)));
  const shared = repo();
  run(shared, { ...base, frameworks: ['superpowers'], share: true });
  const committed = committedSetup(shared.dir);
  const edit = committed.find((c) => c.step === 'framework');
  assert.ok(!JSON.parse(edit.edit(readFileSync(edit.path, 'utf8'))).enabledPlugins);
});

test('one workflow owner: a second is refused, unknown ids and codex-only projects too', () => {
  const lib = { frameworks: [{ id: 'a', title: 'A', role: 'owner', install: { kind: 'plugin', plugin: 'a@m' } }, { id: 'b', title: 'B', role: 'owner', install: { kind: 'plugin', plugin: 'b@m' } }, { id: 'c', title: 'C', role: 'parts', install: { kind: 'plugin', plugin: 'c@m' } }] };
  assert.throws(() => checkOwners(['a', 'b'], lib), /one workflow owner per project: A and B/);
  assert.doesNotThrow(() => checkOwners(['a', 'c'], lib));
  const r = repo();
  assert.throws(() => plan(r, { ...base, frameworks: ['nope'] }), /unknown framework nope/);
  assert.throws(() => plan(r, { ...base, agents: ['codex'], frameworks: ['superpowers'] }), /installs for Claude Code only/);
});

test('a state file from a clone cannot name an unknown framework or an agent file outside the catalog', () => {
  const r = repo();
  const state = (x) => { mkdirSync(join(r.dir, '.benchkeeper'), { recursive: true }); writeFileSync(join(r.dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 1, agents: ['claude'], env: 'host', ...x })); };
  state({ frameworks: ['../x'] });
  assert.throws(() => resolveAnswers(r.dir), /unknown framework/);
  state({ frameworks: ['agency-agents'], agentFiles: ['../../etc/passwd'] });
  assert.throws(() => resolveAnswers(r.dir), /not an agent file of the catalog/);
  state({ frameworks: [], agentFiles: [FILE] });
  assert.throws(() => resolveAnswers(r.dir), /need their framework chosen/);
  assert.throws(() => plan(r, { ...base, frameworks: ['agency-agents'], agentFiles: ['engineering/../../x.md'] }), /not an agent file/);
});

test('agency-agents: a pick of agent files fetched at the pinned commit, second plan empty, a dropped pick removed, undo restores', () => {
  const r = repo();
  assert.throws(() => plan(r, { ...base, frameworks: ['agency-agents'] }), /pick the agent files/);
  assert.throws(() => plan(r, { ...base, agentFiles: [FILE] }), /need their framework chosen/);
  const p = run(r, { ...base, frameworks: ['agency-agents'], agentFiles: [FILE] });
  assert.equal(p.run.status, 'done');
  const curl = r.calls.find((c) => c.argv[0] === 'curl');
  const ref = catalog().find((f) => f.id === 'agency-agents').install.ref;
  assert.deepEqual(curl.argv.slice(1, 7), ['-fsSL', '--proto', '=https', '--proto-redir', '=https', '--create-dirs']);
  assert.equal(curl.argv.at(-1), `https://raw.githubusercontent.com/msitarzewski/agency-agents/${ref}/${FILE}`);
  assert.equal(curl.argv.at(-2), join(r.dir, AGENT));
  assert.ok(existsSync(join(r.dir, AGENT)));
  assert.deepEqual(readState(r.dir).agentFiles, [FILE]);
  assert.match(readFileSync(join(r.dir, '.git/info/exclude'), 'utf8'), /\/\.claude\/agents\/engineering-frontend-developer\.md/);
  assert.equal(r.git('status', '--porcelain').toString(), '');
  assert.deepEqual(frameworkSteps(plan(r, {})), []);
  assert.equal(undo(p.run.id, r.ctx).status, 'done');
  assert.ok(!existsSync(join(r.dir, AGENT)), 'undo took the file out again');
  // Applied again with a second file, then one pick dropped: its file goes to the backup, the other stays.
  const other = 'testing/testing-reality-checker.md';
  run(r, { ...base, frameworks: ['agency-agents'], agentFiles: [FILE, other] });
  const drop = run(r, { agentFiles: [other] });
  assert.equal(drop.run.status, 'done');
  assert.deepEqual([existsSync(join(r.dir, AGENT)), existsSync(join(r.dir, '.claude/agents/testing-reality-checker.md'))], [false, true]);
  assert.deepEqual(readState(r.dir).agentFiles, [other]);
});

test('ECC is a pack of single skills at its commit: no plugin, no hooks, nothing outside the project', () => {
  const r = repo();
  const p = plan(r, { ...base, frameworks: ['ecc'] });
  assert.deepEqual(p.answers.packs, ['ecc']);
  assert.deepEqual(p.answers.frameworks, []);
  const installs = p.changes.filter((c) => c.kind === 'command');
  assert.deepEqual(installs.map((c) => c.argv[c.argv.indexOf('-s') + 1]).sort(), ['architecture-decision-records', 'error-handling', 'tdd-workflow', 'verification-loop']);
  assert.ok(installs.every((c) => c.cwd === r.dir && c.argv[4].includes('/affaan-m/ECC/tree/c05b2d6614f62f6db0047669aa4eefb223d478f9')));
  assert.ok(!p.changes.some((c) => /plugin/.test(c.argv?.join(' ') ?? '')));
});

test('undo commands: the plugin forms with a project or local scope, never user scope or extra arguments', () => {
  const ok = (...a) => undoable(['claude', 'plugin', ...a]);
  assert.ok(ok('uninstall', SP, '--scope', 'local') && ok('install', SP, '--scope', 'project') && ok('uninstall', SP));
  assert.ok(!ok('uninstall', SP, '--scope', 'user'));
  assert.ok(!ok('uninstall', SP, '--scope', 'local', '--prune'));
  assert.ok(!ok('uninstall', '--evil', '--scope', 'local'));
  assert.ok(!undoable(['claude', 'plugin', 'marketplace', 'remove', 'x', '--scope', 'local']));
  assert.ok(!undoable(['codex', 'plugin', 'remove', 'x', '--scope', 'local']));
});

test('doctor: a second owner, a framework installed for the user or here that the setup does not record', () => {
  const r = repo();
  const lib = { frameworks: [{ id: 'a', title: 'A', role: 'owner', install: { kind: 'plugin', plugin: 'a@m' } }, { id: 'b', title: 'B', role: 'owner', install: { kind: 'plugin', plugin: 'b@m' } }] };
  const issues = (x) => frameworkChecks({ dir: r.dir, ...x });
  assert.deepEqual(issues({ state: null, userPlugins: [{ id: SP }] }), [], 'not a BenchKeeper project');
  assert.deepEqual(issues({ state: { frameworks: ['superpowers'] }, userPlugins: [] }), []);
  const user = issues({ state: { frameworks: [] }, userPlugins: [{ id: 'superpowers@superpowers-marketplace' }] });
  assert.match(user[0].message, /installed for the user \(all projects\)/);
  assert.equal(user[0].level, 'warning');
  const two = frameworkChecks({ dir: r.dir, lib, state: { frameworks: ['a'] }, userPlugins: [{ id: 'b@x' }] });
  assert.equal(two.find((i) => i.level === 'error').message, 'two workflow owners in this project: A and B');
  writeFileSync(join(r.dir, 'x'), '');
  mkdirSync(join(r.dir, '.claude'));
  writeFileSync(join(r.dir, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { [SP]: true } }));
  assert.match(issues({ state: { frameworks: [] }, userPlugins: [] })[0].message, /installed here/);
  assert.match(issues({ state: { frameworks: ['gone'] }, userPlugins: [] }).at(-1).message, /records framework gone/);
});

test('doctor of a project reads the user plugins from the agent files', () => {
  const r = repo();
  run(r, { ...base });
  mkdirSync(join(r.home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(r.home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'superpowers@superpowers-marketplace': [{ scope: 'user', version: '7.0.0' }] } }));
  writeFileSync(join(r.home, '.claude/plugins/known_marketplaces.json'), '{}');
  const found = doctor(r.ctx, { agents: ['claude'], dir: r.dir }).filter((i) => i.check === 'frameworks');
  assert.equal(found.length, 1);
  assert.match(found[0].fix, /claude plugin uninstall superpowers@claude-plugins-official/);
});

test('CLI and server: the list shows the evidence, --framework and --agent-file are answers, none clears', async () => {
  const r = repo();
  const s = sink();
  assert.equal(await main(['frameworks'], { out: s.out, ctx: r.ctx, input: Readable.from(['']) }), 0);
  assert.match(s.text(), /superpowers\s+owner\s+plugin\s+Superpowers[^\n]*cost higher in every with\/without test but one[^\n]*evaluations\/workflow-frameworks\/superpowers\.md/);
  assert.match(s.text(), /--agent-file engineering\/engineering-frontend-developer\.md: A web UI is built or changed/);
  const t = sink();
  const code = await main(['project', 'apply', r.dir, '--agents', 'claude', '--env', 'host', '--framework', 'agency-agents', '--agent-file', FILE, '--yes'], { out: t.out, ctx: r.ctx, input: Readable.from(['']) });
  assert.equal(code, 0, t.text());
  assert.deepEqual(readState(r.dir).frameworks, ['agency-agents']);
  const u = sink();
  assert.equal(await main(['project', 'apply', r.dir, '--framework', 'none', '--yes'], { out: u.out, ctx: r.ctx, input: Readable.from(['']) }), 0, u.text());
  assert.equal(readState(r.dir).frameworks, undefined);
  assert.ok(!existsSync(join(r.dir, AGENT)));
  const routes = api({ ...r.ctx, run: (argv, o) => (argv.join(' ') === 'claude --version' ? { code: 0, stdout: '2.1.0 (Claude Code)', stderr: '' } : r.ctx.run(argv, o)) });
  routes['POST /api/projects']({ action: 'add', path: r.dir });
  const setup = routes['GET /api/project-setup'](new URLSearchParams([['dir', r.dir]]));
  assert.deepEqual(setup.frameworks.map((f) => f.id), ['superpowers', 'matt-pocock', 'ecc', 'agency-agents']);
  const q = (extra) => new URLSearchParams([['dir', r.dir], ['setup', '1'], ['agents', 'claude'], ...extra]);
  const planned = routes['GET /api/project-plan'](q([['framework', 'superpowers'], ['agent-file', '']]));
  assert.ok(planned.changes.some((c) => c.step === 'framework:superpowers'));
  assert.ok(planned.warnings.some((w) => /owns the workflow/.test(w)));
  assert.throws(() => routes['GET /api/project-plan'](q([['framework', 'superpowers,nope']])), (e) => e.status === 400);
});
