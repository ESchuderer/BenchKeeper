// The Doctor table at phone width. Read-only, so it runs in parallel with ui.spec.mjs on the same server.
import { expect, test } from '@playwright/test';

test('Doctor at 390 px: the level badge is not cut and the fix action is on screen without a sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/dashboard');
  const table = page.getByRole('region', { name: 'Doctor' }).getByRole('table', { name: 'Doctor findings' });
  const label = table.locator('.mantine-Badge-label').first();
  await expect(label).toBeVisible();
  expect(await label.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
  const fix = table.getByRole('link', { name: /^(Plan fix|Review removal|Open settings|Plan project)$/ }).first();
  await fix.scrollIntoViewIfNeeded();
  await expect(fix).toBeInViewport({ ratio: 1 });
  expect(await table.evaluate((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth)).toBeLessThanOrEqual(0);
});
