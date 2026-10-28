import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, lint, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-ch-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'ci-health');
const sh = { skip: process.platform === 'win32' && 'sh helpers' };

// A completed run as the --jq of due.sh prints it, newest first: workflow id, run id, attempt, pass or fail, new or old, path.
const run = (wf, id, attempt, result, age = 'new', path = `.github/workflows/w${wf}.yml`) => `${wf} ${id} ${attempt} ${result} ${age} ${path}`;

// A fake gh on PATH that logs its arguments, one line per call. runs: the completed runs per repository; repos without an entry fail.
// repo view answers o/here, api repos/<repo> the default branch main. Issues: the open issues in the file issues,
// issue create adds number 7 there. XDG_STATE_HOME holds the record.
function fake(runs = {}) {
  const bin = mkdtempSync(join(tmpdir(), 'bk-ch-bin-'));
  for (const [r, l] of Object.entries(runs)) writeFileSync(join(bin, `runs-${r.replace('/', '_')}`), l.map((x) => `${x}\n`).join(''));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$*" | tr '\\n' ' ' >> '${bin}/log'; echo >> '${bin}/log'
case "$1 $2" in
  "repo view") echo o/here ;;
  "issue list") [ "$(cat '${bin}/issues' 2>/dev/null)" != error ] && { cat '${bin}/issues' 2>/dev/null || true; } ;;
  "issue create") while [ "$1" != --title ]; do shift; done; printf '7\\t%s\\n' "$2" >> '${bin}/issues' ;;
  api*) f='${bin}'/runs-"$(echo "$2" | cut -d / -f 2,3 | cut -d '?' -f 1 | tr / _)"; [ -e "$f" ] || exit 1
    case "$2" in */actions/runs*) cat "$f" ;; *) echo main ;; esac ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, 'report.md'), 'test step failed\n');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(bin, 'state') };
  const log = () => {
    try { return readFileSync(join(bin, 'log'), 'utf8').trim().split('\n').map((l) => l.trim()).filter(Boolean); } catch { return []; }
  };
  const exec = (cmd, args = []) => {
    writeFileSync(join(bin, 'log'), '');
    const r = spawnSync('sh', ['-c', cmd, 'sh', ...args], { cwd: genericDir, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), log: log() };
  };
  return {
    bin,
    precheck: (values = {}) => exec(fill(template(), values).precheck),
    due: (repos, workflows = '') => exec('ci-health/due.sh "$@"', [repos, workflows]),
    result: (mode, line) => exec('ci-health/result.sh "$@"', [mode, join(bin, 'report.md'), ...line.split(' ')]),
  };
}

test('ci-health: parameters repos and workflows, report only by default, lint passes', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['repos', 'workflows']);
  assert.deepEqual(fill(t).values, { mode: 'report', repos: '', workflows: '' });
  assert.deepEqual(lint(t), []);
});

test('ci-health: issue writes only in result.sh, never a workflow change or a second rerun', sh, () => {
  const t = template();
  const read = (f) => readFileSync(join(genericDir, 'ci-health', f), 'utf8');
  for (const text of [t.prompt, t.precheck, read('precheck.sh'), read('due.sh')]) assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review|lock|delete)\b|\bgit push\b|--method|-X /);
  for (const text of [t.prompt, read('precheck.sh'), read('due.sh'), read('result.sh')]) assert.doesNotMatch(text, /\bgh workflow (disable|enable|run)\b|\bgh run (cancel|delete)\b|\bgh (secret|variable|ruleset) /);
  assert.equal(t.prompt.match(/gh run rerun/g).length, 1);
  assert.match(t.prompt, /Never rerun an attempt above 1, and never rerun in mode report\./);
  assert.match(read('result.sh'), /--author @me/, 'only issues of this account');
});

