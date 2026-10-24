import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBrowser } from '../../src/server.mjs';

const TOKEN = 'ui-test-token-0123456789';
const BATCH = join(tmpdir(), 'bk-ui-batch-4410');
const ONE = join(tmpdir(), 'bk-ui-one-4410');
// While this file exists, the stubbed suggestion for duo and quatro waits (serve.mjs).
const GATE = join(tmpdir(), 'bk-ui-gate-4410');
const VIEWS = ['Dashboard', 'Catalog', 'Agents', 'Projects', 'History', 'Sessions', 'Evals', 'Settings'];
// axe in both color schemes on the page as it is, after drawer and modal transitions.
async function noAxe(page) {
  // A transition may start a frame after the dialog is visible: wait until dialogs and overlays are fully opaque.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')
    && [...document.querySelectorAll('[role=dialog], [class*="Overlay"]')].every((e) => getComputedStyle(e).opacity === '1'), null, { polling: 'raf' });
  for (const scheme of ['light', 'dark']) {
    await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')} ${v.nodes[0].failureSummary}`)).toEqual([]);
  }
}
const nav = (page, view) => page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view });

test.describe.configure({ mode: 'serial' });
let cookie, key;

test.beforeEach(async ({ page }) => {
  // The URL token works once per server, so later tests reuse the cookie from the first. It comes through the file
  // the app opens the browser with, so the cookie must survive that cross-site start.
  if (cookie) return;
  await page.goto(pathToFileURL(openBrowser(`http://127.0.0.1:4410/?token=${TOKEN}`, { open: () => {}, confined: () => false })).href);
  await page.waitForURL('http://127.0.0.1:4410/');
});
test('the token becomes a cookie and an API key; both leave the address bar', async ({ page, context }) => {
  await expect(page).toHaveURL('http://127.0.0.1:4410/');
  [cookie] = await context.cookies();
  key = await page.evaluate(() => localStorage.getItem('benchkeeper-key'));
  expect(key).toMatch(/^[\w-]{43}$/);
  expect(cookie).toMatchObject({ name: "bk_session_4410", httpOnly: true, sameSite: 'Strict' });
  await expect(page.getByRole('heading', { level: 1, name: 'BenchKeeper' })).toBeVisible();
});

