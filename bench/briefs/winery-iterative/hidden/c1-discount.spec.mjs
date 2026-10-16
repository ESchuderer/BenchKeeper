// Checkpoint 1 (changes/1.md): 10% off for 6 or more guests, on the form before booking and on the confirmation.
import { test, expect } from '@playwright/test';
import { bookButton, confirmed, fill, submit } from './helpers.mjs';

const amount = (n) => new RegExp(`(^|[^\\d.,])${n}([.,]00)?(?![\\d.,]*\\d)`);

test('C1 six or more guests get 10% off, five do not', async ({ page }) => {
  // Riesling Evening, EUR 25 per guest: 6 guests cost EUR 135 instead of 150.
  expect(await fill(page, 'Riesling Evening', 6, 'c1@example.org')).toBe(true);
  await expect(page.locator('body')).toContainText(amount(135));
  await submit(page, bookButton(page));
  await expect(confirmed(page)).toBeVisible();
  await expect(page.locator('body')).toContainText(amount(135));
  // Winter Tasting, EUR 28 per guest: 5 guests cost EUR 140, no discount.
  expect(await fill(page, 'Winter Tasting', 5, 'c1b@example.org')).toBe(true);
  await expect(page.locator('body')).toContainText(amount(140));
  await submit(page, bookButton(page));
  await expect(confirmed(page)).toBeVisible();
  await expect(page.locator('body')).toContainText(amount(140));
});
