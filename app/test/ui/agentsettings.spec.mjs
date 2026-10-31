// The Agent settings tables at phone width. Read-only, so it runs in parallel with the serial chain (ui-<n>-*.spec.mjs) on the same server.
import { expect, test } from '@playwright/test';

test('Agent settings at 390 px: the first value control is on screen without a sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/agent-settings');
  const scroller = page.getByRole('region', { name: /, scrollable$/ }).first();
  const control = scroller.getByLabel(/ value$/).first();
  await expect(control).toBeVisible();
  // Scrolling the control into view would also scroll its table sideways, so the check reads where it sits unscrolled.
  expect(await control.evaluate((e) => e.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  expect(await scroller.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0);
});
