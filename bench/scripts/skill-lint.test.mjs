import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintCollection } from './skill-lint.mjs';

const lines = (n, first = '') => [first, ...Array.from({ length: n }, (_, i) => `line ${i}`)].join('\n');
const skill = (root, dir, fm, body, files = {}) => {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, 'SKILL.md'), `---\n${fm}\n---\n${body}\n`);
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(root, dir, f, '..'), { recursive: true }); writeFileSync(join(root, dir, f), text); }
};

test('a skill that follows the guide passes every check; the collection ships evaluations', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-good-'));
  skill(root, 'processing-pdfs', 'name: processing-pdfs\ndescription: "Extracts text from PDF files. Use when the user mentions PDFs."',
    'See [the guide](reference/guide.md).', { 'reference/guide.md': lines(120, '## Contents\n- Setup\n- Usage') });
  skill(root, 'analyzing-data', 'name: analyzing-data\ndescription: Analyzes CSV files. Use when working with tabular data.', 'Short body.\n```js\nnew Date("2025-01-01");\n```');
  mkdirSync(join(root, 'evals')); writeFileSync(join(root, 'evals', 'evals.json'), '[]');
  const c = lintCollection('good', root);
  assert.equal(c.skills.length, 2);
  for (const s of c.skills) assert.deepEqual(s.failed, [], `${s.name}: ${s.failed}`);
  assert.equal(c.evals, true);
  assert.equal(c.naming, 'gerund 2 of 2');
});

test('each guide violation fails exactly its check', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-bad-'));
  skill(root, 'helper', 'name: claude-helper\ndescription: I can help you with files.',
    `${lines(510)}\nAs of 2025-08-01 use the old API.\nCall the MCP tool \`browser_navigate\` first.\nSee [advanced](advanced.md) and scripts\\run.py.`,
    { 'advanced.md': `${lines(150)}\nSee [details](details.md).`, 'details.md': 'x' });
  skill(root, 'long-description', `name: long-description\ndescription: "${'Processes data. '.repeat(70)}Use when needed."`, 'Body.');
  skill(root, 'xml', 'name: xml\ndescription: Processes <b>files</b>. Use when asked.', 'Body.');
  const c = lintCollection('bad', root);
  const by = Object.fromEntries(c.skills.map((s) => [s.dir, s.failed.sort()]));
  assert.deepEqual(by.helper, ['body-lines', 'dated-text', 'desc-third-person', 'desc-when', 'mcp-qualified', 'name-valid', 'nested-refs', 'ref-toc', 'windows-paths']);
  assert.deepEqual(by['long-description'], ['desc-length']);
  assert.deepEqual(by.xml, ['desc-xml']);
  assert.equal(c.evals, false);
});
