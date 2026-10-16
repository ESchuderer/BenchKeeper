import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthly } from '../src/schedule.js';

test('same day each month, across a year end', () => {
  assert.deepEqual(monthly('2027-11-15', 3), ['2027-11-15', '2027-12-15', '2028-01-15']);
});

test('last day of shorter months, without drift', () => {
  assert.deepEqual(monthly('2027-01-31', 4), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  assert.deepEqual(monthly('2028-01-30', 2), ['2028-01-30', '2028-02-29']);
  assert.deepEqual(monthly('2100-01-29', 2), ['2100-01-29', '2100-02-28']);
});

test('invalid input throws RangeError', () => {
  assert.throws(() => monthly('2027-02-30', 1), RangeError);
  assert.throws(() => monthly('2027-01-31', 1.5), RangeError);
  assert.deepEqual(monthly('2027-01-31', 0), []);
});
