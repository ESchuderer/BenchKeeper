import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir } from '../src/automations.mjs';
import { automationTemplate, initRepo } from './helpers.mjs';

const template = () => automationTemplate('daily-digest');

// The precheck in the template folder with a fake gh on PATH that logs its arguments and prints the number of changed
// items its list reports (pr and issue answers by repository).
function precheck(values, answers = {}, digestAge = null) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-dd-bin-'));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> '${bin}/log'\ncase "$*" in\n${Object.entries(answers).map(([k, n]) => `  *"${k}"*) echo ${n} ;;\n`).join('')}  *) echo 0 ;;\nesac\n`, { mode: 0o755 });
  const file = join(bin, 'digest.md');
  if (digestAge != null) {
    writeFileSync(file, 'old digest\n');
    const t = Date.now() / 1000 - digestAge;
    utimesSync(file, t, t);
  }
  const r = spawnSync('sh', ['-c', fill(template(), { file, ...values }).precheck], { cwd: genericDir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  let log = '';
  try { log = readFileSync(join(bin, 'log'), 'utf8'); } catch {}
  return { code: r.status, log: log.trim().split('\n').filter(Boolean) };
}

test('daily-digest: the precheck writes nothing to GitHub', () => {
  const helper = readFileSync(join(genericDir, 'daily-digest/precheck.sh'), 'utf8');
  assert.doesNotMatch(helper, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review|lock|delete)\b|\bgh api\b|\bgit\b[^\n]*\bpush\b|\bgh (label|release|repo|secret|variable|workflow) /);
  assert.doesNotMatch(helper, /--method|-X /);
});

test('daily-digest precheck: a committed, unchanged digest starts at its commit author time, not its mtime', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-dd-repo-'));
  const git = initRepo(dir);
  const file = join(dir, 'digest.md');
  writeFileSync(file, 'digest\n');
  git('add', 'digest.md');
  git('commit', '-qm', 'digest', '--date=2020-01-02T03:04:05Z');
  const r = precheck({ file });
  assert.equal(r.code, 1);
  assert.match(r.log[0], / --search updated:>=2020-01-02T03:04:05Z /);
});

test('daily-digest precheck: runs without a digest, then only when a pull request or an issue changed since it', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  assert.deepEqual(precheck({}), { code: 0, log: [] }, 'no digest yet: no gh call');
  const quiet = precheck({ repos: 'o/a,o/b' }, {}, 3600);
  assert.equal(quiet.code, 1);
  assert.equal(quiet.log.length, 4, 'pr and issue per repository');
  assert.match(quiet.log[0], /^pr list --repo o\/a --state all --search updated:>=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ --json number --jq length$/);
  const own = precheck({ issue: '12' }, {}, 3600);
  assert.match(own.log[1], /^issue list --state all --search \S+ --json number --jq map\(select\(\.number \| tostring != "12"\)\) \| length$/, 'the digest issue does not start the next run');
  assert.match(precheck({ repos: 'o/b', issue: '12' }, {}, 3600).log[1], /^issue list --repo o\/b .* --jq length$/, 'issue 12 of another repository still counts');
  assert.match(quiet.log[3], /^issue list --repo o\/b /);
  assert.equal(precheck({ repos: 'o/a,o/b' }, { 'issue list --repo o/b': 2 }, 3600).code, 0);
  const here = precheck({}, { 'pr list --state': 1 }, 3600);
  assert.deepEqual([here.code, here.log.length], [0, 1], 'empty repos: the checkout repository, no --repo');
  assert.equal(precheck({}, { 'pr list': 'error' }, 3600).code, 1, 'a failing gh skips the run');
});
