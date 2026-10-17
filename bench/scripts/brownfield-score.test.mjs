import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from './brownfield-score.mjs';

const checks = (prefix, n, ok = n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}`, ok: i < ok }));
const step = (k, s, x = []) => ({ k, checks: [...s, ...x], suite_ok: true, minutes: 2, cost_usd_api_equivalent: 1 });
const review = (v) => ({ review: { scores: { a: v, b: { score: v } } } });

test('all checks and a perfect review give 100', () => {
  const t = { steps: [step(1, checks('S1', 14)), step(2, checks('S2', 7), checks('X2', 3)), step(3, checks('S3', 3), checks('X3', 3))] };
  const r = score(t, [review(5), review(5)]);
  assert.equal(r.total, 100);
  assert.deepEqual(r.raw, { step_checks: '24/24', cross_checks: '6/6', suite_steps: 3, review_criteria: 4 });
  assert.equal(r.minutes, 6);
});

test('a step not reached counts its checks as failed; null cross checks are not counted; review 1 to 5 maps to 0 to 35', () => {
  const t = { steps: [step(1, checks('S1', 14, 7)), step(2, checks('S2', 7), [{ id: 'X2-ci', ok: null }, ...checks('X2-c', 2, 1)])] };
  const r = score(t, [review(3)]);
  assert.equal(r.raw.step_checks, '14/24');
  assert.equal(r.raw.cross_checks, '1/5');
  assert.equal(r.parts.review, 17.5);
  assert.equal(r.parts.suite, 6.67);
});

test('no review gives no total', () => {
  assert.equal(score({ steps: [] }, []).total, null);
});
