import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { ownPacks, savePack } from '../src/packs.mjs';
import { exportProfile, readProfile } from '../src/profile.mjs';
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
  assert.deepEqual(entry, { path: proj, answers: { agents: ['claude'], env: 'host', sandbox: false, share: false, packs: ['ui'], singles: [], tier: 'quick', paths: {}, disabled: [] } });
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
