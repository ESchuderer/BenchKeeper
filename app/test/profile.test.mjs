import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { ownPacks, savePack, scopeFile } from '../src/packs.mjs';
import { exportProfile, importPlan, readProfile } from '../src/profile.mjs';
import { addProject, listProjects } from '../src/projects.mjs';
import { apply, context, preview } from '../src/runner.mjs';
import { STATE, projectPlan, readState } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());

const tmp = (p) => mkdtempSync(join(TMP, p));
const machine = () => context({ home: tmp('bk-prof-'), run: (argv) => (argv[0] === 'npm' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' }) });

test('export holds choices only; import registers projects, saves packs, sets up projects without a state file, skips missing paths', async () => {
  const a = machine();
  savePack(a, { id: 'ui', skills: ['accessibility'] });
  const proj = tmp('bk-prof-proj-');
  const actx = { ...a, roots: [...a.roots, proj] };
  apply(preview(projectPlan({ ctx: actx, dir: proj, answers: { agents: ['claude'], env: 'host', packs: ['ui'], tier: 'quick' } }).changes), actx, { scope: proj });
  writeFileSync(join(proj, 'secret.txt'), 'TOKEN=abc\n');
  addProject(a, proj);
  const gone = tmp('bk-prof-gone-');
  addProject(a, gone);
  rmSync(gone, { recursive: true });
  const text = exportProfile(a, { agents: ['claude'], packs: [] });
  const p = readProfile(text);
  const { rules, ...entry } = p.projects[0];
  assert.deepEqual(rules.map((r) => [r.path, r.owner, r.state]), [['CLAUDE.local.md', 'BenchKeeper', 'always']]);
  assert.deepEqual(entry, { path: proj, answers: { agents: ['claude'], env: 'host', sandbox: false, share: false, packs: ['ui'], singles: [], tier: 'quick', paths: {}, disabled: [], guards: true } });
  assert.ok(!text.includes('TOKEN') && !text.includes('accessibility/SKILL'));

  // The other machine has the clone without the state file.
  rmSync(join(proj, '.benchkeeper'), { recursive: true });
  rmSync(join(proj, 'CLAUDE.local.md'));
  const b = machine();
  const file = join(tmp('bk-prof-file-'), 'profile.json');
  writeFileSync(file, text);
  let out = '';
  const w = new Writable({ write(c, _, done) { out += c; done(); } });
  assert.equal(await main(['profile', 'import', file, '--yes'], { out: w, ctx: b, input: Readable.from(['']) }), 0, out);
  assert.match(out, new RegExp(`skipped ${gone}: not on this machine`));
  assert.deepEqual(ownPacks(b).map((x) => x.id), ['ui']);
  assert.deepEqual(listProjects(b).map((x) => x.path), [proj]);
  assert.equal(readState(proj).tier, 'quick');
  assert.deepEqual(readState(proj).skills.map((s) => s.name), ['accessibility']);
  assert.match(readFileSync(join(proj, 'CLAUDE.local.md'), 'utf8'), /Default tier: quick/);
  assert.ok(existsSync(join(b.home, '.claude/rules/00-global.md')));
});

test('profile files are checked before anything is applied', () => {
  const base = { kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['claude'] } };
  assert.throws(() => readProfile('x'), /profile:/);
  assert.throws(() => readProfile(JSON.stringify({ ...base, kind: 'other' })), /not a BenchKeeper profile/);
  assert.throws(() => readProfile(JSON.stringify({ ...base, schemaVersion: 9 })), /schemaVersion 9/);
  assert.throws(() => readProfile(JSON.stringify({ ...base, projects: [{ path: 'rel/dir' }] })), /not absolute/);
  assert.throws(() => readProfile(JSON.stringify({ ...base, global: {} })), /agents missing/);
});

test('one answer stream serves several questions in one command', async () => {
  const b = machine();
  let out = '';
  const w = new Writable({ write(c, _, done) { out += c; done(); } });
  const file = join(tmp('bk-prof-file-'), 'p.json');
  writeFileSync(file, JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['claude'] } }));
  await main(['profile', 'import', file], { out: w, ctx: b, input: Readable.from(['y\n', 'n\n'.repeat(80)]) });
  assert.ok(existsSync(join(b.home, '.claude/rules/00-global.md')));
  assert.ok(!existsSync(join(b.home, '.claude/settings.json')) || !readFileSync(join(b.home, '.claude/settings.json'), 'utf8').includes('opusplan'));
});

