import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverage, unitCommand } from './coverage.mjs';

test('unitCommand picks node --test unit scripts only', () => {
  assert.deepEqual(unitCommand({ scripts: { test: 'node --test tests/*.test.js' } }), ['test']);
  assert.deepEqual(unitCommand({ scripts: { test: 'npm run test:unit && npm run test:e2e', 'test:unit': 'node --test tests/unit' } }), ['run', 'test:unit']);
  assert.equal(unitCommand({ scripts: { test: 'node --test tests/e2e.test.js' } }), null);
  assert.equal(unitCommand({ scripts: { test: 'playwright test' } }), null);
  assert.equal(unitCommand({}), null);
});

function app(test, files) {
  const dir = mkdtempSync(join(tmpdir(), 'cov-app-'));
  mkdirSync(join(dir, 'js')); mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test tests/*.test.js' } }));
  writeFileSync(join(dir, 'js/a.js'), 'export function a(x) {\n  if (x) return 1;\n  return 2;\n}\n');
  writeFileSync(join(dir, 'js/unused.js'), 'export function b() {\n  return 1;\n}\n');
  writeFileSync(join(dir, 'tests/a.test.js'), test);
  return dir;
}

test('coverage sees scripts run through vm with a plain path as filename', () => {
  const dir = app("import { test } from 'node:test';\nimport { readFileSync } from 'node:fs';\nimport vm from 'node:vm';\nimport { fileURLToPath } from 'node:url';\n" +
    "const f = fileURLToPath(new URL('../js/a.js', import.meta.url));\ntest('a', () => { vm.runInThisContext(readFileSync(f, 'utf8').replace('export ', '') + '\\na(1);', { filename: f }); });\n");
  const r = coverage(dir);
  assert.equal(r.reason, null);
  assert.ok(r.covered_lines >= 3, `covered ${r.covered_lines}`);
});

test('coverage maps a bare vm file name to the own file of that name in a subfolder', () => {
  const dir = app("import { test } from 'node:test';\nimport { readFileSync } from 'node:fs';\nimport vm from 'node:vm';\nimport { fileURLToPath } from 'node:url';\n" +
    "const f = fileURLToPath(new URL('../js/a.js', import.meta.url));\ntest('a', () => { vm.runInThisContext(readFileSync(f, 'utf8').replace('export ', '') + '\\na(1);', { filename: 'a.js' }); });\n");
  const r = coverage(dir);
  assert.equal(r.reason, null);
  assert.ok(r.covered_lines >= 3, `covered ${r.covered_lines}`);
});

test('coverage counts unloaded own files, null when the tests fail or are missing', () => {
  const ok = coverage(app("import { test } from 'node:test';\nimport { a } from '../js/a.js';\ntest('a', () => { a(1); });\n"));
  assert.equal(ok.reason, null);
  assert.ok(ok.line > 0 && ok.line < 100, `line ${ok.line}`);
  assert.ok(ok.branch < 100);
  const bad = coverage(app("import { test } from 'node:test';\ntest('x', () => { throw new Error('x'); });\n"));
  assert.equal(bad.line, null);
  assert.match(bad.reason, /failed/);
  assert.match(coverage(mkdtempSync(join(tmpdir(), 'cov-empty-'))).reason, /package\.json/);
});

test('a suite failing only under coverage is measured and flagged', () => {
  const r = coverage(app("import { test } from 'node:test';\nimport assert from 'node:assert';\nimport { a } from '../js/a.js';\ntest('a', () => { a(1); assert.ok(!process.env.NODE_V8_COVERAGE); });\n"));
  assert.equal(r.fails_under_coverage, true);
  assert.ok(r.line > 0);
});
