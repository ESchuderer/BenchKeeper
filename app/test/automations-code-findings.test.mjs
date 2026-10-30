import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, lint } from '../src/automations.mjs';
import { automationTemplate, sh } from './helpers.mjs';

const template = () => automationTemplate('code-findings');
const fixture = (name) => join(import.meta.dirname, 'fixtures', 'automations', 'code-findings', name);
const helper = (name) => join(genericDir, 'code-findings', name);

// A git checkout with a fake gh on PATH that logs its arguments and answers the code scanning alerts from a fixture
// (missing: 404), and a tracked linter script that prints a fixture with /repo as the checkout.
function checkout({ alerts, report } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-cf-repo-'));
  const bin = mkdtempSync(join(tmpdir(), 'bk-cf-bin-'));
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
echo "$@" >> '${bin}/log'
case "$1 $2" in
  "repo view") echo o/here ;;
  "api --paginate") ${alerts ? `cat '${fixture(alerts)}'` : "echo 'HTTP 404' >&2; exit 1"} ;;
esac
`, { mode: 0o755 });
  if (report) writeFileSync(join(dir, 'lint.sh'), `#!/bin/sh\nsed "s|/repo|$(pwd -P)|" '${fixture(report)}'\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'untracked.sh'), '#!/bin/sh\n', { mode: 0o755 });
  const git = (...a) => spawnSync('git', a, { cwd: dir });
  git('init', '-q');
  if (report) git('add', 'lint.sh');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const run = (cmd, args = [], extra = {}) => {
    writeFileSync(join(bin, 'log'), '');
    const r = spawnSync('sh', ['-c', cmd, 'sh', ...args], { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), err: r.stderr, log: readFileSync(join(bin, 'log'), 'utf8').trim().split('\n').filter(Boolean) };
  };
  return {
    precheck: (values = {}, extra) => run(fill(template(), values).precheck.replace('code-findings/', `${genericDir}/code-findings/`), [], extra),
    list: (...args) => run(`'${helper('list.sh')}' "$@"`, args),
  };
}

// Outside a git checkout, so the fixtures' blobs are unknown.
const check = (diff) => spawnSync('sh', [helper('check.sh')], { cwd: tmpdir(), input: readFileSync(fixture(diff)), encoding: 'utf8' });

test('code-findings: parameters adapter, linter, token_var and max_workers, report only by default, lint passes', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['adapter', 'linter', 'token_var', 'max_workers']);
  assert.deepEqual(fill(t).values, { mode: 'report', adapter: 'code-scanning', linter: '', token_var: '', max_workers: '2' });
  assert.deepEqual(lint(t), []);
});

test('code-findings: no GitHub write in the helpers or the report part of the prompt', () => {
  const t = template();
  const [report, act] = t.prompt.split(/^5\. Mode act:/m);
  assert.ok(act, 'act mode follows the report');
  assert.match(report, /Mode report: stop here\. .* Write nothing/);
  assert.match(act, /Merge nothing\./);
  assert.match(t.prompt, /Never add a suppression or ignore comment, an exclusion, a baseline entry or a changed threshold/);
  const helpers = ['precheck.sh', 'list.sh', 'check.sh'].map((f) => readFileSync(helper(f), 'utf8'));
  for (const text of [t.precheck, ...helpers]) assert.doesNotMatch(text, /\bgh (pr|issue) (create|comment|edit|close|reopen|merge|review)\b|--method|-X |\bgit push\b/);
});

test('code-findings code-scanning adapter: open alerts of all pages grouped by rule and file, most first', sh, () => {
  const r = checkout({ alerts: 'code-scanning.json' }).list('code-scanning', '', '');
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, ['2 js/path-injection src/server.mjs', '1 js/unused-local-variable src/cli.mjs']);
  assert.deepEqual(r.log, ['repo view --json nameWithOwner --jq .nameWithOwner', 'api --paginate --slurp repos/o/here/code-scanning/alerts?state=open&per_page=100']);
  const off = checkout().list('code-scanning', '', '');
  assert.deepEqual([off.code, off.out], [1, []], 'code scanning not set up or not readable: no work');
});

test('code-findings linter adapter: an ESLint JSON or SARIF report from a tracked script, grouped by rule and file', sh, () => {
  const r = checkout({ report: 'eslint.json' }).list('linter', 'lint.sh', '');
  assert.deepEqual([r.code, r.out], [0, ['2 no-unused-vars src/a.js', '1 eqeqeq src/a.js']]);
  assert.deepEqual(checkout({ report: 'sarif.json' }).list('linter', 'lint.sh', '').out, ['1 E501 pkg/mod.py']);
  const c = checkout({ report: 'eslint.json' });
  for (const bad of ['untracked.sh', '../lint.sh', '/bin/sh', 'missing.sh']) assert.equal(c.list('linter', bad, '').code, 2, bad);
});

