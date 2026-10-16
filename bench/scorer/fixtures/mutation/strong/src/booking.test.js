import { describe, expect, test } from 'vitest';
import { seatsLeft, validate } from './booking.js';

describe('booking', () => {
  test('seats left subtract every booking', () => {
    expect(seatsLeft(12, [{ guests: 3 }, { guests: 2 }])).toBe(7);
    expect(seatsLeft(8, [])).toBe(8);
  });
  test('valid input has no errors', () => {
    expect(validate({ name: 'Erika', email: 'e@example.org', guests: 2 }, 5)).toEqual({});
  });
  test('each invalid field gets its error', () => {
    expect(validate({ name: ' ', email: 'e@example.org', guests: 1 }, 5)).toEqual({ name: 'Enter your name.' });
    expect(validate({ name: 'Erika', email: 'nope', guests: 1 }, 5)).toEqual({ email: 'Enter a valid email address.' });
    for (const guests of [0, 9, 2.5]) expect(validate({ name: 'Erika', email: 'e@example.org', guests }, 9)).toEqual({ guests: 'Guests must be 1 to 8.' });
    expect(validate({ name: 'Erika', email: 'e@example.org', guests: 1 }, 9).guests).toBeUndefined();
    expect(validate({ name: 'Erika', email: 'e@example.org', guests: 8 }, 9).guests).toBeUndefined();
  });
  test('more guests than seats left', () => {
    expect(validate({ name: 'Erika', email: 'e@example.org', guests: 4 }, 3)).toEqual({ guests: 'Only 3 seats left.' });
    expect(validate({ name: 'Erika', email: 'e@example.org', guests: 3 }, 3)).toEqual({});
  });
});
