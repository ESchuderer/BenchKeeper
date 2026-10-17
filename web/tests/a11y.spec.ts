import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const [name, path] of [['main page', './'], ['benchmark overview', './bench/'], ['cartridges run page', './bench/2026-10-16-cartridges-sonnet/']]) {
  for (const scheme of ['light', 'dark']) {
    test(`no axe violations on the ${name} in ${scheme} mode`, async ({ page }) => {
      await page.goto(path);
      await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}
