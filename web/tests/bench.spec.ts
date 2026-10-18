import { expect, test } from '@playwright/test';

test('one summary per run: winners and top 10 by the run score, link to the run page, report link, API cost per arm', async ({ page }) => {
  await page.goto('./bench/');
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
  const run = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'winery-react, Sonnet 5.5' }) });
  await expect(run).toContainText('protocol 1.14');
  const table = run.getByRole('region', { name: /Claude Code: top 10/ });
  await expect(table.locator('tbody tr')).toHaveCount(10);
  const ratings = await table.locator('tbody tr td:nth-child(4)').allInnerTexts();
  expect(ratings.map(Number)).toEqual([...ratings.map(Number)].sort((a, b) => b - a));
  await expect(run.getByRole('link', { name: '2026-10-15-winery-react.md' })).toHaveAttribute('href', /\/blob\/main\/bench\/results\/2026-10-15-winery-react\.md$/);
  await expect(run.getByRole('link', { name: 'All arms, reviews and screenshots' })).toHaveAttribute('href', '/BenchKeeper/bench/2026-10-15-winery-react-sonnet/');
  const brownfield = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'openballistics, Sonnet 5.5' }) });
  await expect(brownfield.getByRole('region', { name: /top 10/ }).locator('tbody tr')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Skill authoring check' })).toBeVisible();
  await expect(brownfield.getByRole('region', { name: /top 10/ }).getByRole('columnheader', { name: 'API cost' })).toBeVisible();
  await expect(brownfield.getByRole('region', { name: /top 10/ }).locator('tbody tr').first()).toContainText(/\$\d+\.\d{2}/);
});

test('a run page ranks every arm and shows each arm with its rounds, review notes and screenshots', async ({ page, request }) => {
  await page.goto('./bench/2026-10-17-openballistics-sonnet/');
  await expect(page.getByRole('heading', { level: 1, name: 'openballistics, Sonnet 5.5' })).toBeVisible();
  const table = page.getByRole('region', { name: /ranked arms/ });
  await expect(table.locator('tbody tr')).toHaveCount(5);
  const scores = await table.locator('tbody tr td:nth-child(5)').allInnerTexts();
  expect(scores.map(Number)).toEqual([...scores.map(Number)].sort((a, b) => b - a));
  const ad = page.locator('#arm-AD');
  await expect(ad.getByRole('heading', { level: 4 })).toHaveCount(3);
  await expect(ad.getByText('Review notes').first()).toBeVisible();
  const img = ad.locator('.gallery img').first();
  await expect(img).toHaveAttribute('alt', /^AD, round 1: step 2, compare/);
  expect((await request.get(await img.getAttribute('src') ?? '')).status()).toBe(200);
  await expect(page.getByRole('region', { name: /ranked arms/ }).first().getByRole('columnheader', { name: 'API cost' })).toBeVisible();
});

test('the winery run page ranks runtimes apart', async ({ page }) => {
  await page.goto('./bench/2026-10-15-winery-react-sonnet/');
  await expect(page.getByRole('region', { name: /Claude Code: ranked arms/ }).locator('tbody tr')).toHaveCount(22);
  await expect(page.getByRole('region', { name: /OpenCode: ranked arms/ }).locator('tbody tr')).toHaveCount(7);
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

for (const path of ['./', './bench/', './bench/2026-10-16-cartridges-sonnet/']) {
  test(`no horizontal page scroll at phone width on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}

test('the benchmark pages use the main site header, its section links lead back to the main page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./bench/2026-10-17-openballistics-sonnet/');
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'SDLC' })).toHaveAttribute('href', '/BenchKeeper/#sdlc');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Benchmark', exact: true })).toBeVisible();
});
