import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { check } from './claims.mjs';

const facts = JSON.parse(readFileSync(new URL('../../web/src/data/facts.json', import.meta.url), 'utf8'));
const part = (evidence) => ({ overview: { parts: [{ title: 'Demo', text: 'Does a thing.', evidence }] } });
const tool = (evidence) => ({ parallelTools: [{ name: 'Tool', url: 'https://example.org/tool', evidence }] });

test('every claim in facts.json has evidence that resolves', () => {
  assert.deepEqual(check(facts), []);
});
test('evidence kinds that pass', () => {
  for (const e of ['docs/setup.md#accounts', 'docs/automations.md', 'app/test/cli.test.mjs', 'https://github.com/ESchuderer/BenchKeeper-research/blob/main/README.md', ['docs/setup.md', 'app/package.json']]) {
    assert.deepEqual(check(part(e)), [], String(e));
  }
  assert.deepEqual(check(tool(['https://example.org/tool/docs', 'docs/stack.md#recommended-tools-optional'])), []);
  assert.deepEqual(check({ tagline: 'Does a thing.', evidence: { tagline: 'docs/setup.md' } }), []);
  assert.deepEqual(check({ quickstart: { paths: [{ steps: [{ text: 'Runs.', evidence: 'app/test/cli.test.mjs' }] }] } }), []);
});
test('failing fixture: each kind of bad evidence is reported', () => {
  const cases = [
    [undefined, /"Demo": no evidence/],
    [[], /no evidence/],
    ['unverified', /file not found: unverified/],
    ['docs/missing.md', /file not found: docs\/missing\.md/],
    [['docs/setup.md', 'docs/missing.md'], /file not found: docs\/missing\.md/],
    ['docs/setup.md#no-such-heading', /no heading for #no-such-heading/],
    ['app/test/cli.test.mjs#plan writes nothing', /only a Markdown heading/],
    ['README.md', /generated from facts\.json/],
    ['https://example.org/benchmark', /only BenchKeeper-research results/],
  ];
  for (const [e, re] of cases) {
    const errors = check(part(e));
    assert.equal(errors.length, 1, String(e));
    assert.match(errors[0], re);
  }
  const dir = mkdtempSync(join(tmpdir(), 'claims-'));
  writeFileSync(join(dir, 'doc.md'), '## Levels\n\n<!-- generated:levels -->\n| Level |\n<!-- /generated:levels -->\n');
  assert.match(check(part('doc.md#levels'), dir)[0], /#levels in doc\.md holds only generated text/);
  rmSync(dir, { recursive: true });
  assert.match(check(tool('https://example.org/tool'))[0], /"Tool": what BenchKeeper says needs a repository file/);
  assert.match(check({ tagline: 'Does a thing.' })[0], /facts\.tagline: no evidence/);
  assert.match(check({ quickstart: { paths: [{ steps: [{ text: 'Runs.' }] }] } })[0], /facts\.quickstart\.paths\[0\]\.steps\[0\]: no evidence/);
  assert.match(check({ evidence: { tagline: 'docs/setup.md' } })[0], /facts\.evidence\["tagline"\]: no such string claim/);
  assert.match(check({ pricing: 'Costs less.' })[0], /facts\.pricing: not a known claim/);
});
