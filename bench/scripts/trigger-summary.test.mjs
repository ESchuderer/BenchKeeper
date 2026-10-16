import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, table } from './trigger-summary.mjs';

const result = (should_trigger, triggers, runs = 3) => ({ should_trigger, triggers, runs, trigger_rate: triggers / runs });

test('recall and precision are counted per run', () => {
  const out = { results: [result(true, 3), result(true, 1), result(false, 2), result(false, 0)], summary: { passed: 2, total: 4 } };
  const row = summarize('tdd', out);
  assert.deepEqual(row, { skill: 'tdd', pos: 6, tp: 4, neg: 6, fp: 2, passed: 2, total: 4 });
  assert.equal(table([row]).split('\n')[2], '| `tdd` | 4/6 (0.67) | 4/6 (0.67) | 2/6 (0.33) | 2/4 |');
});

test('a skill without should-trigger queries or without triggers shows n/a, not a division by zero', () => {
  const row = summarize('continuous-learning', { results: [result(false, 0), result(false, 0)], summary: { passed: 2, total: 2 } });
  assert.equal(table([row]).split('\n')[2], '| `continuous-learning` | n/a | n/a | 0/6 (0.00) | 2/2 |');
});
