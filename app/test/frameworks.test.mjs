import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { library } from '../src/content.mjs';
import { parse as parseToml } from 'smol-toml';
import { codexAgent, frameworkRemovals, sourceRows, sources } from '../src/frameworks.mjs';
import { classify } from '../src/inventory.mjs';
import { apply, context, preview, runCommand, undo, undoable } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { localSetup, projectPlan, readState, resolveAnswers } from '../src/steps/project.mjs';
import { initRepo } from './helpers.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());
const FILE = 'engineering/engineering-frontend-developer.md';
const AGENT = '.claude/agents/engineering-frontend-developer.md';

// A project in a git repository, and a machine whose curl is stubbed: it writes the file it is told to.
function repo() {
  const dir = mkdtempSync(join(TMP, 'bk-fw-'));
  const git = initRepo(dir);
  const home = mkdtempSync(join(TMP, 'bk-fwhome-'));
  const calls = [];
  const run = (argv, o = {}) => {
    if (['claude', 'curl'].includes(argv[0])) calls.push({ argv, cwd: o.cwd });
    if (argv[0] === 'curl') { mkdirSync(dirname(argv.at(-2)), { recursive: true }); writeFileSync(argv.at(-2), `---\nname: Frontend Developer\ndescription: Builds web UIs\n---\nfrom ${argv.at(-1)}\n`); }
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

test('the catalog: agent-file sources, each with an evaluation in BenchKeeper-research and a pinned source; no frameworks', () => {
  const lib = library();
  assert.equal(lib.frameworks, undefined);
  assert.deepEqual(sources(lib).map((f) => f.id), ['agency-agents']);
  for (const f of sources(lib)) {
    assert.match(f.evaluation, /^https:\/\/github\.com\/ESchuderer\/BenchKeeper-research\/blob\/main\/evaluations\/[a-z-]+\/[a-z-]+\.md$/);
    assert.match(f.install.ref, /^[0-9a-f]{40}$/);
    for (const { path } of f.install.files) assert.match(path, /^[a-z0-9-]+\/[a-z0-9-]+\.md$/);
  }
  const row = sourceRows().find((f) => f.id === 'agency-agents'), ref = sources(lib)[0].install.ref;
  assert.equal(row.files.length, 6);
  assert.equal(row.readme, `https://github.com/msitarzewski/agency-agents/blob/${ref}/README.md`);
  assert.equal(row.files.find((x) => x.path === FILE).url, `https://github.com/msitarzewski/agency-agents/blob/${ref}/${FILE}`);
});

test('a new pin: the refetch shows outdated, and a file edited since the fetch gets a warning naming it', () => {
  const r = repo();
  run(r, { ...base, agentFiles: [FILE] });
  const at = join(r.dir, '.benchkeeper/state.json');
  const state = JSON.parse(readFileSync(at, 'utf8'));
  assert.match(state.agentHashes[FILE], /^[0-9a-f]{64}$/);
  writeFileSync(at, JSON.stringify({ ...state, frameworkRefs: { 'agency-agents': '0'.repeat(40) } }));
  const states = (p) => { const out = []; classify(r.ctx, p.changes.filter((c) => c.step.startsWith('framework:')), (_, __, x) => out.push(x)); return out; };
  const edited = (p) => p.warnings.filter((w) => w.includes('was edited since it was fetched'));
  const unedited = plan(r, {});
  assert.deepEqual(states(unedited), ['outdated']);
  assert.deepEqual(edited(unedited), []);
  writeFileSync(join(r.dir, AGENT), 'my edit\n');
  const p = plan(r, {});
  assert.deepEqual(states(p), ['outdated']);
  assert.equal(edited(p).length, 1);
  assert.match(edited(p)[0], new RegExp(`^${join(r.dir, AGENT)} was edited .* backup`));
  // A file missing on disk is fetched as missing, not outdated.
  execFileSync('rm', [join(r.dir, AGENT)]);
  const gone = plan(r, {});
  assert.deepEqual([states(gone), edited(gone)], [['missing'], []]);
});

test('removing a local setup takes the fetched agent files out too', () => {
  const r = repo();
  run(r, { ...base, agentFiles: [FILE] });
  assert.ok(localSetup(r.ctx, r.dir).some((c) => c.step === 'framework' && c.kind === 'remove' && c.path.endsWith(AGENT)));
});

test('a state file from a clone: paths the catalog lacks are ignored, never planned or run; unknown answers are refused', () => {
  const r = repo();
  const state = (x) => { mkdirSync(join(r.dir, '.benchkeeper'), { recursive: true }); writeFileSync(join(r.dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 1, agents: ['claude'], env: 'host', ...x })); };
  state({ agentFiles: ['../../etc/passwd'], agentOwned: ['../../etc/passwd'] });
  assert.deepEqual(resolveAnswers(r.dir).agentFiles, []);
  assert.deepEqual(frameworkSteps(plan(r, {})), []);
  state({ agentFiles: [FILE], agentOwned: [FILE] });
  assert.deepEqual(resolveAnswers(r.dir).agentFiles, [FILE], 'a picked file of a source');
  assert.throws(() => plan(r, { ...base, agentFiles: ['../../etc/passwd'] }), /not an agent file of the catalog/);
  assert.throws(() => plan(r, { ...base, agentFiles: ['engineering/../../x.md'] }), /not an agent file/);
  // The owned list never reaches a removal: only catalog paths do.
  state({ agentFiles: [FILE], agentOwned: ['../../etc/passwd', 'codex:../../etc/passwd', `gemini:${FILE}`, `evil:${FILE}`] });
  assert.deepEqual(frameworkRemovals(r.dir, readState(r.dir)), []);
  assert.deepEqual(resolveAnswers(r.dir).agentOwned, []);
});

test('an agent file that was there before is the project\'s: kept, not fetched, not removed when unpicked', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude/agents'), { recursive: true });
  writeFileSync(join(r.dir, AGENT), 'mine\n');
  const other = 'testing/testing-reality-checker.md';
  run(r, { ...base, agentFiles: [FILE, other] });
  assert.equal(r.calls.filter((c) => c.argv[0] === 'curl').length, 1, 'only the missing file is fetched');
  assert.deepEqual(readState(r.dir).agentOwned, [other]);
  run(r, { agentFiles: [other] });
  assert.equal(readFileSync(join(r.dir, AGENT), 'utf8'), 'mine\n');
});

