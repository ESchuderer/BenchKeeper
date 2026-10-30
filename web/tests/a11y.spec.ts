import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const [name, path] of [['main page', './'], ['app page', './app/'], ['overview page', './overview/'], ['writes page', './writes/'], ['changelog page', './changelog/'], ['404 page', './404.html']]) {
  for (const scheme of ['light', 'dark']) {
    for (const width of [undefined, 390]) {
      test(`no axe violations on the ${name} in ${scheme} mode${width ? ` at ${width} px` : ''}`, async ({ page }) => {
        if (width) await page.setViewportSize({ width, height: 844 });
        await page.goto(path);
        await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        if (width) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      });
    }
  }
}
