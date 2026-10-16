import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { typeErrors } from './types.mjs';

test('counts type errors in own source only, with node globals and the DOM known', () => {
  const dir = mkdtempSync(join(tmpdir(), 'types-'));
  for (const d of ['js', 'node_modules/x', 'test']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'js/a.js'), "const n = document.title.length;\nmodule.exports = { n };\n/** @type {number} */\nconst bad = 'x';\nconsole.log(bad, nope);\n");
  writeFileSync(join(dir, 'node_modules/x/i.js'), '/** @type {number} */\nconst bad = "x";\n');
  writeFileSync(join(dir, 'test/t.js'), '/** @type {number} */\nconst bad = "x";\n');
  const r = typeErrors(dir);
  assert.equal(r.errors, 2);
  assert.deepEqual(r.codes, { TS2322: 1, TS2304: 1 });
  assert.equal(r.source_lines, 5);
  assert.equal(r.per_1000_lines, 400);
});
