// Hidden acceptance tests for the winery brief. Never mounted into the agent sandbox.
// One test per required feature. They run in order against one app instance; each makes its own
// bookings and checks seat counts relative to what it read, so one failing feature does not fail or skip the others.
import { test, expect } from '@playwright/test';
import { book, confirmed, field, scan, seatsLeft, signIn, submit, PASSWORD } from './helpers.mjs';

test('F1 start page lists tastings with seats left', async ({ page }) => {
  for (const [t, n] of [['Riesling Evening', 12], ['Red Wine Cellar Tour', 8], ['Winter Tasting', 10]]) {
    expect(await seatsLeft(page, t), t).toBe(n);
  }
  await scan(page, 'start');
});

test('F2 booking shows confirmation and takes seats', async ({ page }) => {
  const before = await seatsLeft(page, 'Red Wine Cellar Tour');
  expect(await book(page, 'Red Wine Cellar Tour', 2, 'f2@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  await expect(page.locator('body')).toContainText('Red Wine Cellar Tour');
  await expect(page.locator('body')).toContainText(/64/);
  await scan(page, 'confirmation');
  expect(await seatsLeft(page, 'Red Wine Cellar Tour')).toBe(before - 2);
});

test('F3 booking more seats than left is rejected', async ({ page }) => {
  // Bring the tasting below 8 seats first, so the request is valid except for capacity.
  expect(await book(page, 'Red Wine Cellar Tour', 2, 'f3@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  const left = await seatsLeft(page, 'Red Wine Cellar Tour');
  expect(left).toBeLessThan(8);
  await book(page, 'Red Wine Cellar Tour', left + 1, 'f3b@example.org');
  await expect(confirmed(page)).toHaveCount(0);
  expect(await seatsLeft(page, 'Red Wine Cellar Tour')).toBe(left);
});

test('F4 invalid email is rejected', async ({ page }) => {
  const before = await seatsLeft(page, 'Winter Tasting');
  expect(await book(page, 'Winter Tasting', 1, 'not-an-email')).toBe(true);
  await expect(confirmed(page)).toHaveCount(0);
  await scan(page, 'form');
  expect(await seatsLeft(page, 'Winter Tasting')).toBe(before);
});

test('F5 staff page needs the password', async ({ page }) => {
  expect(await book(page, 'Winter Tasting', 1, 'f5@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  await page.goto('/staff');
  await expect(page.locator('body')).not.toContainText('f5@example.org');
  await field(page, 'Password').fill('wrong-password');
  await submit(page, page.getByRole('button', { name: 'Sign in' }));
  await expect(page.locator('body')).not.toContainText('f5@example.org');
  // A wrong password must leave the sign-in form or an error message on screen, not the bookings.
  await expect(field(page, 'Password').or(page.getByText(/wrong|incorrect|invalid|failed/i)).first()).toBeVisible();
  await page.goto('/staff');
  await field(page, 'Password').fill(PASSWORD);
  await submit(page, page.getByRole('button', { name: 'Sign in' }));
  await expect(page.locator('body')).toContainText('f5@example.org');
  await expect(page.locator('body')).toContainText('Erika Probe');
  await scan(page, 'staff');
});

test('F6 cancelling frees the seats', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const before = await seatsLeft(page, 'Riesling Evening');
  expect(await book(page, 'Riesling Evening', 3, 'f6@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  expect(await seatsLeft(page, 'Riesling Evening')).toBe(before - 3);
  await signIn(page);
  const cancel = page.getByRole('button', { name: 'Cancel' });
  // Wait for the cancel request itself: a single-page app sends it in the background, and leaving the page aborts it.
  await submit(page, page.locator('body *').filter({ hasText: 'f6@example.org' }).filter({ has: cancel }).last().locator(cancel).first());
  await expect.poll(() => seatsLeft(page, 'Riesling Evening')).toBe(before);
});
