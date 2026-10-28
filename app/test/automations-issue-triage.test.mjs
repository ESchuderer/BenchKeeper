import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, lint, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-it-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'issue-triage');
const sh = { skip: process.platform === 'win32' && 'sh helpers' };
// The label that approves agent work (the default triage labels of the setup).
const APPROVE = 'ready-for-agent';

// An issue as gh issue list prints it through the helper's --jq: number, author and its labels, tab separated.
const issue = (number, author, ...labels) => `${number}\t${author}\t${labels.join(',')}`;

// A fake gh on PATH that logs its arguments. issues: open issues per repository. repo view answers o/here, api user me.
function fake(issues = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-it-bin-'));
  for (const [r, l] of Object.entries(issues)) writeFileSync(join(bin, `issues-${r.replace('/', '_')}`), l.map((x) => `${x}\n`).join(''));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$@" >> '${bin}/log'
case "$1 $2" in
  "repo view") echo o/here ;;
  "api user") echo me ;;
  "issue list") cat '${bin}'/issues-"$(echo "$4" | tr / _)" 2>/dev/null || true ;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const run = (cmd, args = []) => {
    writeFileSync(join(bin, 'log'), '');
    const r = spawnSync('sh', ['-c', cmd, 'sh', ...args], { cwd: genericDir, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), log: readFileSync(join(bin, 'log'), 'utf8').trim().split('\n').filter(Boolean) };
  };
  return {
    precheck: (values = {}) => run(fill(template(), values).precheck),
    list: (repos, labels, trusted = '') => run('issue-triage/list.sh "$@"', [repos, labels, trusted]),
  };
}

test('issue-triage: parameters repos, labels and trusted_authors, report only by default, lint passes', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['repos', 'labels', 'trusted_authors']);
  assert.deepEqual(fill(t).values, { mode: 'report', repos: '', labels: 'bug,enhancement,documentation,question', trusted_authors: '' });
  assert.deepEqual(lint(t), []);
});

test('issue-triage: the approving label is never named as a label to set, no close, no write in report mode', sh, () => {
  const t = template();
  const helpers = ['precheck.sh', 'list.sh'].map((f) => readFileSync(join(genericDir, 'issue-triage', f), 'utf8'));
  for (const text of [t.prompt, t.precheck, t.parameters.labels.default, ...helpers]) assert.ok(!text.includes(APPROVE), text);
  assert.match(t.prompt, /^Never set a label that approves agent work/m);
  const [report, act] = t.prompt.split(/^5\. Mode act:/m);
  assert.ok(act, 'act mode follows report mode');
  assert.match(report, /Write nothing to GitHub\./);
  assert.doesNotMatch(report, /\bgh (issue|pr) (create|comment|edit|close|reopen|lock|transfer|delete)\b/);
  assert.doesNotMatch(t.prompt, /--remove-label|gh issue (close|reopen|lock|transfer|delete)\b/);
  for (const text of [t.precheck, ...helpers]) assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review|lock)\b|--method|-X |\bgit push\b/);
});

test('issue-triage precheck: runs for an open issue without a triage label, skips otherwise', sh, () => {
  const labels = 'bug,enhancement';
  const run = fake({ 'o/a': [issue(1, 'someone')] }).precheck({ repos: 'o/a', labels });
  assert.equal(run.code, 0);
  assert.match(run.log[1], /^issue list --repo o\/a --state open --limit 100 --json number,author,labels --jq /);
  assert.equal(fake({ 'o/a': [issue(2, 'someone', 'bug')] }).precheck({ repos: 'o/a', labels }).code, 1, 'already triaged');
  assert.equal(fake({}).precheck({ repos: 'o/a', labels }).code, 1, 'no open issue');
  const here = fake({ 'o/here': [issue(3, 'me', 'needs-triage')] }).precheck({});
  assert.deepEqual([here.code, here.log[0]], [0, 'repo view --json nameWithOwner --jq .nameWithOwner'], 'empty: the checkout repository');
});

test('issue-triage list: an issue is trusted only when its author is on the list, labels with spaces count', sh, () => {
  const f = fake({ 'o/a': [issue(1, 'me'), issue(2, 'stranger', 'needs-triage'), issue(3, 'friend', 'good first issue'), issue(4, 'friend', 'area: ui', 'bug')] });
  assert.deepEqual(f.list('o/a', 'bug,good first issue').out, ['issue o/a 1 trusted', 'issue o/a 2 untrusted'], 'empty list: this account');
  const named = f.list('o/a', 'bug', 'friend');
  assert.deepEqual(named.out, ['issue o/a 1 untrusted', 'issue o/a 2 untrusted', 'issue o/a 3 trusted']);
  assert.ok(!named.log.some((l) => l.startsWith('api user')), 'a given list needs no login');
  for (const line of named.log) assert.match(line, /^issue list /, `read only: ${line}`);
});

test('issue-triage list: a hostile repository name never reaches gh', sh, () => {
  const r = fake({ 'o/a': [issue(1, 'me')] }).list('../x,o/..,-x/y,o/b;id,o/a', 'bug');
  assert.deepEqual(r.out, ['issue o/a 1 trusted']);
  assert.ok(r.log.every((l) => !/\.\.|;id|-x\/y/.test(l)), r.log.join('\n'));
});
