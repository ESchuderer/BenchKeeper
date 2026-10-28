import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MIN_SAMPLES, findingKey, insights } from '../src/insights.mjs';
import { context } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { SNOOZE_DAYS, readTriage, setTriage, withTriage } from '../src/triage.mjs';

const ctx = () => context({ home: mkdtempSync(join(realpathSync(tmpdir()), 'bk-triage-')), run: () => ({ code: 1, stdout: '', stderr: '' }) });
const NOW = Date.parse('2026-10-28T10:00:00Z');
const DAY = 864e5;
const finding = (message = 'rules differ') => insights({ doctorFindings: [{ check: 'rules', level: 'warning', message, fix: 'benchkeeper apply', dir: '/work/shop' }] }).findings[0];
const project = (n, failed, folder = 'shop') => Array.from({ length: n }, (_, i) => ({ id: `${folder}-${i}`, agent: 'claude', skills: [], project: `/work/${folder}`, tests: i < failed ? 'fail' : 'pass', prs: [] }));

test('dismiss hides until the evidence changes, snooze until its date, reopen shows again', () => {
  const c = ctx(), f = finding(), key = findingKey(f);
  assert.deepEqual(withTriage([f], readTriage(c), NOW)[0].triage, null);
  assert.deepEqual(setTriage(c, key, 'dismiss', NOW), { key, triage: { state: 'dismissed' } });
  assert.deepEqual(withTriage([f], readTriage(c), NOW + 400 * DAY)[0].triage, { state: 'dismissed' }, 'no date ends a dismissal');
  assert.equal(setTriage(c, key, 'reopen', NOW).triage, null);
  assert.equal(withTriage([f], readTriage(c), NOW)[0].triage, null);
  const until = new Date(NOW + SNOOZE_DAYS * DAY).toISOString();
  assert.deepEqual(setTriage(c, key, 'snooze', NOW).triage, { state: 'snoozed', until });
  assert.deepEqual(withTriage([f], readTriage(c), NOW + 6 * DAY)[0].triage, { state: 'snoozed', until });
  assert.equal(withTriage([f], readTriage(c), NOW + 7 * DAY)[0].triage, null, 'the date ends the snooze');
});

test('changed evidence reopens a dismissed finding; the running counts do not', () => {
  const c = ctx();
  const before = insights({ sessions: project(MIN_SAMPLES, 3) }).findings[0];
  setTriage(c, findingKey(before), 'dismiss', NOW);
  // Two more passing sessions change the counts and the rate, not the failed sessions.
  const counts = insights({ sessions: [...project(MIN_SAMPLES, 3), ...project(2, 0, 'x').map((s, i) => ({ ...s, id: `p${i}`, project: '/work/shop' }))] }).findings[0];
  assert.notEqual(counts.evidence.sessions, before.evidence.sessions);
  assert.deepEqual(withTriage([counts], readTriage(c), NOW)[0].triage, { state: 'dismissed' });
  const failing = insights({ sessions: project(MIN_SAMPLES, 4) }).findings[0];
  assert.equal(withTriage([failing], readTriage(c), NOW)[0].triage, null, 'another failed session is new evidence');
  // A changed doctor finding has another id, so it shows too.
  setTriage(c, findingKey(finding()), 'dismiss', NOW);
  assert.equal(withTriage([finding('rules differ in 2 files')], readTriage(c), NOW)[0].triage, null);
  // Unused skills: the set of names decides, not the token count.
  const skills = (names, tokens) => insights({ sessions: Array.from({ length: MIN_SAMPLES }, (_, i) => ({ id: `s${i}`, agent: 'claude', skills: [] })), skills: names.map((name) => ({ name, scope: 'global', tokens })) }).findings[0];
  setTriage(c, findingKey(skills(['a'], 10)), 'snooze', NOW);
  assert.equal(withTriage([skills(['a'], 99)], readTriage(c), NOW)[0].triage?.state, 'snoozed');
  assert.equal(withTriage([skills(['a', 'b'], 10)], readTriage(c), NOW)[0].triage, null);
});

