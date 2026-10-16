import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daily, weekly } from '../src/schedule.js';

test('daily across a month end', () => {
  assert.deepEqual(daily('2027-02-27', 3), ['2027-02-27', '2027-02-28', '2027-03-01']);
});

test('weekly', () => {
  assert.deepEqual(weekly('2027-03-01', 3), ['2027-03-01', '2027-03-08', '2027-03-15']);
});

test('invalid input throws RangeError', () => {
  assert.throws(() => daily('2027-02-29', 1), RangeError);
  assert.throws(() => weekly('2027-03-01', -1), RangeError);
  assert.deepEqual(daily('2027-03-01', 0), []);
});
