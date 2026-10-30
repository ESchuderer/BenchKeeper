import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, lint } from '../src/automations.mjs';
import { automationTemplate } from './helpers.mjs';

const template = () => automationTemplate('ci-audit');
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).stdout.trim();

// A repository with one commit; commit() adds files and returns the new HEAD.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'bk-ca-repo-'));
  git(dir, 'init', '-q');
  const commit = (files) => {
    for (const [f, body] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), body); }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'c');
    return git(dir, 'rev-parse', 'HEAD');
  };
  return { dir, commit };
}

const precheck = (dir, file) => spawnSync('sh', ['-c', `'${join(genericDir, 'ci-audit/precheck.sh')}' "$0"`, file], { cwd: dir }).status;

test('ci-audit: parameters file and max_prs, report only by default, file required, lints clean', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['file', 'max_prs']);
  assert.deepEqual(fill(t, { file: 'audit.md' }).values, { mode: 'report', file: 'audit.md', max_prs: '3' });
  assert.throws(() => fill(t), /file/);
  assert.deepEqual(lint(t), []);
  assert.match(t.schedule, /^\S+ \S+ \d+ \* \*$/, 'monthly');
});

test('ci-audit: GitHub writes only in act mode, never a merge or a loosened check, and no write in the precheck', () => {
  const t = template();
  const [report, act] = t.prompt.split(/^4\. Mode act:/m);
  assert.ok(act, 'act mode is the last step');
  assert.match(report, /Mode report: stop here .*Write nothing else/s);
  assert.match(report, /Never lower a threshold or a coverage floor, raise a budget, remove a check or add a suppression/);
  const helper = readFileSync(join(genericDir, 'ci-audit/precheck.sh'), 'utf8');
  for (const text of [report, t.precheck, helper]) {
    assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review)\b|\bgh api\b|\bgit push\b/);
  }
  assert.doesNotMatch(helper, /\bgh\b|>[ \t]*(?!\/dev\/null)\S|\brm\b|\bgit (add|commit|checkout|reset)\b/);
  assert.match(act, /Merge nothing\./);
});

test('ci-audit precheck: runs without a report, then only when a workflow or dependency file changed since its commit', { skip: process.platform === 'win32' && 'sh precheck' }, () => {
  const { dir, commit } = repo();
  const first = commit({ 'src/a.mjs': 'a\n', 'README.md': 'x\n' });
  const report = join(dir, '..', `${dir.split('/').pop()}-audit.md`);
  assert.equal(precheck(dir, report), 0, 'no report yet');
  writeFileSync(report, 'no commit line\n');
  assert.equal(precheck(dir, report), 0, 'a report without a commit line');
  writeFileSync(report, `Commit: ${'f'.repeat(40)}\n`);
  assert.equal(precheck(dir, report), 0, 'a commit the checkout does not have');
  writeFileSync(report, `Commit: ${first}\n# Audit\n`);
  assert.equal(precheck(dir, report), 1, 'nothing changed');
  commit({ 'src/a.mjs': 'b\n', 'README.md': 'y\n', 'docs/package.json.md': 'z\n' });
  assert.equal(precheck(dir, report), 1, 'source and prose changes only');
  const steps = commit({ '.github/workflows/ci.yml': 'on: push\n' });
  assert.equal(precheck(dir, report), 0, 'a workflow changed');
  writeFileSync(report, `Commit: ${steps}\n`);
  assert.equal(precheck(dir, report), 1);
  commit({ 'app/package-lock.json': '{}\n' });
  assert.equal(precheck(dir, report), 0, 'a lock file in a subfolder changed');
});
