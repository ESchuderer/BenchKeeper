import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The routes of the app's sidebar (GROUPS in app/ui/App.jsx): ['id', 'Label', Component, Icon].
const sidebar = [...readFileSync(new URL('../../app/ui/App.jsx', import.meta.url), 'utf8')
  .match(/const GROUPS = \[[\s\S]*?\n\];/)![0].matchAll(/\['([a-z-]+)', '[^']+', [A-Z]/g)].map((m) => m[1]);

test('every view of the app sidebar has an entry on the app page', async ({ page }) => {
  expect(sidebar.length).toBeGreaterThan(10);
  await page.goto('./app/');
  for (const view of sidebar) await expect(page.locator(`section[data-view="${view}"]`).first(), view).toBeAttached();
});

test('the app page says its screenshots show example data', async ({ page }) => {
  await page.goto('./app/');
  await expect(page.getByText('All screenshots show example data')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test(`every screenshot of the app page loads and has alt text in ${scheme} mode`, async ({ page }) => {
    await page.goto('./app/');
    await page.evaluate((s) => document.documentElement.setAttribute('data-theme', s), scheme);
    const shots = page.locator(`img.shot-${scheme}`);
    expect(await shots.count()).toBe(await page.locator('section[data-view]').count());
    for (const img of await shots.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute('alt', /^(\S+\s+){4}\S+/);
      await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
    }
  });
}
