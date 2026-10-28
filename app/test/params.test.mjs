import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { contentDir } from '../src/content.mjs';
import { doctor } from '../src/doctor.mjs';
import { FILES, RULES, SCHEMA_VERSION, format, load, loadFiles, paramChecks, resolvePins } from '../src/params.mjs';
import { context } from '../src/runner.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/params/', import.meta.url));
const text = (...p) => readFileSync(join(fixtures, ...p), 'utf8');
const tmp = () => mkdtempSync(join(tmpdir(), 'bk-params-'));
const project = (files) => {
  const dir = tmp();
  for (const [f, body] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), typeof body === 'string' ? body : JSON.stringify(body)); }
  return dir;
};
const pins = (phases) => ({ schemaVersion: 1, phases });
const stub = (installed, models = {}) => context({ home: tmp(), run: (argv) => (argv[1] === '--version' ? { code: installed.includes(argv[0]) ? 0 : 127, stdout: '1.0.0' } : { code: 0, stdout: models[argv[0]] ?? '' }) });

for (const family of ['pins', 'preset', 'policy']) {
  for (const name of readdirSync(join(fixtures, family, 'invalid'))) {
    test(`${family}: ${name} is rejected for the rule it is named for`, () => {
      const rule = name.replace(/\.json$/, '');
      assert.ok(load(family, text(family, 'invalid', name)).errors.some((e) => e.rule === rule), `${family}/${name} lacks the rule ${rule}`);
    });
  }
}

test('every rule has an invalid fixture', () => {
  const named = new Set(['pins', 'preset', 'policy'].flatMap((f) => readdirSync(join(fixtures, f, 'invalid')).map((n) => n.replace(/\.json$/, ''))));
  assert.deepEqual(RULES.filter((r) => !named.has(r)), []);
  assert.deepEqual([...named].filter((r) => !RULES.includes(r)), []);
});

test('valid files, including the shipped policy example, pass', () => {
  assert.deepEqual(load('pins', text('valid', 'pins.json')).errors, []);
  assert.deepEqual(load('preset', text('valid', 'preset.json')).errors, []);
  const example = readFileSync(join(contentDir, 'skills/orchestrating-projects/policy.example.json'), 'utf8');
  assert.deepEqual(load('policy', example).errors, []);
  // A policy written before schemaVersion existed stays valid.
  assert.deepEqual(load('policy', '{"merge":{"allowed":false}}').errors, []);
});

test('unknown keys and // comment keys survive a round trip', () => {
  for (const [family, name] of [['pins', 'pins.json'], ['preset', 'preset.json']]) {
    const first = load(family, text('valid', name)).doc;
    const second = load(family, format(first)).doc;
    assert.deepEqual(second, first);
    assert.equal(format(second), format(first));
  }
  const doc = load('pins', text('valid', 'pins.json')).doc;
  assert.equal(doc['//'], 'kept as written');
  assert.deepEqual(doc.futureKey, { any: ['thing'] });
  assert.equal(doc.phases['//review'], 'another agent reviews');
  assert.equal(doc.phases.implement.note, 'unknown keys survive');
});

test('the loader stays under 300 lines and the schemas share one schemaVersion', () => {
  assert.ok(readFileSync(new URL('../src/params.mjs', import.meta.url), 'utf8').trimEnd().split('\n').length <= 300);
  for (const f of ['pins', 'preset', 'policy']) assert.equal(SCHEMA_VERSION(f), 1);
  // Tied to the content contract once the content file exists.
  const content = join(contentDir, 'content.json');
  if (existsSync(content)) for (const f of ['pins', 'preset', 'policy']) assert.equal(SCHEMA_VERSION(f), JSON.parse(readFileSync(content, 'utf8')).schemaVersion);
});

test('pins: the personal file replaces a phase of the team file as a whole, default omits, the rest is the session', () => {
  const dir = project({
    '.benchkeeper/pins.json': pins({ implement: { agent: 'claude', model: 'm-team', effort: 'high' }, review: { agent: 'codex', model: 'm-rev' } }),
    '.benchkeeper/pins.local.json': pins({ implement: { agent: 'codex', model: 'default' }, verify: { agent: 'default' } }),
  });
  const { pins: got, errors } = resolvePins(dir);
  assert.deepEqual(errors, []);
  assert.deepEqual(got.map((p) => [p.phase, p.agent, p.model, p.effort, p.source]), [
    ['research', null, null, null, 'session'],
    ['implement', 'codex', null, null, '.benchkeeper/pins.local.json'],
    ['review', 'codex', 'm-rev', null, '.benchkeeper/pins.json'],
    ['verify', null, null, null, '.benchkeeper/pins.local.json'],
  ]);
});

test('without a file nothing changes: every phase is the session, doctor adds nothing', async () => {
  const dir = project({ '.benchkeeper/state.json': '{}' });
  const { pins: got, errors } = resolvePins(dir);
  assert.deepEqual(errors, []);
  assert.ok(got.every((p) => p.agent === null && p.source === 'session'));
  assert.deepEqual(paramChecks(stub([]), dir), []);
  assert.deepEqual(doctor(stub([]), { agents: ['claude'], dir }).filter((i) => ['params', 'pins'].includes(i.check)), []);
  let out = '';
  assert.equal(await main(['pins', 'list', dir], { out: new Writable({ write(c, _, d) { out += c; d(); } }), ctx: stub([]) }), 0);
  assert.match(out, /^research +session +default +default +session$/m);
});

