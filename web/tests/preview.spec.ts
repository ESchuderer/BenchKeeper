import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PREVIEW } from './base';

// Every built page: the develop preview is marked noindex and labelled, the released site is not.
const pages = readdirSync('dist', { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.html')).map((f) => f.replace(/index\.html$/, ''));

test('the build has pages', () => {
  expect(pages.length).toBeGreaterThan(0);
});

for (const path of pages) {
  test(`${path || 'main page'}: noindex and development banner ${PREVIEW ? 'present' : 'absent'}`, async ({ page }) => {
    await page.goto(`./${path}`);
    const robots = page.locator('meta[name="robots"][content="noindex"]');
    const banner = page.getByRole('region', { name: 'Development preview' });
    await expect(robots).toHaveCount(PREVIEW ? 1 : 0);
    await expect(banner).toHaveCount(PREVIEW ? 1 : 0);
  });
}
