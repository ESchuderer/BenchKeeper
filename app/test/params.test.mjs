import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { context } from '../src/runner.mjs';
import { contentDir } from '../src/content.mjs';
import { FILES, RULES, format, load } from '../src/params.mjs';
import { addProject } from '../src/projects.mjs';
import { api } from '../src/server.mjs';
import { validate } from '../../plugins/benchkeeper/skills/orchestrating-projects/policy.mjs';
import { jobDone } from './fakes/job.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/params/policy/invalid/', import.meta.url));
const tmp = () => mkdtempSync(join(tmpdir(), 'bk-params-'));
const project = (files) => {
  const dir = tmp();
  for (const [f, body] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), body); }
  return dir;
};

for (const name of readdirSync(fixtures)) {
  test(`policy: ${name} is rejected for the rule it is named for`, () => {
    const rule = name.replace(/\.json$/, '');
    assert.ok(load('policy', readFileSync(join(fixtures, name), 'utf8')).errors.some((e) => e.rule === rule), `${name} lacks the rule ${rule}`);
  });
}

test('every rule has an invalid fixture', () => {
  const named = new Set(readdirSync(fixtures).map((n) => n.replace(/\.json$/, '')));
  assert.deepEqual(RULES.filter((r) => !named.has(r)), []);
  assert.deepEqual([...named].filter((r) => !RULES.includes(r)), []);
});

test('the coordinator\'s reader names the same rule and path as the editor for every invalid fixture', () => {
  const named = (errors) => errors.map((e) => [e.rule, e.path]);
  for (const name of readdirSync(fixtures)) {
    const text = readFileSync(join(fixtures, name), 'utf8');
    let doc;
    // Text that is not JSON never reaches the reader's validate.
    try { doc = JSON.parse(text); } catch { continue; }
    assert.deepEqual(named(validate(doc)), named(load('policy', text).errors), name);
  }
});

const PATH_LISTS = [['merge', 'ownerOnlyPaths'], ['merge', 'additivePaths'], ['review', 'sensitivePaths']];
const NO_PATHS = ['', '/x', '../x', 'x/..', 'a/*', 'a\\b', './x', 'x//y', 'x/./y', ' x', 'x ', 'x /y', '.', 'x\ny', 'x\0y'];
// One refused document per row, with the one rule and path that both the editor and the coordinator's reader name for it.
const REFUSED = [
  ...PATH_LISTS.flatMap(([group, list]) => NO_PATHS.map((path) => [{ [group]: { [list]: [path] } }, 'pattern', `${group}.${list}[0]`])),
  ...['owner/tracker/docs', 'owner/tra cker', 'owner/..', 'tracker'].map((repository) => [{ issues: { repository, labels: ['project-a'] } }, 'pattern', 'issues.repository']),
  [{ issues: { repository: 'owner/tracker', labels: [] } }, 'length', 'issues.labels'],
  [{ models: { phases: { review: { model: 'some-model-20260101' } } } }, 'enum', 'models.phases.review.model'],
  [{ review: { depth: 'max' } }, 'enum', 'review.depth'],
  [{ review: { sensitiveDepth: 'max' } }, 'enum', 'review.sensitiveDepth'],
  [{ minPlugin: '6.26' }, 'pattern', 'minPlugin'],
  [{ minPlugin: 'v6.26.0' }, 'pattern', 'minPlugin'],
  [{ issuesPerWorker: 0 }, 'range', 'issuesPerWorker'],
  [{ issuesPerWorker: 17 }, 'range', 'issuesPerWorker'],
  ...['', '--dangerously-skip-permissions', 'opus; id', 'opus fast', `o${'p'.repeat(128)}`].map((model) => [{ models: { worker: { model } } }, 'pattern', 'models.worker.model']),
  [{ later: true }, 'unknown-key', 'later'],
  [{ models: { phases: { plan: { modle: 'opus' } } } }, 'unknown-key', 'models.phases.plan.modle'],
];

test('each refused value is named with its rule and path, by the editor and by the coordinator\'s reader', () => {
  const named = (errors) => errors.map((e) => [e.rule, e.path]);
  for (const [doc, rule, path] of REFUSED) {
    const text = JSON.stringify(doc);
    assert.deepEqual(named(load('policy', text).errors), [[rule, path]], `editor: ${text}`);
    assert.deepEqual(named(validate(doc)), [[rule, path]], `reader: ${text}`);
  }
  // The longest name and the characters of a full model name stay allowed.
  for (const model of ['opus[1m]', 'vendor.family-4-5-v1:0', 'team/model@2026-01-01', 'p'.repeat(128)]) {
    assert.deepEqual(load('policy', JSON.stringify({ models: { worker: { model } } })).errors, [], model);
    assert.deepEqual(validate({ models: { worker: { model } } }), [], model);
  }
});

test('the shipped policy example passes, and so does a policy without schemaVersion', () => {
  const example = readFileSync(join(contentDir, 'skills/orchestrating-projects/policy.example.json'), 'utf8');
  assert.deepEqual(load('policy', example).errors, []);
  // A policy written before schemaVersion existed stays valid.
  assert.deepEqual(load('policy', '{"merge":{"allowed":false}}').errors, []);
});

