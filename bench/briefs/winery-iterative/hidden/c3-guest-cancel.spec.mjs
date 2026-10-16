// Checkpoint 3 (changes/3.md): guests cancel with the reference and email; a wrong email cancels nothing.
import { test, expect } from '@playwright/test';
import { book, confirmed, field, seatsLeft, signIn, submit } from './helpers.mjs';

// The booking reference: a token of the confirmation that the staff list also shows next to the booking's email.
async function reference(page, email, confirmation) {
  await signIn(page);
  const row = (await page.locator('body *').filter({ hasText: email }).last().innerText()).trim();
  const tokens = row.split(/[\s,;:()|]+/).map((t) => t.replace(/[.#]+$/, '').replace(/^#/, ''))
    .filter((t) => t.length >= 4 && /\d/.test(t) && !t.includes('@') && confirmation.includes(t));
  expect(tokens.length, `a reference shared by the confirmation and the staff row: ${row}`).toBeGreaterThan(0);
  return tokens.sort((a, b) => b.length - a.length)[0];
}

async function cancel(page, ref, email) {
  await page.goto('/cancel');
  await field(page, 'Booking reference').fill(ref);
  await field(page, 'Email').fill(email);
  await submit(page, page.getByRole('button', { name: 'Cancel booking' }));
}

test('C3 guests cancel their own booking; a wrong email cancels nothing', async ({ page }) => {
  const before = await seatsLeft(page, 'Riesling Evening');
  expect(await book(page, 'Riesling Evening', 1, 'c3@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  const ref = await reference(page, 'c3@example.org', await page.locator('body').innerText());
  await cancel(page, ref, 'someone-else@example.org');
  await expect(page.getByRole('heading', { name: 'Booking cancelled' })).toHaveCount(0);
  expect(await seatsLeft(page, 'Riesling Evening')).toBe(before - 1);
  await cancel(page, ref, 'c3@example.org');
  await expect(page.getByRole('heading', { name: 'Booking cancelled' })).toBeVisible();
  expect(await seatsLeft(page, 'Riesling Evening')).toBe(before);
});