test('a state file this app cannot read: export names the project, import skips it and goes on', async () => {
  for (const [text, reason] of [['{"schemaVersion": 99}', /schemaVersion 99, this benchkeeper reads up to/], ['{ damaged', /JSON/]]) {
    const a = machine();
    const bad = tmp('bk-prof-bad-'), good = tmp('bk-prof-good-');
    mkdirSync(join(bad, '.benchkeeper'));
    writeFileSync(join(bad, STATE), text);
    addProject(a, bad);
    addProject(a, good);
    const warned = [];
    const p = readProfile(exportProfile(a, { agents: ['claude'], packs: [], warn: (m) => warned.push(m) }));
    assert.equal(warned.length, 1);
    assert.ok(warned[0].includes(join(bad, STATE)) && reason.test(warned[0]), warned[0]);
    assert.ok(!('answers' in p.projects.find((x) => x.path === bad)));

    // The other machine has both folders, the unreadable state file included.
    p.projects.find((x) => x.path === bad).answers = { agents: ['claude'], env: 'host' };
    p.projects.find((x) => x.path === good).answers = { agents: ['claude'], env: 'host', tier: 'quick' };
    const b = machine();
    const file = join(tmp('bk-prof-file-'), 'profile.json');
    writeFileSync(file, JSON.stringify(p));
    let out = '';
    const w = new Writable({ write(c, _, done) { out += c; done(); } });
    assert.equal(await main(['profile', 'import', file, '--yes'], { out: w, ctx: b, input: Readable.from(['']) }), 0, out);
    assert.match(out, new RegExp(`skipped ${bad}: ${join(bad, STATE)}: .*${reason.source}`));
    assert.equal(readState(good).tier, 'quick');
    assert.equal(readFileSync(join(bad, STATE), 'utf8'), text);
    assert.ok(existsSync(join(b.home, '.claude/rules/00-global.md')));
  }
});

test('an own pack this library cannot take is skipped with its reason; the other packs, the projects and the plans go on', async () => {
  const proj = tmp('bk-prof-proj-');
  const text = JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['claude'], packs: [] },
    packs: [{ id: 'ui', skills: ['accessibility'] }, { id: 'newer', skills: ['accessibility', 'not-a-skill'] }],
    projects: [{ path: proj, answers: { agents: ['claude'], env: 'host', packs: ['ui'], tier: 'quick' } }] });
  const b = machine();
  const file = join(tmp('bk-prof-file-'), 'profile.json');
  writeFileSync(file, text);
  let out = '';
  const w = new Writable({ write(c, _, done) { out += c; done(); } });
  assert.equal(await main(['profile', 'import', file, '--yes'], { out: w, ctx: b, input: Readable.from(['']) }), 0, out);
  assert.match(out, /skipped pack newer: not in the library: not-a-skill/);
  assert.deepEqual(ownPacks(b).map((x) => x.id), ['ui']);
  assert.deepEqual(listProjects(b).map((x) => x.path), [proj]);
  assert.equal(readState(proj).tier, 'quick');
  assert.ok(existsSync(join(b.home, '.claude/rules/00-global.md')));
});

