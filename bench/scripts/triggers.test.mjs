// Checks the trigger eval prompt sets (bench/triggers/<collection>.json, #36 step 3): every model-invocable skill of the
// 2026-10-16 inventory has 8 should-trigger and 8 should-not-trigger queries (a skill whose description forbids its use:
// 16 should-not), at least 4 near-misses naming a sibling installed in the same container, no query twice within a skill,
// no query naming an installed skill, ASCII text only, and no query starting with "/" (Claude Code runs a slash command
// itself, so the description would not be tested).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Skills without `disable-model-invocation: true` per collection, from the SKILL.md files in the arm images (extracted as
// in bench/scripts/skill-lint.sh, checked 2026-10-16): none of agent-skills, Superpowers, ECC (48 SKILL.md files), Ponytail,
// OpenSpec and Spec Kit has the flag; Matt Pocock: 16 of the 27 skills its plugin.json lists have it. BenchKeeper: read
// from skills/ here.
const bk = readdirSync(new URL('../../skills/', import.meta.url)).filter((d) =>
  !/^disable-model-invocation: true$/m.test(readFileSync(new URL(`../../skills/${d}/SKILL.md`, import.meta.url), 'utf8'))).length;
const COUNTS = { 'agent-skills': 25, Superpowers: 15, ECC: 48, 'Matt-Pocock': 27 - 16, Ponytail: 6, OpenSpec: 6, 'Spec-Kit': 10, BenchKeeper: bk };
const NEVER = new Set(['ECC/continuous-learning']); // deprecated, its description says not to invoke it
const sets = Object.fromEntries(Object.keys(COUNTS).map((c) =>
  [c, JSON.parse(readFileSync(new URL(`../triggers/${c}.json`, import.meta.url), 'utf8'))]));

// Only the collection's own skills are installed in its eval container (BenchKeeper's beside agent-skills).
const installed = (col) => (col === 'BenchKeeper' ? [col, 'agent-skills'] : [col]);
// Names a query must not contain, so recall measures the description: the hyphenated names of the installed skills
// (case-insensitive) and the spec tools' command words.
const named = (col) => [...installed(col).flatMap((c) => Object.keys(sets[c]).filter((s) => s.includes('-'))), 'opsx', 'speckit'];

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
        for (const n of named(col)) assert.ok(!i.query.toLowerCase().includes(n), `${id}: names ${n}: ${i.query}`);
        assert.deepEqual(Object.keys(i).filter((k) => !['query', 'should_trigger', 'near_miss_of'].includes(k)), [], id);
      }
      const near = neg.filter((i) => i.near_miss_of);
      assert.ok(near.length >= 4, `${id}: ${near.length} near-misses`);
      for (const { near_miss_of: n } of near) {
        const [c, s] = n.split('/');
        assert.ok(installed(col).includes(c) && sets[c]?.[s] && n !== id, `${id}: near_miss_of ${n} is not another skill installed beside it`);
      }
    }
  });
}
