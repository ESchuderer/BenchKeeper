import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir } from '../src/automations.mjs';
import { automationTemplate, sh } from './helpers.mjs';

const template = () => automationTemplate('release-watch');

// A fake gh on PATH that logs its arguments, prints the newest release tag (the file release; "error" fails), lists the
// open issues from the file issues and adds one there on issue create. XDG_STATE_HOME holds the record.
function fake() {
  const bin = mkdtempSync(join(tmpdir(), 'bk-rw-bin-'));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$@" >> '${bin}/log'
case "$1 $2" in
  "repo view") echo o/here ;;
  "release list") [ "$(cat '${bin}/release')" != error ] && cat '${bin}/release' ;;
  "issue list") [ "$(cat '${bin}/issues' 2>/dev/null)" != error ] && { cat '${bin}/issues' 2>/dev/null || true; } ;;
  "issue create") while [ "$1" != --title ]; do shift; done; printf '7\\t%s\\n' "$2" >> '${bin}/issues' ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, 'release'), 'v1.2.0\n');
  writeFileSync(join(bin, 'report.md'), 'registry: 1.2.0 is missing\n');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: join(bin, 'state') };
  const log = () => {
    try { return readFileSync(join(bin, 'log'), 'utf8').trim().split('\n'); } catch { return []; }
  };
  const run = (cmd, args) => {
    writeFileSync(join(bin, 'log'), '');
    return { code: spawnSync('sh', ['-c', cmd, 'sh', ...args], { cwd: genericDir, env }).status, log: log().filter(Boolean) };
  };
  const precheck = (values = {}) => run(fill(template(), values).precheck, []);
  const due = (repos) => {
    const r = spawnSync('sh', [join(genericDir, 'release-watch/due.sh'), repos], { env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean) };
  };
  const result = (...args) => run('release-watch/result.sh "$@"', [...args, join(bin, 'report.md')]);
  const record = (repo) => {
    try { return readFileSync(join(bin, 'state', 'benchkeeper', 'release-watch', repo), 'utf8'); } catch { return null; }
  };
  // Moves every recorded time of a repository back by seconds.
  const age = (repo, seconds) => {
    const file = join(bin, 'state', 'benchkeeper', 'release-watch', repo);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/ (\d+)$/gm, (_, t) => ` ${Number(t) - seconds}`));
  };
  return { bin, precheck, due, result, record, age };
}

test('release-watch: parameters repos, registry and install_command, report only by default', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['repos', 'registry', 'install_command']);
  assert.deepEqual(fill(t, { registry: 'npm:my-tool' }).values, { mode: 'report', repos: '', registry: 'npm:my-tool', install_command: '' });
});

test('release-watch: GitHub writes only in result.sh, never a release, tag or publish', () => {
  const t = template();
  const read = (f) => readFileSync(join(genericDir, 'release-watch', f), 'utf8');
  const helpers = ['precheck.sh', 'due.sh', 'valid.sh'].map(read);
  for (const text of [t.prompt, ...helpers]) assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review|lock|delete)\b|\bgit push\b|--method|-X /);
  for (const text of [t.prompt, ...helpers, read('result.sh')]) assert.doesNotMatch(text, /\bgh (release|label|repo|secret|variable|workflow) (create|edit|delete|upload)\b|\b(npm|pnpm|yarn) publish\b|\bgit tag\b/);
  assert.match(read('result.sh'), /--author @me/, 'only issues of this account');
});

