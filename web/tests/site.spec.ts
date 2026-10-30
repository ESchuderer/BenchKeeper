import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BASE } from './base';

for (const path of ['./', './overview/', './app/', './writes/', './changelog/', './benchmark/', './404.html']) {
  test(`${path} links back to the repository and its security policy`, async ({ page }) => {
    await page.goto(path);
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="https://github.com/ESchuderer/BenchKeeper"]')).toHaveCount(1);
    await expect(footer.locator('a[href$="/SECURITY.md"]')).toHaveCount(1);
  });

  test(`${path} has no evaluation link and links the research repository only on the benchmark page`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('a[href*="EVALUATIONS"], a[href*="evaluations/"]')).toHaveCount(0);
    if (path !== './benchmark/') return await expect(page.locator('a[href*="BenchKeeper-research"]')).toHaveCount(0);
    await expect(page.locator('main a[href="https://github.com/ESchuderer/BenchKeeper-research"]')).toHaveCount(1);
  });

  test(`${path} theme button shows its state and follows the system scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(path);
    const button = page.locator('[data-theme-toggle]').first();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
    // A stored choice wins over a later system change.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  });
}

test('the sitemap lists the six pages', async ({ request }) => {
  const xml = await (await request.get('./sitemap.xml')).text();
  expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)).toEqual([BASE, `${BASE}overview/`, `${BASE}app/`, `${BASE}writes/`, `${BASE}changelog/`, `${BASE}benchmark/`]);
});

test('the writes page renders the sections of docs/setup.md and docs/security.md', async ({ page }) => {
  await page.goto('./writes/');
  const doc = page.locator('.doc');
  await expect(doc).toContainText('The app itself never: runs a command through a shell');
  await expect(doc.locator('h2#trust-boundaries + ul')).toContainText('Two exceptions.');
  await expect(doc.locator('h2#what-the-app-writes + table')).toContainText('.git is denied');
  await expect(doc.locator('h2#what-the-app-never-does + ul > li').first()).toHaveText('Run a command through a shell.');
  await expect(doc.locator('a[href="https://github.com/ESchuderer/BenchKeeper/blob/main/docs/security.md#controls-in-claude-code"]')).toHaveCount(1);
  await expect(doc.locator('a[href="https://github.com/ESchuderer/BenchKeeper/blob/main/SECURITY.md"]')).toHaveCount(1);
});

test('the changelog page shows the entries of CHANGELOG.md in its order', async ({ page }) => {
  const entries = [...readFileSync('../CHANGELOG.md', 'utf8').matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  await page.goto('./changelog/');
  await expect(page.locator('.doc h2')).toHaveText(entries);
  await expect(page.locator('.doc h1')).toHaveCount(0);
  await expect(page.locator(`footer a[href="${BASE}changelog/"]`)).toHaveCount(1);
});

test('the homepage and the footer link to the writes page', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator(`#start a[href="${BASE}writes/"]`)).toHaveCount(1);
  await expect(page.locator(`footer a[href="${BASE}writes/"]`)).toHaveCount(1);
});

test('the homepage benchmark item and the footer link to the benchmark page', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator(`#features a[href="${BASE}benchmark/"]`)).toHaveCount(1);
  await expect(page.locator(`footer a[href="${BASE}benchmark/"]`)).toHaveCount(1);
});

test('the installed parts render code and links from facts.json', async ({ page }) => {
  await page.goto('./');
  const parts = page.locator('#parts');
  await expect(parts.locator('code', { hasText: 'rules/global.md' })).toHaveCount(1);
  await expect(parts.getByRole('link', { name: 'BenchKeeper library' })).toHaveAttribute('href', /plugins\/benchkeeper\/library\/README\.md$/);
  await expect(parts).not.toContainText('[');
});
