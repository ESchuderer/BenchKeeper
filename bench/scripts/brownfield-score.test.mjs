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

test('scoreBrief: hidden, static, suite and process checks per step with the brief\'s weights', async () => {
  const { scoreBrief } = await import('./brownfield-score.mjs');
  const conf = { weights: { hidden: 35, suite: 10, static: 15, process: 15, review: 25 }, hidden: { 1: 2, 2: 2 }, static: { 1: 1, 2: 1 }, process: { 1: ['plan_first', 'verified'], 2: ['verified'] } };
  const trial = { steps: [
    { k: 1, checks: [{ id: 'S1-a', ok: true }, { id: 'S1-b', ok: false }, { id: 'Q1-tests', ok: true }], suite_ok: true, workflow: { plan_first: true, verified: false, skills: ['tdd'] }, minutes: 5 },
  ] };
  const r = scoreBrief(trial, [{ review: { scores: { a: 5, b: 3 } } }], conf);
  // step 2 not reached: its checks count as failed
  assert.deepEqual(r.raw, { hidden_checks: '1/4', static_checks: '1/2', process_checks: '1/3', suite_steps: 1, review_criteria: 2 });
  assert.deepEqual(r.parts, { hidden: 8.75, suite: 5, static: 7.5, process: 5, review: 18.75 });
  assert.equal(r.total, 45);
  assert.deepEqual(r.skills, ['tdd']);
  assert.equal(scoreBrief(trial, [], conf).total, null);
});