test('the file holds finding keys and dates only, readable by you; a new choice replaces the old key of the finding and drops a run-out snooze', () => {
  const c = ctx(), friction = insights({ sessions: project(MIN_SAMPLES, 2, 'secret-folder') }).findings[0], old = finding('old');
  setTriage(c, findingKey(old), 'snooze', NOW - 30 * DAY);
  setTriage(c, findingKey(friction), 'dismiss', NOW);
  setTriage(c, findingKey(friction), 'snooze', NOW);
  const file = join(c.config, 'insights-triage.json'), text = readFileSync(file, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['dismissed', 'schemaVersion', 'snoozed']);
  assert.deepEqual(JSON.parse(text).dismissed, {});
  assert.deepEqual(Object.keys(JSON.parse(text).snoozed), [findingKey(friction)], 'the old snooze ran out');
  for (const leak of ['secret-folder', 'shop-0', '/work']) assert.ok(!text.includes(leak), leak);
  for (const v of [...Object.values(JSON.parse(text).snoozed)]) assert.match(v, /^\d{4}-\d\d-\d\dT/);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('a missing, damaged or foreign state file reads as empty; bad input is refused', () => {
  const c = ctx(), none = { dismissed: {}, snoozed: {} };
  assert.deepEqual(readTriage(c), none);
  mkdirSync(c.config, { recursive: true });
  const file = join(c.config, 'insights-triage.json');
  writeFileSync(file, '{ not json');
  assert.deepEqual(readTriage(c), none);
  writeFileSync(file, JSON.stringify({ dismissed: { 'not a key': 'x', 'a:b@0123abcd': 'never', 'ok:1@0123abcd': '2026-10-28T10:00:00Z' }, snoozed: [1] }));
  assert.deepEqual(readTriage(c), { dismissed: { 'ok:1@0123abcd': '2026-10-28T10:00:00Z' }, snoozed: {} });
  assert.throws(() => setTriage(c, '../x', 'dismiss'), /finding key/);
  assert.throws(() => setTriage(c, undefined, 'dismiss'), /finding key/);
  assert.throws(() => setTriage(c, 'ok:1@0123abcd', 'delete'), /action must be/);
});

test('the key of unused skills does not depend on their order', () => {
  const skill = (scope) => ({ scope, name: 'lint', tokens: 10 });
  const keyOf = (skills) => findingKey({ id: 'unused-skills', evidence: { skills } });
  assert.equal(keyOf([skill('user'), skill('project')]), keyOf([skill('project'), skill('user')]));
});

test('GET /api/insights adds key and triage; POST /api/insights-triage sets it', async () => {
  let runs = 0;
  const c = ctx(), routes = api({ ...c, run: (...a) => { runs++; return c.run(...a); } });
  mkdirSync(join(c.home, '.claude'), { recursive: true });
  writeFileSync(join(c.home, '.claude/settings.json'), JSON.stringify({ env: { DO_NOT_TRACK: '1' } }));
  const first = await routes['GET /api/insights']();
  assert.ok(first.findings.length && first.findings.every((f) => /^.+@[0-9a-f]{8}$/.test(f.key) && f.triage === null));
  const { key } = first.findings[0];
  assert.deepEqual(routes['POST /api/insights-triage']({ key, action: 'dismiss' }), { key, triage: { state: 'dismissed' } });
  const before = runs, second = await routes['GET /api/insights']();
  assert.equal(runs, before, 'the triage click kept the cached scan');
  assert.deepEqual(second.findings.find((f) => f.key === key).triage, { state: 'dismissed' });
  assert.throws(() => routes['POST /api/insights-triage']({ key: 'x', action: 'dismiss' }), (e) => e.status === 400);
});