test('a round trip keeps guards, agent files and the pack scopes; an agent file this catalog does not know is dropped', async () => {
  const a = machine();
  savePack(a, { id: 'ui', skills: ['accessibility'] });
  mkdirSync(a.config, { recursive: true });
  writeFileSync(scopeFile(a), JSON.stringify({ schemaVersion: 1, scopes: { ui: 'global', 'matt-pocock': 'projects' } }));
  const proj = tmp('bk-prof-proj-');
  const actx = { ...a, roots: [...a.roots, proj] };
  apply(preview(projectPlan({ ctx: actx, dir: proj, answers: { agents: ['claude'], env: 'host', tier: 'quick', guards: false } }).changes), actx, { scope: proj });
  const file = 'engineering/engineering-frontend-developer.md';
  writeFileSync(join(proj, STATE), JSON.stringify({ ...readState(proj), agentFiles: [file, 'newer/unknown.md'] }));
  addProject(a, proj);
  const p = readProfile(exportProfile(a, { agents: ['claude'], packs: [] }));
  assert.deepEqual(p.global.scopes, { ui: 'global', 'matt-pocock': 'projects' });
  assert.deepEqual(p.global.packs, ['ui']);
  assert.ok(p.projects[0].answers.guards === false && p.projects[0].answers.agentFiles.length === 2);

  rmSync(join(proj, '.benchkeeper'), { recursive: true });
  const b = machine();
  const at = join(tmp('bk-prof-file-'), 'profile.json');
  writeFileSync(at, JSON.stringify(p));
  let out = '';
  const w = new Writable({ write(c, _, done) { out += c; done(); } });
  assert.equal(await main(['profile', 'import', at, '--yes'], { out: w, ctx: b, input: Readable.from(['']) }), 0, out);
  assert.deepEqual(JSON.parse(readFileSync(scopeFile(b), 'utf8')).scopes, p.global.scopes);
  assert.deepEqual(readState(proj).guards, false);
  assert.deepEqual(readState(proj).agentFiles, [file]);
  assert.match(out, /pack ui: all projects/);
});

test('an import project plan keeps its skills when it is applied before the scope change, or that change is declined', () => {
  const b = machine();
  savePack(b, { id: 'ui', skills: ['accessibility'] });
  const proj = tmp('bk-prof-proj-');
  const p = { global: { agents: ['claude'], scopes: { ui: 'global' } }, projects: [{ path: proj, answers: { agents: ['claude'], env: 'host', packs: ['ui'], singles: [], tier: 'quick' } }] };
  const [x] = importPlan(b, p).projects;
  assert.ok(x.changes.some((c) => c.title.includes('accessibility')));
  apply(x.changes, x.ctx, { scope: x.path });
  assert.deepEqual(readState(proj).skills.map((s) => s.name), ['accessibility']);
  assert.ok(!existsSync(scopeFile(b)));

  // Global here and in the profile: the project gets no copies.
  mkdirSync(b.config, { recursive: true });
  writeFileSync(scopeFile(b), JSON.stringify({ schemaVersion: 1, scopes: { ui: 'global' } }));
  const other = tmp('bk-prof-proj-');
  const [y] = importPlan(b, { ...p, projects: [{ ...p.projects[0], path: other }] }).projects;
  assert.ok(!y.changes.some((c) => c.title.includes('accessibility')));
});

test('a pack moved to all projects: its global installs and its scope write are applied together or not at all', () => {
  const b = machine();
  savePack(b, { id: 'ui', skills: ['accessibility'] });
  const { global } = importPlan(b, { global: { agents: ['claude'], scopes: { ui: 'global' } } });
  const scope = global.find((c) => c.id === 'scope:ui');
  const installs = global.filter((c) => c.step === 'pack:ui');
  assert.ok(scope.unit && installs.length && installs.every((c) => c.unit === scope.unit));
  const runs = [];
  const ctx = { ...b, run: (argv) => { runs.push(argv); return b.run(argv); } };
  assert.throws(() => apply(global, ctx, { scope: 'global', select: global.filter((c) => c !== scope).map((c) => c.id) }), /go together/);
  assert.ok(!runs.some((argv) => argv.includes('accessibility')));
  assert.ok(!existsSync(scopeFile(b)));
});

test('a profile scope must be one of the pack scopes', () => {
  const base = { kind: 'benchkeeper-profile', schemaVersion: 1 };
  assert.throws(() => readProfile(JSON.stringify({ ...base, global: { agents: ['claude'], scopes: { ui: 'everywhere' } } })), /scope of pack ui must be one of global, projects/);
});
