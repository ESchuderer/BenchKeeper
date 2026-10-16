import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { files, functions, metrics } from './erosion.mjs';

test('complexity counts decisions per function, nested functions on their own', () => {
  const fns = functions(`
export function check(a, b) {
  if (a && b) return 1;
  for (const x of a) { if (x ?? b) continue; }
  const f = () => (a ? 1 : 2);
  switch (b) { case 1: return 2; case 2: return 3; default: return 4; }
}`, 'a.js');
  assert.deepEqual(fns.map((f) => [f.name, f.complexity]), [['check', 8], ['(anonymous)', 2]]);
  assert.equal(functions('const C = ({ a }) => <p>{a && <b>x</b>}</p>;', 'c.jsx')[0].complexity, 2);
  assert.equal(functions('function t(x: number): string { return x > 1 ? "a" : "b"; }', 't.ts')[0].complexity, 2);
});

test('metrics: own source only, erosion as the share of complexity above 10', () => {
  const dir = mkdtempSync(join(tmpdir(), 'erosion-'));
  for (const d of ['src', 'node_modules/x', 'dist', 'tests']) mkdirSync(join(dir, d), { recursive: true });
  const big = `export function big(a) {\n${Array.from({ length: 11 }, (_, i) => `  if (a === ${i}) return ${i};`).join('\n')}\n}\n`;
  writeFileSync(join(dir, 'src/big.js'), big);
  writeFileSync(join(dir, 'src/small.js'), 'export const small = (a) => (a ? 1 : 0);\n');
  writeFileSync(join(dir, 'src/small.test.js'), big);
  writeFileSync(join(dir, 'node_modules/x/index.js'), big);
  writeFileSync(join(dir, 'dist/app.js'), big);
  writeFileSync(join(dir, 'tests/e.js'), big);
  writeFileSync(join(dir, 'vite.config.js'), big);
  assert.deepEqual(files(dir).sort(), ['src/big.js', 'src/small.js']);
  const m = metrics(dir);
  assert.equal(m.functions, 2);
  assert.equal(m.complexity, 14);
  assert.equal(m.max_complexity, 12);
  assert.equal(m.erosion, Math.round(1000 * 12 / 14) / 1000);
});
