// axe on every view as it first opens, in both schemes and at phone width. Read-only, so not part of the serial chain
// of ui.spec.mjs: these run in parallel with it on the same server.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { VIEWS, nav, ready } from './views.mjs';

test.describe.configure({ mode: 'parallel' });
// Projects as a table, as in ui.spec.mjs.
test.beforeEach(({ context }) => context.addInitScript(() => { if (localStorage.getItem('bk-projects-layout') === null) localStorage.setItem('bk-projects-layout', 'table'); }));

const noViolations = async (page, scheme) => {
  await expect(ready(page)).toBeVisible();
  await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
  // A switched scheme starts color transitions (the segmented control labels): measure the colors they end at.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { polling: 'raf' });
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')} ${v.nodes[0].failureSummary}`)).toEqual([]);
};

for (const [view, route] of VIEWS) {
  for (const scheme of ['light', 'dark']) {
    test(`no axe violations in ${view}, ${scheme} mode`, async ({ page }) => {
      await page.goto('/');
      await nav(page, view).click();
      await noViolations(page, scheme);
    });
    // The same pass at 390 px, where the sidebar is a menu: reflow and link styling differ there.
    test(`no axe violations in ${view}, ${scheme} mode, phone width`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/#/${route}`);
      await noViolations(page, scheme);
    });
  }
}
