// Checks the trigger eval prompt sets (bench/triggers/<collection>.json, #36 step 3): every model-invocable skill of the
// 2026-10-16 inventory has 8 should-trigger and 8 should-not-trigger queries (a skill whose description forbids its use:
// 16 should-not), at least 4 near-misses naming an existing skill, no query twice within a skill, ASCII text only, and no
// query starting with "/" (Claude Code runs a slash command itself, so the description would not be tested).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COUNTS = { 'agent-skills': 25, Superpowers: 15, ECC: 48, 'Matt-Pocock': 11, Ponytail: 6, OpenSpec: 6, 'Spec-Kit': 10, BenchKeeper: 1 };
const NEVER = new Set(['ECC/continuous-learning']); // deprecated, its description says not to invoke it
const sets = Object.fromEntries(Object.keys(COUNTS).map((c) =>
  [c, JSON.parse(readFileSync(new URL(`../triggers/${c}.json`, import.meta.url), 'utf8'))]));

for (const [col, set] of Object.entries(sets)) {
  test(`${col}: ${COUNTS[col]} skills, balanced queries, valid near-misses`, () => {
    assert.equal(Object.keys(set).length, COUNTS[col]);
    for (const [skill, items] of Object.entries(set)) {
      const id = `${col}/${skill}`, pos = items.filter((i) => i.should_trigger === true), neg = items.filter((i) => i.should_trigger === false);
      assert.deepEqual([pos.length, neg.length], NEVER.has(id) ? [0, 16] : [8, 8], id);
      assert.equal(new Set(items.map((i) => i.query)).size, items.length, `${id}: duplicate query`);
      for (const i of items) {
        assert.ok(typeof i.query === 'string' && i.query.trim().length >= 10, `${id}: short query ${i.query}`);
        assert.ok(/^[\x20-\x7E\n]*$/.test(i.query), `${id}: non-ASCII text in ${i.query}`);
        assert.ok(!i.query.trimStart().startsWith('/'), `${id}: slash command ${i.query}`);
        assert.deepEqual(Object.keys(i).filter((k) => !['query', 'should_trigger', 'near_miss_of'].includes(k)), [], id);
      }
      const near = neg.filter((i) => i.near_miss_of);
      assert.ok(near.length >= 4, `${id}: ${near.length} near-misses`);
      for (const { near_miss_of: n } of near) {
        const [c, s] = n.split('/');
        assert.ok(sets[c]?.[s] && n !== id, `${id}: near_miss_of ${n} is not another tested skill`);
      }
    }
  });
}