test('a fetch that did not run is not recorded', () => {
  const r = repo();
  const failing = { ...r.ctx, run: (argv, o) => (['claude', 'curl'].includes(argv[0]) ? { code: 1, stdout: '', stderr: 'no network' } : r.ctx.run(argv, o)) };
  const p = projectPlan({ ctx: failing, dir: r.dir, answers: { ...base, agentFiles: [FILE] }, plugins: {} });
  const changes = preview(p.changes);
  const result = apply(changes, failing, { scope: r.dir, select: changes.filter((c) => c.selected).map((c) => c.id) });
  assert.equal(result.status, 'failed');
  const state = readState(r.dir);
  assert.deepEqual([state.agentFiles, state.agentOwned, state.frameworkRefs], [[FILE], [], undefined]);
  // Applied again, it plans the fetch once more.
  assert.equal(frameworkSteps(plan(r, {})).length, 1);
});

test('answers without --agent-file keep the agent files picked; an empty pick drops them', () => {
  const r = repo();
  run(r, { ...base, agentFiles: [FILE] });
  assert.deepEqual(resolveAnswers(r.dir, { tier: 'quick' }).agentFiles, [FILE]);
  assert.deepEqual(resolveAnswers(r.dir, { agentFiles: [] }).agentFiles, []);
});

test('agency-agents: a pick of agent files fetched at the pinned commit, second plan empty, a dropped pick removed, undo restores', () => {
  const r = repo();
  assert.throws(() => plan(r, { ...base, agents: ['gemini'], agentFiles: [FILE] }), /installs for Claude Code, Codex, GitHub Copilot CLI only/);
  const p = run(r, { ...base, agentFiles: [FILE] });
  assert.equal(p.run.status, 'done');
  const curl = r.calls.find((c) => c.argv[0] === 'curl');
  const ref = sources().find((f) => f.id === 'agency-agents').install.ref;
  assert.deepEqual(curl.argv.slice(1, 8), ['-fsSL', '--remove-on-error', '--proto', '=https', '--proto-redir', '=https', '--create-dirs']);
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
  run(r, { ...base, agentFiles: [FILE, other] });
  const drop = run(r, { agentFiles: [other] });
  assert.equal(drop.run.status, 'done');
  assert.deepEqual([existsSync(join(r.dir, AGENT)), existsSync(join(r.dir, '.claude/agents/testing-reality-checker.md'))], [false, true]);
  assert.deepEqual(readState(r.dir).agentFiles, [other]);
});

