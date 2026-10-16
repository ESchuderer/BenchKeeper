// Checkpoint 2 (changes/2.md): staff add a tasting that appears on the start page and can be booked.
import { test, expect } from '@playwright/test';
import { book, confirmed, field, seatsLeft, signIn, submit } from './helpers.mjs';

test('C2 staff add a tasting that guests can book', async ({ page }) => {
  await signIn(page);
  await field(page, 'Title').fill('Autumn Sparkling');
  const when = field(page, 'Date and time');
  const type = await when.getAttribute('type');
  await when.fill(type === 'datetime-local' ? '2026-12-12T16:00' : type === 'date' ? '2026-12-12' : '2026-12-12 16:00');
  await field(page, 'Price per guest').fill('30');
  await field(page, 'Seats').fill('6');
  await submit(page, page.getByRole('button', { name: 'Add tasting' }));
  await expect.poll(() => seatsLeft(page, 'Autumn Sparkling')).toBe(6);
  expect(await book(page, 'Autumn Sparkling', 2, 'c2@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  expect(await seatsLeft(page, 'Autumn Sparkling')).toBe(4);
});