test('pins list refuses an invalid file with the rule and the file', async () => {
  const dir = project({ '.benchkeeper/pins.local.json': text('pins', 'invalid', 'effort-without-model.json') });
  let out = '';
  assert.equal(await main(['pins', 'list', dir], { out: new Writable({ write(c, _, d) { out += c; d(); } }), ctx: stub([]) }), 1);
  assert.match(out, /pins\.local\.json: effort-without-model at phases\.review\.effort/);
  let bad = '';
  assert.equal(await main(['pins', 'sync'], { out: new Writable({ write(c, _, d) { bad += c; d(); } }), ctx: stub([]) }), 2);
});

test('doctor: an invalid file is an error; a pin to an agent that is not installed is a warning', () => {
  const dir = project({ '.benchkeeper/pins.json': pins({ review: { agent: 'codex' }, implement: { agent: 'claude' } }), 'docs/agents/orchestration.json': text('policy', 'invalid', 'type.json') });
  const found = paramChecks(stub(['claude']), dir);
  assert.deepEqual(found.map((i) => [i.level, i.check]), [['error', 'params'], ['warning', 'pins']]);
  assert.match(found[0].message, /docs\/agents\/orchestration\.json: type at workersPerProject/);
  assert.match(found[1].message, /names codex, which is not installed/);
  assert.ok(doctor(stub(['claude']), { agents: ['claude'], dir }).some((i) => i.check === 'params' && i.level === 'error'));
});

test('doctor: a model the agent does not list is a warning, only for agents that can list models', () => {
  const dir = project({ '.benchkeeper/pins.json': pins({ review: { agent: 'codex', model: 'gone-1' }, implement: { agent: 'claude', model: 'whatever' } }) });
  const reg = [{ id: 'codex', name: 'Codex', bin: 'codex', modelsCommand: ['codex', 'models'] }, { id: 'claude', name: 'Claude Code', bin: 'claude' }];
  const found = paramChecks(stub(['codex', 'claude'], { codex: 'here-1  current\nhere-2\n' }), dir, reg);
  assert.deepEqual(found.map((i) => i.check), ['pins']);
  assert.match(found[0].message, /review pin names model gone-1, which Codex does not list/);
  assert.deepEqual(paramChecks(stub(['codex', 'claude'], { codex: 'gone-1\n' }), dir, reg), []);
});

test('doctor: the personal pins file must be ignored by git', () => {
  const dir = project({ '.benchkeeper/pins.local.json': pins({ review: { agent: 'claude' } }) });
  execFileSync('git', ['init', '-q', dir]);
  const real = context({ home: tmp() });
  assert.match(paramChecks({ ...real, run: (argv) => (argv[0] === 'git' ? real.run(argv) : { code: 0, stdout: '' }) }, dir)[0].message, /pins\.local\.json is not ignored by git/);
  writeFileSync(join(dir, '.git/info/exclude'), '/.benchkeeper/pins.local.json\n');
  assert.deepEqual(paramChecks({ ...real, run: (argv) => (argv[0] === 'git' ? real.run(argv) : { code: 0, stdout: '' }) }, dir), []);
});

test('files are found under the paths the schema families name', () => {
  const dir = project(Object.fromEntries(Object.values(FILES).flat().map((f) => [f, '{}'])));
  assert.deepEqual(Object.keys(FILES).map((f) => loadFiles(dir, f).length), [2, 1, 1]);
});

test('doctor checks a project that has only the orchestrator policy', () => {
  const dir = project({ 'docs/agents/orchestration.json': text('policy', 'invalid', 'type.json') });
  assert.ok(doctor(stub([]), { agents: ['claude'], dir }).some((i) => i.check === 'params' && /orchestration\.json: type/.test(i.message)));
});

test('a preset list with several null entries is validated without throwing', () => {
  const { errors } = load('preset', JSON.stringify({ schemaVersion: 1, presets: [null, null] }));
  assert.ok(errors.length > 0 && errors.every((e) => e.rule !== 'duplicate-preset'));
});

test('an unreadable pin file is an error, not the session defaults', async () => {
  const dir = project({});
  mkdirSync(join(dir, '.benchkeeper/pins.json'), { recursive: true });
  assert.deepEqual(paramChecks(stub([]), dir).map((i) => [i.level, i.check, i.message]), [['error', 'params', '.benchkeeper/pins.json: unreadable: cannot be read']]);
  let out = '';
  assert.equal(await main(['pins', 'list', dir], { out: new Writable({ write(c, _, d) { out += c; d(); } }), ctx: stub([]) }), 1);
  assert.match(out, /pins\.json: unreadable/);
});

test('pins list rejects a folder that does not exist', async () => {
  let out = '';
  assert.equal(await main(['pins', 'list', join(tmp(), 'missing')], { out: new Writable({ write(c, _, d) { out += c; d(); } }), ctx: stub([]) }), 2);
  assert.match(out, /is not a folder/);
});
