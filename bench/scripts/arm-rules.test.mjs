import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { base, DROPPED } from './arm-rules.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const rules = read('rules/global.md');
const names = JSON.parse(read('bench/arms/agent-skills-names.json'));

test('base rules name no agent-skills skill and set no workflow', () => {
  const out = base(rules);
  assert.deepEqual(names.filter((n) => out.includes(`\`${n}\``)), []);
  assert.ok(!out.includes('agent-skills'));
  for (const h of DROPPED) assert.ok(!out.includes(`## ${h}`), h);
});

test('base rules keep every other section unchanged', () => {
  const out = base(rules);
  for (const h of ['Ask, do not assume', 'Scope', 'Safety', 'Context economy']) {
    const section = rules.split(/^(?=## )/m).find((s) => s.startsWith(`## ${h}\n`));
    assert.ok(out.includes(section.trimEnd()), h);
  }
});

test('fails when a dropped section is renamed', () => {
  assert.throws(() => base('## Scope\n- x\n'), /sections not found/);
});
