import { expect, test } from '@playwright/test';

test('the app page says its screenshots show example data', async ({ page }) => {
  await page.goto('./app/');
  await expect(page.getByText('All screenshots show example data')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  test(`every screenshot of the app page loads and has alt text in ${scheme} mode`, async ({ page }) => {
    await page.goto('./app/');
    await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
    const shots = page.locator(`img.shot-${scheme}`);
    expect(await shots.count()).toBe(12);
    for (const img of await shots.all()) {
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect(img).toHaveAttribute('alt', /^(\S+\s+){4}\S+/);
      await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(0);
    }
  });
}
