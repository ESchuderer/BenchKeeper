import { expect, test } from '@playwright/test';
import { BASE } from './base';

for (const path of ['./', './overview/', './app/', './404.html']) {
  test(`${path} links back to the repository and its security policy`, async ({ page }) => {
    await page.goto(path);
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="https://github.com/ESchuderer/BenchKeeper"]')).toHaveCount(1);
    await expect(footer.locator('a[href$="/SECURITY.md"]')).toHaveCount(1);
  });

  test(`${path} has no benchmark or evaluation link besides the homepage feature item`, async ({ page }) => {
    await page.goto(path);
    const links = page.locator('a[href*="BenchKeeper-research"], a[href*="EVALUATIONS"], a[href*="evaluations/"]');
    if (path !== './') return await expect(links).toHaveCount(0);
    await expect(links).toHaveCount(1);
    await expect(page.locator('#features a[href="https://github.com/ESchuderer/BenchKeeper-research"]')).toHaveCount(1);
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

test('the sitemap lists the three pages', async ({ request }) => {
  const xml = await (await request.get('./sitemap.xml')).text();
  expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)).toEqual([BASE, `${BASE}overview/`, `${BASE}app/`]);
});

test('the installed parts render code and links from facts.json', async ({ page }) => {
  await page.goto('./');
  const parts = page.locator('#parts');
  await expect(parts.locator('code', { hasText: 'rules/global.md' })).toHaveCount(1);
  await expect(parts.getByRole('link', { name: 'BenchKeeper library' })).toHaveAttribute('href', /plugins\/benchkeeper\/library\/README\.md$/);
  await expect(parts).not.toContainText('[');
});
