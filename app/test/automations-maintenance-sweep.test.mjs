import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { fill, genericDir, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-ms-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'maintenance-sweep');
const cli = fileURLToPath(new URL('../bin/benchkeeper.mjs', import.meta.url));

// The precheck with a fixture knowledge base (entries by file name; null: none), a fake npx that runs this app's
// knowledge show on it and a fake gh that logs its arguments and prints the number of merged pull requests.
function precheck(values, knowledge, merged = 0) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-ms-bin-')), dir = join(bin, 'project');
  mkdirSync(join(dir, '.benchkeeper/knowledge'), { recursive: true });
  for (const [name, entries] of Object.entries(knowledge ?? {})) writeFileSync(join(dir, '.benchkeeper/knowledge', name), JSON.stringify({ entries }));
  writeFileSync(join(bin, 'npx'), `#!/bin/sh\necho "$@" >> '${bin}/log'\nshift 2\nexec '${process.execPath}' '${cli}' "$@" '${dir}'\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> '${bin}/log'\necho ${merged}\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, BENCHKEEPER_HOME: join(bin, 'home') };
  const r = spawnSync('sh', ['-c', fill(template(), values).precheck], { cwd: genericDir, env });
  let log = '';
  try { log = readFileSync(join(bin, 'log'), 'utf8'); } catch {}
  return { code: r.status, log: log.trim().split('\n').filter(Boolean) };
}

const base = {
  'verdicts.json': [{ id: 'cleanup:src/a.mjs:unusedFn', verdict: 'kept', date: '2026-09-01' }, { id: 'docs:README.md:install', verdict: 'open', date: '2026-10-02T08:00:00Z' }],
  'tests.json': [{ id: 'test/a.test.mjs', score: 81.4, date: '2026-08-15' }],
};

test('maintenance-sweep: parameters min_merged, max_prs and paths, report only by default', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['min_merged', 'max_prs', 'paths']);
  assert.deepEqual(fill(t).values, { mode: 'report', min_merged: '10', max_prs: '3', paths: '' });
});

test('maintenance-sweep: GitHub writes only in act mode, never a merge, and no write in the precheck', () => {
  const t = template();
  const [report, act] = t.prompt.split(/^4\. Mode act:/m);
  assert.ok(act, 'act mode is the last step');
  assert.match(report, /Mode report: stop here\. Write nothing but the knowledge base/);
  const helper = readFileSync(join(genericDir, 'maintenance-sweep/precheck.sh'), 'utf8');
  for (const text of [report, t.precheck, helper]) {
    assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review)\b|\bgh api\b|\bgit push\b/);
  }
  assert.match(act, /Merge nothing\./);
});

test('maintenance-sweep precheck: runs without a pass in the knowledge base, then after min_merged merged pull requests', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  const first = precheck({}, null);
  assert.deepEqual(first, { code: 0, log: ['-y benchkeeper@6 knowledge show --json'] }, 'no knowledge base: no gh call');
  const quiet = precheck({}, base, 4);
  assert.equal(quiet.code, 1);
  assert.equal(quiet.log[1], 'pr list --state merged --search merged:>=2026-10-02 --limit 10 --json number --jq length', 'the newest date of any file');
  assert.equal(precheck({}, base, 10).code, 0);
  assert.equal(precheck({ min_merged: 4 }, base, 4).code, 0);
  assert.deepEqual(precheck({ min_merged: 0 }, base).log.length, 1, '0: every scheduled run, no gh call');
  assert.equal(precheck({}, base, 'error').code, 1, 'a failing gh skips the run');
  assert.equal(precheck({ min_merged: 'ten' }, base).code, 2);
});

test('maintenance-sweep precheck: a date the knowledge base holds in another field or form never reaches gh', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  const odd = { 'verdicts.json': [{ id: 'x', reason: '"date": "2099-01-01', date: '26-10-02' }, { id: 'y', date: 'yesterday' }] };
  assert.deepEqual(precheck({}, odd).log.length, 1, 'no valid date: treated as no pass yet');
});
