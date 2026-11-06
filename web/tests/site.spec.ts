import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BASE } from './base';

// WCAG 2.2 contrast ratio of two computed colors (rgb() or rgba() from getComputedStyle).
const contrast = (a: string, b: string): number => {
  const lum = (c: string) => {
    const [r, g, bl] = (c.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

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

  test(`${path} names CedarLoom in the title, header and footer, with the brand mark as its icon`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveTitle(/, CedarLoom$|^CedarLoom: /);
    await expect(page.locator('header .wordmark')).toHaveText('CedarLoom');
    await expect(page.locator('footer')).toContainText('CedarLoom, MIT License');
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', `${BASE}brand/cedarloom-icon.svg`);
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

test('the header and hero show the brand mark in the colors of each scheme, never filtered', async ({ page }) => {
  await page.goto('./');
  for (const [scheme, file] of [['light', 'cedarloom-icon.svg'], ['dark', 'cedarloom-dark.svg']]) {
    await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
    for (const mark of [page.locator('header img:visible'), page.locator('.hero img:visible')]) {
      await expect(mark).toHaveCount(1);
      await expect(mark).toHaveAttribute('src', `${BASE}brand/${file}`);
      await expect(mark).toHaveCSS('filter', 'none');
    }
  }
});

test('focus rings keep 3:1 against the page in both schemes (WCAG 2.2, 1.4.11)', async ({ page }) => {
  await page.goto('./');
  for (const scheme of ['light', 'dark']) {
    await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
    for (const target of [page.getByRole('link', { name: 'Set up your machine' }), page.locator('[data-theme-toggle]').first()]) {
      await target.focus();
      const [style, ring, body] = await target.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineColor, getComputedStyle(document.body).backgroundColor]);
      expect(style).toBe('solid');
      expect(contrast(ring, body), `${scheme}: ${ring} on ${body}`).toBeGreaterThanOrEqual(3);
    }
  }
});

test('the share image is the 1280x640 CedarLoom preview', async ({ page, request }) => {
  await page.goto('./');
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1280');
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '640');
  const png = await (await request.get('./og.png')).body();
  // The PNG header: width and height are the first two fields of IHDR.
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1280, 640]);
});

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
