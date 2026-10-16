import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeDocs, decisionRecords, docs, readmeAccuracy } from './docs.mjs';

test('codeDocs: named functions, adjacent comments, exports, comment density', () => {
  const r = codeDocs(`// header
/** Adds. */
export function add(a, b) { return a + b; }

export const sub = (a, b) => a - b; // trailing is not a leading comment
// helper
const helper = function () { return [1].map((x) => x); };
function undocumented() {}
module.exports = { helper };
`, 'a.js');
  assert.deepEqual([r.functions, r.documented, r.exported, r.exported_documented], [4, 2, 3, 2]);
  assert.deepEqual([r.code_lines, r.comment_lines], [5, 3]);
});

test('codeDocs: comment lines after a character outside the BMP', () => {
  const d = codeDocs("const s = '\u{1F600}';\n// note\nf();\n", 'a.js');
  assert.deepEqual([d.code_lines, d.comment_lines], [2, 1]);
});

test('readmeAccuracy: npm scripts and paths must exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-'));
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'js/app.js'), '');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', lint: 'x' } }));
  const r = readmeAccuracy(dir, 'Run `npm test` and npm run lint, npm run build, npm start. See `js/app.js`, `js/gone.js`, [x](docs/a.md) and [y](https://x.org), `text/css`.');
  assert.deepEqual(r.wrong.sort(), ['npm run build', 'npm start', 'path docs/a.md', 'path js/gone.js']);
  assert.equal(r.checked, 7);
});

test('decisionRecords and docs on a small app', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docs-'));
  mkdirSync(join(dir, 'docs/adr'), { recursive: true });
  writeFileSync(join(dir, 'docs/adr/0001-x.md'), '# x');
  writeFileSync(join(dir, 'CHANGELOG.md'), '');
  mkdirSync(join(dir, 'js'));
  writeFileSync(join(dir, 'js/a.js'), '/** A. */\nfunction a() {}\n');
  writeFileSync(join(dir, 'README.md'), '# App\n\nA reference database of cartridges for engineers.\n\n## Run\n\nOpen `index.html`.\n');
  assert.deepEqual(decisionRecords(dir), { adr: true, changelog: false, spec: false, count: 1 });
  const d = docs(dir);
  assert.equal(d.code.documented_share, 100);
  assert.equal(d.code.exported_share, null);
  assert.equal(d.readme.coverage.purpose, true);
  assert.equal(d.readme.coverage.run, true);
  assert.equal(d.readme.coverage.test, false);
  assert.equal(docs(mkdtempSync(join(tmpdir(), 'docs-'))).readme, null);
});
