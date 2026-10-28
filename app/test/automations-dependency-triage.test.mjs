import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, lint, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-dt-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'dependency-triage');
const sh = { skip: process.platform === 'win32' && 'sh helpers' };

// A pull request as gh pr list prints it through the helper's --jq: number, author and the login of each commit author.
const pr = (number, author, ...commits) => `${number} ${author} ${commits.join(' ')}`;

// A fake gh on PATH that logs its arguments. pulls: open pull requests per repository; alerts: alert numbers per
// repository, a repository without an entry answers 403; owners: the repositories per account. repo view answers
// o/here, api user me.
function fake({ pulls = {}, alerts = {}, owners = {} } = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-dt-bin-'));
  const file = (kind, key, lines) => writeFileSync(join(bin, `${kind}-${key.replace('/', '_')}`), lines.map((l) => `${l}\n`).join(''));
  for (const [r, l] of Object.entries(pulls)) file('pulls', r, l);
  for (const [r, l] of Object.entries(alerts)) file('alerts', r, l);
  for (const [o, l] of Object.entries(owners)) file('owners', o, l);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$@" >> '${bin}/log'
case "$1 $2" in
  "repo view") echo o/here ;;
  "repo list") cat '${bin}'/owners-"$3" 2>/dev/null || true ;;
  "api user") echo me ;;
  "pr list") cat '${bin}'/pulls-"$(echo "$4" | tr / _)" 2>/dev/null || true ;;
  api*) cat '${bin}'/alerts-"$(echo "$2" | cut -d / -f 2,3 | tr / _)" 2>/dev/null || { echo 'HTTP 403' >&2; exit 1; } ;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(bin, 'state') };
  const log = () => {
    try { return readFileSync(join(bin, 'log'), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
  };
  const run = (cmd, args = []) => {
    writeFileSync(join(bin, 'log'), '');
    const r = spawnSync('sh', ['-c', cmd, 'sh', ...args], { cwd: genericDir, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), log: log() };
  };
  return {
    precheck: (values = {}) => run(fill(template(), values).precheck),
    list: (owners, repos, ...rest) => run('dependency-triage/list.sh "$@"', [owners, repos, ...rest]),
  };
}

test('dependency-triage: parameters owners, repos and max_workers, report only by default, lint passes', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['owners', 'repos', 'max_workers']);
  assert.deepEqual(fill(t).values, { mode: 'report', owners: '', repos: '', max_workers: '2' });
  assert.deepEqual(lint(t), []);
});

test('dependency-triage: no GitHub write in the helpers or the report part of the prompt', sh, () => {
  const t = template();
  const [report, act] = t.prompt.split(/^5\. Mode act:/m);
  assert.ok(act, 'act mode is the last step but one');
  assert.match(report, /Mode report: stop here\. Answer with the sorted list .* Write nothing/);
  assert.match(act, /Merge nothing\./);
  const helpers = ['precheck.sh', 'list.sh'].map((f) => readFileSync(join(genericDir, 'dependency-triage', f), 'utf8'));
  for (const text of [t.precheck, ...helpers]) assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review)\b|--method|-X |\bgit push\b/);
});

test('dependency-triage precheck: runs for an open bot pull request or an alert, skips otherwise', sh, () => {
  const repos = { 'o/a': [pr(1, 'app/dependabot', 'dependabot[bot]')] };
  const f = fake({ pulls: repos, alerts: { 'o/a': [] } });
  const run = f.precheck({ repos: 'o/a' });
  assert.equal(run.code, 0);
  assert.match(run.log[1], /^pr list --repo o\/a --state open --limit 100 --json number,author,commits --jq /);
  assert.equal(fake({ pulls: { 'o/a': [pr(2, 'someone', 'someone')] }, alerts: { 'o/a': [] } }).precheck({ repos: 'o/a' }).code, 1, 'a human pull request is not dependency work');
  assert.equal(fake({ alerts: { 'o/a': [5] } }).precheck({ repos: 'o/a' }).code, 0, 'an open alert');
  assert.equal(fake({ alerts: { 'o/a': [] } }).precheck({ repos: 'o/a' }).code, 1, 'nothing open');
  const here = fake({ pulls: { 'o/here': repos['o/a'] } }).precheck({});
  assert.deepEqual([here.code, here.log[0]], [0, 'repo view --json nameWithOwner --jq .nameWithOwner'], 'empty: the checkout repository');
  const owned = fake({ owners: { o: ['o/a'] }, pulls: repos }).precheck({ owners: 'o' });
  assert.deepEqual([owned.code, owned.log[0]], [0, 'repo list o --no-archived --source --limit 1000 --json nameWithOwner --jq .[].nameWithOwner'], 'the repositories of an account');
});

test('dependency-triage list: a bot pull request with a commit by someone else is listed as foreign and nothing is written', sh, () => {
  const f = fake({ pulls: { 'o/a': [
    pr(1, 'app/dependabot', 'dependabot[bot]'),
    pr(2, 'app/dependabot', 'dependabot[bot]', 'me'),
    pr(3, 'app/renovate', 'renovate[bot]', 'stranger'),
    pr(4, 'stranger', 'stranger'),
    pr(5, 'app/dependabot', 'dependabot[bot]', '-'),
  ] }, alerts: { 'o/a': [7] } });
  const r = f.list('', 'o/a', 'record');
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['pr o/a 1 own', 'pr o/a 2 own', 'pr o/a 3 foreign', 'pr o/a 5 foreign', 'alert o/a 7']);
  for (const line of r.log) assert.match(line, /^(api user|pr list |api repos\/o\/a\/dependabot\/alerts\?state=open)/, `read only: ${line}`);
});

test('dependency-triage list: alerts the token cannot read are reported once, not an error', sh, () => {
  const f = fake({ pulls: { 'o/a': [pr(1, 'app/dependabot', 'dependabot[bot]')] } });
  assert.deepEqual(f.list('', 'o/a').out, ['pr o/a 1 own'], 'the precheck neither reports nor records');
  assert.deepEqual(f.list('', 'o/a', 'record').out, ['pr o/a 1 own', 'noaccess o/a']);
  const again = f.list('', 'o/a', 'record');
  assert.deepEqual([again.code, again.out], [0, ['pr o/a 1 own']], 'reported once');
  assert.equal(fake().list('', 'o/a', 'record').code, 1, 'only a missing permission: no work');
});

test('dependency-triage list: a hostile account or repository name never reaches gh', sh, () => {
  const f = fake({ owners: { o: ['o/a', '-x/y', 'o/$(id)'] }, alerts: { 'o/a': [1] } });
  const r = f.list('-o,o', '../x,o/..,o/b;id');
  assert.deepEqual(r.out, ['alert o/a 1']);
  assert.ok(r.log.every((l) => !/-o |\.\.|;id|-x\/y|\$\(id\)/.test(l)), r.log.join('\n'));
});