test('errors name the path of a nested key and of an array item', () => {
  const { errors } = load('policy', JSON.stringify({ merge: { requiredChecks: ['ci', ''] }, trustedAuthors: [3], hostWorkerLimit: 65 }));
  assert.deepEqual(errors.map((e) => [e.rule, e.path]), [['type', 'trustedAuthors[0]'], ['range', 'hostWorkerLimit'], ['length', 'merge.requiredChecks[1]']]);
});

test('// comment keys pass at every level and survive a round trip', () => {
  const text = '{ "schemaVersion": 1, "//": "kept as written", "merge": { "//allowed": "owner only", "allowed": false } }';
  const { doc: first, errors } = load('policy', text);
  assert.deepEqual(errors, []);
  const second = load('policy', format(first)).doc;
  assert.deepEqual(second, first);
  assert.equal(format(second), format(first));
  assert.equal(first['//'], 'kept as written');
  assert.equal(first.merge['//allowed'], 'owner only');
});

test('the loader stays under 300 lines', () => {
  assert.ok(readFileSync(new URL('../src/params.mjs', import.meta.url), 'utf8').trimEnd().split('\n').length <= 300);
});

test('editor routes: absent while the preference editors is off; on, the policy with its errors, a live check, a plan applied and undone', async () => {
  const ctx = context({ home: tmp(), run: (argv) => (argv[1] === '--version' ? { code: 127, stdout: '' } : { code: 0, stdout: '' }) });
  const policy = '{\n  "schemaVersion": 1,\n  "// note": "kept",\n  "workersPerProject": 2\n}\n';
  const file = FILES.policy[0];
  const dir = project({ [file]: policy });
  addProject(ctx, dir);
  const routes = api(ctx);
  const status = (f) => { try { f(); } catch (e) { return e.status; } return 200; };
  const q = new URLSearchParams({ dir });
  assert.equal((await routes['GET /api/overview']()).editors, false);
  for (const f of [() => routes['GET /api/params'](q), () => routes['POST /api/params-check']({ dir, file, text: '{}' }), () => routes['POST /api/params-plan']({ dir, file, text: '{}' })]) assert.equal(status(f), 404);
  assert.throws(() => routes['POST /api/preferences']({ editors: 'yes' }), /true or false/);
  routes['POST /api/preferences']({ editors: true });
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.config, 'preferences.json'), 'utf8')), { editors: true, dismissed: [], schemaVersion: 1 });
  const files = routes['GET /api/params'](q);
  assert.deepEqual(files.map((f) => [f.file, f.text, f.errors]), [[file, policy, []]]);
  const empty = project({});
  addProject(ctx, empty);
  assert.deepEqual(routes['GET /api/params'](new URLSearchParams({ dir: empty })).map((f) => f.text), [null]);
  assert.throws(() => routes['GET /api/params'](new URLSearchParams({ dir: tmp() })), /register the project first/);
  assert.deepEqual(routes['POST /api/params-check']({ dir, file, text: '{' }).errors.map((e) => e.rule), ['bad-json']);
  assert.equal(status(() => routes['POST /api/params-check']({ dir, file: 'package.json', text: '{}' })), 400);
  assert.equal(status(() => routes['POST /api/params-check']({ dir, file, text: 3 })), 400);
  // Refused while the loader finds an error; a valid text is written as typed, its comment keys included.
  assert.throws(() => routes['POST /api/params-plan']({ dir, file, text: policy.replace('2', '"2"') }), /type at workersPerProject/);
  const next = policy.replace('2', '3');
  const plan = routes['POST /api/params-plan']({ dir, file, text: next });
  assert.deepEqual(plan.changes.map((c) => c.title), [`write ${file}`]);
  const job = routes['POST /api/apply']({ planId: plan.planId });
  const s = await jobDone(routes, job.job);
  assert.equal(readFileSync(join(dir, file), 'utf8'), next);
  routes['POST /api/undo']({ run: s.run.id });
  assert.equal(readFileSync(join(dir, file), 'utf8'), policy);
  routes['POST /api/preferences']({ editors: false });
  assert.equal(status(() => routes['GET /api/params'](q)), 404);
});

test('editor routes: a save is refused when the file changed after the plan, and the hand edit stays', async () => {
  const ctx = context({ home: tmp(), run: (argv) => (argv[1] === '--version' ? { code: 127, stdout: '' } : { code: 0, stdout: '' }) });
  const policy = '{\n  "schemaVersion": 1,\n  "// note": "mine"\n}\n';
  const file = FILES.policy[0];
  const dir = project({ [file]: policy });
  addProject(ctx, dir);
  const routes = api(ctx);
  routes['POST /api/preferences']({ editors: true });
  const plan = routes['POST /api/params-plan']({ dir, file, text: policy.replace('mine', 'from the editor') });
  const byHand = policy.replace('"mine"', '"mine",\n  "// added after the plan": "kept"');
  writeFileSync(join(dir, file), byHand);
  const s = await jobDone(routes, routes['POST /api/apply']({ planId: plan.planId }).job);
  assert.equal(s.run.status, 'failed');
  assert.match(s.run.entries[0].error, /changed since the plan/);
  assert.equal(readFileSync(join(dir, file), 'utf8'), byHand);
});
