import { expect, test } from '@playwright/test';

for (const path of ['./', './overview/', './app/', './404.html']) {
  test(`${path} links back to the repository and its security policy`, async ({ page }) => {
    await page.goto(path);
    const footer = page.locator('footer');
    await expect(footer.locator('a[href="https://github.com/ESchuderer/BenchKeeper"]')).toHaveCount(1);
    await expect(footer.locator('a[href$="/SECURITY.md"]')).toHaveCount(1);
  });

  test(`${path} has no benchmark or evaluation link`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('a[href*="BenchKeeper-research"], a[href*="EVALUATIONS"], a[href*="evaluations/"]')).toHaveCount(0);
  });
}

test('the sitemap lists the three pages', async ({ request }) => {
  const xml = await (await request.get('./sitemap.xml')).text();
  expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)).toEqual(['/BenchKeeper/', '/BenchKeeper/overview/', '/BenchKeeper/app/']);
});
