import { expect, test } from '@playwright/test';

test('the overview page has no benchmark or evaluation link or text', async ({ page }) => {
  await page.goto('./overview/');
  await expect(page.locator('a[href*="BenchKeeper-research"], a[href*="EVALUATIONS"], a[href*="evaluations/"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/benchmark|evaluation|\beval/i);
});

test('every step link of the workflow ring reaches its step on the overview page', async ({ page }) => {
  await page.goto('./overview/');
  for (const href of await page.locator('.ring a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))) {
    await expect(page.locator(href!)).toHaveCount(1);
  }
});

test('the homepage links to the overview page in its body', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('main a[href$="/overview/"]')).toHaveCount(1);
});

test('the homepage features are the overview cards, each linked to its card', async ({ page }) => {
  await page.goto('./overview/');
  const ids = await page.locator('#brings [id]:not(h2)').evaluateAll((els) => els.map((e) => e.id));
  await page.goto('./');
  const hrefs = await page.locator('#features a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!.split('#')[1]));
  expect(hrefs).toEqual(ids);
});