test.describe('views', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addCookies([cookie]);
    await context.addInitScript((k) => localStorage.setItem('benchkeeper-key', k), key);
    await page.goto('/');
  });

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

  // The same pass at 390 px, where the sidebar is a menu: reflow and link styling differ there.
  for (const view of VIEWS) {
    for (const scheme of ['light', 'dark']) {
      test(`no axe violations in ${view}, ${scheme} mode, phone width`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/#/${view.toLowerCase()}`);
        await expect(page.getByText('CLI', { exact: true })).toBeVisible();
        await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')} ${v.nodes[0].failureSummary}`)).toEqual([]);
      });
    }
  }

  test('phone width: the header fits at 320 px; the menu holds theme and Stop, and says whether it is open', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const burger = page.getByRole('button', { name: 'Views' });
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['Views', 'Search']) {
      const box = await page.getByRole('banner').getByRole('button', { name }).boundingBox();
      expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    await expect(page.getByRole('banner').getByRole('button', { name: /theme$|Stop BenchKeeper/ })).toHaveCount(0);
    // Closed, the menu is off screen and out of the Tab order.
    await expect(page.locator('#app-nav')).toHaveAttribute('inert', '');
    await burger.click();
    await expect(page.locator('#app-nav')).not.toHaveAttribute('inert');
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    const theme = page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /theme$/ });
    await expect.poll(async () => (await theme.boundingBox()).x).toBeGreaterThanOrEqual(0);
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Stop BenchKeeper' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Doctor: \d+ errors, \d+ warnings$/ })).toBeVisible();
  });

  test('skip link: the first Tab stop moves focus to the view heading; each view has a title and a heading', async ({ page }) => {
    await expect(page).toHaveTitle('Dashboard - BenchKeeper');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await nav(page, 'Projects').click();
    await expect(page).toHaveTitle('Projects - BenchKeeper');
    await expect(page.getByRole('heading', { level: 2, name: 'Projects' })).toBeFocused();
  });

  test('a view chosen in the palette gets the focus on its heading once the palette has closed', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+K');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(async () => {
      await palette.getByLabel('Search').fill('');
      await palette.getByLabel('Search').fill('Settings');
      await expect(palette.locator('[data-selected]')).toContainText('Settings', { timeout: 1000 });
    }).toPass();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Settings' })).toBeFocused();
  });

  test('Settings: the / key can be turned off', async ({ page }) => {
    await nav(page, 'Settings').click();
    const slash = page.getByRole('switch', { name: 'Open the command palette with the / key' });
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    // Hotkeys ignore a focused input, so the focus leaves the switch before each key.
    const press = async (key) => { await page.getByRole('heading', { level: 2, name: 'Settings' }).click(); await page.keyboard.press(key); };
    await slash.click();
    await press('/');
    await expect(palette).toBeHidden();
    await press('ControlOrMeta+K');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await slash.click();
    await press('/');
    await expect(palette).toBeVisible();
  });

  test('Sessions: a scan fills the board frame; a title stays text; no axe violations in the frame, light and dark', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    await expect(board.getByRole('heading', { level: 1, name: 'Sessions board' })).toBeVisible();
    // The fixture project is registered, but no session ran in it: All stays chosen, Registered projects is offered.
    await expect(board.getByLabel('Project').locator('option').first()).toHaveText('Registered projects');
    await expect(board.getByLabel('Project')).toHaveValue('');
    await board.getByLabel('Period').selectOption('all');
    // A changed count is announced.
    await expect(board.getByRole('status').filter({ hasText: / of \d+ sessions/ })).toBeVisible();
    await expect(board.getByRole('table', { name: 'Sessions, newest first' })).toContainText('Cart </script><img src=x onerror=alert(1)> fix');
    await expect(board.getByRole('table', { name: /Sessions by tier/ })).toContainText('full');
    await noAxe(page);
    // The app's theme reloads the frame in that theme.
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await expect(page.locator('iframe[title="Sessions board"]')).toHaveAttribute('src', /^\/board\?theme=dark&ticket=[\w-]+$/);
    await expect(board.locator('html')).toHaveAttribute('data-theme', 'dark');
    await noAxe(page);
  });

  test('no axe violations with the command palette open, light and dark', async ({ page }) => {
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await noAxe(page);
  });

  test('keyboard: Tab to a sidebar link and Enter opens its view; mod+2 opens Projects', async ({ page }) => {
    const link = nav(page, 'Agents');
    for (let i = 0; i < 30 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('table', { name: 'Agents' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+2');
    await expect(nav(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/#\/projects$/);
  });

  test('Dashboard shows the edited rules file as modified in the coverage matrix', async ({ page }) => {
    const cell = page.getByRole('table', { name: 'Coverage' }).getByRole('link', { name: 'rules for Claude Code: modified, open the plan' });
    await cell.click();
    await expect(page).toHaveURL(/#\/agents\?agent=claude$/);
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('Claude Code rules');
  });

  test('Dashboard: flow diagram links, install health counts, recent runs', async ({ page }) => {
    await expect(page.getByRole('group', { name: /^Setup flow/ }).getByRole('link', { name: /^Projects 1 registered, 0 behind ok$/ })).toBeVisible();
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

  test('Stop: the header button asks first; Cancel keeps the server running', async ({ page }) => {
    await page.getByRole('button', { name: 'Stop BenchKeeper' }).click();
    const dialog = page.getByRole('dialog', { name: 'Stop BenchKeeper?' });
    await expect(dialog.getByText(/npx benchkeeper@\d+\.\d+\.\d+/)).toBeVisible();
    await noAxe(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
  });

  test('a read that loses its connection is asked again; no answer at all says the server has stopped', async ({ page }) => {
    let n = 0;
    // The app reads the history once at load.
    await page.route(/\/api\/history(\?|$)/, (r) => (n++ === 0 ? r.abort('connectionreset') : r.continue()));
    await page.reload();
    await nav(page, 'History').click();
    await expect(page.locator('a[href*="history?run="]').first()).toBeVisible();
    expect(n).toBe(2);
    await page.unroute(/\/api\/history(\?|$)/);
    await page.route(/\/api\/history(\?|$)/, (r) => r.abort('connectionreset'));
    await page.reload();
    await expect(page.getByText(/BenchKeeper does not answer: its server has stopped/)).toBeVisible();
  });

  test('slash opens the palette too', async ({ page }) => {
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });

  test('palette: mod+K, type a project, Enter opens it', async ({ page }) => {
    await page.keyboard.press('ControlOrMeta+K');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    // Spotlight selects the first match when the query changes; projects that load later need the query typed again.
    await expect(async () => {
      await palette.getByLabel('Search').fill('');
      await palette.getByLabel('Search').fill('bk-ui-proj');
      await expect(palette.locator('[data-selected]')).toContainText('bk-ui-proj', { timeout: 1000 });
    }).toPass();
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

  test('Catalog: search, then the detail panel with the skill text and its eval results', async ({ page }) => {
    await nav(page, 'Catalog').click();
    await page.getByRole('textbox', { name: 'Search' }).fill('technical-uis');
    await page.getByRole('table', { name: 'Skills' }).getByRole('link', { name: 'designing-technical-uis' }).click();
    const detail = page.getByRole('region', { name: 'Skill designing-technical-uis' });
    await expect(detail.getByText('# Designing technical UIs')).toBeVisible();
    await expect(detail.getByRole('table', { name: 'Eval runs' }).getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('table', { name: 'Skills' }).getByRole('row')).toHaveCount(2);
  });

  test('Catalog: the pack builder finds no overlapping descriptions in the library and saves an own pack; export downloads it', async ({ page }) => {
    await nav(page, 'Catalog').click();
    const boxes = page.getByRole('table', { name: 'Skills' }).getByRole('checkbox');
    for (let i = 0; i < 6; i++) await boxes.nth(i).check();
    await page.getByRole('button', { name: 'Build pack (6)' }).click();
    const drawer = page.getByRole('dialog', { name: 'Build a pack' });
    await expect(drawer.getByLabel(/^Pack id/)).toBeVisible();
    await expect(drawer.getByText(/overlapping descriptions/)).toHaveCount(0);
    await noAxe(page);
    await drawer.getByLabel(/^Pack id/).fill('my-pack');
    await drawer.getByRole('button', { name: 'Save pack' }).click();
    await expect(drawer).toBeHidden();
    const packs = page.getByRole('table', { name: 'Packs' });
    await expect(packs.getByRole('row', { name: /my-pack.*own/ })).toBeVisible();
    const download = page.waitForEvent('download');
    await packs.getByRole('button', { name: 'Export my-pack' }).click();
    expect((await download).suggestedFilename()).toBe('my-pack.json');
  });

  test('Projects: the drift board row, its plan, skill toggle and doctor, and Update all progress per project', async ({ page }) => {
    await nav(page, 'Projects').click();
    const row = page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1);
    await expect(row).toContainText(/\d+\.\d+\.\d+ current/);
    await expect(row).toContainText(/\d+ pending/);
    await expect(row).toContainText('dirty');
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/#\/projects\?path=/);
    const changes = page.getByRole('region', { name: /^Changes in / });
    await expect(changes).toBeVisible();
    const skill = page.getByRole('region', { name: 'Skills' }).getByRole('switch').first();
    await skill.click();
    await expect(changes).toContainText('.benchkeeper/disabled/');
    await expect(page.getByRole('region', { name: 'Project doctor' })).toBeVisible();
    await noAxe(page);
    await page.getByRole('button', { name: 'Update all' }).click();
    await expect(page.getByRole('progressbar', { name: 'Update all: 1 of 1 projects' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Update all results' })).toContainText(/stopped|current|committed/);
  });

  test('Projects: Choose folder fills the path from the dialog; scan offers the unregistered folder', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('button', { name: 'Choose folder' }).click();
    await expect(page.getByLabel('Project folder')).toHaveValue(/bk-ui-scan-/);
    await page.getByRole('button', { name: 'Scan for projects' }).click();
    const found = page.getByRole('region', { name: 'Found projects' });
    await expect(found.getByRole('checkbox')).toHaveCount(1);
    await expect(found.getByRole('checkbox', { name: /\/other$/ })).toBeChecked();
    await found.getByRole('button', { name: 'Add selected (1)' }).click();
    await expect(page.getByRole('table', { name: 'Projects' }).getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('table', { name: 'Projects' })).toContainText('no state file');
  });

  test('Projects: skills per agent, in the project and in all', async ({ page }) => {
    await nav(page, 'Projects').click();
    await expect(page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1)).toContainText(/\d+ here, \d+ in all/);
  });

  test('Projects: a project without a state file is set up step by step, local or on a branch', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: 'other', exact: true }).click();
    await page.getByRole('button', { name: 'Set up this project' }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await expect(drawer.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('radio', { name: /^Agent in the dev container/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Next' }).click();
    // Community skills need npx, which the fixture lacks: no pack here.
    await expect(drawer.getByRole('checkbox', { name: /^Frontend/ })).not.toBeChecked();
    await noAxe(page);
    // An agent suggests skills only after the user agrees to its session.
    await drawer.getByRole('button', { name: 'Suggest with an agent' }).click();
    const ask = page.getByRole('dialog', { name: 'Start an agent session?' });
    await expect(ask).toContainText('Read only');
    await noAxe(page);
    await ask.getByRole('button', { name: 'Start Claude Code' }).click();
    await expect(drawer.getByRole('alert')).toContainText('Skill designing-technical-uis: the project has a UI');
    await drawer.getByRole('button', { name: 'Next' }).click();
    await drawer.getByRole('radio', { name: /^Standard/ }).check();
    await drawer.getByRole('button', { name: 'Next' }).click();
    // Local is the default; the repository is the other choice.
    await expect(drawer.getByRole('radio', { name: /^On this machine/ })).toBeChecked();
    await expect(drawer).toContainText(/\d+ changes in this checkout, in files git ignores/);
    await expect(drawer).toContainText('CLAUDE.local.md');
    await drawer.getByRole('radio', { name: /^In the repository/ }).check();
    await expect(drawer).toContainText(/\d+ changes on branch/);
    await expect(drawer).toContainText('AGENTS.md');
    await expect(drawer).toContainText('skill designing-technical-uis (own)');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Continue' }).click();
    await drawer.getByRole('button', { name: 'Create branch and pull request' }).click();
    await expect(drawer.getByRole('alert')).toContainText('committed');
    await drawer.getByRole('button', { name: 'Next project' }).click();
    await expect(drawer).toBeHidden();
  });

  test('Projects: Change setup starts from the state file', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: /bk-ui-proj$/ }).click();
    await page.getByRole('button', { name: 'Change setup' }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await expect(drawer.getByRole('heading', { name: /Change project setup/ })).toBeVisible();
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('radio', { name: /^Agent on the host/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('checkbox', { name: /^Frontend/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  test('Projects: Prefill all asks once, suggests per project in turn, and a shared project lands as its own pull request', async ({ page }) => {
    await nav(page, 'Projects').click();
    for (const name of ['alpha', 'broken']) {
      await page.getByLabel('Project folder').fill(join(BATCH, name));
      await page.getByRole('button', { name: 'Add project' }).click();
      await expect(page.getByRole('table', { name: 'Projects' }).getByRole('link', { name, exact: true })).toBeVisible();
    }
    await page.getByRole('button', { name: /^Set up 3 new projects$/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await drawer.getByRole('button', { name: 'Prefill all with Claude Code' }).click();
    const ask = page.getByRole('dialog', { name: 'Start 3 agent sessions?' });
    await expect(ask).toContainText('3 sessions, one after the other');
    await noAxe(page);
    await ask.getByRole('button', { name: 'Start Claude Code' }).click();
    const list = drawer.getByRole('region', { name: 'Suggestions' });
    await expect(list.getByRole('listitem').filter({ hasText: 'broken' })).toContainText('failed');
    await expect(list.getByRole('listitem').filter({ hasText: 'broken' })).toContainText('model overloaded');
    await expect(list.getByRole('listitem').filter({ hasText: 'alpha' })).toContainText('ready');
    await expect(drawer.getByText(/^Prefilled from Claude Code's suggestion/)).toBeVisible();
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Skip' }).click();
    await expect(drawer.getByText(/^Prefilled from Claude Code's suggestion/)).toBeVisible();
    for (let s = 0; s < 4; s++) await drawer.getByRole('button', { name: 'Next' }).click();
    await drawer.getByRole('radio', { name: /^In the repository/ }).check();
    await expect(drawer).toContainText('skill designing-technical-uis (own)');
    await drawer.getByRole('button', { name: 'Continue' }).click();
    await drawer.getByRole('button', { name: 'Create branch and pull request' }).click();
    await expect(drawer.getByRole('link', { name: 'https://github.com/acme/alpha/pull/1' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Next project' }).click();
    // No suggestion for broken: its form starts from the defaults.
    await expect(drawer.getByText(/^Prefilled from/)).toBeHidden();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  test('History: a run report with numbered diffs, split or unified; undo of one step, then of the run', async ({ page }) => {
    await nav(page, 'History').click();
    await page.getByRole('navigation', { name: 'Runs' }).getByRole('link', { name: /^Apply: global setup/ }).first().click();
    const run = page.getByRole('region', { name: /^Run / });
    await expect(run.getByRole('article', { name: /Claude Code rules/ })).toBeVisible();
    await expect(run.getByRole('group', { name: 'Summary' })).toContainText(/\d+ done/);
    // An edit of an existing file splits into before and after; a created file stays unified.
    const diffs = run.getByRole('group', { name: /^Diff of .*settings\.json$/ });
    const created = diffs.filter({ hasText: '@@ -0,0 ' }).first(), edited = diffs.filter({ hasNotText: '@@ -0,0 ' }).first();
    await expect(edited).toContainText(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    await run.getByText('Split', { exact: true }).click();
    await expect(edited.locator('tbody tr:not(.hunk)').first().locator('td')).toHaveCount(4);
    await expect(edited.getByRole('columnheader')).toHaveText(['Old line', 'Before', 'New line', 'After']);
    await expect(created.locator('tbody tr:not(.hunk)').first().locator('td')).toHaveCount(3);
    await expect(created.getByRole('columnheader')).toHaveText(['Old line', 'New line', 'Change']);
    await noAxe(page);
    await run.getByText('Unified', { exact: true }).click();
    // A step whose file no later step changed (settings.json gets later edits, so its step alone is refused).
    await run.getByRole('button', { name: 'Undo step settings:ponytail', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Undone' })).toContainText(/1 of 1 changes undone/);
    await expect(run).toContainText('undone by');
    await run.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  // After History, whose tests expect the fixture's first global run newest; before Agents, which installs the global skill.
  test('Dashboard: Fix everything walks through global setup, projects and manual fixes, then applies', async ({ page }) => {
    await page.getByRole('button', { name: 'Fix everything' }).click();
    const fix = page.getByRole('dialog', { name: 'Fix everything' });
    await expect(fix.getByRole('checkbox', { name: /^global skill find-skills/ })).toBeChecked();
    // The global skill install was rehearsed in a scratch folder: its file shows as a diff before anything runs.
    await expect(fix.getByRole('group', { name: /^Diff of .*\.claude\/skills\/find-skills\/SKILL\.md$/ })).toBeVisible();
    await noAxe(page);
    await fix.getByRole('button', { name: 'Next' }).click();
    // Update all skips a project with uncommitted changes, so it is not offered.
    const proj = fix.getByRole('checkbox', { name: 'bk-ui-proj' });
    await expect(proj).toBeDisabled();
    await expect(fix).toContainText('skipped: uncommitted changes');
    await noAxe(page);
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(fix.getByRole('table', { name: 'Doctor findings' }).or(fix.getByText('No problems found.'))).toBeVisible();
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(fix.getByRole('list', { name: 'What Apply does' })).toContainText(/Global setup: \d+ of \d+ changes/);
    await expect(fix.getByRole('list', { name: 'What Apply does' })).toContainText('Projects: none');
    await noAxe(page);
    await fix.getByRole('button', { name: 'Apply', exact: true }).click();
    // The wizard sits above the views: a view shortcut leaves it open, so the run goes on.
    await page.keyboard.press('ControlOrMeta+2');
    await expect(nav(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(fix.getByRole('status').filter({ hasText: /^Run / })).toContainText(/done|failed/);
    await expect(fix.getByRole('heading', { name: 'Still open' })).toBeVisible();
    await expect(fix.getByRole('button', { name: 'Close' })).toBeEnabled();
    await noAxe(page);
  });

  test('an apply in Agents shows up in History and the header without a reload', async ({ page }) => {
    await nav(page, 'History').click();
    const runs = page.getByRole('navigation', { name: 'Runs' }).getByRole('link');
    await expect(runs.first()).toBeVisible();
    const before = await runs.count();
    await nav(page, 'Agents').click();
    await page.getByRole('button', { name: /^Plan setup for/ }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await changes.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
    // The result replaces the plan: the run report with each change, and a link to it in History.
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(changes.getByRole('link', { name: 'Open in History' })).toBeVisible();
    await expect(nav(page, 'History')).toContainText(String(before + 1));
    await nav(page, 'History').click();
    await expect(runs).toHaveCount(before + 1);
  });

  test('Evals: one agent at a time, targets worst first, the chart and runs table of one target', async ({ page }) => {
    await nav(page, 'Evals').click();
    const targets = page.getByRole('table', { name: 'Eval targets' });
    // The newest result is Codex's: its one target, no overview chart for a single target.
    await expect(targets.getByRole('link')).toHaveText(['skill:workflow']);
    await expect(page.getByRole('region', { name: 'Latest rates per target' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Agent and model' }).click();
    await page.getByRole('option', { name: 'claude' }).click();
    // Worst first by the higher rate; a target without rates last, shown as -, never 0%.
    await expect(targets.getByRole('link')).toHaveText(['skill:designing-technical-uis', 'skill:workflow', 'rule:global']);
    await expect(targets.getByRole('row').last()).toContainText('rule:global6--');
    await expect(page.getByRole('region', { name: 'Latest rates per target' }).locator('.recharts-surface')).toBeVisible();
    // The legend follows the series order, as the table does.
    await expect(page.getByRole('region', { name: 'Latest rates per target' }).locator('.recharts-legend-wrapper')).toHaveText(/^Miss\s*False trigger$/);
    await noAxe(page);
    await targets.getByRole('link', { name: 'skill:designing-technical-uis' }).click();
    const detail = page.getByRole('region', { name: 'Eval skill:designing-technical-uis' });
    await expect(detail.locator('.recharts-surface').first()).toBeVisible();
    await expect(detail.getByRole('table', { name: 'Eval runs' })).toContainText('25%');
    const run = page.getByRole('region', { name: 'Run evals' });
    await run.getByRole('button', { name: 'Plan evals' }).click();
    await expect(run.getByRole('table', { name: 'Planned evals' })).toContainText('skill:workflow');
    await expect(run.getByRole('button', { name: /^Start \d+ agent sessions$/ })).toBeVisible();
    await noAxe(page);
  });

  test('Settings: profile export downloads a file; its import registers and shows the global plan', async ({ page }) => {
    await nav(page, 'Settings').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export profile' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('benchkeeper-profile.json');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import profile' }).click();
    await (await chooser).setFiles(await file.path());
    await expect(page.getByRole('region', { name: 'Profile contents' })).toContainText('Agents: claude');
    await page.getByRole('button', { name: 'Register projects and packs' }).click();
    await expect(page.getByRole('region', { name: 'Global changes' })).toBeVisible();
    await noAxe(page);
  });


  // The one-run setup, last: it applies project setups and registers four more projects.
  const addProjects = async (page, names) => {
    await nav(page, 'Projects').click();
    for (const name of names) {
      await page.getByLabel('Project folder').fill(join(ONE, name));
      await page.getByRole('button', { name: 'Add project' }).click();
      await expect(page.getByRole('table', { name: 'Projects' }).getByRole('link', { name, exact: true })).toBeVisible();
    }
    await nav(page, 'Dashboard').click();
  };
  const oneRun = (page) => page.getByRole('dialog', { name: 'One-run setup' });

  test('One-run, Global only: the start form, then a review page with only the global plan', async ({ page }) => {
    await page.getByRole('button', { name: 'Set up global only' }).click();
    const drawer = oneRun(page);
    await expect(drawer.getByRole('checkbox', { name: 'Global setup' })).toBeChecked();
    // A shared setup is left to Update all.
    await expect(drawer.getByRole('checkbox', { name: 'bk-ui-proj' })).toBeDisabled();
    await expect(drawer.getByText(/left to Update all: shared setup/)).toBeVisible();
    await expect(drawer.getByRole('checkbox', { name: 'broken' })).not.toBeChecked();
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Start', exact: true }).click();
    const global = drawer.getByRole('region', { name: 'Global setup' });
    await expect(global.getByRole('checkbox', { name: 'Global setup', exact: true })).toBeChecked();
    await expect(drawer.getByRole('region', { name: 'broken' })).toHaveCount(0);
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
  });

  test('One-run, Everything with two projects (one without a setup): one progress bar, one review page, one apply', async ({ page }) => {
    await addProjects(page, ['uno', 'duo']);
    const drawer = oneRun(page);
    writeFileSync(GATE, '');
    try {
      await page.getByRole('button', { name: 'Set up everything', exact: true }).click();
      // Everything preselects every project the run can set up; the earlier tests registered three more.
      for (const name of ['uno', 'duo', 'broken', 'alpha', 'other']) await expect(drawer.getByRole('checkbox', { name, exact: true })).toBeChecked();
      for (const name of ['alpha', 'other']) await drawer.getByRole('checkbox', { name, exact: true }).uncheck();
      await drawer.getByRole('button', { name: 'Start', exact: true }).click();
      // One consent for the sessions of the projects without a setup: duo and broken.
      const ask = page.getByRole('dialog', { name: 'Start 2 agent sessions?' });
      await expect(ask).toContainText('2 sessions, one after the other');
      await noAxe(page);
      await ask.getByRole('button', { name: 'Start Claude Code' }).click();
      const progress = drawer.getByRole('region', { name: 'Prepare progress' });
      await expect(progress.getByRole('row', { name: /duo/ })).toContainText('Claude Code is reading the repository');
      await expect(progress.getByRole('row', { name: /broken/ })).toContainText('ready');
      await expect(progress.getByRole('row', { name: /uno/ })).toContainText('ready');
      await noAxe(page);
    } finally { rmSync(GATE, { force: true }); }
    const duo = drawer.getByRole('region', { name: 'duo', exact: true });
    await expect(duo).toBeVisible();
    // A failed suggestion shows its reason; the project still gets a plan from the defaults.
    await expect(drawer.getByRole('region', { name: 'broken' })).toContainText('model overloaded');
    await expect(duo).toContainText('Suggested by Claude Code: skill designing-technical-uis');
    const uno = drawer.getByRole('region', { name: 'uno', exact: true });
    await expect(uno.getByRole('group', { name: /^Diff of / })).toHaveCount(0);
    await uno.getByRole('button', { name: /^Show diff of / }).first().click();
    await expect(uno.getByRole('group', { name: /^Diff of .*CLAUDE\.local\.md$/ })).toBeVisible();
    // An edit of the answers builds that project's plan again.
    const checked = () => duo.getByText(/\d+ of \d+ changes checked/).textContent();
    const before = await checked();
    await duo.getByRole('button', { name: 'Edit answers of duo' }).click();
    await duo.getByRole('checkbox', { name: 'Frontend', exact: true }).check();
    await expect.poll(checked).not.toBe(before);
    // Per-section checkboxes: leave out the global plan and broken.
    await drawer.getByRole('region', { name: 'Global setup' }).getByRole('checkbox', { name: 'Global setup', exact: true }).uncheck();
    await drawer.getByRole('region', { name: 'broken' }).getByRole('checkbox', { name: 'broken', exact: true }).uncheck();
    await noAxe(page);
    await drawer.getByRole('button', { name: /^Apply \d+ changes in 2 sections$/ }).click();
    const apply = drawer.getByRole('region', { name: 'Apply progress' });
    await expect(apply.getByRole('status')).toContainText(/^Finished: 2 of 2 sections done/);
    await expect(apply.getByRole('row', { name: /^done .*\/uno: / })).toBeVisible();
    await expect(apply.getByRole('row', { name: /^done .*\/duo: / })).toBeVisible();
    await expect(apply.getByRole('link', { name: 'Open report' })).toHaveCount(2);
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  test('One-run, Projects with one picked: no global plan, one consent for one session, one section', async ({ page }) => {
    await addProjects(page, ['tres']);
    await page.getByRole('button', { name: 'Set up projects' }).click();
    const drawer = oneRun(page);
    await expect(drawer.getByRole('checkbox', { name: 'Global setup' })).not.toBeChecked();
    // Set up by the run before: not preselected. Without a setup: preselected.
    await expect(drawer.getByRole('checkbox', { name: 'uno', exact: true })).not.toBeChecked();
    await expect(drawer.getByRole('checkbox', { name: 'tres', exact: true })).toBeChecked();
    for (const name of ['broken', 'alpha', 'other']) await drawer.getByRole('checkbox', { name, exact: true }).uncheck();
    await drawer.getByRole('button', { name: 'Start', exact: true }).click();
    const ask = page.getByRole('dialog', { name: 'Start an agent session?' });
    await ask.getByRole('button', { name: 'Start Claude Code' }).click();
    await expect(drawer.getByRole('region', { name: 'tres' })).toBeVisible();
    await expect(drawer.getByRole('region', { name: 'Global setup' })).toHaveCount(0);
    await expect(drawer.getByRole('region', { name: 'broken' })).toHaveCount(0);
    await drawer.getByRole('button', { name: /^Apply \d+ changes in 1 sections$/ }).click();
    await expect(drawer.getByRole('region', { name: 'Apply progress' }).getByRole('status')).toContainText(/^Finished: 1 of 1 sections done/);
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  test('One-run: a cancel during prepare stops the running session; what is ready stays reviewable', async ({ page }) => {
    await addProjects(page, ['quatro']);
    const drawer = oneRun(page);
    writeFileSync(GATE, '');
    try {
      await page.getByRole('button', { name: 'Set up projects' }).click();
      await drawer.getByRole('checkbox', { name: 'Global setup' }).check();
      for (const name of ['broken', 'alpha', 'other']) await drawer.getByRole('checkbox', { name, exact: true }).uncheck();
      await drawer.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByRole('dialog', { name: 'Start an agent session?' }).getByRole('button', { name: 'Start Claude Code' }).click();
      const progress = drawer.getByRole('region', { name: 'Prepare progress' });
      await expect(progress.getByRole('row', { name: /quatro/ })).toContainText('Claude Code is reading the repository');
      await progress.getByRole('button', { name: 'Cancel' }).click();
    } finally { rmSync(GATE, { force: true }); }
    const progress = drawer.getByRole('region', { name: 'Prepare progress' });
    await expect(progress.getByRole('row', { name: /quatro/ })).toContainText('cancelled');
    await expect(progress.getByRole('status')).toContainText('Cancelled: 1 of 2 items are ready.');
    await drawer.getByRole('button', { name: 'Review what is ready' }).click();
    await expect(drawer.getByRole('region', { name: 'Global setup' })).toBeVisible();
    await expect(drawer.getByRole('region', { name: 'quatro' })).toContainText('Not prepared');
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  test('One-run: another mode from the palette during prepare does not leave Close disabled', async ({ page }) => {
    const drawer = oneRun(page);
    writeFileSync(GATE, '');
    try {
      await page.getByRole('button', { name: 'Set up projects' }).click();
      await drawer.getByRole('checkbox', { name: 'Global setup' }).check();
      for (const name of ['broken', 'alpha', 'other']) await drawer.getByRole('checkbox', { name, exact: true }).uncheck();
      await drawer.getByRole('button', { name: 'Start', exact: true }).click();
      await page.getByRole('dialog', { name: 'Start an agent session?' }).getByRole('button', { name: 'Start Claude Code' }).click();
      await expect(drawer.getByRole('region', { name: 'Prepare progress' }).getByRole('row', { name: /quatro/ })).toContainText('Claude Code is reading the repository');
      await expect(drawer.getByRole('button', { name: 'Close' })).toBeDisabled();
      await page.keyboard.press('ControlOrMeta+K');
      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await expect(async () => {
        await palette.getByLabel('Search').fill('');
        await palette.getByLabel('Search').fill('global only in one run');
        await expect(palette.locator('[data-selected]')).toContainText('Set up global only', { timeout: 1000 });
      }).toPass();
      await page.keyboard.press('Enter');
      await expect(drawer.getByRole('button', { name: 'Close' })).toBeEnabled();
    } finally { rmSync(GATE, { force: true }); }
    await drawer.getByRole('button', { name: 'Close' }).click();
  });
});
