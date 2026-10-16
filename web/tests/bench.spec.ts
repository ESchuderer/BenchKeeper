import { expect, test } from '@playwright/test';

test('one summary per run: setup, ranked table, report link, no cost figures', async ({ page }) => {
  await page.goto('./bench/');
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
  const run = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'winery-react, Sonnet 5.5' }) });
  await expect(run).toContainText('protocol 1.14');
  const table = run.getByRole('region', { name: /Claude Code: ranked arms/ });
  await expect(table.locator('tbody tr')).toHaveCount(22);
  const ratings = await table.locator('tbody tr td:nth-child(6)').allInnerTexts();
  expect(ratings.map(Number)).toEqual([...ratings.map(Number)].sort((a, b) => b - a));
  await expect(run.getByRole('link', { name: '2026-10-15-winery-react.md' })).toHaveAttribute('href', /\/blob\/main\/bench\/results\/2026-10-15-winery-react\.md$/);
  await expect(page.getByRole('link', { name: 'Skill authoring check' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/USD|\$\s?\d|\bcosts?\b/i);
});

test('the main page links to the benchmark summary', async ({ page }) => {
  await page.goto('./');
  await page.locator('a[href="/BenchKeeper/bench/"]').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
});

test('no horizontal page scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('./bench/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
