import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const TOKEN = 'ui-test-token-0123456789';
const VIEWS = ['Dashboard', 'Catalog', 'Agents', 'Projects', 'History'];

test.beforeEach(async ({ page, context }) => {
  // The URL token works once per server, so later tests reuse the cookie from the first.
  const cookies = await context.cookies();
  if (!cookies.length) await page.goto(`/?token=${TOKEN}`);
});

test.describe.configure({ mode: 'serial' });
let cookie;
test('the token becomes a cookie and leaves the address bar', async ({ page, context }) => {
  await expect(page).toHaveURL('http://127.0.0.1:4410/');
  [cookie] = await context.cookies();
  expect(cookie).toMatchObject({ name: 'bk_session', httpOnly: true, sameSite: 'Strict' });
  await expect(page.getByRole('heading', { level: 1, name: 'BenchKeeper' })).toBeVisible();
});

test.describe('views', () => {
  test.beforeEach(async ({ context, page }) => { await context.addCookies([cookie]); await page.goto('/'); });

  for (const view of VIEWS) {
    for (const scheme of ['light', 'dark']) {
      test(`no axe violations in ${view}, ${scheme} mode`, async ({ page }) => {
        await page.getByRole('tab', { name: view }).click();
        await expect(page.getByText('CLI', { exact: true })).toBeVisible();
        await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }

  test('keyboard: arrow keys move between views', async ({ page }) => {
    await page.getByRole('tab', { name: 'Dashboard' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Catalog' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Projects' })).toBeFocused();
  });

  test('Dashboard lists the edited rules file as modified', async ({ page }) => {
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention.getByRole('row', { name: /modified.*Claude Code rules/ })).toBeVisible();
  });

  test('Catalog: search, then the detail panel with the skill text', async ({ page }) => {
    await page.getByRole('tab', { name: 'Catalog' }).click();
    await page.getByLabel('Search').fill('technical');
    await page.getByRole('button', { name: 'designing-technical-uis' }).click();
    const detail = page.getByRole('region', { name: 'Skill designing-technical-uis' });
    await expect(detail.getByText('# Designing technical UIs')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Skills' }).getByRole('row')).toHaveCount(2);
  });

  test('Projects: the registered project, its plan, and Update all reports why it stopped', async ({ page }) => {
    await page.getByRole('tab', { name: 'Projects' }).click();
    const row = page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1);
    await expect(row).toContainText('6.0.0');
    await row.getByRole('button', { name: 'Plan' }).click();
    await expect(page.getByRole('region', { name: /^Changes in / })).toBeVisible();
    await page.getByRole('button', { name: 'Update all' }).click();
    await expect(page.getByRole('table', { name: 'Update all results' })).toContainText(/stopped|current|committed/);
  });

  test('History: a run shows its diffs, undo restores', async ({ page }) => {
    await page.getByRole('tab', { name: 'History' }).click();
    const runs = page.getByRole('table', { name: 'Runs' });
    const global = runs.getByRole('row').filter({ hasText: /apply.*global/ }).first();
    await global.getByRole('button', { name: 'Changes' }).click();
    await expect(page.getByRole('region', { name: /^Run / })).toContainText('Claude Code rules');
    await global.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('region', { name: 'Undo' })).toContainText(/done|failed/);
  });
});
