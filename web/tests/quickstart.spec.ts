import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import facts from '../src/data/facts.json' with { type: 'json' };

const [app, cli] = facts.quickstart.paths;

test('the quick start selects App first and CLI second', async ({ page }) => {
  await page.goto('./');
  const tabs = page.getByRole('tablist', { name: 'Install path' }).getByRole('tab');
  await expect(tabs).toHaveText(['App', 'CLI']);
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'App' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'CLI' })).toBeHidden();
});

test('arrow keys, Home and End move between the tabs', async ({ page }) => {
  await page.goto('./');
  const [appTab, cliTab] = await page.getByRole('tab').all();
  await appTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cliTab).toBeFocused();
  await expect(cliTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'CLI' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'App' })).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(appTab).toBeFocused();
  await page.keyboard.press('End');
  await expect(cliTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(appTab).toHaveAttribute('aria-selected', 'true');
});

test('each path is at most two commands and every command is pinned', async ({ page }) => {
  await page.goto('./');
  for (const [name, path] of [['App', app], ['CLI', cli]] as const) {
    expect(path.steps.length).toBeLessThanOrEqual(2);
    for (const step of path.steps) {
      expect(step.command).toMatch(/^npx benchkeeper@\d+\.\d+\.\d+( [a-z]+)?$/);
      await page.getByRole('tab', { name }).click();
      await expect(page.getByRole('tabpanel', { name }).locator('pre', { hasText: step.command })).toBeVisible();
    }
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('both paths are visible under their headings', async ({ page }) => {
    await page.goto('./');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'App', level: 3 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'CLI', level: 3 })).toBeVisible();
    await expect(page.locator('#start pre', { hasText: cli.steps[1].command })).toBeVisible();
  });
});

for (const scheme of ['light', 'dark']) {
  test(`no axe violations on the CLI tab in ${scheme} mode`, async ({ page }) => {
    await page.goto('./');
    await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
    await page.getByRole('tab', { name: 'CLI' }).click();
    const { violations } = await new AxeBuilder({ page }).include('#start').analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
}
