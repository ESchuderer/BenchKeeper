import { expect, test } from '@playwright/test';

const rows = (page) => page.locator('[data-trial-row]:not([hidden])');

test('the overview lists the briefs and opens one', async ({ page }) => {
  await page.goto('./bench/');
  await page.getByRole('link', { name: 'winery-react' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Brief winery-react' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/USD|\$\s?\d/);
});

test('a brief lists every trial, without cost figures', async ({ page }) => {
  await page.goto('./bench/winery-react/');
  const all = await page.locator('[data-trial-row]').count();
  expect(all).toBeGreaterThan(0);
  await expect(page.locator('[data-card]')).toHaveCount(all);
  await expect(page.locator('body')).not.toContainText(/USD|\$\s?\d/);
});

test('filters from the URL, keeps cards in step, and resets', async ({ page }) => {
  await page.goto('./bench/winery-react/?runtime=OpenCode&model=Haiku+5.5');
  await expect(page.getByLabel('Runtime')).toHaveValue('OpenCode');
  const n = await rows(page).count();
  expect(n).toBeGreaterThan(0);
  for (const r of await rows(page).all()) {
    await expect(r).toHaveAttribute('data-runtime', 'OpenCode');
    await expect(r).toHaveAttribute('data-model', 'Haiku 5.5');
  }
  await expect(page.locator('[data-card]:not([hidden])')).toHaveCount(n);
  await expect(page.locator('[data-count]')).toContainText(`${n} of`);
  await page.getByLabel('Search').fill('oso');
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/q=oso/);
  await page.getByRole('button', { name: 'Reset' }).click();
  await expect(rows(page)).toHaveCount(await page.locator('[data-trial-row]').count());
});

test('sorts by review rating', async ({ page }) => {
  await page.goto('./bench/winery-react/');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const ratings = (await rows(page).evaluateAll((rs) => rs.map((r) => Number(r.getAttribute('data-overall')))));
  expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  await expect(page.locator('th:has([data-sort="overall"])')).toHaveAttribute('aria-sort', 'descending');
});

test('the main page links to the database', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'benchmark database' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmark database' })).toBeVisible();
});
