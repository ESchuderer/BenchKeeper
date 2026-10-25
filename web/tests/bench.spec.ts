import { expect, test } from '@playwright/test';
import { BASE } from './base';

test('one summary per run: top 10 by the run score, link to the run page, report link, API cost per arm', async ({ page }) => {
  await page.goto('./bench/');
  await expect(page.getByRole('heading', { level: 1, name: 'Benchmarks' })).toBeVisible();
  const run = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'mistreevous, Sonnet 5.5' }) });
  await expect(run).toContainText('protocol 1.21');
  const table = run.getByRole('region', { name: /top 10/ });
  await expect(table.locator('tbody tr')).toHaveCount(10);
  const scores = await table.locator('tbody tr td:nth-child(4)').allInnerTexts();
  expect(scores.map(Number)).toEqual([...scores.map(Number)].sort((a, b) => b - a));
  await expect(run.getByRole('link', { name: '2026-10-18-mistreevous.md' })).toHaveAttribute('href', /\/blob\/main\/bench\/results\/2026-10-18-mistreevous\.md$/);
  await expect(run.getByRole('link', { name: 'All arms and reviews' })).toHaveAttribute('href', `${BASE}bench/2026-10-18-mistreevous-sonnet/`);
  await expect(table.getByRole('columnheader', { name: 'API cost' })).toBeVisible();
  await expect(table.locator('tbody tr').first()).toContainText(/\$\d+\.\d{2}/);
  const opusplan = page.locator('section', { has: page.getByRole('heading', { level: 2, name: 'mistreevous, opusplan' }) });
  await expect(opusplan.getByRole('region', { name: /top 10/ }).locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Skill authoring check' })).toBeVisible();
});

test('a run page ranks every arm and shows each arm with its rounds and review notes', async ({ page }) => {
  await page.goto('./bench/2026-10-18-mistreevous-sonnet/');
  await expect(page.getByRole('heading', { level: 1, name: 'mistreevous, Sonnet 5.5' })).toBeVisible();
  const table = page.getByRole('region', { name: /ranked arms/ });
  await expect(table.locator('tbody tr')).toHaveCount(12);
  const scores = await table.locator('tbody tr td:nth-child(5)').allInnerTexts();
  expect(scores.map(Number)).toEqual([...scores.map(Number)].sort((a, b) => b - a));
  const al = page.locator('#arm-AL');
  await expect(al.getByRole('heading', { level: 4 })).toHaveCount(3);
  await expect(al.getByText('Review notes').first()).toBeVisible();
  await expect(al.locator('img')).toHaveCount(0);
  await expect(table.getByRole('columnheader', { name: 'API cost' })).toBeVisible();
});

test('the main page links to the benchmark summary', async ({ page }) => {
  await page.goto('./');
  await page.locator(`a[href="${BASE}bench/"]`).first().click();
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

for (const path of ['./', './bench/', './bench/2026-10-18-mistreevous-sonnet/']) {
  test(`no horizontal page scroll at phone width on ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });
}

test('the benchmark pages use the main site header, its section links lead back to the main page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./bench/2026-10-18-mistreevous-sonnet/');
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Sections' });
  await expect(nav.getByRole('link', { name: 'Workflow' })).toHaveAttribute('href', `${BASE}#sdlc`);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Benchmark', exact: true })).toBeVisible();
});

test('the header repository widget is one link whose name starts with the repository', async ({ page }) => {
  await page.goto('./');
  const link = page.getByRole('banner').getByRole('link', { name: /^ESchuderer\/BenchKeeper/ });
  await expect(link).toHaveAttribute('href', 'https://github.com/ESchuderer/BenchKeeper');
});