test('code-findings precheck: runs for open findings, skips without; quality-gate only with its token variable set', sh, () => {
  assert.equal(checkout({ alerts: 'code-scanning.json' }).precheck().code, 0);
  assert.equal(checkout().precheck().code, 1);
  assert.equal(checkout({ report: 'eslint.json' }).precheck({ adapter: 'linter', linter: 'lint.sh' }).code, 0);
  const gate = checkout();
  assert.equal(gate.precheck({ adapter: 'quality-gate', token_var: 'BK_GATE_TOKEN' }, { BK_GATE_TOKEN: '' }).code, 1);
  const set = gate.precheck({ adapter: 'quality-gate', token_var: 'BK_GATE_TOKEN' }, { BK_GATE_TOKEN: 'x' });
  assert.deepEqual([set.code, set.log], [0, []], 'the service is read in the run, not by the helper');
  assert.equal(gate.list('quality-gate', '', 'A;id').code, 2, 'not a variable name');
  assert.equal(gate.list('other', '', '').code, 2, 'unknown adapter');
});

test('code-findings check step: a fix that adds a suppression comment or changes a tool configuration is rejected', sh, () => {
  assert.deepEqual([check('fix-clean.diff').status, check('fix-clean.diff').stdout], [0, '']);
  const s = check('fix-suppression.diff');
  assert.equal(s.status, 1);
  assert.deepEqual(s.stdout.trim().split('\n'), ['suppression: src/a.js: // eslint-disable-next-line no-unused-vars', 'suppression: src/a.js:   return a == b; // NOSONAR']);
  const c = check('fix-config.diff');
  assert.deepEqual([c.status, c.stdout.trim()], [1, 'config: eslint.config.mjs']);
});

test('code-findings check step: the quality configs and coverage markers of the BenchKeeper templates, a renamed config', sh, () => {
  const lines = (diff) => {
    const r = check(diff);
    assert.equal(r.status, 1, diff);
    return r.stdout.trim().split('\n');
  };
  assert.deepEqual(lines('fix-toml.diff'), [
    'config: pyproject.toml: +ignore = ["E501"]',
    'config: pyproject.toml: -"src/**" = []',
    'config: pyproject.toml: +"src/**" = ["C901"]',
    'config: setup.cfg: -strict = True',
    'config: setup.cfg: +strict = False',
    'config: tox.ini: +omit = src/hard.py',
  ], 'tool sections only, a hunk without its section header counts as one; dependencies pass');
  assert.deepEqual(lines('fix-quality-config.diff'), ['knip.json', 'tsconfig.json', 'biome-quality.jsonc', '.basedpyright/baseline.json', 'scripts/tsc-baseline.sh'].map((f) => `config: ${f}`));
  assert.deepEqual(lines('fix-markers.diff'), ['/* v8 ignore next */', '// stryker-disable-next-line all', '// Stryker disable next-line all', '/* node:coverage ignore next */']
    .map((l) => `suppression: src/a.js: ${l}`).concat('suppression: pkg/mod.py:     return 1  # pragma: no cover'));
  assert.deepEqual(lines('fix-rename.diff'), ['config: eslint.config.mjs', 'config: pyproject.toml']);
  assert.deepEqual(lines('fix-quoted.diff'), ['config: caf\\303\\251/tsconfig.json'], 'a path git quotes for its non-ASCII characters');
});

test('code-findings check step: a hunk below its section header is in the section git has above it', sh, () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-cf-toml-'));
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
  const toml = (dep, opt) => ['[project]', 'dependencies = [', ...Array.from({ length: 10 }, (_, i) => `  "dep${i}>=${i === 8 ? dep : 1}",`), ']',
    '  [tool.ruff]', ...Array.from({ length: 10 }, (_, i) => `opt${i} = ${i === 8 ? opt : 1}`), ''].join('\n');
  writeFileSync(join(dir, 'pyproject.toml'), toml(1, 1));
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'init');
  writeFileSync(join(dir, 'pyproject.toml'), toml(2, 2));
  const r = spawnSync('sh', [helper('check.sh')], { cwd: dir, input: git('diff').stdout, encoding: 'utf8' });
  assert.deepEqual([r.status, r.stdout.trim().split('\n')], [1, ['config: pyproject.toml: -opt8 = 1', 'config: pyproject.toml: +opt8 = 2']], 'the dependency passes, the indented tool section does not');
});
