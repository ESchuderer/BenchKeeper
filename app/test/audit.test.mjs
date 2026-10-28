import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { CATALOGUE, GROUPS, audit, auditMarkdown, clones } from '../src/audit.mjs';
import { main } from '../src/cli.mjs';
import { insights } from '../src/insights.mjs';
import { context } from '../src/runner.mjs';
import { listFiles } from '../src/fsx.mjs';

const TMP = realpathSync(tmpdir());
const SHA = 'a'.repeat(40);
const home = mkdtempSync(join(TMP, 'bk-audit-home-'));
const ctx = context({ home });

function tree(files) {
  const dir = mkdtempSync(join(TMP, 'bk-audit-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  }
  return dir;
}
const fingerprint = (dir) => createHash('sha256').update(listFiles(dir).map((f) => `${f}\0${readFileSync(join(dir, f))}`).join('\0')).digest('hex');
const ids = (dir, opts) => audit(ctx, dir, opts).findings.map((f) => f.id).sort();

// A workflow that none of the workflow checks reports: one push branch, paths-ignore, cancel, pins, narrow rights, a cache.
const ci = ({ push = '    branches: [main]\n', cache = '          cache: npm\n', extra = '', pr = '    paths-ignore: ["**.md"]\n', concurrency = 'concurrency:\n  group: ci-${{ github.ref }}\n  cancel-in-progress: true\n' } = {}) => `name: CI
on:
  push:
${push}  pull_request:
${pr}permissions: {}
${concurrency}jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@${SHA} # v4
      - uses: actions/setup-node@${SHA} # v4
        with:
          node-version: 22
${cache}      - run: npm ci
      - run: npm run lint
      - run: npm test
${extra}`;
const lines = (n, k = 'v') => Array.from({ length: n }, (_, i) => `const ${k}${i} = ${i};`).join('\n');
const SOURCE = 'export function sum(list) {\n  return list.reduce((n, x) => n + x, 0);\n}\n';
const TESTFILE = "import { sum } from '../src/index.js';\nsum([1]);\n";

const LINTER_ONLY = () => tree({
  'package.json': { name: 'a', devDependencies: { eslint: '9.0.0' }, scripts: { lint: 'eslint .' } },
  '.eslintrc.json': { rules: {} },
  'src/index.js': SOURCE,
  '.github/workflows/ci.yml': ci(),
});
const MANY_TOOLS = () => tree({
  'package.json': { name: 'b', scripts: { test: 'node --test --experimental-test-coverage --test-coverage-lines=50 test/*.test.js' } },
  'coverage/coverage-summary.json': { total: { lines: { pct: 92 }, branches: { pct: 80 }, functions: { pct: 90 }, statements: { pct: 92 } } },
  'src/index.js': SOURCE,
  'test/index.test.js': TESTFILE,
  // Unfiltered push next to pull_request, and an install without a cache.
  '.github/workflows/ci.yml': ci({ push: '', cache: '' }),
});

test('a project with only a linter: the checks that need no tool run, the others are listed as skipped', () => {
  const r = audit(ctx, LINTER_ONLY());
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.skipped.map((s) => s.id), ['tests/coverage-floor', 'tests/duplicate', 'tests/snapshot-size']);
  assert.equal(r.ran, CATALOGUE.length - 3);
  const floor = r.skipped[0];
  assert.match(floor.reason, /no coverage floor.*no coverage report/);
  assert.match(floor.enable, /--test-coverage-lines=80.*json-summary or lcov/);
  assert.ok(r.skipped.every((s) => !/install/i.test(s.enable)), 'no skipped check tells the project to install a tool');
  assert.deepEqual(r.summary, { error: 0, warning: 0, info: 0 });
});

test('a duplicated trigger, an uncached install and a floor far below the measured value are exactly three findings', () => {
  const dir = MANY_TOOLS();
  const r = audit(ctx, dir);
  assert.deepEqual(r.findings.map((f) => f.id).sort(), ['tests/coverage-floor', 'workflows/duplicate-trigger:.github/workflows/ci.yml', 'workflows/no-cache:.github/workflows/ci.yml#test']);
  assert.deepEqual(r.skipped.map((s) => s.id), ['tests/snapshot-size']);
  const byId = Object.fromEntries(r.findings.map((f) => [f.id.split(':')[0], f]));
  assert.deepEqual(byId['workflows/duplicate-trigger'].evidence, { file: '.github/workflows/ci.yml', line: 3 });
  const installLine = readFileSync(join(dir, '.github/workflows/ci.yml'), 'utf8').split('\n').findIndex((l) => l.includes('npm ci')) + 1;
  assert.deepEqual(byId['workflows/no-cache'].evidence, { file: '.github/workflows/ci.yml', line: installLine, job: 'test' });
  assert.deepEqual(byId['tests/coverage-floor'].evidence, { file: 'package.json', line: 1, report: 'coverage/coverage-summary.json', metrics: [{ metric: 'lines', floor: 50, measured: 92 }] });
  assert.match(byId['tests/coverage-floor'].fix, /lines 91.*only ever rises/);
});

test('the floor check: near the measured value is fine, lcov and c8 configuration are read, the highest floor counts', () => {
  const near = tree({ 'package.json': { scripts: { test: 'node --test --test-coverage-lines=90' } }, 'coverage/coverage-summary.json': { total: { lines: { pct: 92 } } } });
  assert.deepEqual(ids(near), []);
  const lcov = tree({ 'package.json': { scripts: { test: 'c8 --lines 30 node --test' }, c8: { lines: 40, branches: 20 } }, 'coverage/lcov.info': 'SF:a\nLF:10\nLH:9\nBRF:4\nBRH:4\nFNF:2\nFNH:2\nend_of_record\n' });
  const [f] = audit(ctx, lcov).findings;
  assert.deepEqual(f.evidence.metrics, [{ metric: 'lines', floor: 40, measured: 90 }, { metric: 'branches', floor: 20, measured: 100 }]);
  assert.equal(f.evidence.report, 'coverage/lcov.info');
  const rc = tree({ '.c8rc.json': { statements: 10 }, 'coverage/coverage-summary.json': { total: { statements: { pct: 'Unknown' }, lines: { pct: 50 } } } });
  assert.deepEqual(ids(rc), [], 'a metric the report does not hold is not compared');
  const jest = tree({ 'package.json': { jest: { coverageThreshold: { global: { functions: 10 } } } }, 'coverage/coverage-summary.json': { total: { functions: { pct: 80 } } } });
  assert.deepEqual(ids(jest), ['tests/coverage-floor']);
});

test('workflow checks: cancel, path filter, repeated build, matrix, pins, permissions', () => {
  const dir = tree({
    '.github/workflows/a.yml': `on: [push, pull_request]
jobs:
  one:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: [a, b, c]
        node: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - run: npm run build
  two:
    uses: owner/repo/.github/workflows/x.yml@main
  three:
    runs-on: ubuntu-latest
    steps:
      - uses: docker://alpine@sha256:${'b'.repeat(64)}
      - uses: ./local
      - run: npm   run   build
`,
    '.github/workflows/b.yml': `on:
  pull_request:
  workflow_dispatch:
permissions: write-all
concurrency:
  group: x
  cancel-in-progress: false
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: make
`,
  });
  assert.deepEqual(ids(dir), [
    'workflows/broad-permissions:.github/workflows/a.yml',
    'workflows/broad-permissions:.github/workflows/b.yml',
    'workflows/duplicate-trigger:.github/workflows/a.yml',
    'workflows/matrix-size:.github/workflows/a.yml#one',
    'workflows/no-cancel:.github/workflows/a.yml',
    'workflows/no-cancel:.github/workflows/b.yml',
    'workflows/no-path-filter:.github/workflows/a.yml',
    'workflows/no-path-filter:.github/workflows/b.yml',
    'workflows/repeat-build:.github/workflows/a.yml#three:one',
    'workflows/unpinned-action:.github/workflows/a.yml',
  ]);
  const r = audit(ctx, dir, { only: ['workflows'] });
  const pin = r.findings.find((f) => f.id.startsWith('workflows/unpinned'));
  assert.deepEqual(pin.evidence.actions, ['actions/checkout@v4', 'owner/repo/.github/workflows/x.yml@main']);
  assert.match(pin.message, /^Security, not bloat: 2 actions/);
  assert.equal(r.findings.find((f) => f.id.includes('matrix-size')).evidence.combinations, 9);
  const repeat = r.findings.find((f) => f.id.includes('repeat-build'));
  assert.equal(repeat.evidence.sameAs, 'one');
});

test('workflow checks leave clean shapes alone: a cancel expression, a cache action, a publishing workflow, a global install', () => {
  const dir = tree({
    '.github/workflows/a.yml': ci({ cache: '', concurrency: "concurrency:\n  group: g\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n", extra: '      - uses: actions/cache@' + SHA + '\n        with:\n          path: x\n          key: y\n' }),
    '.github/workflows/b.yml': `on:
  workflow_call:
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - run: npm ci
      - run: npm i -g tool
  tool:
    runs-on: ubuntu-latest
    permissions: {}
    steps:
      - run: npm install --global tool
`,
    '.github/workflows/broken.yml': 'on: [unclosed\n',
  });
  assert.deepEqual(ids(dir), []);
});

test('a workflow whose aliases expand past the limit is skipped, a job repeating two builds gives two findings', () => {
  const bomb = `x: &a [${Array(9).fill('"x"').join(', ')}]\nb: &b [${Array(9).fill('*a').join(', ')}]\nc: &c [${Array(9).fill('*b').join(', ')}]\nd: &d [${Array(9).fill('*c').join(', ')}]\ne: [${Array(9).fill('*d').join(', ')}]\n`;
  const job = (name, cmd) => `  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${cmd}\n`;
  const dir = tree({
    '.github/workflows/bomb.yml': bomb,
    '.github/workflows/b.yml': `on: workflow_dispatch\njobs:\n${job('one', 'make build-a')}${job('two', 'make build-b')}  three:\n    runs-on: ubuntu-latest\n    steps:\n      - run: make build-a\n      - run: make build-b\n`,
  });
  assert.deepEqual(ids(dir), ['workflows/broad-permissions:.github/workflows/b.yml', 'workflows/repeat-build:.github/workflows/b.yml#three:one', 'workflows/repeat-build:.github/workflows/b.yml#three:two']);
});

test('findings of the own tools: a lint step that cannot fail', () => {
  const dir = tree({ '.github/workflows/ci.yml': ci({ extra: '      - run: npx eslint . || true\n      - run: ruff check .\n        continue-on-error: true\n' }) });
  assert.deepEqual(ids(dir), ['findings/lint-non-failing:.github/workflows/ci.yml#test:5', 'findings/lint-non-failing:.github/workflows/ci.yml#test:6']);
  assert.deepEqual(ids(dir, { only: ['workflows'] }), []);
});

test('duplicated code is found with the place of the first copy; distinct code and tiny runs are not', () => {
  const body = (name) => `export function ${name}(list, options) {\n${Array.from({ length: 14 }, (_, i) => `  const value${i} = list.map((item) => item.field${i} + options.offset${i}).filter(Boolean);`).join('\n')}\n  return value0;\n}\n`;
  const same = tree({ 'src/a.js': body('same'), 'src/b.js': `// copied\nimport x from 'y';\n${body('same')}` });
  const [f] = audit(ctx, same, { only: ['code'] }).findings;
  assert.equal(f.id, 'code/duplication:src/b.js:3');
  assert.equal(f.evidence.clone.file, 'src/a.js');
  assert.equal(f.evidence.clone.line, 1);
  assert.ok(f.evidence.tokens >= 100);
  assert.deepEqual(ids(tree({ 'src/a.js': body('one'), 'src/b.js': body('two').replaceAll('field', 'other') }), { only: ['code'] }), []);
  assert.deepEqual(ids(tree({ 'src/a.js': SOURCE, 'src/b.js': SOURCE }), { only: ['code'] }), []);
  const part = (file) => ({ file, hashes: Uint32Array.from({ length: 150 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0), lines: Array.from({ length: 150 }, (_, i) => i + 1) });
  assert.deepEqual(clones([part('x'), part('y')], 100), [{ file: 'y', line: 1, endLine: 150, tokens: 150, clone: { file: 'x', line: 1, endLine: 150 } }]);
});

test('duplicated tests, snapshot and fixture size, large files with the limit the project sets', () => {
  const block = (n) => `test('t${n}', () => {\n${Array.from({ length: 12 }, (_, i) => `  assert.equal(compute(${i}, 'case-${i}', { flag: true, retries: ${i} }), expected(${i}, 'case-${i}'));`).join('\n')}\n});\n`;
  const dir = tree({
    'test/a.test.js': block(1),
    'test/b.test.js': block(1),
    'test/__snapshots__/big.snap': 'x'.repeat(1200000),
    'test/fixtures/small.json': '{}',
    'src/long.js': lines(60),
    '.eslintrc.json': { rules: { 'max-lines': ['error', { max: 50 }] } },
  });
  assert.deepEqual(ids(dir), ['code/large-file:src/long.js', 'tests/duplicate:test/b.test.js:1', 'tests/snapshot-size:snapshots']);
  const r = audit(ctx, dir);
  assert.equal(r.findings.find((f) => f.id === 'code/large-file:src/long.js').evidence.limit, 50);
  assert.equal(r.findings.find((f) => f.id === 'tests/snapshot-size:snapshots').evidence.largest[0].file, 'test/__snapshots__/big.snap');
  assert.deepEqual(ids(tree({ 'src/long.js': lines(60) })), []);
  assert.deepEqual(ids(tree({ 'src/long.js': `${lines(1000)}\n` })), [], 'a trailing newline is no extra line');
  assert.deepEqual(ids(tree({ 'src/long.js': `${lines(51)}\n`, '.eslintrc.json': { rules: { 'max-lines': ['error', 50] } } })), ['code/large-file:src/long.js']);
  assert.deepEqual(ids(tree({ 'src/long.js': lines(1001) })), ['code/large-file:src/long.js']);
  assert.deepEqual(ids(tree({ 'src/long.js': lines(60), '.eslintrc': { rules: { 'max-lines': ['warn', 20] } } })), ['code/large-file:src/long.js']);
});

test('a git repository lists its files without the ignored ones; a folder is walked without node_modules and dot folders', () => {
  const dir = tree({ 'src/a.js': lines(1001, 'a'), 'node_modules/p/index.js': lines(1001, 'p'), '.hidden/x.js': lines(1001, 'h'), 'ignored/b.js': lines(1001, 'b') });
  assert.deepEqual(ids(dir), ['code/large-file:ignored/b.js', 'code/large-file:src/a.js']);
  execFileSync('git', ['-C', dir, 'init', '-q']);
  writeFileSync(join(dir, '.gitignore'), 'ignored/\nnode_modules/\n');
  assert.deepEqual(ids(dir), ['code/large-file:.hidden/x.js', 'code/large-file:src/a.js'], 'nothing is added yet, the untracked files count');
});

test('an empty folder lists every check as skipped and --only limits the groups', () => {
  const dir = tree({ 'README.md': 'x' });
  const r = audit(ctx, dir);
  assert.equal(r.ran, 0);
  assert.equal(r.skipped.length, CATALOGUE.length);
  assert.ok(r.skipped.every((s) => s.reason && s.enable));
  assert.deepEqual([...new Set(audit(ctx, dir, { only: ['tests'] }).skipped.map((s) => s.group))], ['tests']);
  assert.deepEqual(GROUPS, ['workflows', 'tests', 'code', 'findings']);
});

test('no check changes a file: the tree is the same after a run in text and in JSON mode, and the module has no write call', async () => {
  const dirs = [LINTER_ONLY(), MANY_TOOLS()];
  execFileSync('git', ['-C', dirs[1], 'init', '-q']);
  const before = dirs.map(fingerprint);
  for (const dir of dirs) {
    await run(['projects', 'audit', dir]);
    await run(['projects', 'audit', dir, '--json']);
  }
  assert.deepEqual(dirs.map(fingerprint), before);
  assert.doesNotMatch(readFileSync(new URL('../src/audit.mjs', import.meta.url), 'utf8'), /writeFile|appendFile|unlink|rmSync|renameSync|mkdirSync|copyFile|execFile|spawn/);
});

test('the finding shape is the one of the insights findings', () => {
  const shapeProblems = (f) => {
    const problems = [];
    for (const k of ['id', 'signal', 'message', 'fix']) if (typeof f[k] !== 'string' || !f[k]) problems.push(k);
    if (!['error', 'warning', 'info'].includes(f.severity)) problems.push('severity');
    if (!f.evidence || typeof f.evidence !== 'object') problems.push('evidence');
    if ('effort' in f && !['small', 'medium', 'large'].includes(f.effort)) problems.push('effort');
    return problems;
  };
  const fromInsights = insights({ doctorFindings: [{ level: 'warning', check: 'env', message: 'm', fix: 'f', file: 'x', line: 2 }] }).findings;
  const body = (n) => `test('t${n}', () => {\n${Array.from({ length: 12 }, (_, i) => `  assert.equal(compute(${i}, 'case-${i}', { flag: true, retries: ${i} }), expected(${i}, 'case-${i}'));`).join('\n')}\n});\n`;
  const everything = tree({
    'package.json': { scripts: { test: 'c8 --lines 10 node --test' } },
    'coverage/coverage-summary.json': { total: { lines: { pct: 99 } } },
    'src/long.js': lines(1001),
    'test/a.test.js': body(1),
    'test/b.test.js': body(1),
    'test/fixtures/big.json': 'x'.repeat(1200000),
    '.github/workflows/ci.yml': ci({ push: '', cache: '', pr: '', concurrency: '', extra: '      - run: npx eslint . || true\n' }),
  });
  const fromAudit = audit(ctx, everything).findings;
  assert.ok(fromAudit.length >= 8, `${fromAudit.length} findings`);
  assert.ok(new Set(fromAudit.map((f) => f.signal)).size === 4, 'every group is represented');
  for (const f of [...fromInsights, ...fromAudit]) assert.deepEqual(shapeProblems(f), [], f.id);
  assert.deepEqual(Object.keys(fromInsights[0]).filter((k) => k in fromAudit[0]).sort(), ['evidence', 'fix', 'id', 'message', 'severity', 'signal']);
  assert.equal(new Set(fromAudit.map((f) => f.id)).size, fromAudit.length, 'ids are unique');
});

async function run(args) {
  let text = '', err = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  const errOut = new Writable({ write(c, _, done) { err += c; done(); } });
  const code = await main(args, { out, err: errOut, ctx });
  return { code, text, err };
}

test('projects audit prints a Markdown report; --json one document under the envelope', async () => {
  const dir = MANY_TOOLS();
  const text = await run(['projects', 'audit', dir]);
  assert.equal(text.code, 0);
  assert.match(text.text, /^# Audit of .*\n\n3 findings \(0 error, 3 warning, 0 info\); 13 checks ran, 1 skipped\./);
  assert.match(text.text, /## workflows\n\n- \*\*warning\*\* `workflows\/duplicate-trigger:.github\/workflows\/ci.yml` .*\(\.github\/workflows\/ci\.yml:3\)\n {2}- fix \(small\): /);
  assert.match(text.text, /## tests\n/);
  assert.match(text.text, /## Skipped\n\n- `tests\/snapshot-size`: no snapshot or fixture files\./);
  const json = await run(['projects', 'audit', dir, '--json']);
  const doc = JSON.parse(json.text);
  assert.equal(json.code, 0);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.command, 'projects audit');
  assert.deepEqual(Object.keys(doc).slice(2), ['dir', 'ran', 'findings', 'skipped', 'summary']);
  assert.deepEqual(doc.summary, { error: 0, warning: 3, info: 0 });
  assert.equal(auditMarkdown(JSON.parse(json.text)), text.text);
  const only = JSON.parse((await run(['projects', 'audit', dir, '--only', 'tests,code', '--json'])).text);
  assert.deepEqual(only.findings.map((f) => f.id), ['tests/coverage-floor']);
});

test('projects audit refuses an unknown group, a missing folder and extra arguments with exit 2', async () => {
  const dir = MANY_TOOLS();
  for (const [args, message] of [
    [[dir, '--only', 'speed'], /--only takes workflows, tests, code, findings, not "speed"/],
    [[join(dir, 'gone')], /is not a folder/],
    [[dir, 'extra'], /unexpected argument extra/],
  ]) {
    const text = await run(['projects', 'audit', ...args]);
    assert.equal(text.code, 2);
    assert.match(text.text, message);
    const json = await run(['projects', 'audit', ...args, '--json']);
    assert.equal(json.code, 2);
    assert.match(JSON.parse(json.text).error, message);
  }
});