test('release-watch valid.sh: a tag gives its version, a hostile tag, package or script path is refused', sh, () => {
  const valid = (...a) => spawnSync('sh', [join(genericDir, 'release-watch/valid.sh'), ...a], { encoding: 'utf8' });
  for (const [tag, v] of [['setup-v6.9.0', '6.9.0'], ['v1.2.0-rc.1', '1.2.0-rc.1'], ['21.0.0', '21.0.0'], ['app2-v1.0.0', '1.0.0']]) assert.equal(valid('tag', tag).stdout, `${v}\n`, tag);
  for (const tag of ['v1$(id)', 'v1.0.0`id`', '-v1.0.0', 'v1.0', 'v1.0.0\nx', '']) assert.equal(valid('tag', tag).status, 2, tag);
  assert.equal(valid('package', '@scope/my-tool').status, 0);
  for (const name of ['-rf', 'a b', 'My-Tool', '@s/../x/y']) assert.equal(valid('package', name).status, 2, name);
  const repo = mkdtempSync(join(tmpdir(), 'bk-rw-repo-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'install.sh'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(repo, 'plain.sh'), '#!/bin/sh\n');
  const script = (p) => spawnSync('sh', [join(genericDir, 'release-watch/valid.sh'), 'script', p], { cwd: repo }).status;
  assert.equal(script('install.sh'), 2, 'not tracked');
  spawnSync('git', ['add', 'install.sh', 'plain.sh'], { cwd: repo });
  assert.equal(script('install.sh'), 0);
  for (const p of ['plain.sh', '../install.sh', `${repo}/install.sh`, 'x/../install.sh', '']) assert.equal(script(p), 2, p);
});

test('release-watch precheck: runs for a valid release tag without a recorded pass or a failure younger than a day', sh, () => {
  const f = fake();
  const first = f.precheck({ repos: 'o/a,o/b' });
  assert.equal(first.code, 0);
  assert.deepEqual(first.log, ['release list --repo o/a --exclude-drafts --limit 1 --json tagName --jq .[0].tagName // empty', 'release list --repo o/b --exclude-drafts --limit 1 --json tagName --jq .[0].tagName // empty']);
  assert.deepEqual(f.due('o/a,o/b').out, ['o/a v1.2.0 1.2.0', 'o/b v1.2.0 1.2.0']);
  f.result('report', 'o/a', 'v1.2.0', 'pass');
  assert.deepEqual(f.due('o/a,o/b').out, ['o/b v1.2.0 1.2.0'], 'o/a passed');
  f.result('report', 'o/b', 'v1.2.0', 'fail');
  assert.equal(f.precheck({ repos: 'o/a,o/b' }).code, 1, 'a pass and a fresh failure');
  f.age('o_b', 86401);
  assert.deepEqual(f.due('o/a,o/b').out, ['o/b v1.2.0 1.2.0'], 'a failure older than a day is checked again');
  writeFileSync(join(f.bin, 'release'), 'v1.3.0\n');
  assert.equal(f.precheck({ repos: 'o/a' }).code, 0, 'a newer tag');
  const here = f.precheck({});
  assert.deepEqual([here.code, here.log[0]], [0, 'repo view --json nameWithOwner --jq .nameWithOwner'], 'empty repos: the checkout repository');
  writeFileSync(join(f.bin, 'release'), 'v1$(id).0.0\n');
  assert.deepEqual([f.precheck({ repos: 'o/a' }).code, f.due('o/a').out], [1, []], 'a hostile tag is no work');
  writeFileSync(join(f.bin, 'release'), 'error');
  assert.equal(f.precheck({ repos: 'o/a' }).code, 1, 'a failing gh skips the run');
  writeFileSync(join(f.bin, 'release'), '');
  assert.equal(f.precheck({ repos: 'o/a' }).code, 1, 'no release yet');
});

test('release-watch result: a missing registry version opens one issue, a second run updates it, a pass closes it', sh, () => {
  const f = fake();
  assert.deepEqual(f.result('report', 'o/a', 'v1.2.0', 'fail'), { code: 0, log: [] }, 'report mode writes nothing to GitHub');
  assert.match(f.record('o_a'), /^v1\.2\.0 fail \d+\n$/);

  const g = fake();
  const opened = g.result('act', 'o/a', 'v1.2.0', 'fail');
  assert.equal(opened.code, 0);
  assert.match(opened.log[0], /^issue list --repo o\/a --author @me --state open /);
  assert.equal(opened.log[1], `issue create --repo o/a --title Release watch: v1.2.0 failed --body-file ${g.bin}/report.md`);
  g.age('o_a', 86401);
  assert.equal(g.precheck({ repos: 'o/a' }).code, 0, 'the next day the failed tag is due again');
  const updated = g.result('act', 'o/a', 'v1.2.0', 'fail');
  assert.deepEqual(updated.log.slice(1), [`issue edit 7 --repo o/a --body-file ${g.bin}/report.md`], 'the second run updates the same issue');
  const passed = g.result('act', 'o/a', 'v1.2.0', 'pass');
  assert.deepEqual(passed.log.slice(1), [`issue edit 7 --repo o/a --body-file ${g.bin}/report.md`, 'issue close 7 --repo o/a']);
  assert.match(g.record('o_a'), /v1\.2\.0 pass \d+\n$/);
  writeFileSync(join(g.bin, 'issues'), '9\tRelease watch: v1.2.0 failed later\n');
  assert.equal(g.result('act', 'o/a', 'v1.2.0', 'fail').log[1].split(' ').slice(0, 2).join(' '), 'issue create', 'only the exact title counts');
  writeFileSync(join(g.bin, 'issues'), 'error');
  const failed = g.result('act', 'o/a', 'v1.2.0', 'fail');
  assert.notEqual(failed.code, 0);
  assert.deepEqual(failed.log.map((l) => l.split(' ').slice(0, 2).join(' ')), ['issue list'], 'a failing issue list opens no second issue');
  for (const args of [['act', 'o/a', 'v1.2.0', 'maybe'], ['act', 'o/a', 'v1$(id)', 'fail'], ['act', 'o/a;x', 'v1.2.0', 'fail']]) {
    const r = g.result(...args);
    assert.deepEqual([r.code, r.log], [2, []], args.join(' '));
  }
});
