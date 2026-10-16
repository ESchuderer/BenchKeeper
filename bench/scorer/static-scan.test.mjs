import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { group, scan } from './static-scan.mjs';

const app = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'static-scan-'));
  for (const [n, text] of Object.entries(files)) { mkdirSync(join(dir, n, '..'), { recursive: true }); writeFileSync(join(dir, n), text); }
  return dir;
};

test('rules are grouped: core lint, sonar bug, sonar smell, security', () => {
  assert.equal(group('no-undef'), 'lint');
  assert.equal(group('sonarjs/no-identical-expressions'), 'sonar_bugs');
  assert.equal(group('sonarjs/prefer-single-boolean-return'), 'sonar_smells');
  assert.equal(group('sonarjs/no-hardcoded-passwords'), 'security');
  assert.equal(group('security/detect-eval-with-expression'), 'security');
});

test('a bug, a smell and a security issue land in their groups; clean code scores zero', async () => {
  const dir = app({
    'js/app.js': [
      'export function f(a, b, code) {',
      '  if (a == 1 && a == 1) return 1;', // bug: identical operands
      '  if (b) { return true; } else { return false; }', // smell: boolean return
      '  return eval(code);', // security: eval of a non-literal
      '}',
      'export const g = () => unknownName;', // core lint: no-undef
      '',
    ].join('\n'),
    'js/ok.js': 'export const add = (a, b) => a + b;\n',
    'js/legacy.js': 'var x = 1;\nwith (Math) { x = 2; }\n', // parses only as a script
    'node_modules/x/index.js': 'eval(foo);',
    'test/a.test.js': 'eval(foo);',
  });
  const r = await scan(dir);
  assert.equal(r.totals.files, 3);
  assert.equal(r.totals.parse_errors, 0);
  assert.equal(r.sonar_bugs.rules['sonarjs/no-identical-expressions'], 1);
  assert.equal(r.sonar_smells.rules['sonarjs/prefer-single-boolean-return'], 1);
  assert.equal(r.security.rules['security/detect-eval-with-expression'], 1);
  assert.equal(r.security.rules['sonarjs/code-eval'], 1);
  assert.equal(r.lint.rules['no-undef'], 1);
  assert.equal(r.security.per_1000_lines, +((2 * 1000) / r.totals.lines).toFixed(2));

  const clean = await scan(app({ 'js/ok.js': 'export const add = (a, b) => a + b;\n' }));
  assert.deepEqual([clean.lint.count, clean.sonar_bugs.count, clean.sonar_smells.count, clean.security.count, clean.totals.parse_errors], [0, 0, 0, 0, 0]);
  assert.equal((await scan(app({ 'js/bad.js': 'const = ;\n' }))).totals.parse_errors, 1);
});
