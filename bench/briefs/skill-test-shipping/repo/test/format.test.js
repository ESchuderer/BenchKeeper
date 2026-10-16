import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCents } from '../src/format.js';

test('formatCents', () => {
  assert.equal(formatCents(1234), '12.34 EUR');
  assert.equal(formatCents(5), '0.05 EUR');
});
