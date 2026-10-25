import { expect, test } from '@playwright/test';

test('the benchmark page summarizes the runs and links to BenchKeeper-Eval', async ({ page }) => {
  await page.goto('./bench/');
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Headline numbers per run' }).locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'BenchKeeper-Eval' })).toHaveAttribute('href', 'https://github.com/ESchuderer/BenchKeeper-Eval');
  await expect(page.getByRole('link', { name: 'bench/results' })).toHaveAttribute('href', /BenchKeeper-Eval\/tree\/develop\/bench\/results$/);
  await expect(page.getByText('bench/run-brief.sh <brief>')).toBeVisible();
});

test('the main page links to the benchmark summary', async ({ page }) => {
  await page.goto('./');
  await page.locator('a[href="/BenchKeeper/bench/"]').first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
});

for (const [name, width] of [['phone', 375], ['desktop', 1280]]) {
  test(`the header Benchmark button opens the summary at ${name} width`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./');
    await page.getByRole('banner').getByRole('link', { name: 'Benchmark', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
  });
}

for (const path of ['./', './bench/']) {
  test(`no horizontal page scroll at phone width on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}

test('the benchmark page uses the main site header, its section links lead back to the main page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./bench/');
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'Workflow' })).toHaveAttribute('href', '/BenchKeeper/#sdlc');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Benchmark', exact: true })).toBeVisible();
});

test('the header repository widget is one link whose name starts with the repository', async ({ page }) => {
  await page.goto('./');
  const link = page.getByRole('banner').getByRole('link', { name: /^ESchuderer\/BenchKeeper/ });
  await expect(link).toHaveAttribute('href', 'https://github.com/ESchuderer/BenchKeeper');
});