test('undo commands: no scoped plugin forms (no plan writes them)', () => {
  assert.ok(undoable(['claude', 'plugin', 'uninstall', 'p@m']));
  assert.ok(!undoable(['claude', 'plugin', 'uninstall', 'p@m', '--scope', 'local']));
  assert.ok(!undoable(['claude', 'plugin', 'install', 'p@m', '--scope', 'project']));
});

test('CLI and server: skills sources shows the evidence, --agent-file is an answer, none clears', async () => {
  const r = repo();
  for (const argv of [['skills', 'sources'], ['skills', 'sources', 'list']]) {
    const x = sink();
    assert.equal(await main(argv, { out: x.out, ctx: r.ctx, input: Readable.from(['']) }), 0);
    assert.match(x.text(), /agency-agents\s+agents[^\n]* README: https:\/\/github\.com\/msitarzewski\/agency-agents\/blob\/[0-9a-f]{40}\/README\.md\n\s+--agent-file engineering\/engineering-frontend-developer\.md: A web UI is built or changed[^\n]* Source: https:\/\/github\.com\/msitarzewski\/agency-agents\/blob\/[0-9a-f]{40}\/engineering\/engineering-frontend-developer\.md\n/);
  }
  const t = sink();
  const code = await main(['projects', 'apply', r.dir, '--agents', 'claude', '--env', 'host', '--agent-file', FILE, '--yes'], { out: t.out, ctx: r.ctx, input: Readable.from(['']) });
  assert.equal(code, 0, t.text());
  assert.deepEqual(readState(r.dir).agentFiles, [FILE]);
  const u = sink();
  assert.equal(await main(['projects', 'apply', r.dir, '--agent-file', 'none', '--yes'], { out: u.out, ctx: r.ctx, input: Readable.from(['']) }), 0, u.text());
  assert.equal(readState(r.dir).agentFiles, undefined);
  assert.ok(!existsSync(join(r.dir, AGENT)));
  const routes = api({ ...r.ctx, run: (argv, o) => (argv.join(' ') === 'claude --version' ? { code: 0, stdout: '2.1.0 (Claude Code)', stderr: '' } : r.ctx.run(argv, o)) });
  routes['POST /api/projects']({ action: 'add', path: r.dir });
  const setup = routes['GET /api/project-setup'](new URLSearchParams([['dir', r.dir]]));
  assert.deepEqual([setup.frameworks, setup.sources.map((f) => f.id)], [undefined, ['agency-agents']]);
  const q = (extra) => new URLSearchParams([['dir', r.dir], ['setup', '1'], ['agents', 'claude'], ...extra]);
  const planned = routes['GET /api/project-plan'](q([['agent-file', FILE]]));
  assert.ok(planned.changes.some((c) => c.step === 'framework:agency-agents'));
  assert.ok(planned.warnings.some((w) => /^agency-agents: No outcome measurement/.test(w)));
  assert.throws(() => routes['GET /api/project-plan'](q([['agent-file', 'nope.md']])), (e) => e.status === 400);
});

test('a state file that still has frameworks (a 6.x setup): read and applied, the next write drops the key', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.benchkeeper'), { recursive: true });
  writeFileSync(join(r.dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 2, appVersion: '6.0.0', contentVersion: '6.0.0', agents: ['claude'], env: 'host', frameworks: ['old-owner'], agentFiles: [FILE] }));
  assert.deepEqual(frameworkSteps(plan(r, {})).map((c) => c.step), ['framework:agency-agents'], 'only the agent file is planned');
  assert.equal(run(r, {}).run.status, 'done');
  const written = JSON.parse(readFileSync(join(r.dir, '.benchkeeper/state.json'), 'utf8'));
  assert.deepEqual([written.frameworks, written.agentFiles], [undefined, [FILE]]);
});

const toml = (t) => ({ ...parseToml(t) });
const CODEX = '.codex/agents/engineering-frontend-developer.toml', COPILOT = '.github/agents/engineering-frontend-developer.agent.md';