test('ci-health precheck: runs for a new failure or a pass after a recorded failure, skips otherwise', sh, () => {
  const f = fake({ 'o/a': [run(1, 10, 1, 'fail'), run(1, 9, 1, 'pass'), run(2, 11, 1, 'fail', 'old'), run(3, 12, 1, 'pass')] });
  const first = f.precheck({ repos: 'o/a' });
  assert.equal(first.code, 0);
  assert.equal(first.log[0], 'api repos/o/a --jq .default_branch');
  assert.match(first.log[1], /^api repos\/o\/a\/actions\/runs\?branch=main&status=completed&per_page=100 --jq /);
  assert.match(first.log[1], /select\(\(\.event == "push" or \.event == "schedule"\) and \(\.path \| startswith\("\.github\/workflows\/"\)\)\)/);
  assert.deepEqual(f.due('o/a').out, ['o/a 1 10 1 fail .github/workflows/w1.yml'], 'the newest run per workflow; an old failure and a pass are no work');
  assert.deepEqual(f.due('o/a', 'w2.yml,w3.yml').out, [], 'workflows filters by file name');
  f.result('report', 'o/a 1 10 1 fail .github/workflows/w1.yml');
  assert.equal(f.precheck({ repos: 'o/a' }).code, 1, 'a recorded attempt is no work');

  const g = fake({ 'o/a': [run(1, 10, 2, 'fail')] });
  g.result('report', 'o/a 1 10 1 fail .github/workflows/w1.yml');
  assert.deepEqual(g.due('o/a').out, ['o/a 1 10 2 fail .github/workflows/w1.yml'], 'the rerun attempt');
  const h = fake({ 'o/a': [run(1, 13, 1, 'fail', 'old'), run(2, 14, 1, 'pass')] });
  h.result('report', 'o/a 1 10 2 fail .github/workflows/w1.yml');
  h.result('report', 'o/a 2 8 1 fail .github/workflows/w2.yml');
  assert.deepEqual(h.due('o/a').out, ['o/a 1 13 1 fail .github/workflows/w1.yml', 'o/a 2 14 1 pass .github/workflows/w2.yml'], 'after a recorded failure: an older failure and a pass are due');

  const here = fake({ 'o/here': [run(1, 10, 1, 'fail')] }).precheck({});
  assert.deepEqual([here.code, here.log[0]], [0, 'repo view --json nameWithOwner --jq .nameWithOwner'], 'empty repos: the checkout repository');
  assert.equal(fake({}).precheck({ repos: 'o/a' }).code, 1, 'a failing gh skips the run');
  const hostile = fake({ 'o/a': [run(1, 10, 1, 'fail', 'new', '.github/workflows/$(id).yml'), run('x', 11, 1, 'fail')] }).due('-o/a,../x,o/..,o/b;id,o/a');
  assert.deepEqual(hostile.out, [], 'a hostile path or id is no work');
  assert.ok(hostile.log.every((l) => /^api repos\/o\/a[ /]/.test(l)), hostile.log.join('\n'));
});

test('ci-health result: two failures open one issue, a third updates it, a green run closes it', sh, () => {
  const line = (run, attempt, result) => `o/a 1 ${run} ${attempt} ${result} .github/workflows/ci.yml`;
  const r = fake();
  r.result('report', line(10, 1, 'fail'));
  assert.deepEqual(r.result('report', line(10, 2, 'fail')), { code: 0, out: [], log: [] }, 'report mode writes nothing to GitHub');

  const f = fake();
  const first = f.result('act', line(10, 1, 'fail'));
  assert.deepEqual(first.log.map((l) => l.split(' ').slice(0, 2).join(' ')), ['issue list'], 'one failure: no issue yet');
  const second = f.result('act', line(10, 2, 'fail'));
  assert.match(second.log[0], /^issue list --repo o\/a --author @me --state open /);
  assert.deepEqual(second.log.slice(1), [`issue create --repo o/a --title CI health: .github/workflows/ci.yml fails --body-file ${f.bin}/report.md`]);
  const third = f.result('act', line(11, 1, 'fail'));
  assert.deepEqual(third.log.slice(1), [`issue edit 7 --repo o/a --body-file ${f.bin}/report.md`]);
  const green = f.result('act', line(12, 1, 'pass'));
  assert.deepEqual(green.log.slice(1), [`issue comment 7 --repo o/a --body-file ${f.bin}/report.md`, 'issue close 7 --repo o/a']);

  writeFileSync(join(f.bin, 'issues'), '');
  f.result('act', line(13, 1, 'fail'));
  assert.deepEqual(f.result('act', line(13, 2, 'pass')).log.slice(1), [], 'a failure that passed on its rerun opens nothing');
  assert.equal(f.result('act', line(14, 1, 'fail')).log.length, 1, 'the pass reset the count');
  writeFileSync(join(f.bin, 'issues'), '9\tCI health: .github/workflows/ci.yml fails later\n');
  assert.equal(f.result('act', line(14, 2, 'fail')).log[1].split(' ').slice(0, 2).join(' '), 'issue create', 'only the exact title counts');
  writeFileSync(join(f.bin, 'issues'), 'error');
  const failed = f.result('act', line(15, 1, 'fail'));
  assert.notEqual(failed.code, 0);
  assert.deepEqual(failed.log.map((l) => l.split(' ').slice(0, 2).join(' ')), ['issue list'], 'a failing issue list opens no second issue');
  for (const bad of ['o/a 1 10 1 maybe ci.yml', 'o/a;x 1 10 1 fail ci.yml', 'o/a x 10 1 fail ci.yml', 'o/a 1 10 1 fail $(id).yml', 'o/a 1 10 1 fail -x']) {
    const b = f.result('act', bad);
    assert.deepEqual([b.code, b.log], [2, []], bad);
  }
});
