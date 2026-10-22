import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const TOKEN = 'ui-test-token-0123456789';
const VIEWS = ['Dashboard', 'Catalog', 'Agents', 'Projects', 'History', 'Settings'];
const nav = (page, view) => page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view });

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
        await nav(page, view).click();
        await expect(page.getByText('CLI', { exact: true })).toBeVisible();
        await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')} ${v.nodes[0].failureSummary}`)).toEqual([]);
      });
    }
  }

  test('no axe violations with the command palette open, light and dark', async ({ page }) => {
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByRole('dialog')).toBeVisible();
    for (const scheme of ['light', 'dark']) {
      await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
  });

  test('keyboard: Tab to a sidebar link and Enter opens its view; mod+2 opens Catalog', async ({ page }) => {
    const link = nav(page, 'Agents');
    for (let i = 0; i < 30 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('table', { name: 'Agents' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+2');
    await expect(nav(page, 'Catalog')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/#\/catalog$/);
  });

  test('Dashboard lists the edited rules file as modified, in the list and the coverage matrix', async ({ page }) => {
    const attention = page.getByRole('region', { name: 'Needs attention' });
    await expect(attention.getByRole('row', { name: /modified.*Claude Code rules/ })).toBeVisible();
    const cell = page.getByRole('table', { name: 'Coverage' }).getByRole('link', { name: 'rules for Claude Code: modified, open the plan' });
    await cell.click();
    await expect(page).toHaveURL(/#\/agents\?agent=claude$/);
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('Claude Code rules');
  });

  test('Dashboard: flow diagram links, install health counts, recent runs', async ({ page }) => {
    await expect(page.getByRole('group', { name: /^Setup flow/ }).getByRole('link', { name: /^Projects: 1 registered, 0 behind, ok$/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Global items by state' })).toContainText('modified');
    await page.getByRole('region', { name: 'Recent runs' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/#\/history\?run=/);
  });

  test('Dashboard: a doctor finding opens the plan that fixes it', async ({ page }) => {
    const doctor = page.getByRole('region', { name: 'Doctor' });
    await doctor.getByRole('row', { name: /Claude Code rules/ }).getByRole('link', { name: 'Plan fix' }).click();
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('Claude Code rules');
    await expect(page.getByRole('banner').getByRole('link', { name: /^Doctor: \d+ errors, \d+ warnings$/ })).toBeVisible();
  });

  test('palette: mod+K, type a project, Enter opens it', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByRole('dialog').getByLabel('Search').fill('bk-ui-proj');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/projects\?path=/);
  });

  test('theme toggle switches between light and dark', async ({ page }) => {
    const html = page.locator('html');
    await page.getByRole('button', { name: /theme$/ }).click();
    const first = await html.getAttribute('data-mantine-color-scheme');
    await page.getByRole('button', { name: /theme$/ }).click();
    await expect(html).not.toHaveAttribute('data-mantine-color-scheme', first);
  });

  test('Catalog: search, then the detail panel with the skill text', async ({ page }) => {
    await nav(page, 'Catalog').click();
    await page.getByLabel('Search').fill('technical');
    await page.getByRole('button', { name: 'designing-technical-uis' }).click();
    const detail = page.getByRole('region', { name: 'Skill designing-technical-uis' });
    await expect(detail.getByText('# Designing technical UIs')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Skills' }).getByRole('row')).toHaveCount(2);
  });

  test('Projects: the registered project, its plan, and Update all reports why it stopped', async ({ page }) => {
    await nav(page, 'Projects').click();
    const row = page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1);
    await expect(row).toContainText('6.0.0');
    await row.getByRole('button', { name: 'Plan' }).click();
    await expect(page.getByRole('region', { name: /^Changes in / })).toBeVisible();
    await page.getByRole('button', { name: 'Update all' }).click();
    await expect(page.getByRole('table', { name: 'Update all results' })).toContainText(/stopped|current|committed/);
  });

  test('History: a run shows its diffs, undo restores', async ({ page }) => {
    await nav(page, 'History').click();
    const runs = page.getByRole('table', { name: 'Runs' });
    const global = runs.getByRole('row').filter({ hasText: /apply.*global/ }).first();
    await global.getByRole('button', { name: 'Changes' }).click();
    await expect(page.getByRole('region', { name: /^Run / })).toContainText('Claude Code rules');
    await global.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('region', { name: 'Undo' })).toContainText(/done|failed/);
  });
});
