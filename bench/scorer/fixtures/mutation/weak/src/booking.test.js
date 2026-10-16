import { expect, test } from 'vitest';
import { seatsLeft, validate } from './booking.js';

// Runs the code without checking what it returns.
test('booking functions run', () => {
  expect(seatsLeft(12, [{ guests: 3 }])).toBeDefined();
  expect(validate({ name: 'Erika', email: 'e@example.org', guests: 2 }, 5)).toBeTypeOf('object');
});
