import { expect, test } from '@playwright/test';

test('the benchmark page summarizes the runs and links to BenchKeeper-Eval', async ({ page }) => {
  await page.goto('./bench/');
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Headline numbers per run' }).locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'BenchKeeper-Eval' })).toHaveAttribute('href', 'https://github.com/ESchuderer/BenchKeeper-Eval');
  await expect(page.getByRole('link', { name: 'bench/results' })).toHaveAttribute('href', /BenchKeeper-Eval\/tree\/develop\/bench\/results$/);
  await expect(page.getByText('bench/run-brief.sh <brief>')).toBeVisible();
});
