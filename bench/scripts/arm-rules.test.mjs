import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { variant } from './arm-rules.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const rules = read('rules/global.md');
const names = JSON.parse(read('bench/arms/agent-skills-names.json'));
const referenced = names.filter((n) => rules.includes(`\`${n}\``));

for (const arm of ['superpowers', 'ecc']) {
  const map = JSON.parse(read(`bench/arms/${arm}.json`));
  test(`${arm}: every agent-skills name in the rules is mapped`, () => {
    assert.deepEqual(referenced.filter((n) => !map.skills[n]), []);
  });
  test(`${arm}: no unmapped agent-skills name or mention is left`, () => {
    const out = variant(rules, map);
    const kept = Object.entries(map.skills).filter(([k, v]) => v.skill === k).map(([k]) => k);
    assert.deepEqual(names.filter((n) => !kept.includes(n) && out.includes(`\`${n}\``)), []);
    assert.ok(!out.includes('agent-skills'));
  });
}

test('renders skills, agents and missing equivalents', () => {
  const map = { text: {}, skills: { a: { skill: 'x' }, b: { agent: 'y' }, c: { none: 'z' } } };
  assert.equal(variant('`a` `b` `c` `d` a', map), '`x` the `y` agent any installed z skill `d` a');
});