test('Codex agent file: name, description and the Markdown body as TOML; text without front matter stays', () => {
  const md = '---\nname: "Frontend \\"Dev\\""\ndescription: Builds UIs \u{1F5A5}\ncolor: "#0077B6"\nemoji: \u{1F5A5}\n---\n\n# Body\nquotes " and \"\"\" and a back\\slash\n';
  assert.deepEqual(toml(codexAgent(md)), { name: 'Frontend "Dev"', description: 'Builds UIs \u{1F5A5}', developer_instructions: '\n# Body\nquotes " and \"\"\" and a back\\slash\n' });
  assert.equal(codexAgent(''), '');
  assert.equal(codexAgent('name = "x"\n'), 'name = "x"\n');
  assert.throws(() => codexAgent('---\nname: x\n---\nbody\n'), /no name or description/);
});

test('Codex and Copilot: a copy per chosen agent in its folder and format, second plan empty, a dropped agent loses only its copies, undo restores', () => {
  const r = repo();
  const p = run(r, { ...base, agents: ['claude', 'codex', 'copilot'], agentFiles: [FILE] });
  assert.equal(p.run.status, 'done');
  assert.deepEqual(r.calls.filter((c) => c.argv[0] === 'curl').map((c) => c.argv.at(-2)).sort(), [AGENT, CODEX, COPILOT].map((x) => join(r.dir, x)).sort());
  assert.deepEqual(toml(readFileSync(join(r.dir, CODEX), 'utf8')), { name: 'Frontend Developer', description: 'Builds web UIs', developer_instructions: `from ${r.calls[0].argv.at(-1)}\n` });
  assert.equal(readFileSync(join(r.dir, COPILOT), 'utf8'), `---\nname: Frontend Developer\ndescription: Builds web UIs\n---\nfrom ${r.calls[0].argv.at(-1)}\n`);
  const state = readState(r.dir);
  assert.deepEqual(state.agentOwned, [FILE, `codex:${FILE}`, `copilot:${FILE}`]);
  assert.deepEqual(Object.keys(state.agentHashes), state.agentOwned);
  const exclude = readFileSync(join(r.dir, '.git/info/exclude'), 'utf8');
  for (const x of [AGENT, CODEX, COPILOT]) assert.ok(exclude.includes(`/${x}`), x);
  assert.deepEqual(frameworkSteps(plan(r, {})), []);
  const drop = run(r, { agents: ['claude', 'copilot'] });
  assert.equal(drop.run.status, 'done');
  assert.deepEqual([AGENT, CODEX, COPILOT].map((x) => existsSync(join(r.dir, x))), [true, false, true]);
  assert.deepEqual(readState(r.dir).agentOwned, [FILE, `copilot:${FILE}`]);
  assert.equal(undo(drop.run.id, r.ctx).status, 'done');
  assert.equal(undo(p.run.id, r.ctx).status, 'done');
  assert.deepEqual([AGENT, CODEX, COPILOT].map((x) => existsSync(join(r.dir, x))), [false, false, false]);
});

test('Codex only: a file the project had in .codex/agents stays its own, and a failed conversion fails the step and records nothing', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.codex/agents'), { recursive: true });
  writeFileSync(join(r.dir, CODEX), 'name = "mine"\n');
  run(r, { ...base, agents: ['codex'], agentFiles: [FILE] });
  assert.equal(r.calls.filter((c) => c.argv[0] === 'curl').length, 0);
  assert.deepEqual(readState(r.dir).agentOwned, []);
  run(r, { agentFiles: [] });
  assert.equal(readFileSync(join(r.dir, CODEX), 'utf8'), 'name = "mine"\n');
  const s = repo();
  const bad = { ...s.ctx, run: (argv, o) => { if (argv[0] !== 'curl') return s.ctx.run(argv, o); mkdirSync(dirname(argv.at(-2)), { recursive: true }); writeFileSync(argv.at(-2), '---\nname: x\n---\nbody\n'); return { code: 0, stdout: '', stderr: '' }; } };
  const changes = preview(projectPlan({ ctx: bad, dir: s.dir, answers: { ...base, agents: ['codex'], agentFiles: [FILE] }, plugins: {} }).changes);
  const result = apply(changes, bad, { scope: s.dir, select: changes.filter((c) => c.selected).map((c) => c.id) });
  assert.equal(result.status, 'failed');
  assert.match(result.entries.find((e) => e.status === 'failed').error, /no name or description/);
  assert.deepEqual(readState(s.dir).agentOwned, []);
});
