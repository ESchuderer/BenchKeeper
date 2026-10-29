import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOKENS } from '../../src/tokens.mjs';
import { nav, ready } from './views.mjs';

const BATCH = join(tmpdir(), 'bk-ui-batch-4410');
const ONE = join(tmpdir(), 'bk-ui-one-4410');
// While this file exists, the stubbed suggestion for duo and quatro waits (serve.mjs).
const GATE = join(tmpdir(), 'bk-ui-gate-4410');
// While this file exists, the stubbed automations runner answers (serve.mjs).
const RUNNER = join(tmpdir(), 'bk-ui-runner-4410');
// axe in both color schemes on the page as it is, after drawer and modal transitions.
async function noAxe(page) {
  // The pointer rests away from the page: a hovered filled button has its hover color, which is not what is checked.
  await page.mouse.move(0, 0);
  // A transition may start a frame after the dialog is visible: let it start, then wait until dialogs and overlays are fully opaque.
  await page.waitForTimeout(250);
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')
    && [...document.querySelectorAll('[role=dialog], [class*="Overlay"]')].every((e) => getComputedStyle(e).opacity === '1'), null, { polling: 'raf' });
  for (const scheme of ['light', 'dark']) {
    await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
    // A switched scheme starts color transitions (the segmented control labels): measure the colors they end at.
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { polling: 'raf' });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')} ${v.nodes[0].failureSummary}`)).toEqual([]);
  }
}
// A plan's diffs are folded: open each before reading one.
const openDiffs = async (scope) => {
  const buttons = scope.getByRole('button', { name: /^Show file diff of / });
  await expect(buttons.first()).toBeVisible();
  // An opened fold renames its button, so the first one left is always the next.
  for (let n = await buttons.count(); n > 0; n--) await buttons.first().click();
};

// Serial on one shared server: later tests read what earlier ones left there (registered and set-up projects, applied
// plans, undone runs), so a test cannot run alone. Read-only checks of every view are in views-axe.spec.mjs.
test.describe.configure({ mode: 'serial' });

test.describe('views', () => {
  test.beforeEach(async ({ context, page }) => {
    // Projects as a table unless a test picks Cards: the tests of the rows predate the cards.
    await context.addInitScript(() => { if (localStorage.getItem('bk-projects-layout') === null) localStorage.setItem('bk-projects-layout', 'table'); });
    await page.goto('/');
    // Shortcuts and the skip link exist once the app is up, behind the starting screen.
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
  });

  test('the board tokens are the app variables in both schemes; reduced motion removes the transitions', async ({ page }) => {
    for (const scheme of ['light', 'dark']) {
      await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
      const read = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
      expect(await read('--bk-accent')).toBe(TOKENS[scheme].accent);
      expect(await read('--bk-s2')).toBe(TOKENS[scheme].s2);
      expect(await read('--mantine-color-text')).toBe(TOKENS[scheme].ink);
    }
    // The focus ring is the accent in dark mode (the filled step is below 3:1 on the dark surface).
    const button = page.getByRole('button', { name: 'Fix everything' });
    await page.keyboard.press('Shift');
    await button.focus();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(134, 182, 239)');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await button.evaluate((el) => getComputedStyle(el).transitionDuration)).not.toBe('0s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await button.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  });

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
    await expect(page.getByRole('link', { name: /^Doctor: \d+ errors?, \d+ warnings?$/ })).toBeVisible();
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
      await palette.getByLabel('Search').fill('Agent settings');
      await expect(palette.locator('[data-selected]')).toContainText('Agent settings', { timeout: 1000 });
    }).toPass();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 2, name: 'Agent settings' })).toBeFocused();
  });

  test('Preferences: the / key can be turned off', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const slash = page.getByRole('switch', { name: 'Open the command palette with the / key' });
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    // Hotkeys ignore a focused input, so the focus leaves the switch before each key.
    const press = async (key) => { await page.getByRole('heading', { level: 2, name: 'Preferences' }).click(); await page.keyboard.press(key); };
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

  test('first load: the eval charts are fetched only with the Evals view, the inventory once', async ({ page }) => {
    const urls = [];
    page.on('request', (r) => urls.push(new URL(r.url()).pathname));
    await page.goto('/');
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    expect(urls.filter((u) => u === '/api/inventory')).toHaveLength(1);
    expect(urls.filter((u) => /\/assets\/evals-.*\.js$/.test(u))).toHaveLength(0);
    await nav(page, 'Evals').click();
    await expect(page.getByRole('table', { name: 'Eval targets' })).toBeVisible();
    expect(urls.filter((u) => /\/assets\/evals-.*\.js$/.test(u))).toHaveLength(1);
  });

  test('a chart chunk that fails to load shows a message with Reload, not a blank page', async ({ page }) => {
    await page.route(/\/assets\/evals-.*\.js$/, (r) => r.abort());
    await page.reload();
    await nav(page, 'Evals').click();
    const note = page.getByRole('alert').filter({ hasText: 'Charts did not load' });
    await expect(note.getByRole('button', { name: 'Reload' })).toBeVisible();
    await noAxe(page);
    await page.unroute(/\/assets\/evals-.*\.js$/);
  });

  test('a hidden tab does not poll the running jobs', async ({ page }) => {
    // Hidden from the start and a fake clock that runs past three 2 s poll intervals: no request at all.
    await page.addInitScript(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
    await page.clock.install();
    await page.reload();
    let jobs = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/jobs') jobs++; });
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await page.clock.runFor(6600);
    expect(jobs).toBe(0);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => jobs).toBeGreaterThan(0);
  });

  test('History: the newest 100 runs, the older ones on request, a linked old run stays listed', async ({ page }) => {
    await page.route(/\/api\/history(\?|$)/, async (route) => {
      const real = await (await route.fetch()).json();
      const old = Array.from({ length: 150 }, (_, i) => ({ ...real[0], id: `old-${i}`, time: new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString() })).reverse();
      await route.fulfill({ json: [...real, ...old] });
    });
    await page.reload();
    await nav(page, 'History').click();
    const runs = page.getByRole('navigation', { name: 'Runs' }).getByRole('link');
    await expect(runs).toHaveCount(100);
    await page.getByRole('button', { name: /^Show \d+ older runs$/ }).click();
    await expect(runs).toHaveCount(await page.evaluate(async () => (await (await fetch('/api/history', { headers: { 'x-benchkeeper': localStorage.getItem('benchkeeper-key') } })).json()).length));
    // Opened by its link, an old run is in the list from the start.
    await page.goto('/#/history?run=old-0');
    await page.reload();
    await expect(runs.and(page.locator('[aria-current=true]'))).toHaveCount(1);
  });

  test('Sessions: a scan fills the board frame; a title stays text; no axe violations in the frame, light and dark', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    await expect(board.getByRole('heading', { level: 1, name: 'Sessions board' })).toBeVisible();
    // Controls first: no intro on transcripts, cache or retention, in the view or in the frame.
    await expect(page.getByRole('main')).not.toContainText(/transcript|cache/i);
    await expect(board.locator('main')).not.toContainText(/cleanup period|cache of summaries/i);
    // A skipped Ponytail ledger file is named after a scan.
    const before = await page.locator('iframe[title="Sessions board"]').getAttribute('src');
    await page.getByRole('button', { name: 'Rescan' }).click();
    await expect(page.getByRole('main')).toContainText('Ponytail ledger broken.csv skipped: not a Ponytail ledger');
    // The scan loads a new frame after the note: the filter is set on that one, not on the frame it replaces.
    await expect(page.locator('iframe[title="Sessions board"]')).not.toHaveAttribute('src', before);
    await expect(board.getByRole('heading', { level: 1, name: 'Sessions board' })).toBeVisible();
    await board.getByLabel('Period').selectOption('all');
    // A changed count is announced.
    await expect(board.locator('#count-live')).toContainText(/\d+ of \d+ sessions/);
    await expect(board.getByRole('table', { name: 'Sessions, newest first' })).toContainText('Cart </script><img src=x onerror=alert(1)> fix');
    await expect(board.locator('#by-tier')).toContainText('full');
    await noAxe(page);
    // The app's theme reaches the frame without a reload: the filter the user set stays.
    await page.getByRole('button', { name: 'Dark theme' }).click();
    await expect(board.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('iframe[title="Sessions board"]')).toHaveAttribute('src', /^\/board\?theme=light&ticket=[\w-]+$/);
    await expect(board.getByLabel('Period')).toHaveValue('all');
    await noAxe(page);
  });

  test('Sessions board: one entry per repository with its worktree sessions folded in, a folder of no repository under Other; Registered only keeps the registered project and is remembered', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    const cards = board.locator('#rail button.card:not(.all)');
    await board.getByLabel('Period').selectOption('all');
    await expect(cards.filter({ hasText: /^bk-ui-proj/ })).toContainText('2 sessions, 2 worktrees');
    await expect(cards.filter({ hasText: /^Other/ })).toContainText('3 sessions, 2 folders');
    await board.getByLabel('Registered only').check();
    await expect(cards).toHaveText([/^bk-ui-proj2 sessions, 2 worktrees/]);
    await expect(board.locator('#count')).toHaveText('2 of 2 sessions');
    await page.reload();
    await expect(board.getByLabel('Registered only')).toBeChecked();
    await expect(cards).toHaveCount(1);
  });

  test('Sessions board: the frame has the board\'s height and its own heading, intro and theme button are hidden; a day is read by pointer and keyboard; a setup keeps its color; an empty selection says so', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const frame = page.locator('iframe[title="Sessions board"]');
    const board = page.frameLocator('iframe[title="Sessions board"]');
    await board.getByLabel('Period').selectOption('all');
    // The frame is as tall as the board, so the page scrolls and the frame does not.
    await expect.poll(async () => (await frame.boundingBox()).height).toBeGreaterThan(700);
    expect(await board.locator('body').evaluate((b) => b.scrollHeight - b.clientHeight)).toBeLessThanOrEqual(1);
    await expect(board.locator('#theme')).toBeHidden();
    await expect(board.locator('.lead')).toBeHidden();
    // Pointer: the readout names the day and every series in it, not one bar.
    const colors = () => board.locator('#legend').evaluate((el) => Object.fromEntries([...el.querySelectorAll('.key')].map((k) => [k.textContent, k.querySelector('.swatch').getAttribute('style')])));
    const all = await colors();
    expect(Object.keys(all).length).toBeGreaterThan(1);
    const hits = board.locator('#chart svg rect[fill=transparent]');
    await hits.nth(await hits.count() - 3).hover();
    await expect(board.locator('#tip')).toContainText(/\d{4}-\d{2}-\d{2}.*(Total|no sessions)/);
    // Keyboard: arrow keys read day by day, Escape closes.
    await board.locator('#chart').focus();
    await page.keyboard.press('End');
    await expect(board.locator('#tip')).toContainText(new Date().toISOString().slice(0, 10));
    await expect(board.locator('#tip-live')).toContainText(new Date().toISOString().slice(0, 10));
    await page.keyboard.press('ArrowLeft');
    await expect(board.locator('#tip')).not.toContainText(new Date().toISOString().slice(0, 10));
    await page.keyboard.press('Escape');
    await expect(board.locator('#tip')).toBeEmpty();
    // The fixture's sessions with subagents are groups; the others are single.
    await expect(board.locator('#by-pattern')).toContainText('group');
    await board.getByLabel('Pattern', { exact: true }).selectOption('single');
    await expect(board.locator('#count')).toContainText(/^3 of 3 sessions/);
    await board.getByLabel('Pattern', { exact: true }).selectOption('');
    // A filter that drops series does not repaint the others.
    await board.getByLabel('Agent', { exact: true }).selectOption('claude');
    const some = await colors();
    for (const [name, style] of Object.entries(some)) expect(all[name]).toBe(style);
    // Nothing selected: one sentence per section, no empty axis.
    await board.getByLabel('Agent', { exact: true }).selectOption('codex');
    await board.getByLabel('Tier', { exact: true }).selectOption('full');
    await expect(board.getByText('No sessions match these filters.')).toHaveCount(11);
    await expect(board.locator('#chart svg')).toHaveCount(0);
    await noAxe(page);
  });

  test('no axe violations with the command palette open, light and dark', async ({ page }) => {
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await noAxe(page);
  });

  test('keyboard: Tab to a sidebar link and Enter opens its view; mod+2 opens History, mod+3 Projects', async ({ page }) => {
    const link = nav(page, 'Global setup');
    for (let i = 0; i < 30 && !(await link.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('table', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('row', { name: /^Codex/ })).toContainText('the usage feed is not available for Codex');
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page).toHaveURL(/#\/history$/);
    await page.keyboard.press('ControlOrMeta+3');
    await expect(nav(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/#\/projects$/);
  });

  test('sidebar: five groups in order, and Preferences lists the nine view keys by name', async ({ page }) => {
    const sidebar = page.getByRole('navigation', { name: 'Views' });
    await expect(sidebar.getByRole('group')).toHaveText([/^Overview/, /^Projects/, /^Analysis/, /^Agent configuration/, /^Machine/]);
    await expect(sidebar.getByRole('group', { name: 'Machine' }).getByRole('link')).toHaveText([/^Automations/, /^Preferences/]);
    await nav(page, 'Preferences').click();
    const keys = page.getByRole('table', { name: 'Keyboard shortcuts' });
    for (const [n, view] of [[1, 'Dashboard'], [3, 'Projects'], [9, 'Global setup']]) await expect(keys.getByRole('row', { name: new RegExp(`^(Ctrl|Cmd)\\+${n} ${view}$`) })).toBeVisible();
  });

  test('Dashboard shows the edited rules file as modified in the setup by part', async ({ page }) => {
    await page.getByText('More about the setup').click();
    const cell = page.getByRole('table', { name: 'Global setup by part' }).getByRole('link', { name: 'rules for Claude Code: modified, open the plan' });
    await cell.click();
    await expect(page).toHaveURL(/#\/agents\?agent=claude$/);
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('Claude Code rules');
  });

  test('a slow first overview shows the starting screen, not 0 agents; a failed one offers Try again', async ({ page }) => {
    let down = true;
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route(/\/api\/overview(\?|$)/, async (route) => {
      if (!down) return route.continue();
      await gate;
      return route.abort('connectionreset');
    });
    await page.reload();
    await expect(page.getByRole('status')).toContainText('Starting');
    await expect(page.getByText('0 installed')).toHaveCount(0);
    release();
    await expect(page.getByRole('alert')).toContainText('Cannot read the setup');
    down = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
  });

  test('a failed refresh keeps the shell and the open view', async ({ page }) => {
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await nav(page, 'Preferences').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Preferences' })).toBeVisible();
    let failed = 0;
    await page.route(/\/api\/overview(\?|$)/, (r) => r.abort('connectionreset'));
    page.on('requestfailed', (q) => { if (new URL(q.url()).pathname === '/api/overview') failed++; });
    // Closing the one-run drawer calls refresh().
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByRole('dialog', { name: 'Command palette' }).getByLabel('Search').fill('Set up projects in one run');
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'One-run setup' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // The read is asked twice (a lost connection is retried once), then the overview clears.
    await expect.poll(() => failed).toBeGreaterThanOrEqual(2);
    // The failure clears the overview in the next render: wait for a frame after it.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(page.getByRole('heading', { level: 2, name: 'Preferences' })).toBeVisible();
    await expect(page.getByText('Starting')).toHaveCount(0);
  });

  test('Dashboard: the top row counts what needs attention and where, the health ring and the scopes; the flow folds away', async ({ page }) => {
    // The fixture has items in the global setup and a project: no one view shows both, so only the parts link.
    await expect(page.getByRole('link', { name: /items need attention/ })).toHaveCount(0);
    await expect(page.getByText(/^items, in the global setup \d+, /).getByRole('link', { name: 'the global setup' })).toHaveAttribute('href', '#/agents?plan=1');
    await expect(page.getByRole('link', { name: /^\d+ doctor findings, open the table$/ })).toHaveAttribute('href', '#/dashboard?panel=doctor');
    await expect(page.getByRole('img', { name: /^Items by state: .*\d+ modified/ })).toBeVisible();
    const where = page.getByRole('region', { name: 'Where' }).getByRole('list', { name: 'Items by scope' });
    await expect(where.getByRole('listitem').first()).toContainText(/^Global\d+ current/);
    await expect(where.getByRole('link', { name: 'Global' })).toHaveAttribute('href', '#/agents?plan=1');
    await expect(where.getByRole('listitem').filter({ hasText: 'not set up' })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Setup flow' })).toBeHidden();
    // At 390 px the blocks stack and nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByText('More about the setup').click();
    await expect(page.getByRole('group', { name: /^Setup flow/ }).getByRole('link', { name: /^Projects 2 registered, 1 behind attention$/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'BenchKeeper plugin' })).toContainText(/available \d+\.\d+\.\d+/);
    await expect(page.getByRole('region', { name: 'Install level' })).toContainText('full');
    await page.getByRole('region', { name: 'Recent runs' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/#\/history\?run=/);
  });

  test('Dashboard: a project that cannot be read is named in the attention card, also when nothing else needs attention', async ({ page }) => {
    let clean = false;
    await page.route(/\/api\/dashboard(\?|$)/, async (route) => {
      const d = await (await route.fetch()).json();
      const zero = (states) => states && Object.fromEntries(Object.keys(states).map((s) => [s, 0]));
      if (clean) d.global.states = zero(d.global.states);
      d.projects = [...d.projects.map((p) => (clean ? { ...p, states: zero(p.states) } : p)),
        { ...d.projects[0], path: '/gone', name: 'gone', setup: false, states: null, error: 'EACCES: permission denied' }];
      return route.fulfill({ json: d });
    });
    for (const c of [false, true]) {
      clean = c;
      await page.reload();
      await expect(page.getByText(/^Cannot be read: gone$/).getByRole('link', { name: 'gone' })).toHaveAttribute('href', '#/projects/%2Fgone');
    }
    await expect(page.getByText('Nothing needs attention.')).toHaveCount(0);
  });

  test('Dashboard: a failed dashboard request shows one alert with one Try again, and the panels it feeds say Not loaded', async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/dashboard(\?|$)/, (route) => (fail ? route.fulfill({ status: 500, json: { error: 'stubbed failure' } }) : route.fallback()));
    await page.reload();
    const alert = page.getByRole('alert').filter({ hasText: 'Dashboard data not loaded' });
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('stubbed failure');
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Health' })).toContainText('Not loaded.');
    fail = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByRole('img', { name: /^Items by state: / })).toBeVisible();
  });

  test('Dashboard: installed, health and coverage figures are links with a keyboard path; the catalog by pack is a sorted list', async ({ page }) => {
    await page.getByText('More about the setup').click();
    const installed = page.getByRole('table', { name: 'Installed skills and packs' });
    await expect(installed.getByRole('row', { name: /^Global/ }).getByRole('link', { name: /^Claude Code \d+$/ })).toHaveAttribute('href', '#/agents?agent=claude');
    await expect(installed.getByRole('row', { name: /bk-ui-proj/ }).getByRole('link', { name: 'frontend' })).toHaveAttribute('href', '#/catalog?pack=frontend');
    // The rows beside the ring count what it draws.
    const health = page.getByRole('region', { name: 'Health' });
    await expect(health.getByRole('list', { name: 'Items by state, all scopes' }).getByRole('link', { name: /modified/ })).toBeVisible();
    // Coverage rows are the packs a project chose; the others are one line of links under the table.
    const coverage = page.getByRole('region', { name: 'Coverage' });
    const packRows = coverage.getByRole('table', { name: 'Pack coverage' }).locator('tbody tr');
    await expect(packRows.first()).toBeVisible();
    await expect(packRows.filter({ has: page.getByRole('link', { name: / for .*: \d+ projects?$/ }) })).toHaveCount(await packRows.count());
    await expect(coverage.getByText(/^In no project: /).getByRole('link', { name: 'Testing' })).toHaveAttribute('href', '#/catalog?pack=testing');
    // A cell of the coverage matrix: reached with Tab-order focus and opened with Enter, the projects with that pack and agent.
    const cell = page.getByRole('table', { name: 'Pack coverage' }).getByRole('link', { name: 'Frontend for Claude Code: 1 project' });
    await cell.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/projects\?pack=frontend&agent=claude$/);
    await expect(page.getByRole('table', { name: 'Projects' }).getByRole('row', { name: /bk-ui-proj/ })).toBeVisible();
    await nav(page, 'Dashboard').click();
    await page.getByText('More about the setup').click();
    const bars = page.getByRole('list', { name: 'Skills per pack' }).getByRole('listitem');
    await expect(bars.first()).toBeVisible();
    const counts = await bars.evaluateAll((li) => li.map((x) => Number(x.lastElementChild.textContent)));
    expect(counts.length).toBeGreaterThan(3);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  test('Catalog opens with the pack and agent a link names', async ({ page }) => {
    await page.goto('/#/catalog?pack=frontend&agent=codex');
    await expect(page.getByRole('combobox', { name: 'Pack' })).toHaveValue('Frontend');
    await expect(page.getByRole('combobox', { name: 'Agent' })).toHaveValue('Codex');
  });

  test('Dashboard: a doctor finding opens the plan that fixes it', async ({ page }) => {
    const doctor = page.getByRole('region', { name: 'Doctor' });
    await doctor.getByRole('row', { name: /Claude Code rules/ }).getByRole('link', { name: 'Plan fix' }).click();
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('Claude Code rules');
    await expect(page.getByRole('banner').getByRole('link', { name: /^Doctor: \d+ errors?, \d+ warnings?$/ })).toBeVisible();
  });

  test('Dashboard: a doctor cell shows the action, a source URL sits behind a link, a run id opens History', async ({ page }) => {
    const table = page.getByRole('region', { name: 'Doctor' }).getByRole('table', { name: 'Doctor findings' });
    await expect(table.getByRole('row', { name: /SUBPROCESS_ENV_SCRUB/ }).getByRole('link', { name: 'Open settings' })).toBeVisible();
    await expect(table.getByRole('row', { name: /SUBPROCESS_ENV_SCRUB/ }).getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', /^https:\/\//);
    await expect(table).not.toContainText('https://');
    const run = table.getByRole('row', { name: /00-global\.md changed since run/ }).getByRole('link', { name: /^\d{8}T\d{6}Z-[0-9a-f]{6}$/ });
    await run.click();
    await expect(page).toHaveURL(/#\/history\?run=\d{8}T/);
    await expect(page.getByRole('region', { name: /^Run / })).toBeVisible();
  });

  test('Doctor counts: the header, the Dashboard and Insights count errors, warnings and info alike; an info finding has the info color', async ({ page }) => {
    const info = { level: 'info', check: 'allow-rules', message: 'Claude Code allows WebFetch (user, settings.json): every WebFetch call', fix: 'information only, nothing is changed' };
    await page.route(/\/api\/doctor(\?|$)/, async (route) => route.fulfill({ json: [...await (await route.fetch()).json(), info] }));
    await page.route(/\/api\/insights(\?|$)/, async (route) => {
      const real = await (await route.fetch()).json();
      route.fulfill({ json: { ...real, findings: [...real.findings, { ...real.findings.at(-1), key: 'info-test', id: 'info-test', severity: 'info', message: info.message, triage: null }] } });
    });
    await page.goto('/#/dashboard');
    await page.reload();
    const badge = page.getByRole('banner').getByRole('link', { name: /^Doctor: / });
    await expect(badge).toHaveText(/^Doctor: \d+ errors?, \d+ warnings?, 1 info$/);
    const counts = (await badge.textContent()).slice('Doctor: '.length);
    await expect(page.getByRole('region', { name: 'Doctor' }).getByRole('row', { name: /allows WebFetch/ }).locator('.bk-dot')).toHaveAttribute('style', /--mantine-color-blue-filled/);
    await expect(page.getByText(counts, { exact: true })).toHaveCount(2);
    await nav(page, 'Insights').click();
    await expect(page.getByText(new RegExp(`^\\d+ findings: ${counts}\\. Do first: `))).toBeVisible();
  });

  test('Insights: the summary names the count and the first finding, findings are grouped by severity and area; a card names its action as the Doctor table does and links its fix source, the action opens the plan, Dismiss and Snooze hide a card and a reload keeps it, Show again brings it back; focus moves to the next finding or the list and the status says what happened; other evidence and an ended snooze show; no axe violations', async ({ page }) => {
    await nav(page, 'Insights').click();
    const card = (re) => page.getByRole('article', { name: re });
    const market = card(/marketplace benchkeeper$/), deny = card(/No Read deny rule/), scrub = card(/SUBPROCESS_ENV_SCRUB/);
    // The seeded dismissal belongs to other evidence and the seeded snooze has ended: both findings show.
    await expect(deny).toBeVisible();
    await expect(scrub).toBeVisible();
    await expect(deny.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', /^#\/agent-settings/);
    await expect(deny).toContainText('permissions.deny');
    await expect(deny.getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', /^https:\/\//);
    await expect(deny).not.toContainText('(https://');
    await expect(page.getByText(/^\d+ findings: \d+ (error|warning).*\. Do first: /)).toBeVisible();
    await expect(page.getByText(/^Checked at \d\d:\d\d: the doctor's checks/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Setup' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Agent settings' })).toBeVisible();
    // Do first names the first card and moves focus to it.
    const first = page.getByRole('article').first().getByRole('heading');
    await page.getByRole('button', { name: await first.textContent(), exact: true }).click();
    await expect(first).toBeFocused();
    await noAxe(page);
    await card(/plugin benchkeeper@benchkeeper$/).getByRole('link', { name: 'Plan fix' }).click();
    await expect(page).toHaveURL(/#\/agents\?plan=1$/);
    await expect(page.getByRole('region', { name: 'Changes' })).toBeVisible();
    await nav(page, 'Insights').click();
    // The heading after the card in page order, or before it for the last card.
    const nextHeading = (art) => art.evaluate((a) => { const all = [...document.querySelectorAll('article')], i = all.indexOf(a); return (all[i + 1] ?? all[i - 1]).getAttribute('aria-labelledby'); });
    const status = page.getByRole('status').filter({ hasText: /^(Dismissed|Snoozed for 7 days|Shown again): / });
    let next = await nextHeading(market);
    await market.getByRole('button', { name: 'Dismiss' }).focus();
    await page.keyboard.press('Enter');
    await expect(market).toHaveCount(0);
    await expect(page.locator(`[id="${next}"]`)).toBeFocused();
    await expect(status).toHaveText(/^Dismissed: .*marketplace benchkeeper$/);
    next = await nextHeading(scrub);
    await scrub.getByRole('button', { name: 'Snooze 7 days' }).focus();
    await page.keyboard.press('Enter');
    await expect(scrub).toHaveCount(0);
    await expect(page.locator(`[id="${next}"]`)).toBeFocused();
    await expect(status).toHaveText(/^Snoozed for 7 days: .*SUBPROCESS_ENV_SCRUB/);
    await page.reload();
    await expect(deny).toBeVisible();
    await expect(market).toHaveCount(0);
    await expect(scrub).toHaveCount(0);
    const hidden = page.getByRole('region', { name: 'Dismissed and snoozed findings' });
    await hidden.getByRole('button', { name: 'Dismissed and snoozed (2)' }).click();
    const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await expect(hidden).toContainText('Dismissed');
    await expect(hidden).toContainText(`Snoozed until ${week}`);
    await noAxe(page);
    await hidden.getByRole('button', { name: 'Show again' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(market.or(scrub)).toHaveCount(1);
    await expect(hidden).toBeFocused();
    await expect(status).toHaveText(/^Shown again: /);
    await hidden.getByRole('button', { name: 'Show again' }).focus();
    await page.keyboard.press('Enter');
    await expect(hidden).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Findings' })).toBeFocused();
    await expect(market).toBeVisible();
    await expect(scrub).toBeVisible();
  });

  test('Insights: while a dismissal is saved, triage waits across the list, so two quick dismissals leave focus on a remaining finding', async ({ page }) => {
    await nav(page, 'Insights').click();
    const cards = page.getByRole('article');
    const [first, second] = [cards.nth(0), cards.nth(1)];
    const name = await first.getAttribute('aria-labelledby');
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(/\/api\/insights-triage$/, async (route) => { await held; await route.continue(); });
    await first.getByRole('button', { name: 'Dismiss' }).click();
    await expect(second.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    await expect(second.getByRole('button', { name: 'Snooze 7 days' })).toBeDisabled();
    release();
    await expect(page.locator(`[id="${name}"]`)).toHaveCount(0);
    const focused = await page.evaluate(() => document.activeElement.id);
    expect(await page.locator('article').evaluateAll((all) => all.map((a) => a.getAttribute('aria-labelledby')))).toContain(focused);
    await page.unroute(/\/api\/insights-triage$/);
    const hidden = page.getByRole('region', { name: 'Dismissed and snoozed findings' });
    await hidden.getByRole('button', { name: /^Dismissed and snoozed/ }).click();
    await hidden.getByRole('button', { name: 'Show again' }).click();
    await expect(hidden).toHaveCount(0);
  });

  test('Insights narrative: the input is on the page, the first run asks for consent, the text is marked as model text and a dismissal drops it; no axe violations', async ({ page }) => {
    await nav(page, 'Insights').click();
    const narrative = page.getByRole('region', { name: 'Adviser narrative' });
    // Opt-in: folded until a narrative exists.
    await expect(narrative).toBeHidden();
    await page.getByText('Adviser narrative', { exact: true }).click();
    await expect(narrative).toBeVisible();
    await narrative.getByRole('button', { name: /^Input sent to the agent \(\d/ }).click();
    await expect(narrative.locator('#narrative-input')).toContainText('"findings"');
    await noAxe(page);
    await narrative.getByRole('button', { name: 'Write with Claude Code' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send the findings to an agent?' });
    await expect(dialog).toContainText('No session messages, prompts, file contents');
    await noAxe(page);
    await dialog.getByRole('button', { name: 'Agree and write with Claude Code' }).click();
    await expect(narrative.getByText('Model text')).toBeVisible();
    await expect(narrative).toContainText('Fix the deny rule first.');
    await expect(narrative).toContainText('$0.0214');
    await page.reload();
    await expect(narrative).toContainText('Fix the deny rule first.');
    await expect(narrative.getByRole('button', { name: 'Write again with Claude Code' })).toBeVisible();
    await page.getByRole('article', { name: /SUBPROCESS_ENV_SCRUB/ }).getByRole('button', { name: 'Dismiss' }).click();
    await expect(narrative.getByText('Model text')).toHaveCount(0);
    const hidden = page.getByRole('region', { name: 'Dismissed and snoozed findings' });
    await hidden.getByRole('button', { name: /^Dismissed and snoozed/ }).click();
    await hidden.getByRole('button', { name: 'Show again' }).click();
  });

  test('Insights: a failed narrative read keeps the folded section with the error and Try again; no findings leaves no Findings heading', async ({ page }) => {
    let fail = true;
    await page.route(/\/api\/insights-narrative(\?|$)/, (route) => (fail ? route.fulfill({ status: 500, json: { error: 'stubbed failure' } }) : route.fallback()));
    await nav(page, 'Insights').click();
    await page.getByText('Adviser narrative', { exact: true }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'Adviser narrative not loaded' });
    await expect(alert).toContainText('stubbed failure');
    fail = false;
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await page.unroute(/\/api\/insights-narrative(\?|$)/);
    await page.route(/\/api\/insights(\?|$)/, async (route) => route.fulfill({ json: { ...(await (await route.fetch()).json()), findings: [] } }));
    await page.reload();
    await expect(page.getByText('No findings.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Findings' })).toHaveCount(0);
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
    // The Dashboard's doctor links runs too: the link counted is one the History view lists.
    await expect(page.getByRole('heading', { level: 2, name: 'History' })).toBeVisible();
    await expect(page.getByRole('main').locator('a[href*="history?run="]').first()).toBeVisible();
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
    await expect(page).toHaveURL(/#\/projects\/[^/?]+$/);
  });

  test('the segmented control focus ring is the accent in dark mode', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'));
    await nav(page, 'Agent settings').click();
    await page.getByRole('radio').first().focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => getComputedStyle(document.activeElement).getPropertyValue('--segmented-control-outline').trim())).toBe('2px solid #86b6ef');
  });

  test('the Switch focus ring is the accent in dark mode', async ({ page }) => {
    await page.evaluate(() => document.documentElement.setAttribute('data-mantine-color-scheme', 'dark'));
    await nav(page, 'Agent settings').click();
    const toggle = page.getByRole('switch', { name: 'Changed from default' });
    await page.keyboard.press('Shift');
    await toggle.focus();
    expect(await toggle.evaluate((el) => getComputedStyle(el.nextElementSibling).outlineColor)).toBe('rgb(134, 182, 239)');
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

  test('Catalog: the pack builder removes a skill with focus kept, finds no overlapping descriptions in the library and saves an own pack; export downloads it', async ({ page }) => {
    await nav(page, 'Catalog').click();
    const boxes = page.getByRole('table', { name: 'Skills' }).getByRole('checkbox');
    for (let i = 0; i < 6; i++) await boxes.nth(i).check();
    await page.getByRole('button', { name: 'Build pack (6)' }).click();
    const drawer = page.getByRole('dialog', { name: 'Build a pack' });
    await expect(drawer.getByLabel(/^Pack id/)).toBeVisible();
    // Remove takes its row: focus moves to the skills count and the status names the skill.
    await drawer.getByRole('button', { name: /^Remove / }).first().focus();
    await page.keyboard.press('Enter');
    await expect(drawer.getByText('Skills (5)')).toBeFocused();
    await expect(drawer.getByRole('status')).toHaveText(/^Removed: /);
    await expect(drawer.getByText(/overlapping descriptions/)).toHaveCount(0);
    await noAxe(page);
    await drawer.getByLabel(/^Pack id/).fill('my-pack');
    await drawer.getByRole('button', { name: 'Save pack' }).click();
    await expect(drawer).toBeHidden();
    const packs = page.getByRole('table', { name: 'Packs' });
    await expect(packs.getByRole('row', { name: /my-pack.*own/ })).toBeVisible();
    const download = page.waitForEvent('download');
    await packs.getByRole('button', { name: 'Export my-pack' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('my-pack.json');
    // The file's id is an own pack's: asked first, and Cancel leaves everything as it was.
    const importFile = async () => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Import pack file' }).click();
      await (await chooser).setFiles(await file.path());
    };
    await importFile();
    const ask = page.getByRole('dialog', { name: 'Replace pack my-pack?' });
    await expect(ask).toContainText('run backups');
    await noAxe(page);
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    await importFile();
    await ask.getByRole('button', { name: 'Replace pack my-pack' }).click();
    await expect(ask).toBeHidden();
    await expect(packs.getByRole('row', { name: /my-pack.*own/ })).toHaveCount(1);
  });

  test('Catalog: a pack file that is not a pack is listed with its reason and can be removed with focus kept; no axe violations', async ({ page }) => {
    await page.route(/\/api\/catalog(\?|$)/, async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), invalidPacks: [{ file: 'broken.json', reason: 'not valid JSON' }] } });
    });
    await page.route(/\/api\/packs$/, (route) => route.fulfill({ json: { removed: 'broken.json' } }));
    await page.reload();
    await nav(page, 'Catalog').click();
    const bad = page.getByRole('region', { name: 'Pack files that are not packs' });
    await expect(bad).toContainText('broken.json');
    await expect(bad).toContainText('not valid JSON');
    await noAxe(page);
    const sent = page.waitForRequest((q) => q.url().endsWith('/api/packs') && q.method() === 'POST');
    await bad.getByRole('button', { name: 'Remove broken.json' }).focus();
    await page.keyboard.press('Enter');
    expect((await sent).postDataJSON()).toEqual({ action: 'remove', id: 'broken.json' });
    // Its last file takes the section with it: focus moves to the Packs heading.
    await expect(page.getByRole('heading', { level: 3, name: 'Packs', exact: true })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Removed: broken.json' })).toHaveCount(1);
    // The removal reloads the catalog: wait for that stubbed answer.
    await page.unrouteAll({ behavior: 'wait' });
  });

  test('Projects: the drift board row, its plan, skill toggle and doctor, and Update all progress per project', async ({ page }) => {
    // The fixture project has no origin; the list says Update all pushes the shared one so Update all asks before the pull request.
    await page.route(/\/api\/projects(\?|$)/, async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: (await r.json()).map((p) => ({ ...p, github: true, willPush: p.share })) });
    });
    await nav(page, 'Projects').click();
    const row = page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1);
    await expect(row).toContainText('current, shared');
    await expect(row).toContainText(/\d+ pending/);
    await expect(row).toContainText('dirty');
    await row.getByRole('link').click();
    await expect(page).toHaveURL(/#\/projects\/[^/?]+$/);
    await expect(page.getByRole('region', { name: 'Project doctor' })).toBeVisible();
    await page.getByRole('tab', { name: 'Installs' }).click();
    const changes = page.getByRole('region', { name: 'Changes', exact: true });
    await expect(changes).toBeVisible();
    const skill = page.getByRole('region', { name: 'Skills' }).getByRole('switch').first();
    await skill.click();
    await expect(changes).toContainText('.benchkeeper/disabled/');
    await noAxe(page);
    await page.getByRole('link', { name: 'All projects' }).click();
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    // The project's setup is shared: a pull request, so Update all asks first and names the count.
    const ask = page.getByRole('dialog', { name: 'Open up to 1 pull request?' });
    await noAxe(page);
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    await expect(page.getByRole('progressbar', { name: /^Update all:/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    // After the last of the 2 projects the page reloads the list; its response means the handler's route.fetch() is done.
    let updated = 0;
    const reloaded = page.waitForResponse((r) => {
      if (r.url().endsWith('/api/update-all')) updated++;
      return updated === 2 && /\/api\/projects(\?|$)/.test(r.url()) && r.request().method() === 'GET';
    });
    await ask.getByRole('button', { name: 'Update all and open up to 1 pull request' }).click();
    await expect(page.getByRole('progressbar', { name: 'Update all: 2 of 2 projects' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Update all results' })).toContainText(/stopped|current|committed/);
    await reloaded;
    // Guard for any later call of the handler.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('Projects: Update all counts a pull request only for a project the list marks willPush', async ({ page }) => {
    const project = (name, extra) => ({ path: `/work/${name}`, setupVersion: '0.1.0', current: false, changes: [], repo: true, clean: true, ...extra });
    // shared-local: status reads a newer shared setup on origin, but Update all applies the untracked local one.
    await page.route(/\/api\/projects(\?|$)/, (route) => route.fulfill({ json: [project('local'), project('shared', { share: true, github: true, willPush: true }), project('shared-local', { share: true, github: true }), project('no-github', { share: true }), project('committed', { committed: true })] }));
    await nav(page, 'Projects').click();
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    const ask = page.getByRole('dialog', { name: 'Open up to 1 pull request?' });
    await expect(ask.getByRole('button', { name: 'Update all and open up to 1 pull request' })).toBeVisible();
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
  });

  test('Projects: Update all runs without asking when no shared project has a GitHub origin', async ({ page }) => {
    const project = (name, extra) => ({ path: `/work/${name}`, setupVersion: '0.1.0', current: false, changes: [], repo: true, clean: true, ...extra });
    await page.route(/\/api\/projects(\?|$)/, (route) => route.fulfill({ json: [project('no-github', { share: true })] }));
    await page.route(/\/api\/update-all$/, (route) => route.fulfill({ json: [{ path: '/work/no-github', status: 'committed', branch: 'chore/agent-setup-0.2.0' }] }));
    await nav(page, 'Projects').click();
    const sent = page.waitForRequest((q) => q.url().endsWith('/api/update-all'));
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ paths: ['/work/no-github'], push: true });
    await expect(page.getByRole('dialog', { name: /pull request/ })).toHaveCount(0);
  });

  test('Projects: Choose folder fills the path from the dialog; scan offers the unregistered folder', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('button', { name: 'Choose folder' }).click();
    await expect(page.getByLabel('Project folder')).toHaveValue(/bk-ui-scan-/);
    await page.getByRole('button', { name: 'Scan for projects' }).click();
    const found = page.getByRole('region', { name: 'Found projects' });
    await expect(found.getByRole('checkbox')).toHaveCount(1);
    await expect(found.getByRole('checkbox', { name: /\/found$/ })).toBeChecked();
    await found.getByRole('button', { name: 'Add selected (1)' }).click();
    const table = page.getByRole('table', { name: 'Projects' });
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table.getByRole('row', { name: /found/ })).toContainText('not set up');
    await unregister(page, ['found']);
  });

  test('Projects: one line for name and tree state, one for path and branch; one status per column; no mid-word break at phone width', async ({ page }) => {
    await nav(page, 'Projects').click();
    const row = page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1);
    await expect(row).toContainText(/\d+ loaded/);
    await expect(row.getByRole('cell').nth(2).locator('.mantine-Badge-root')).toHaveCount(1);
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 800 });
      // The path line keeps one line: cut at its start, never wrapped.
      const path = row.getByRole('cell').nth(1).locator('p').last();
      await expect(path).toHaveCSS('white-space', 'nowrap');
      expect((await path.boundingBox()).height).toBeLessThan(24);
      await noAxe(page);
    }
  });

  // Folders for the list tests: made here, registered in the page and unregistered again, so the other tests see the
  // projects they expect.
  const folder = (name) => { const d = join(mkdtempSync(join(tmpdir(), 'bk-ui-mv-')), name); mkdirSync(d); return d; };
  const addFolder = async (page, dir) => { await page.getByLabel('Project folder').fill(dir); await page.getByRole('button', { name: 'Add project' }).click(); };
  const choose = async (page, label, option) => { await page.getByRole('combobox', { name: label }).click(); await page.getByRole('option', { name: option, exact: true }).click(); };
  const chip = (page, name) => page.getByRole('group', { name: 'Filters' }).getByText(name, { exact: true });
  const bar = (page) => page.getByRole('group', { name: 'Selected projects' });
  const unregister = async (page, names) => {
    const table = page.getByRole('table', { name: 'Projects' });
    for (const n of names) await table.getByRole('checkbox', { name: `Select ${n}` }).check();
    await bar(page).getByRole('button', { name: 'Remove from list' }).click();
    const ask = page.getByRole('dialog', { name: `Remove ${names.length} project${names.length === 1 ? '' : 's'} from the list?` });
    await noAxe(page);
    await ask.getByRole('button', { name: /^Remove \d+ projects? from the list$/ }).click();
    await expect(ask).toBeHidden();
    for (const n of names) await expect(table.getByRole('link', { name: n, exact: true })).toHaveCount(0);
  };

  test('Projects: display name and notes, search, filter and sort, selection by keyboard', async ({ page }) => {
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, folder('mv-app'));
    await table.getByRole('link', { name: 'mv-app', exact: true }).click();
    await page.getByRole('button', { name: 'Edit name and notes' }).click();
    await page.getByLabel('Display name').fill('Marketing site');
    await page.getByLabel('Notes').fill('owner: ana');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Marketing site' })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Project \// })).toContainText('owner: ana');
    await page.getByRole('link', { name: 'All projects' }).click();
    await expect(table.getByRole('link', { name: 'Marketing site', exact: true })).toBeVisible();
    // The name and the notes are searched; the filter and the sort narrow and order the rows.
    await page.getByLabel('Search projects').fill('ana');
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByLabel('Search projects').fill('zzz');
    await expect(page.getByText('No project matches the search and filters.')).toBeVisible();
    await page.getByLabel('Search projects').fill('');
    await chip(page, 'No setup').click();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table).not.toContainText('bk-ui-proj');
    await chip(page, 'No setup').click();
    await choose(page, 'Sort by', 'Name');
    await expect(table.getByRole('row').nth(1)).toContainText('bk-ui-proj');
    await choose(page, 'Sort by', 'Order added');
    // Selection with the keyboard: focus the checkbox, Space; the bar names the count.
    const box = table.getByRole('checkbox', { name: 'Select Marketing site' });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(box).toBeChecked();
    await expect(bar(page)).toContainText('1 selected');
    await expect(bar(page).getByRole('button', { name: 'Update' })).toBeDisabled();
    await noAxe(page);
    await page.getByRole('checkbox', { name: 'Select all shown projects' }).check();
    await expect(bar(page)).toContainText('3 selected');
    await page.getByRole('checkbox', { name: 'Select all shown projects' }).uncheck();
    await unregister(page, ['Marketing site']);
  });

  test('Projects cards: totals equal the cards, health with findings, setup line, the graph as text; selection by keyboard shows the bulk bar; the choice is remembered; 390 px without sideways scroll; no axe violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    // At this width the sidebar is a closed menu.
    await page.goto('/#/projects');
    await page.getByText('Cards', { exact: true }).click();
    const cards = page.getByRole('list', { name: 'Projects' });
    // bk-ui-proj and other, both registered by serve.mjs.
    await expect(cards.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Totals' })).toContainText(/^2projects/);
    const card = cards.getByRole('article', { name: /^bk-ui-proj/ });
    await expect(card).toContainText(/In sync|Outdated|Modified/);
    await expect(card).toContainText('Claude Code');
    await expect(card.getByRole('img', { name: /^(\d+ sessions? on \d+ days?|No sessions) from \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d/ })).toBeVisible();
    await expect(card).toContainText(/sessions in 30 days/);
    await expect(page.getByRole('img', { name: /^Projects by health: / })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The chips narrow the cards and the table shows the same projects.
    await chip(page, 'No setup').click();
    await expect(cards.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Totals' })).toContainText(/^1projects/);
    await page.getByText('Table', { exact: true }).click();
    await expect(page.getByRole('table', { name: 'Projects' }).getByRole('row')).toHaveCount(2);
    await page.getByText('Cards', { exact: true }).click();
    await chip(page, 'No setup').click();
    await expect(bar(page)).toHaveCount(0);
    const box = card.getByRole('checkbox', { name: /^Select bk-ui-proj/ });
    await box.focus();
    await page.keyboard.press('Space');
    await expect(bar(page)).toContainText('1 selected');
    await noAxe(page);
    await page.keyboard.press('Space');
    await expect(bar(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('list', { name: 'Projects' })).toBeVisible();
    await page.getByRole('list', { name: 'Projects' }).getByRole('article', { name: /^bk-ui-proj/ }).getByRole('link', { name: /^Details of / }).click();
    await expect(page).toHaveURL(/#\/projects\/[^/?]+$/);
    await expect(page.getByRole('region', { name: /^Project \// })).toBeVisible();
  });

  test('Project page: a card opens it with name, health and folder; each tab is a route that reload and Back keep; Sessions, Rules and History show only this project; keyboard tabs; 390 px; an older link opens Installs; an unknown project offers the way back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/#/projects');
    await page.getByText('Cards', { exact: true }).click();
    const card = page.getByRole('list', { name: 'Projects' }).getByRole('article', { name: /^bk-ui-proj/ });
    const path = await card.locator('p[title]').getAttribute('title');
    await page.route(/\/api\/history(\?|$)/, async (route) => {
      const real = await (await route.fetch()).json();
      await route.fulfill({ json: [{ ...real[0], id: 'mine', scope: path }, { ...real[0], id: 'not-mine', scope: 'global' }] });
    });
    await page.reload();
    const route = (tab) => `#/projects/${encodeURIComponent(path)}${tab ? `/${tab}` : ''}`;
    await card.getByRole('link', { name: /^bk-ui-proj/ }).click();
    await expect(page).toHaveURL((u) => u.hash === route());
    const project = page.getByRole('region', { name: `Project ${path}` });
    await expect(project.getByRole('heading', { name: /^bk-ui-proj/ })).toBeVisible();
    await expect(project).toContainText(/In sync|Outdated|Modified/);
    await expect(project.getByText(path, { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await noAxe(page);
    // The tabs by keyboard: an arrow key moves to the next tab and its route.
    const tabs = project.getByRole('tablist', { name: 'Project views' });
    await tabs.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: 'Installs' })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL((u) => u.hash === route('installs'));
    await expect(project.getByRole('region', { name: 'Changes', exact: true })).toBeVisible();
    // History: only this project's runs; reload keeps the tab, Back returns to the one before.
    await tabs.getByRole('tab', { name: 'History' }).click();
    await expect(page).toHaveURL((u) => u.hash === route('history'));
    await expect(project.getByRole('navigation', { name: 'Runs' }).getByRole('link')).toHaveCount(1);
    await page.reload();
    await expect(tabs.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page).toHaveURL((u) => u.hash === route('installs'));
    await expect(tabs.getByRole('tab', { name: 'Installs' })).toHaveAttribute('aria-selected', 'true');
    // Sessions: the board asked for this project shows only its sessions.
    await tabs.getByRole('tab', { name: 'Sessions' }).click();
    const frame = page.locator('iframe[title="Sessions board"]');
    await expect(frame).toHaveAttribute('src', /[?&]project=/);
    expect(new URLSearchParams((await frame.getAttribute('src')).split('?')[1]).get('project')).toBe(path);
    const board = page.frameLocator('iframe[title="Sessions board"]');
    await board.getByLabel('Period').selectOption('all');
    await expect(board.locator('#count')).toHaveText('2 of 2 sessions');
    // Rules and settings: this project's files, no choice of another.
    await tabs.getByRole('tab', { name: 'Rules and settings' }).click();
    await expect(project.getByRole('region', { name: /files for this project$/ }).first()).toBeVisible();
    await expect(project.getByRole('combobox', { name: 'Show' })).toHaveCount(0);
    await expect(project.getByRole('combobox', { name: 'Project' })).toHaveCount(0);
    await noAxe(page);
    // An older link opens Installs; an unknown project offers the way back.
    await page.goto(`/#/projects?path=${encodeURIComponent(path)}`);
    await expect(page).toHaveURL((u) => u.hash === route('installs'));
    await page.goto('/#/projects/%2Fnowhere/sessions');
    await expect(page.getByText('No registered project at /nowhere.')).toBeVisible();
    await page.getByRole('link', { name: 'Back to Projects' }).click();
    await expect(page).toHaveURL(/#\/projects$/);
    await page.unroute(/\/api\/history(\?|$)/);
  });

  test('Project Installs tab: packs, workflow owner, skills and agent files each with a switch, scope hint and state; the global block once with its link; a switch by keyboard changes the plan; 390 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/#/projects');
    await page.getByText('Cards', { exact: true }).click();
    await page.getByRole('list', { name: 'Projects' }).getByRole('article', { name: /^bk-ui-proj/ }).getByRole('link', { name: /^bk-ui-proj/ }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    const packs = page.getByRole('region', { name: 'Packs' });
    await expect(packs.getByRole('switch', { name: 'Frontend' })).toBeChecked();
    await expect(packs).toContainText('only this project');
    await expect(packs).toContainText('Impact: copies');
    const owner = page.getByRole('region', { name: 'Workflow owner' });
    await expect(owner.getByRole('switch', { name: /Matt Pocock/ })).toBeVisible();
    await expect(owner).toContainText('also global');
    await expect(page.getByRole('switch', { name: /Matt Pocock/ })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Skills' })).toContainText(/only this project/);
    const global = page.getByRole('region', { name: 'Active here from your global setup' });
    await expect(global).toContainText('BenchKeeper plugin');
    await expect(global.getByRole('switch')).toHaveCount(0);
    await expect(global.getByRole('link', { name: 'Change them in Global setup' })).toHaveAttribute('href', '#/agents');
    // An agent file switched on by keyboard: the plan fetches it; switched off again, nothing is written.
    const file = page.getByRole('region', { name: 'Agent files' }).getByRole('switch').first();
    const changes = page.getByRole('region', { name: 'Changes', exact: true });
    await file.focus();
    await page.keyboard.press('Space');
    await expect(file).toBeChecked();
    await expect(changes).toContainText('Agent engineering-frontend-developer');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await noAxe(page);
    await page.keyboard.press('Space');
    await expect(file).not.toBeChecked();
  });

  test('Project Installs tab: the switches wait while the plan loads and while an apply runs', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: /^bk-ui-proj/ }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    const skill = page.getByRole('region', { name: 'Skills' }).getByRole('switch').first();
    const pack = page.getByRole('region', { name: 'Packs' }).getByRole('switch', { name: 'Frontend' });
    const file = page.getByRole('region', { name: 'Agent files' }).getByRole('switch').first();
    await expect(skill).toBeChecked();
    // Two quick clicks on one switch: the second lands while the plan loads and is ignored; once the plan is back, a click
    // turns the skill on again and the plan asks for no change.
    let release;
    const held = new Promise((r) => { release = r; });
    const urls = [];
    await page.route(/\/api\/project-plan\?/, async (route) => { urls.push(route.request().url()); await held; await route.continue(); });
    await skill.click();
    await expect(skill).toBeDisabled();
    await expect(pack).toBeDisabled();
    await skill.click({ force: true });
    release();
    await expect(skill).toBeEnabled();
    await expect(skill).not.toBeChecked();
    await skill.click();
    await expect(skill).toBeChecked();
    await expect(skill).toBeEnabled();
    expect(urls.at(-1)).not.toMatch(/[?&]disable=/);
    await page.unroute(/\/api\/project-plan\?/);
    // An apply keeps them disabled until its result shows; the job is stubbed so the fixture project stays as it is.
    let finish;
    const done = new Promise((r) => { finish = r; });
    await page.route(/\/api\/apply$/, (route) => route.fulfill({ json: { job: 'stub-job', total: 1 } }));
    await page.route(/\/api\/job\?id=stub-job$/, async (route) => route.fulfill({ json: await Promise.race([done, { done: false, run: { entries: [] } }]) }));
    await file.click();
    const changes = page.getByRole('region', { name: 'Changes', exact: true });
    await changes.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeFocused();
    for (const s of [skill, pack, file]) await expect(s).toBeDisabled();
    finish({ done: true, run: { id: 'stub-run', status: 'done', entries: [] }, output: {} });
    await page.getByRole('button', { name: 'Plan again' }).click();
    for (const s of [skill, pack, file]) await expect(s).toBeEnabled();
    await expect(file).not.toBeChecked();
    await page.unroute(/\/api\/apply$/);
    await page.unroute(/\/api\/job\?id=stub-job$/);
  });

  test('Global setup: only global items, the pointer to Projects and the Accounts link; each per-project control is in the Installs tab; a part opens by keyboard; 390 px', async ({ page }) => {
    // The per-project controls, each a region of switches in a project's Installs tab and none on the global page.
    const MOVED = ['Packs', 'Workflow owner', 'Skills', 'Agent files'];
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/#/agents');
    const main = page.getByRole('main');
    await expect(main).toContainText('Per-project setup lives in each project');
    await expect(main.getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute('href', '#/projects');
    await expect(main.getByRole('link', { name: 'Accounts', exact: true })).toHaveAttribute('href', '#/accounts');
    const global = main.getByRole('region', { name: 'Installed globally' });
    const show = global.getByRole('button', { name: /^Show items of / }).first();
    const part = (await show.getAttribute('aria-label')).replace(/^Show /, '');
    await show.focus();
    await page.keyboard.press('Enter');
    await expect(global.getByRole('button', { name: `Hide ${part}` })).toHaveAttribute('aria-expanded', 'true');
    await expect(global.getByRole('listitem').first()).toBeVisible();
    await expect(main.getByRole('switch')).toHaveCount(0);
    await expect(main.locator('a[href^="#/projects/"]')).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^(Set up this project|Change setup)$/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await noAxe(page);
    await page.goto('/#/projects');
    await page.getByText('Cards', { exact: true }).click();
    await page.getByRole('list', { name: 'Projects' }).getByRole('article', { name: /^bk-ui-proj/ }).getByRole('link', { name: /^bk-ui-proj/ }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    for (const name of MOVED) await expect(page.getByRole('region', { name }).getByRole('switch').first()).toBeVisible();
  });

  test('Projects: a moved folder shows Folder not found with Relocate; the notes follow it', async ({ page }) => {
    const dir = folder('mv-gone');
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, dir);
    await table.getByRole('link', { name: 'mv-gone', exact: true }).click();
    await page.getByRole('button', { name: 'Edit name and notes' }).click();
    await page.getByLabel('Display name').fill('Docs site');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('link', { name: 'All projects' }).click();
    const moved = join(dir, '..', 'mv-moved');
    renameSync(dir, moved);
    await page.reload();
    await chip(page, 'Folder not found').click();
    await expect(table.getByRole('row')).toHaveCount(2);
    await expect(table.getByRole('row').nth(1)).toContainText('Folder not found');
    await table.getByRole('link', { name: 'Docs site', exact: true }).click();
    const detail = page.getByRole('region', { name: /^Project \// });
    await expect(detail.getByRole('button', { name: 'Remove from list' })).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Open folder' })).toHaveCount(0);
    await expect(detail.getByRole('region', { name: 'Project doctor' })).toHaveCount(0);
    await noAxe(page);
    await detail.getByLabel('New folder').fill(join(moved, 'nope'));
    await detail.getByRole('button', { name: 'Relocate', exact: true }).last().click();
    await expect(detail.getByText(/is not a folder/)).toBeVisible();
    await detail.getByLabel('New folder').fill(moved);
    await detail.getByRole('button', { name: 'Relocate', exact: true }).last().click();
    // Relocate leaves the project page for the whole list, with no filter on.
    await expect(page.getByRole('group', { name: 'Filters' }).getByRole('checkbox', { name: 'Folder not found' })).not.toBeChecked();
    await expect(table.getByRole('link', { name: 'Docs site', exact: true })).toBeVisible();
    await expect(table).not.toContainText('Folder not found');
    await unregister(page, ['Docs site']);
  });

  test('Projects: another project opened from the palette starts with its own edit form', async ({ page }) => {
    const [a, b] = [folder('mv-pal-a'), folder('mv-pal-b')];
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, a);
    await expect(table.getByRole('link', { name: 'mv-pal-a', exact: true })).toBeVisible();
    await addFolder(page, b);
    await table.getByRole('link', { name: 'mv-pal-b', exact: true }).click();
    await page.getByRole('button', { name: 'Edit name and notes' }).click();
    await page.getByLabel('Display name').fill('Beta');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await page.getByRole('link', { name: 'All projects' }).click();
    await table.getByRole('link', { name: 'mv-pal-a', exact: true }).click();
    await page.getByRole('button', { name: 'Edit name and notes' }).click();
    await page.getByLabel('Display name').fill('Alpha');
    await page.getByRole('button', { name: /^Search/ }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByLabel('Search').fill(b);
    await expect(palette.locator('[data-selected]')).toContainText(b);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit name and notes' }).click();
    await expect(page.getByLabel('Display name')).toHaveValue('Beta');
    await page.getByRole('link', { name: 'All projects' }).click();
    await unregister(page, ['mv-pal-a', 'Beta']);
  });

  test('Projects: another worktree of a registered repository is offered, not added; bulk removal from the list names the count', async ({ page }) => {
    const main = folder('mv-main');
    const git = (...a) => execFileSync('git', ['-C', main, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'init');
    const tree = join(main, '..', 'mv-tree');
    git('worktree', 'add', '-q', tree);
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, main);
    await expect(table.getByRole('link', { name: 'mv-main', exact: true })).toBeVisible();
    await addFolder(page, tree);
    const note = page.getByRole('alert').filter({ hasText: 'Same repository, other worktree.' });
    await expect(note).toBeVisible();
    await expect(table.getByRole('link', { name: 'mv-tree', exact: true })).toHaveCount(0);
    await noAxe(page);
    await note.getByRole('button', { name: 'Add as a second project' }).click();
    await expect(table.getByRole('link', { name: 'mv-tree', exact: true })).toBeVisible();
    await unregister(page, ['mv-main', 'mv-tree']);
  });

  test('Projects: Remove BenchKeeper setup lists every file, removes a local setup and leaves the project registered', async ({ page }) => {
    const dir = folder('mv-local');
    mkdirSync(join(dir, '.benchkeeper'));
    writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 1, setupVersion: '6.0.0', agents: ['claude'], share: false, packs: [], skills: [] }));
    writeFileSync(join(dir, 'CLAUDE.local.md'), '<!-- benchkeeper:project start -->\n- a rule\n<!-- benchkeeper:project end -->\n');
    writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n');
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, dir);
    await table.getByRole('checkbox', { name: 'Select mv-local' }).check();
    await bar(page).getByRole('button', { name: 'Remove setup' }).click();
    const ask = page.getByRole('dialog', { name: 'Remove the BenchKeeper setup of 1 project' });
    await expect(ask.getByRole('list', { name: /^Changes in / })).toContainText('remove CLAUDE.local.md');
    await expect(ask.getByRole('list', { name: /^Changes in / })).toContainText('remove .benchkeeper/');
    await expect(ask).toContainText('AGENTS.md text, docs/agents/ and .devcontainer/ stay');
    await noAxe(page);
    await ask.getByRole('button', { name: 'Remove setup of 1 project' }).click();
    await expect(ask.getByRole('table', { name: 'Remove setup results' })).toContainText('removed');
    await expect(ask.getByRole('link', { name: 'Open report' })).toBeVisible();
    expect(existsSync(join(dir, '.benchkeeper'))).toBe(false);
    expect(existsSync(join(dir, 'CLAUDE.local.md'))).toBe(false);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    await ask.getByRole('button', { name: 'Close' }).click();
    await expect(table.getByRole('row').filter({ hasText: 'mv-local' })).toContainText('not set up');
    // A shared setup is listed too, and becomes a pull request.
    await table.getByRole('checkbox', { name: 'Select mv-local' }).uncheck();
    await table.getByRole('checkbox', { name: /^Select bk-ui-proj/ }).check();
    await bar(page).getByRole('button', { name: 'Remove setup' }).click();
    await expect(ask).toContainText('Shared setup: a pull request removes these files');
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    await table.getByRole('checkbox', { name: /^Select bk-ui-proj/ }).uncheck();
    await unregister(page, ['mv-local']);
  });

  test('Projects: the project doctor shows the record command of a pack setup with Copy, and Check again clears it once the files exist', async ({ page }) => {
    const dir = folder('pd-pack');
    mkdirSync(join(dir, '.benchkeeper'));
    writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 1, setupVersion: '6.0.0', agents: ['claude'], share: false, packs: ['matt-pocock'], skills: [] }));
    await nav(page, 'Projects').click();
    await addFolder(page, dir);
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: 'pd-pack', exact: true }).click();
    const doctor = page.getByRole('region', { name: 'Project doctor' });
    await expect(doctor).toContainText('pack matt-pocock is on, but docs/agents/ does not exist');
    await expect(doctor).toContainText(`benchkeeper sessions record --project '${dir}' -- claude '/mattpocock-skills:setup-matt-pocock-skills'`);
    const copy = doctor.getByRole('button', { name: 'Copy the command for /mattpocock-skills:setup-matt-pocock-skills' });
    for (const [ok, text] of [[false, /^Copy failed/], [true, /^Copied$/]]) {
      await page.evaluate((ok) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => (ok ? Promise.resolve() : Promise.reject(new Error('denied'))) } }), ok);
      await copy.click();
      await expect(doctor.getByRole('status').filter({ hasText: /^Cop/ })).toHaveText(text);
    }
    await noAxe(page);
    // The app runs nothing: the user's session writes the folder, Check again reads the doctor again.
    mkdirSync(join(dir, 'docs/agents'), { recursive: true });
    await doctor.getByRole('button', { name: 'Check again' }).click();
    await expect(doctor).not.toContainText('docs/agents/ does not exist');
    await page.getByRole('link', { name: 'All projects' }).click();
    await unregister(page, ['pd-pack']);
  });

  test('Projects: pack switches preview the removal of a pack and Copy packs from project sets them; no axe violations', async ({ page }) => {
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, join(ONE, 'uno'));
    await table.getByRole('link', { name: /^bk-ui-proj/ }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    const packs = page.getByRole('region', { name: 'Packs' });
    // The saved pack leads, the others follow in their own group with what each is for.
    const frontend = packs.getByRole('group', { name: 'In use or suggested' }).getByRole('switch', { name: 'Frontend' });
    await expect(frontend).toBeChecked();
    await expect(packs.getByRole('group', { name: 'More packs' })).toContainText('The repository has or adds browser tests');
    await frontend.click();
    await expect(frontend).not.toBeChecked();
    const changes = page.getByRole('region', { name: 'Changes', exact: true });
    await expect(changes.getByRole('group', { name: 'Remove', exact: true })).toBeVisible();
    await expect(changes).toContainText('designing-technical-uis');
    await noAxe(page);
    await frontend.click();
    await expect(frontend).toBeChecked();
    // Copy packs from a project with none: the pack goes off in the plan, nothing is written yet.
    await choose(page, 'Copy packs from project', 'uno: no packs');
    await expect(frontend).not.toBeChecked();
    await expect(changes.getByRole('group', { name: 'Remove', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'All projects' }).click();
    await unregister(page, ['uno']);
  });

  test('Catalog: skill states, activate and deactivate, reset a modified skill with its diff, adopt and remove; untracked folders stay; no axe violations', async ({ page }) => {
    test.slow();
    const dir = folder('sk-proj');
    const skills = join(dir, '.claude/skills');
    mkdirSync(join(dir, '.benchkeeper'));
    writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ schemaVersion: 1, setupVersion: '6.0.0', agents: ['claude'], env: 'host', share: false, packs: [], singles: ['designing-technical-uis'], tier: null, paths: {}, disabled: [],
      skills: [{ name: 'designing-technical-uis', source: 'own' }] }));
    for (const [name, text] of [['mine', 'my own skill\n'], ['mermaid-diagrams', 'a library skill put here by hand\n']]) {
      mkdirSync(join(skills, name), { recursive: true });
      writeFileSync(join(skills, name, 'SKILL.md'), text);
    }
    await nav(page, 'Projects').click();
    await addFolder(page, dir);
    await nav(page, 'Catalog').click();
    const states = page.getByRole('table', { name: 'Skill states' });
    const mine = states.getByRole('row').filter({ hasText: 'sk-proj' });
    const own = mine.filter({ hasText: 'designing-technical-uis' });
    // The folder is gone: Update writes it again through a run (undoable), which also makes a later edit visible as modified.
    await expect(own).toContainText('removed');
    await expect(own).toContainText('BenchKeeper');
    // Check for updates keeps the button focused and the table while it loads; the check is answered without it, offline.
    let answer;
    const held = new Promise((r) => { answer = r; });
    await page.route(/\/api\/skills\?check=1$/, async (route) => { await held; await route.fulfill({ response: await route.fetch({ url: route.request().url().replace('?check=1', '') }) }); });
    const check = page.getByRole('button', { name: 'Check for updates' });
    await check.focus();
    await page.keyboard.press('Enter');
    await expect(check).toHaveAttribute('aria-busy', 'true');
    await expect(own).toContainText('removed');
    await expect(check).toBeFocused();
    answer();
    await expect(check).toHaveAttribute('aria-busy', 'false');
    await expect(check).toBeFocused();
    await own.getByRole('button', { name: /^Update/ }).click();
    const update = page.getByRole('dialog', { name: 'Update designing-technical-uis in sk-proj' });
    await update.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(update.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await update.getByRole('button', { name: 'Close' }).click();
    await expect(own).toContainText('current');
    writeFileSync(join(skills, 'designing-technical-uis/SKILL.md'), 'edited here\n');
    await nav(page, 'Projects').click();
    await nav(page, 'Catalog').click();
    await expect(own).toContainText('modified');
    const untracked = page.getByRole('table', { name: 'Untracked folders' });
    await expect(untracked.getByRole('row').filter({ hasText: 'mine' })).toContainText('left alone');
    await expect(untracked.getByRole('row').filter({ hasText: 'mermaid-diagrams' }).getByRole('button', { name: /^Adopt/ })).toBeVisible();
    await noAxe(page);
    // Deactivate: the plan parks the skill; closing it writes nothing.
    // Mantine's track covers the input, so Playwright's own pointer check refuses it.
    await own.getByRole('switch', { name: /^Active/ }).click({ force: true });
    const off = page.getByRole('dialog', { name: 'Deactivate designing-technical-uis in sk-proj' });
    await expect(off).toContainText('.benchkeeper/disabled/');
    await noAxe(page);
    await off.getByRole('button', { name: 'Close' }).click();
    await expect(off).toBeHidden();
    expect(existsSync(join(skills, 'designing-technical-uis/SKILL.md'))).toBe(true);
    // Reset: the diff against the library comes first; the edit is in the run's backup.
    await own.getByRole('button', { name: /^Reset/ }).click();
    const reset = page.getByRole('dialog', { name: 'Reset designing-technical-uis in sk-proj' });
    await openDiffs(reset);
    await expect(reset.getByRole('group', { name: /^Diff of .*SKILL\.md$/ })).toContainText('edited here');
    await noAxe(page);
    await reset.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(reset.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await reset.getByRole('button', { name: 'Close' }).click();
    await expect(own).toContainText('current');
    // Adopt a library skill that is there without a setup: it becomes a single pick, its folder kept.
    await untracked.getByRole('row').filter({ hasText: 'mermaid-diagrams' }).getByRole('button', { name: /^Adopt/ }).click();
    const adopt = page.getByRole('dialog', { name: 'Adopt mermaid-diagrams in sk-proj' });
    await adopt.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(adopt.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await adopt.getByRole('button', { name: 'Close' }).click();
    const adopted = mine.filter({ hasText: 'mermaid-diagrams' });
    await expect(adopted).toBeVisible();
    expect(existsSync(join(skills, 'mine/SKILL.md'))).toBe(true);
    // Remove takes the single pick out of the project; the untracked folder is still there.
    await adopted.getByRole('button', { name: /^Remove/ }).click();
    const remove = page.getByRole('dialog', { name: 'Remove mermaid-diagrams in sk-proj' });
    await expect(remove.getByRole('group', { name: 'Remove', exact: true })).toContainText('Remove skill mermaid-diagrams');
    await remove.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(remove.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await remove.getByRole('button', { name: 'Close' }).click();
    await expect(mine.filter({ hasText: 'mermaid-diagrams' })).toHaveCount(0);
    expect(existsSync(join(skills, 'mine/SKILL.md'))).toBe(true);
    await nav(page, 'Projects').click();
    await unregister(page, ['sk-proj']);
  });

  test('Projects: a project without a state file is set up step by step, local or on a branch', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: 'other', exact: true }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    await page.getByRole('button', { name: 'Set up this project' }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await expect(drawer.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
    // Local or shared is the first question, as it decides what every later step writes; local is the default.
    await expect(drawer.getByRole('radio', { name: /^On this machine/ })).toBeChecked();
    // Without an agent Next is off, and the text says why.
    await drawer.getByRole('checkbox', { name: 'Claude Code' }).uncheck();
    await expect(drawer.getByText('Pick at least one agent to continue.')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Next' })).toBeDisabled();
    await drawer.getByRole('checkbox', { name: 'Claude Code' }).check();
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('radio', { name: /^Agent in the dev container/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Next' }).click();
    // Community skills need npx, which the fixture lacks: no pack here.
    await expect(drawer.getByRole('checkbox', { name: /^Frontend/ })).not.toBeChecked();
    await noAxe(page);
    // Agent files are a pick of their own; none is preselected.
    await expect(drawer.getByRole('checkbox', { name: 'engineering-frontend-developer' })).not.toBeChecked();
    // An agent suggests skills only after the user agrees to its session.
    await drawer.getByRole('button', { name: 'Suggest with an agent' }).click();
    const ask = page.getByRole('dialog', { name: 'Start an agent session?' });
    await expect(ask).toContainText('Read only');
    await noAxe(page);
    await ask.getByRole('button', { name: 'Start Claude Code' }).click();
    await expect(drawer.getByRole('alert')).toContainText('Skill designing-technical-uis: the project has a UI');
    await drawer.getByRole('button', { name: 'Next' }).click();
    await drawer.getByRole('radio', { name: /^Standard/ }).check();
    const planned = page.waitForResponse(/\/api\/project-plan\?/);
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer).toContainText(/\d+ changes in this checkout, in files git ignores/);
    // The plan shows the line to start in a terminal, as the server built it, with Copy.
    const { prompts } = await (await planned).json();
    expect(prompts[0].command).toMatch(/^benchkeeper sessions record --project '.+' -- claude '\/benchkeeper:setting-up-projects'$/);
    await expect(drawer.getByText(prompts[0].command)).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Copy the command for /benchkeeper:setting-up-projects' })).toBeVisible();
    await openDiffs(drawer);
    await expect(drawer).toContainText('CLAUDE.local.md');
    // The summary shows every answer next to its step; Change goes back to that step and one click returns.
    const answers = drawer.getByRole('list', { name: 'Your answers' });
    await expect(answers).toContainText('Agent in the dev container');
    await expect(answers).toContainText('Standard: one behavior');
    await expect(answers).toContainText('designing-technical-uis');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Change Default tier' }).click();
    await expect(drawer.getByRole('radio', { name: /^Standard/ })).toBeChecked();
    await drawer.getByRole('radio', { name: /^Quick/ }).check();
    await drawer.getByRole('button', { name: 'Back to summary' }).click();
    await expect(answers).toContainText('Quick: the diff fits in one sentence');
    // The repository is the other choice, made in the first step.
    for (let i = 0; i < 4; i++) await drawer.getByRole('button', { name: 'Back' }).click();
    await drawer.getByRole('radio', { name: /^In the repository/ }).check();
    for (let i = 0; i < 4; i++) await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer).toContainText(/\d+ changes on branch/);
    await expect(drawer).toContainText('AGENTS.md');
    await drawer.getByRole('button', { name: 'Show Install' }).click();
    await expect(drawer).toContainText('Skill designing-technical-uis (own)');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Continue' }).click();
    await drawer.getByRole('button', { name: 'Create branch and pull request' }).click();
    await expect(drawer.getByRole('alert')).toContainText('committed');
    // The result step repeats what only the user can start.
    await expect(drawer).toContainText('After merging, start in the project');
    await expect(drawer.getByText(prompts[0].command)).toBeVisible();
    await expect(drawer).toContainText('stack skills, AGENTS.md commands, the dev container');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Next project' }).click();
    await expect(drawer).toBeHidden();
  });

  test('Projects: Change setup starts from the state file', async ({ page }) => {
    // A saved pack loads checked.
    await page.route(/\/api\/project-setup\?/, async (route) => {
      const body = await (await route.fetch()).json();
      body.state = { ...body.state, packs: [...body.state.packs, 'matt-pocock'] };
      await route.fulfill({ json: body });
    });
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: /bk-ui-proj$/ }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    await page.getByRole('button', { name: 'Change setup' }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await expect(drawer.getByRole('heading', { name: /Change project setup/ })).toBeVisible();
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('radio', { name: /^Agent on the host/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('checkbox', { name: /^Frontend/ })).toBeChecked();
    await expect(drawer.getByRole('checkbox', { name: /^Matt Pocock's skills/ })).toBeChecked();
    await noAxe(page);
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
    await drawer.getByRole('radio', { name: /^In the repository/ }).check();
    for (let s = 0; s < 4; s++) await drawer.getByRole('button', { name: 'Next' }).click();
    await drawer.getByRole('button', { name: 'Show Install' }).click();
    await expect(drawer).toContainText('Skill designing-technical-uis (own)');
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
    await run.getByRole('button', { name: 'Undo step plugin:claude:ponytail@ponytail', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Undone' })).toContainText(/1 of 1 changes undone/);
    await expect(run).toContainText('undone by');
    await run.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  // After History, whose tests expect the fixture's first global run newest; before Agents, which installs the global skill.
  test('Dashboard: Fix everything walks through global setup, projects and manual fixes, then applies', async ({ page }) => {
    await page.getByRole('button', { name: 'Fix everything' }).click();
    const fix = page.getByRole('dialog', { name: 'Fix everything' });
    await expect(fix.getByRole('checkbox', { name: /^Global skill find-skills/ })).toBeChecked();
    // A marketplace and its plugin go together: one note for the pair, none per change.
    const pair = fix.getByRole('group', { name: '2 changes that go together' }).first();
    await expect(pair.getByRole('checkbox')).toHaveCount(2);
    await expect(pair.getByText(/go together/)).toHaveCount(1);
    // The skill install is rehearsed in a scratch folder only after a click: its file then shows as a diff before anything runs.
    await expect(fix.getByRole('group', { name: /^Diff of .*SKILL\.md$/ })).toHaveCount(0);
    await fix.getByRole('button', { name: /^Preview the files/ }).click();
    await expect(fix.getByRole('group', { name: /^Diff of .*\.claude\/skills\/find-skills\/SKILL\.md$/ })).toBeVisible();
    await expect(fix).toContainText('Rehearsed in a sandbox');
    await noAxe(page);
    await fix.getByRole('button', { name: 'Next' }).click();
    // Update all skips a project with uncommitted changes, so it is not offered.
    const proj = fix.getByRole('checkbox', { name: 'bk-ui-proj' });
    await expect(proj).toBeDisabled();
    await expect(fix).toContainText('skipped: uncommitted changes');
    await noAxe(page);
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(fix.getByRole('table', { name: 'Doctor findings' }).or(fix.getByText('No findings.'))).toBeVisible();
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(fix.getByRole('list', { name: 'What Apply does' })).toContainText(/Global setup: \d+ of \d+ changes/);
    await expect(fix.getByRole('list', { name: 'What Apply does' })).toContainText('Projects: none');
    await noAxe(page);
    await fix.getByRole('button', { name: 'Apply', exact: true }).click();
    // The wizard sits above the views: a view shortcut leaves it open, so the run goes on.
    await page.keyboard.press('ControlOrMeta+3');
    await expect(nav(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(fix.getByRole('status').filter({ hasText: /^Run / })).toContainText(/done|failed/);
    await expect(fix.getByRole('heading', { name: 'Still open' })).toBeVisible();
    await expect(fix.getByRole('button', { name: 'Close' })).toBeEnabled();
    await noAxe(page);
  });

  test('Fix everything: the Apply step tells a project written in its checkout from one that gets a branch, and a pull request only for a project the list marks willPush', async ({ page }) => {
    const project = (name, extra) => ({ path: `/work/${name}`, setupVersion: '0.1.0', current: false, changes: [], repo: true, clean: true, ...extra });
    await page.route(/\/api\/projects(\?|$)/, (route) => route.fulfill({ json: [project('local-a'), project('local-b'), project('shared', { share: true, github: true, willPush: true }), project('shared-local', { share: true, github: true }), project('no-github', { share: true })] }));
    await page.getByRole('button', { name: 'Fix everything' }).click();
    const fix = page.getByRole('dialog', { name: 'Fix everything' });
    const summary = fix.getByRole('list', { name: 'What Apply does' });
    await fix.getByRole('button', { name: 'Next' }).click();
    await fix.getByRole('checkbox', { name: 'local-a' }).check();
    await fix.getByRole('button', { name: 'Next' }).click();
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(summary).toContainText('Projects: 1 written in their checkout');
    await expect(summary).not.toContainText('pull request');
    await fix.getByRole('button', { name: 'Back' }).click();
    await fix.getByRole('button', { name: 'Back' }).click();
    await fix.getByRole('button', { name: 'Select all' }).click();
    await fix.getByRole('button', { name: 'Next' }).click();
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(summary).toContainText('Projects: 2 written in their checkout, 2 as a branch, 1 as a branch and pull request');
    await page.keyboard.press('Escape');
  });

  test('an apply in Global setup shows up in History and the header without a reload', async ({ page }) => {
    await nav(page, 'History').click();
    const runs = page.getByRole('navigation', { name: 'Runs' }).getByRole('link');
    await expect(runs.first()).toBeVisible();
    const before = await runs.count();
    await nav(page, 'Global setup').click();
    await page.getByRole('button', { name: /^Plan setup for/ }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    const footer = changes.getByRole('group', { name: 'Selected changes' });
    await expect(footer).toContainText(/[1-9]\d* changes? selected/);
    const n = Number((await footer.textContent()).match(/(\d+) change/)[1]);
    await changes.getByRole('button', { name: `Apply ${n} ${n === 1 ? 'change' : 'changes'}` }).click();
    // The result replaces the plan: the run report with each change, its undo, and a link to it in History.
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(changes.getByRole('button', { name: 'Undo run' })).toBeEnabled();
    await expect(changes.getByRole('link', { name: 'Open in History' })).toBeVisible();
    await expect(nav(page, 'History')).toContainText(String(before + 1));
    await nav(page, 'History').click();
    await expect(runs).toHaveCount(before + 1);
  });

  test('Apply preview: one card per group in order, a sentence, impact and chip per step, the command behind Show command, the plugins BenchKeeper did not install folded and unticked; keyboard, Cancel, 390 px; no axe violations', async ({ page }) => {
    const write = (id, state, extra = {}) => ({ id, step: id, title: `${id} file`, kind: 'write', path: `/work/u/${id}.md`, diff: '', state, selected: true, ...extra });
    const changes = [
      ...[1, 2, 3, 4, 5, 6].map((n) => write(`skill-${n}`, 'absent')),
      { id: 'market', step: 'plugin', unit: 'plugin', kind: 'command', title: 'Claude Code marketplace demo', argv: ['claude', 'plugin', 'marketplace', 'add', 'demo/market'], undoArgv: ['claude', 'plugin', 'marketplace', 'remove', 'demo'], state: null, selected: true },
      { id: 'plugin', step: 'plugin', unit: 'plugin', kind: 'command', title: 'Claude Code plugin demo@demo', argv: ['claude', 'plugin', 'install', 'demo@demo'], undoArgv: ['claude', 'plugin', 'uninstall', 'demo@demo'], state: null, selected: true },
      write('rules', 'outdated'), write('agents', 'modified'),
      { id: 'old', step: 'state', kind: 'remove', title: 'remove .benchkeeper/old', path: '/p/.benchkeeper/old', destructive: true, state: 'foreign', selected: false },
      { id: 'mcp', step: 'other:claude:mcp', kind: 'command', title: 'remove the Claude user MCP server demo', argv: ['claude', 'mcp', 'remove', '--scope', 'user', 'demo'], destructive: true, state: 'foreign', selected: false },
      write('settings', 'outdated', { title: 'Claude default model opusplan', settings: { agent: 'claude', keys: ['model'] } }),
      { id: 'off', step: 'off', kind: 'command', title: 'Codex plugin demo@demo: turn on by hand', argv: ['codex', 'plugin', 'add', 'demo@demo'], error: 'demo@demo is installed but turned off', state: null, selected: false },
      { id: 'own', step: 'own', kind: 'command', foreign: true, pack: 'frontend', title: 'frontend (Claude Code plugin own@own) is installed on this machine, but BenchKeeper did not set it up. Keep it (default) or remove it.', argv: ['claude', 'plugin', 'uninstall', 'own@own'], undoArgv: ['claude', 'plugin', 'install', 'own@own'], impact: 'removing runs claude plugin uninstall own@own, which deletes the plugin and its data', destructive: true, state: 'foreign', selected: false },
    ];
    await page.route(/\/api\/global-plan(\?|$)/, (route) => route.fulfill({ json: { planId: 'preview-test', agents: ['claude'], changes } }));
    await nav(page, 'Global setup').click();
    await page.getByRole('button', { name: /^Plan setup for/ }).click();
    const view = page.getByRole('region', { name: 'Changes' });
    const card = (name) => view.getByRole('group', { name, exact: true });
    await expect(card('Install')).toBeVisible();
    const cards = await view.getByRole('group').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter((l) => !/go together|^About /.test(l) && l !== 'Selected changes'));
    expect(cards).toEqual(['Install', 'Update', 'Remove', 'Settings', 'Needs your action', 'Plugins BenchKeeper did not install']);
    // No state word "foreign" and no raw command until asked for.
    await expect(view).not.toContainText('foreign');
    await expect(view).not.toContainText('claude plugin');
    await expect(card('Update')).toContainText('outdated');
    await expect(card('Update')).toContainText('modified');
    // Each change says what it does, why, who it affects and how History undoes it.
    const agents = card('Update').getByRole('group', { name: 'About agents file' });
    await expect(agents).toContainText('What it does: Replaces your edits in /work/u/agents.md.');
    await expect(agents).toContainText("Why: The file differs from BenchKeeper's setup.");
    await expect(agents).toContainText('Undo: History restores your edits.');
    await expect(agents.getByRole('link', { name: 'History' })).toHaveAttribute('href', '#/history');
    await expect(card('Remove')).toContainText('installed by you');
    await expect(card('Remove')).toContainText('installed by BenchKeeper');
    await expect(card('Remove')).toContainText('What it does: Deletes /p/.benchkeeper/old.');
    await expect(card('Remove')).toContainText('Undo: History puts the file back.');
    await expect(card('Settings').getByRole('group', { name: 'About model' })).toBeVisible();
    await expect(card('Needs your action')).toContainText('Not applied: demo@demo is installed but turned off');
    // A long card starts folded and opens by keyboard.
    const showInstall = card('Install').getByRole('button', { name: 'Show Install' });
    await expect(showInstall).toHaveAttribute('aria-expanded', 'false');
    await expect(card('Install')).not.toContainText('Skill-1 file.');
    await showInstall.focus();
    await page.keyboard.press('Enter');
    await expect(card('Install').getByRole('checkbox', { name: 'Skill-1 file.' })).toBeChecked();
    await expect(card('Install')).toContainText('new');
    await expect(card('Install')).toContainText('What it does: Creates /work/u/skill-1.md.');
    // The command and its copy button behind Show command.
    const show = card('Remove').getByRole('button', { name: 'Show command of remove the Claude user MCP server demo' });
    await show.focus();
    await page.keyboard.press('Enter');
    await expect(card('Remove').getByText('claude mcp remove --scope user demo')).toBeVisible();
    await expect(card('Remove').getByRole('button', { name: 'Copy the command of remove the Claude user MCP server demo' })).toBeVisible();
    // Defaults leave every removal off; Select all in Remove ticks its rows and leaves the plugin the user installed alone.
    const footer = view.getByRole('group', { name: 'Selected changes' });
    await expect(footer).toContainText('11 changes selected');
    await card('Remove').getByRole('checkbox', { name: 'Select all in Remove' }).focus();
    await page.keyboard.press('Space');
    await expect(footer).toContainText('13 changes selected');
    await expect(card('Remove').getByRole('checkbox', { name: 'Remove the Claude user MCP server demo.' })).toBeChecked();
    const own = card('Plugins BenchKeeper did not install');
    await expect(own.getByRole('checkbox')).toHaveCount(0);
    await own.getByRole('button', { name: 'Show Plugins BenchKeeper did not install' }).click();
    await expect(own.getByRole('checkbox', { name: 'Remove own@own' })).not.toBeChecked();
    await expect(view.getByRole('button', { name: 'Apply 13 changes' })).toBeEnabled();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await noAxe(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    // Cancel applies nothing and the plan can be reviewed again.
    await footer.getByRole('button', { name: 'Cancel' }).click();
    await expect(view.getByRole('status')).toHaveText('Cancelled. Nothing was changed.');
    await view.getByRole('button', { name: 'Review the changes again' }).click();
    await expect(footer).toContainText('13 changes selected');
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

  test('Preferences: the sessions cache has a retention and Clear', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const history = page.getByRole('region', { name: 'Sessions history' });
    await expect(history).toContainText('sessions in the cache');
    await history.getByRole('switch', { name: 'Drop summaries after a number of days' }).click({ force: true });
    await expect(history.getByText('Retention set.')).toBeVisible();
    await expect(history.getByRole('textbox', { name: 'Days since the last activity' })).toHaveValue('30');
    await history.getByRole('switch', { name: 'Drop summaries after a number of days' }).click({ force: true });
    await expect(history.getByText('Summaries are kept.')).toBeVisible();
    const count = await history.getByText(/\d+ sessions in the cache/).textContent();
    const clear = history.getByRole('button', { name: 'Clear the sessions cache' });
    const ask = page.getByRole('dialog', { name: 'Clear the sessions cache?' });
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(ask).toContainText('are gone for good');
    await ask.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(ask).toBeHidden();
    await expect(history.getByText(count)).toBeVisible();
    await expect(history.getByText('Cache cleared.')).toBeHidden();
    await clear.click();
    await ask.getByRole('button', { name: 'Clear the cache' }).click();
    await expect(history.getByText('Cache cleared.')).toBeVisible();
    await expect(history).toContainText('0 sessions in the cache');
  });

  test('Preferences: the Clear dialog reads the count again when it opens', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const history = page.getByRole('region', { name: 'Sessions history' });
    await expect(history).toContainText('sessions in the cache');
    // Another tab scans meanwhile: the server now holds 7 summaries.
    await page.route(/\/api\/sessions-cache$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { sessions: 7, keepDays: null } }) : r.continue()));
    await history.getByRole('button', { name: 'Clear the sessions cache' }).click();
    await expect(page.getByRole('dialog', { name: 'Clear the sessions cache?' })).toContainText('7 session summaries go');
  });

  test('Preferences: a profile import clears the export warnings', async ({ page }) => {
    await nav(page, 'Preferences').click();
    await page.route(/\/api\/profile-export/, async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), skipped: ['an export warning'] } }));
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export profile' }).click();
    const file = await download;
    await expect(page.getByText('an export warning')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import profile' }).click();
    await (await chooser).setFiles(await file.path());
    await expect(page.getByRole('region', { name: 'Profile contents' })).toContainText('Agents: claude');
    await expect(page.getByText('an export warning')).toBeHidden();
  });

  test('Preferences: profile export downloads a file; its import registers and shows the global plan', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export profile' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('benchkeeper-profile.json');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import profile' }).click();
    await (await chooser).setFiles(await file.path());
    await expect(page.getByRole('region', { name: 'Profile contents' })).toContainText('Agents: claude');
    await page.getByRole('button', { name: 'Register projects and packs' }).click();
    await expect(page.getByRole('region', { name: 'Changes on this machine' })).toBeVisible();
    await noAxe(page);
  });


  test('Agent settings: the list with its notes, a change as plan and diff, undo; advanced lists every key; no axe violations', async ({ page }) => {
    await nav(page, 'Agent settings').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Agent settings' })).toBeVisible();
    await page.getByRole('button', { name: /^Show settings files/ }).click();
    await expect(page.getByRole('table', { name: 'Settings files' })).toContainText('.claude/settings.json');
    // The fixture home holds the setup's advisor model: its row says what it is, and BenchKeeper's setup writes it too.
    const advisor = page.getByRole('row', { name: /advisorModel/ }).first();
    await expect(advisor).toContainText('The model that answers when Claude calls the advisor tool');
    await expect(advisor).toContainText("BenchKeeper's setup writes this key too");
    await noAxe(page);
    // A change is a plan with a diff and an undo.
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('21');
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('cleanupPeriodDays');
    await expect(changes.getByText('21').first()).toBeVisible();
    // The hover color of the button under the pointer is lighter than the checked contrast.
    await page.mouse.move(0, 0);
    await noAxe(page);
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    // An environment switch is set or removed; the advisor with a telemetry switch shows the note on both rows.
    await page.getByRole('switch', { name: 'env.DISABLE_TELEMETRY value' }).check();
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    await openDiffs(page.getByRole('region', { name: 'Changes' }));
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('"DISABLE_TELEMETRY": "1"');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    // Advanced: every key, searchable; keys the app does not know are listed and kept.
    await page.getByRole('switch', { name: 'Advanced: every key' }).check();
    await expect(page.getByRole('table', { name: 'Advanced keys' })).toBeVisible();
    await page.getByLabel('Search settings').fill('modelSettings');
    await expect(page.getByRole('table', { name: 'Advanced keys' })).toContainText('modelSettings');
    await noAxe(page);
    // Codex: its own file and keys.
    await page.getByText('Codex', { exact: true }).click();
    await page.getByRole('button', { name: /^Show settings files/ }).click();
    await expect(page.getByRole('table', { name: 'Settings files' })).toContainText('.codex/config.toml');
  });

  test('Agent settings: each row compares the user file with the suggestion, Use suggested and a note fix open the plan, hardening folds, a conflict stays; no axe violations', async ({ page }) => {
    const conflict = { id: 'stub-conflict', level: 'warning', kind: 'conflict', message: 'A stubbed conflict.', default: 'The default.', risk: 'The risk.', fixChanges: 'What changes.', keys: ['model'], source: 'https://example.com/' };
    const view = /\/api\/settings\?agent=claude$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      await route.fulfill({ response: r, json: { ...body, notes: [conflict, ...body.notes] } });
    });
    await nav(page, 'Agent settings').click();
    await expect(page.getByText(/^\d+ of \d+ settings with a suggestion differ from it in the user file\.$/)).toBeVisible();
    // The setup's retention differs from the suggestion to leave it unset; the update channel matches.
    const row = (key) => page.getByRole('row').filter({ has: page.locator(`[id="setting-${key}"]`) });
    await expect(row('cleanupPeriodDays')).toContainText('Differs from suggested');
    await expect(row('cleanupPeriodDays')).toContainText('Suggested: leave unset.');
    await expect(row('autoUpdatesChannel')).toContainText('Matches suggested.');
    await expect(row('autoUpdatesChannel')).not.toContainText('Differs from suggested');
    // The conflict stays in full with its three lines; hardening advice is one folded line.
    const notes = page.getByRole('region', { name: 'Notes on the settings' });
    for (const t of ['Conflicting settings. A stubbed conflict.', 'Default: The default.', 'Risk: The risk.', 'What the fix changes: What changes.']) await expect(notes).toContainText(t);
    const fold = notes.getByRole('button', { name: /^Hardening advice \(\d+\)$/ });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(notes.getByRole('button', { name: 'Dismiss, I accept this: sandbox-off' })).toHaveCount(0);
    await noAxe(page);
    // Only the differences.
    await page.getByRole('switch', { name: 'Differs from suggested' }).check();
    await expect(row('cleanupPeriodDays')).toBeVisible();
    await expect(row('autoUpdatesChannel')).toHaveCount(0);
    await page.getByLabel('Search settings').fill('no such setting');
    await page.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(page.getByRole('switch', { name: 'Differs from suggested' })).not.toBeChecked();
    await expect(row('autoUpdatesChannel')).toBeVisible();
    // Use suggested stages the value and opens its plan; the row then matches in the pending changes.
    await page.getByRole('button', { name: 'Use suggested for sandbox.enabled' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('sandbox.enabled');
    await expect(changes.getByRole('heading', { name: 'Changes' })).toBeFocused();
    await expect(row('sandbox.enabled')).toContainText('Matches suggested (in your changes).');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    // A hardening note's fix plans the suggestion of its setting; one without a suggested value goes to its setting.
    await fold.click();
    await notes.getByRole('button', { name: 'Fix, review the change: env-scrub-off' }).click();
    await openDiffs(changes);
    await expect(changes).toContainText('"CLAUDE_CODE_SUBPROCESS_ENV_SCRUB": "1"');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByLabel('Search settings').fill('model');
    await notes.getByRole('button', { name: 'Go to the setting: read-deny-credentials' }).click();
    await expect(page.locator('[id="setting-permissions.deny"]')).toBeFocused();
    await expect(page.getByLabel('Search settings')).toHaveValue('');
    await noAxe(page);
    await page.unroute(view);
  });

  test('Agent settings: Dismiss and Show again move a note between the lists, focus stays on the notes and the status says what happened', async ({ page }) => {
    // The note's list follows the stubbed dismissal, so the fixture home keeps its notes for the other tests.
    const note = { id: 'stub-note', level: 'info', kind: 'note', message: 'A stubbed note.', source: 'https://example.com/' };
    let off = false;
    // Only the view's own read: the setting facts the Dashboard reads for settings findings share the path and return a list.
    const view = /\/api\/settings\?agent=claude$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), notes: off ? [] : [note], dismissed: off ? [note] : [] } });
    });
    await page.route(/\/api\/settings-dismiss$/, (route) => { off = route.request().postDataJSON().dismissed; return route.fulfill({ json: { dismissed: [] } }); });
    await nav(page, 'Agent settings').click();
    const notes = page.getByRole('region', { name: 'Notes on the settings' });
    const status = notes.getByRole('status');
    await notes.getByRole('button', { name: 'Dismiss, I accept this: stub-note' }).focus();
    await page.keyboard.press('Enter');
    await expect(notes.getByRole('button', { name: 'Dismissed (1)' })).toBeVisible();
    await expect(notes).toBeFocused();
    await expect(status).toHaveText('Dismissed: stub-note');
    await notes.getByRole('button', { name: 'Dismissed (1)' }).click();
    await notes.getByRole('button', { name: 'Show again: stub-note' }).focus();
    await page.keyboard.press('Enter');
    await expect(notes.getByRole('button', { name: /^Dismissed/ })).toHaveCount(0);
    await expect(notes).toBeFocused();
    await expect(status).toHaveText('Shown again: stub-note');
    await page.unroute(view);
    await page.unroute(/\/api\/settings-dismiss$/);
  });

  test('Agent settings: a failed Dismiss says Not saved inside the notes, and focus stays on the note', async ({ page }) => {
    const note = { id: 'stub-note', level: 'info', kind: 'note', message: 'A stubbed note.', source: 'https://example.com/' };
    const view = /\/api\/settings\?agent=claude$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), notes: [note], dismissed: [] } });
    });
    await page.route(/\/api\/settings-dismiss$/, (route) => route.fulfill({ status: 500, json: { error: 'stubbed failure' } }));
    await nav(page, 'Agent settings').click();
    const notes = page.getByRole('region', { name: 'Notes on the settings' });
    const button = notes.getByRole('button', { name: 'Dismiss, I accept this: stub-note' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(notes.getByRole('alert').filter({ hasText: 'Not saved' })).toContainText('stubbed failure');
    await expect(page.getByRole('alert').filter({ hasText: 'Not planned' })).toHaveCount(0);
    await expect(button).toBeFocused();
    await page.unroute(view);
    await page.unroute(/\/api\/settings-dismiss$/);
  });

  test('Setting facts: Agent settings, the doctor, Insights and the Plan and Apply drawers show summary, plain words, impact, default and the current value with its source; no axe violations', async ({ page }) => {
    const about = (scope, key) => scope.getByRole('group', { name: `About ${key}` }).first();
    const facts = async (box) => {
      for (const t of ['In plain words:', 'Impact:', 'Default:', 'Current:']) await expect(box).toContainText(t);
      await expect(box.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', /^https:\/\//);
    };
    await nav(page, 'Agent settings').click();
    // The fixture home holds the global setup's settings: the advisor and the retention come from the user file.
    const advisor = about(page, 'advisorModel');
    await facts(advisor);
    await expect(advisor).toContainText('from the user file');
    // A catalog key that is not basic is listed in its group with every key.
    await page.getByRole('switch', { name: 'Advanced: every key' }).check();
    await page.getByLabel('Search settings').fill('autoMemoryEnabled');
    await expect(about(page.getByRole('table', { name: 'Memory' }), 'autoMemoryEnabled')).toContainText('Current: the default');
    // A key outside the catalog: the reference description, no guessed text, the rest of the facts still there.
    await page.getByLabel('Search settings').fill('modelSettings');
    const outside = about(page.getByRole('table', { name: 'Advanced keys' }), 'modelSettings');
    await expect(outside).toContainText('Keep a saved effort level or auto-compact window per model');
    await expect(outside).toContainText('Default:');
    await expect(outside).not.toContainText('Impact:');
    await page.getByRole('switch', { name: 'Advanced: every key' }).uncheck();
    await page.getByLabel('Search settings').fill('');
    // The Plan drawer: the planned key with its facts. Applied, it moves the user file off the setup's value.
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('21');
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await facts(about(changes, 'cleanupPeriodDays'));
    await noAxe(page);
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    // The doctor and Insights name the keys of a settings finding.
    await nav(page, 'Dashboard').click();
    await facts(about(page.getByRole('table', { name: 'Doctor findings' }), 'permissions.deny'));
    await nav(page, 'Insights').click();
    await facts(about(page.getByRole('article', { name: /No Read deny rule/ }), 'permissions.deny'));
    await noAxe(page);
    // The Apply drawer: the global settings change, planned again, lists the facts of each key it writes.
    await nav(page, 'Dashboard').click();
    await page.getByRole('button', { name: 'Fix everything' }).click();
    const fix = page.getByRole('dialog', { name: 'Fix everything' });
    await facts(about(fix, 'cleanupPeriodDays'));
    await noAxe(page);
    await page.keyboard.press('Escape');
    await expect(fix).toBeHidden();
    // Back to the setup's value.
    await nav(page, 'Agent settings').click();
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('14');
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
  });

  test('Agent settings: an edit after Review drops the shown plan; Review again and Apply writes both edits', async ({ page }) => {
    await nav(page, 'Agent settings').click();
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('21');
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('cleanupPeriodDays');
    await page.getByRole('switch', { name: 'env.DISABLE_TELEMETRY value' }).check();
    await expect(changes).toBeHidden();
    await page.getByRole('button', { name: 'Review 2 changes' }).click();
    await expect(changes).toContainText('cleanupPeriodDays');
    await openDiffs(changes);
    await expect(changes).toContainText('"DISABLE_TELEMETRY": "1"');
    await changes.getByRole('button', { name: /^Apply 2 changes$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'cleanupPeriodDays value' })).toHaveValue('21');
    await expect(page.getByRole('switch', { name: 'env.DISABLE_TELEMETRY value' })).toBeChecked();
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });


  test('Agent settings: a Review answered after a newer edit shows no plan for the older edits', async ({ page }) => {
    await nav(page, 'Agent settings').click();
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(/\/api\/settings-plan$/, async (r) => { await held; await r.continue(); });
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('21');
    const asked = page.waitForRequest(/\/api\/settings-plan$/);
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    await asked;
    await page.getByRole('switch', { name: 'env.DISABLE_TELEMETRY value' }).check();
    const answered = page.waitForResponse(/\/api\/settings-plan$/);
    release();
    await answered;
    await expect(page.getByRole('button', { name: 'Review 2 changes' })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Changes' })).toBeHidden();
    await page.unroute(/\/api\/settings-plan$/);
    await page.getByRole('button', { name: 'Review 2 changes' }).click();
    await openDiffs(page.getByRole('region', { name: 'Changes' }));
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('"DISABLE_TELEMETRY": "1"');
    await page.getByRole('button', { name: 'Discard changes' }).click();
  });

  test('Rules: files with owner and load state, a switch as plan and undo, the text in a drawer, the budget; no axe violations', async ({ page }) => {
    await nav(page, 'Rules').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Claude Code' })).toBeVisible();
    // The checks come before the files; each limit is a bar that names who sets it.
    await expect(page.getByRole('region', { name: 'Checks' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: /^At the start of a session: .* tokens, limit set by BenchKeeper$/ }).first()).toBeVisible();
    const files = page.getByRole('table', { name: 'Claude Code instruction files' });
    const team = files.getByRole('row', { name: /20-team\.md/ });
    await expect(team).toContainText('yours');
    await expect(team).toContainText('loads');
    // BenchKeeper's own rules file has no switch; the budget counts files, skill descriptions and says what is largest.
    await expect(files.getByRole('row', { name: /00-global\.md/ })).toContainText('No switch: BenchKeeper wrote it');
    await expect(page.getByRole('table', { name: 'Context budget' }).first()).toContainText('Rule files');
    await expect(page.getByText('load at the start of every session').first()).toBeVisible();
    await noAxe(page);
    // The text opens on this machine only.
    await team.getByRole('button', { name: /Show text of/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Rule file text' });
    await expect(drawer).toContainText('Keep answers short.');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();
    // A switch is a plan with a diff; the file itself is never changed. Space keeps the focus on the switch.
    const toggle = team.getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ });
    await toggle.focus();
    await page.keyboard.press('Space');
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toBeVisible();
    await expect(toggle).toBeFocused();
    // The switch shows the requested position as pending until the plan is applied, cancelled or closed.
    await expect(toggle).not.toBeChecked();
    await expect(team).toContainText('Pending');
    await expect(changes).toContainText(/What it does: Claude Code stops loading this file: about [\d,]+ tokens less in every turn\./);
    await expect(changes).toContainText('Why: You turned the switch off in Rules.');
    await expect(changes).toContainText('Affects: Every project on this machine.');
    // The diff is folded.
    const fold = changes.getByRole('button', { name: /^Show file diff of / });
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(changes).not.toContainText('claudeMdExcludes');
    await fold.click();
    await expect(changes).toContainText('claudeMdExcludes');
    // Cancel and Review again hand the focus to what replaced them.
    await changes.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(changes.getByRole('status')).toHaveText('Cancelled. Nothing was changed.');
    await expect(toggle).toBeChecked();
    await expect(team).not.toContainText('Pending');
    await expect(changes.getByRole('button', { name: 'Review the changes again' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(team).toContainText('Pending');
    await expect(changes.getByRole('checkbox', { name: 'Select all in Settings' })).toBeFocused();
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(team).toContainText('off');
    await expect(team).toContainText('user settings');
    await noAxe(page);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    await page.reload();
    await expect(team).toContainText('loads');
    // A project: its files come after the global ones, with the same switch for a global file in this project only.
    await page.getByRole('combobox', { name: 'Show' }).click();
    await page.getByRole('option').nth(1).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Claude Code files for this project' })).toBeVisible();
    await noAxe(page);
  });

  test('Rules: a path-scoped file costs its tokens only in the turns it loads for matching files', async ({ page }) => {
    const view = /\/api\/rules$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      const agents = body.agents.map((a) => ({ ...a, rows: a.rows.map((row) => (/20-team\.md$/.test(row.path) ? { ...row, load: 'path-scoped' } : row)) }));
      await route.fulfill({ response: r, json: { ...body, agents } });
    });
    await nav(page, 'Rules').click();
    const team = page.getByRole('table', { name: 'Claude Code instruction files' }).getByRole('row', { name: /20-team\.md/ });
    await team.getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText(/What it does: Claude Code stops loading this file: about [\d,]+ tokens less in each turn it loads for matching files\./);
    await changes.getByRole('button', { name: 'Cancel' }).click();
    await page.unroute(view);
  });

  test('Rules: Turn off of a finding keeps the keyboard focus while the plan loads and after it opens', async ({ page }) => {
    const view = /\/api\/rules$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      const row = body.agents[0].rows.find((x) => /20-team\.md$/.test(x.path));
      const findings = [{ level: 'warn', message: `${row.shown} is long`, fix: 'Split it.', file: row.shown, action: { agent: body.agents[0].id, file: row.path } }];
      await route.fulfill({ response: r, json: { ...body, findings } });
    });
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/rules-plan$/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Rules').click();
    const off = page.getByRole('table', { name: 'Rule findings' }).getByRole('button', { name: /^Turn off / });
    await off.focus();
    await page.keyboard.press('Enter');
    await expect(off).toHaveAttribute('aria-disabled', 'true');
    await expect(off).toBeFocused();
    answer();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('Why: You turned the switch off in Rules.');
    await expect(off).toBeFocused();
    await changes.getByRole('button', { name: 'Cancel' }).click();
    await page.unroute(view);
    await page.unroute(/\/api\/rules-plan$/);
  });

  test('Rules: while an apply runs, Close, the Pending switch and Show ignore input and keep the focus; after it the view shows the new state', async ({ page }) => {
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/job\?/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Rules').click();
    const team = page.getByRole('table', { name: 'Claude Code instruction files' }).getByRole('row', { name: /20-team\.md/ });
    const toggle = team.getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ });
    await toggle.click({ force: true });
    const changes = page.getByRole('region', { name: 'Changes' });
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeVisible();
    const close = changes.getByRole('button', { name: 'Close' });
    await expect(close).toHaveAttribute('aria-disabled', 'true');
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(close).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await toggle.click({ force: true });
    await expect(team).toContainText('Pending');
    await expect(page.getByRole('combobox', { name: 'Show' })).toHaveAttribute('aria-disabled', 'true');
    answer();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(team).toContainText('off');
    await expect(close).not.toHaveAttribute('aria-disabled');
    await page.unroute(/\/api\/job\?/);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  test('Agent settings: while an apply runs, edits, Use suggested, Discard changes and the choices ignore input; after it the run shows and the edits are cleared', async ({ page }) => {
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/job\?/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Agent settings').click();
    const days = page.getByRole('textbox', { name: 'cleanupPeriodDays value' });
    await days.fill('21');
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeVisible();
    await days.focus();
    await page.keyboard.type('9');
    await expect(days).toHaveValue('21');
    await expect(days).toBeFocused();
    await page.getByRole('button', { name: 'Use suggested for sandbox.enabled' }).click();
    const discard = page.getByRole('button', { name: 'Discard changes' });
    await discard.focus();
    await page.keyboard.press('Enter');
    await expect(discard).toBeFocused();
    await expect(page.getByRole('radiogroup', { name: 'Agent' })).toHaveAttribute('aria-disabled', 'true');
    await page.getByText('Codex', { exact: true }).click({ force: true });
    await expect(page.getByRole('radio', { name: 'Claude Code' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Write to' })).toHaveAttribute('aria-disabled', 'true');
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeVisible();
    answer();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review 0 changes' })).toBeDisabled();
    await expect(days).toHaveValue('21');
    await page.unroute(/\/api\/job\?/);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  test('Rules: while the rule editor plan applies, Close editor and the drawer Close ignore clicks; after it the run shows and the text reloads', async ({ page }) => {
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/job\?/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Rules').click();
    await page.getByRole('table', { name: 'Claude Code instruction files' }).getByRole('row', { name: /20-team\.md/ }).getByRole('button', { name: /Show text of/ }).click();
    const drawer = page.getByRole('dialog', { name: 'Rule file text' });
    await drawer.getByRole('button', { name: 'Edit' }).click();
    const text = drawer.getByRole('textbox', { name: /^Text of / });
    await text.fill('Keep answers very short.');
    await drawer.getByRole('button', { name: 'Save' }).click();
    const changes = drawer.getByRole('region', { name: 'Changes' });
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeVisible();
    for (const name of ['Close editor', 'Close']) {
      const close = drawer.getByRole('button', { name, exact: true });
      await expect(close).toHaveAttribute('aria-disabled', 'true');
      await close.click({ force: true });
    }
    await expect(drawer).toBeVisible();
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeVisible();
    const reloaded = page.waitForRequest(/\/api\/rule-text\?/);
    answer();
    await reloaded;
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await page.unroute(/\/api\/job\?/);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    await drawer.getByRole('button', { name: 'Close editor', exact: true }).click();
    await expect(drawer).toContainText('Keep answers short.');
  });

  test('Rules: a plan answer that arrives while an apply runs does not replace the running plan and says so', async ({ page }) => {
    const view = /\/api\/rules$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      const row = body.agents[0].rows.find((x) => /20-team\.md$/.test(x.path));
      await route.fulfill({ response: r, json: { ...body, findings: [{ level: 'warn', message: `${row.shown} is long`, fix: 'Split it.', file: row.shown, action: { agent: body.agents[0].id, file: row.path } }] } });
    });
    let answerPlan, answerJob;
    const planHeld = new Promise((resolve) => { answerPlan = resolve; });
    const jobHeld = new Promise((resolve) => { answerJob = resolve; });
    let asked = 0;
    await page.route(/\/api\/rules-plan$/, async (route) => { if (asked++) await planHeld; await route.continue(); });
    await page.route(/\/api\/job\?/, async (route) => { await jobHeld; await route.continue(); });
    await nav(page, 'Rules').click();
    await page.getByRole('table', { name: 'Claude Code instruction files' }).getByRole('row', { name: /20-team\.md/ }).getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
    const changes = page.getByRole('region', { name: 'Changes' });
    const apply = changes.getByRole('button', { name: /^Apply 1 change$/ });
    await expect(apply).toBeVisible();
    // A second plan is asked for, and its answer comes only after the first plan started to apply.
    await page.getByRole('table', { name: 'Rule findings' }).getByRole('button', { name: /^Turn off / }).click();
    await apply.click();
    await expect(changes.getByRole('region', { name: 'Apply progress' })).toBeVisible();
    const late = page.waitForResponse(/\/api\/rules-plan$/);
    answerPlan();
    await late;
    await expect(changes.getByRole('status').filter({ hasText: 'Finish the running change first, then try again.' })).toBeVisible();
    answerJob();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await page.unroute(view);
    await page.unroute(/\/api\/rules-plan$/);
    await page.unroute(/\/api\/job\?/);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  test('A plan: while the apply request is out, Cancel ignores input and the job shows when it starts', async ({ page }) => {
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/apply$/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Rules').click();
    await page.getByRole('table', { name: 'Claude Code instruction files' }).getByRole('row', { name: /20-team\.md/ }).getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
    const changes = page.getByRole('region', { name: 'Changes' });
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    const cancel = changes.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toHaveAttribute('aria-disabled', 'true');
    await cancel.click({ force: true });
    await expect(changes).not.toContainText('Cancelled');
    answer();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await page.unroute(/\/api\/apply$/);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  test('A settings merge into a hand-edited file: the Rules switch and the Agent settings plans name the key, not the file state', async ({ page }) => {
    // The fixture's settings file as one the user edited by hand: the server's own plan, its file state modified.
    const edited = async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      await route.fulfill({ response: r, json: { ...body, changes: body.changes.map((c) => ({ ...c, state: 'modified' })) } });
    };
    await page.route(/\/api\/(rules|settings)-plan$/, edited);
    await nav(page, 'Rules').click();
    const team = page.getByRole('table', { name: 'Claude Code instruction files' }).getByRole('row', { name: /20-team\.md/ });
    await team.getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).focus();
    await page.keyboard.press('Space');
    let changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('new key');
    await expect(changes).toContainText('Undo: History restores the file as it was before the run.');
    await expect(changes).not.toContainText('modified');
    await expect(changes).not.toContainText('restores your edits');
    await changes.getByRole('button', { name: 'Cancel' }).click();
    await nav(page, 'Agent settings').click();
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('21');
    await page.getByRole('button', { name: 'Review 1 change' }).click();
    changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('changed key');
    await expect(changes).toContainText(/What it does: Sets cleanupPeriodDays in \S*\.claude\/settings\.json; other keys stay\./);
    await expect(changes).toContainText('Undo: History restores the file as it was before the run.');
    await expect(changes).not.toContainText('Replaces your edits');
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.unroute(/\/api\/(rules|settings)-plan$/);
  });

  test('Editors: off, no sidebar entry and no route; on, a file is edited with live validation, planned, applied and undone; no axe violations at desktop and phone width', async ({ page }) => {
    const entry = page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Presets, pins and policy' });
    await expect(entry).toHaveCount(0);
    await page.goto('/#/editors');
    await expect(page.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/params?dir=x', { headers: { 'x-benchkeeper': localStorage.getItem('benchkeeper-key') } })).status)).toBe(404);
    await nav(page, 'Preferences').click();
    const editors = page.getByRole('switch', { name: 'Editors' });
    await editors.click();
    await expect(page.getByRole('group', { name: 'Advanced' })).toBeVisible();
    await entry.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Presets, pins and policy' })).toBeVisible();
    await page.getByRole('combobox', { name: 'File' }).click();
    await page.getByRole('option', { name: '.benchkeeper/pins.json', exact: true }).click();
    const text = page.getByRole('textbox', { name: '.benchkeeper/pins.json' });
    await expect(text).toHaveValue(/"schemaVersion": 1/);
    await noAxe(page);
    // The loader's errors show while typing, and Review waits for a valid text.
    await text.fill('{ "schemaVersion": 1, "phases": { "review": { "effort": "high" } } }');
    const errors = page.getByRole('list', { name: 'Errors in .benchkeeper/pins.json' });
    await expect(errors).toContainText('effort-without-model at phases.review.effort');
    await expect(page.getByRole('button', { name: 'Review change' })).toBeDisabled();
    await noAxe(page);
    await text.fill('{ "schemaVersion": 1, "// why": "kept", "phases": { "review": { "agent": "claude", "model": "opus", "effort": "high" } } }\n');
    await expect(errors).toBeHidden();
    await page.getByRole('button', { name: 'Review change' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('Write .benchkeeper/pins.json');
    await expect(changes).toContainText('Why: You edited this file here.');
    await openDiffs(changes);
    await expect(changes).toContainText('"// why": "kept"');
    await page.mouse.move(0, 0);
    await noAxe(page);
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/editors');
    await expect(page.getByRole('heading', { level: 2, name: 'Presets, pins and policy' })).toBeVisible();
    await noAxe(page);
    // Off again: the entry and the route are gone.
    await page.goto('/#/settings');
    await editors.click();
    await expect(editors).not.toBeChecked();
    await expect(entry).toHaveCount(0);
  });

  test('Extensions: server, hook and subagent with owner and the runs-code mark, a link to the removal offer, no secret value; no axe violations', async ({ page }) => {
    await nav(page, 'Extensions').click();
    const table = page.getByRole('table', { name: 'Claude Code extensions' });
    const server = table.getByRole('row', { name: /MCP server/ });
    await expect(server).toContainText('files');
    await expect(server).toContainText('yours');
    await expect(server).toContainText('runs code');
    await expect(server).toContainText('npx -y files-server');
    await expect(server.getByRole('link', { name: 'Doctor offers removal (full level)' })).toBeVisible();
    await expect(table.getByRole('row', { name: /Subagent/ })).toContainText('reviewer');
    await expect(table.getByRole('row', { name: /Subagent/ })).not.toContainText('runs code');
    await expect(page.locator('body')).not.toContainText(/dummy-(env|hook)-secret/);
    await noAxe(page);
    // A project adds its own: a hook whose command carries a secret shows it masked.
    await page.getByRole('combobox', { name: 'Show' }).click();
    await page.getByRole('option', { name: /bk-ui-proj/ }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Claude Code extensions for this project' })).toBeVisible();
    const hook = page.getByRole('table', { name: 'Claude Code extensions' }).getByRole('row', { name: /Hook.*AUDIT_TOKEN/ });
    await expect(hook).toContainText('PreToolUse');
    await expect(hook).toContainText('runs code');
    await expect(hook).toContainText('AUDIT_TOKEN=***');
    await expect(hook).toContainText('local');
    await expect(page.locator('body')).not.toContainText(/dummy-(env|hook)-secret/);
    await noAxe(page);
  });

  test('Automations: install and remove by keyboard against the fake runner, the last run and skipped runs; no axe violations at desktop and phone width', async ({ page }) => {
    writeFileSync(RUNNER, '');
    try {
      await nav(page, 'Automations').click();
      const row = page.getByRole('table', { name: 'Automations' }).getByRole('row', { name: /Pull request watch/ });
      await expect(row).toContainText('private');
      await expect(row).toContainText('Not installed');
      await row.getByRole('button', { name: 'Install Pull request watch' }).focus();
      await page.keyboard.press('Enter');
      const form = page.getByRole('form', { name: 'Install Pull request watch' });
      await expect(form.getByRole('combobox', { name: 'Project' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(form.getByRole('textbox', { name: 'repository' })).toBeFocused();
      await page.keyboard.type('acme/alpha');
      await page.keyboard.press('Enter');
      const changes = page.getByRole('region', { name: 'Changes' });
      await expect(changes).toContainText('automation Pull request watch, disabled');
      await expect(changes).toContainText('Why: You asked to install this automation in Automations.');
      await noAxe(page);
      await changes.getByRole('button', { name: /^Apply \d+ changes?$/ }).focus();
      await page.keyboard.press('Enter');
      await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
      await expect(row).toContainText('matches the template');
      await expect(row).toContainText('Disabled, mode report');
      await expect(row).toContainText('completed, 2026-10-28 09:00 UTC');
      await expect(row).toContainText('1 skipped since');
      await page.setViewportSize({ width: 390, height: 844 });
      await noAxe(page);
      await page.setViewportSize({ width: 1280, height: 720 });

      await changes.getByRole('button', { name: 'Close', exact: true }).click();
      await row.getByRole('button', { name: 'Remove Pull request watch' }).focus();
      await page.keyboard.press('Enter');
      await expect(changes.getByRole('group', { name: 'Remove', exact: true })).toContainText('Remove the');
      await expect(changes.getByRole('checkbox', { name: /^Remove the / })).toBeChecked();
      await changes.getByRole('button', { name: /^Apply \d+ changes?$/ }).focus();
      await page.keyboard.press('Enter');
      await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
      await expect(row).toContainText('Not installed');
    } finally {
      rmSync(RUNNER, { force: true });
    }
  });

  test('Accounts: two add buttons when empty; Advanced adds as a plan; cards with sign-in and usage; one-click default and tracking; no axe violations', async ({ page }) => {
    await nav(page, 'Accounts').click();
    const accounts = page.getByRole('region', { name: 'Accounts' });
    await expect(accounts).toContainText('No account yet');
    await expect(accounts.getByRole('button', { name: 'Add Claude Code account' })).toBeVisible();
    await expect(accounts.getByRole('button', { name: 'Add Codex account' })).toBeVisible();
    await expect(page.getByText('Each login stays in the agent\'s own folder (mode 0700)')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Token for unattended containers' })).toContainText('never in a file');
    await expect(page.getByRole('region', { name: 'Usage limits' })).toContainText('Auto-pick is off');
    await expect(page.getByRole('region', { name: 'Usage limits' })).toContainText('minimum 5-hour 8%, 7-day 3%');
    await noAxe(page);
    // Advanced: the form of a name, label, folder or dev container, as a plan.
    await page.getByText('Advanced: choose the name').click();
    await expect(page.getByText('A hijacked session in a container can read the credentials in its volume.')).toBeVisible();
    const changes = page.getByRole('region', { name: 'Changes' });
    for (const name of ['work', 'home']) {
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Plan the new account' }).click();
      await expect(changes).toContainText(`Add claude account ${name}`);
      await expect(changes).toContainText('Why: You asked to add this account in Accounts.');
      await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
      await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
      await changes.getByRole('button', { name: 'Close' }).click();
    }
    const work = page.getByRole('article', { name: 'work' }), home = page.getByRole('article', { name: 'home' });
    await expect(work).toContainText('For new sessions');
    await expect(work).toContainText('not signed in (its folder does not exist yet)');
    await expect(home).not.toContainText('For new sessions');
    // The container form asks for the mount path.
    await page.getByRole('radio', { name: 'In a dev container' }).check({ force: true });
    await expect(page.getByRole('button', { name: 'Plan the new account' })).toBeDisabled();
    await noAxe(page);
    // One click each: the default moves, tracking is set up; both are runs in History.
    await home.getByRole('button', { name: 'Use for new sessions: home' }).click();
    await expect(home).toContainText('For new sessions');
    await expect(work).not.toContainText('For new sessions');
    await work.getByRole('button', { name: 'Track usage of work' }).click();
    await expect(work).toContainText('Usage is tracked: it shows after the next session of this account.');
    // Tracking created the folder, so the status runs: the stub signs it in with an address and a plan.
    await expect(work).toContainText('work@example.com, max');
    await expect(work.getByText('signed in', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(work).toBeVisible();
    await noAxe(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    // Back to no account, as the other tests expect the machine.
    for (const card of [home, work]) {
      await card.getByRole('button', { name: /^Remove / }).click();
      await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
      await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
      await changes.getByRole('button', { name: 'Close' }).click();
    }
    await expect(page.getByRole('region', { name: 'Accounts' })).toContainText('No account yet');
  });

  test('Preferences: the tier strip plan says the user asked for it', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const views = page.getByRole('region', { name: 'Views and their cost' });
    await views.getByRole('switch', { name: 'Terminal tier strip: Off' }).click({ force: true });
    await expect(views).toContainText('Why: You turned the tier strip on in Preferences.');
    // While the plan is open the switch shows the asked-for position as Pending; Close drops the plan.
    await expect(views.getByRole('switch', { name: 'Terminal tier strip: Pending' })).toBeChecked();
    await views.getByRole('region', { name: 'Changes' }).getByRole('button', { name: 'Close' }).click();
    await expect(views.getByRole('switch', { name: 'Terminal tier strip: Off' })).not.toBeChecked();
  });

  test('Preferences: the tier strip switch ignores input while its plan is asked for', async ({ page }) => {
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/settings-plan$/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Preferences').click();
    const views = page.getByRole('region', { name: 'Views and their cost' });
    const strip = views.getByRole('switch', { name: 'Terminal tier strip: Off' });
    await strip.click({ force: true });
    await expect(strip).toHaveAttribute('aria-disabled', 'true');
    answer();
    const changes = views.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('Why: You turned the tier strip on in Preferences.');
    await page.unroute(/\/api\/settings-plan$/);
    await changes.getByRole('button', { name: 'Close' }).click();
  });

  test('Accounts: a late answer for the project chosen before is dropped; clearing the project clears a container card', async ({ page }) => {
    await page.route(/\/api\/accounts(\?|$)/, async (route) => {
      const json = await (await route.fetch()).json();
      await route.fulfill({ json: { ...json, accounts: [{ name: 'boxed', agent: 'claude', mode: 'container', label: null, default: false, pool: null, limits: json.settings, volume: 'v', mount: '/m', token: { kept: false, created: null } }] } });
    });
    // The first project's answer waits until the second project's answer has arrived.
    let second;
    const answered = new Promise((r) => { second = r; });
    let first = null;
    await page.route(/\/api\/accounts-status\?/, async (route) => {
      const project = new URL(route.request().url()).searchParams.get('project');
      first ??= project;
      if (project === first) {
        await answered;
        return route.fulfill({ json: { loggedIn: true, findings: [] } });
      }
      await route.fulfill({ json: { loggedIn: false, findings: [] } });
      second();
    });
    await nav(page, 'Accounts').click();
    const boxed = page.getByRole('article', { name: 'boxed' });
    await expect(boxed).toContainText('not checked');
    const select = page.getByRole('combobox', { name: 'Project of the dev container' });
    await select.click();
    await page.getByRole('option').nth(0).click();
    await expect(boxed).toContainText('checking');
    const late = page.waitForResponse((r) => new URL(r.url()).searchParams.get('project') === first);
    await select.click();
    await page.getByRole('option').nth(1).click();
    await expect(boxed.getByText('not signed in', { exact: true })).toBeVisible();
    // Let the late answer land, then check it did not replace the second project's result.
    await late;
    await expect(boxed.getByText('not signed in', { exact: true })).toBeVisible();
    await expect(boxed.getByText('signed in', { exact: true })).toHaveCount(0);
    // Choosing the selected option again clears the project.
    await select.click();
    await page.getByRole('option').nth(1).click();
    await expect(boxed).toContainText('not checked');
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

  test('One-run: the level choice sets the global plan, lite plans the plugin alone', async ({ page }) => {
    await page.getByRole('button', { name: 'Set up global only' }).click();
    const drawer = oneRun(page);
    await drawer.getByLabel('Level').selectOption('lite');
    const asked = page.waitForRequest((r) => r.url().includes('/api/global-plan?level=lite'));
    await drawer.getByRole('button', { name: 'Start', exact: true }).click();
    await asked;
    const global = drawer.getByRole('region', { name: 'Global setup' });
    await expect(global).toBeVisible();
    await expect(global).not.toContainText('Claude settings');
    await drawer.getByRole('button', { name: 'Close' }).click();
  });

  test('One-run, Everything with two projects (one without a setup): one progress bar, one review page, one apply', async ({ page }) => {
    await addProjects(page, ['uno', 'duo']);
    const drawer = oneRun(page);
    writeFileSync(GATE, '');
    try {
      await page.getByRole('button', { name: 'Set up everything', exact: true }).click();
      // Everything preselects every project the run can set up; serve.mjs registered other, the earlier tests broken and alpha.
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
    await uno.getByRole('button', { name: /^Show file diff of / }).first().click();
    await expect(uno.getByRole('group', { name: /^Diff of .*CLAUDE\.local\.md$/ })).toBeVisible();
    // A change without an install unit names the section's scope.
    await expect(uno).toContainText('Affects: This project only.');
    // Guards keep the saved choice of a project set up before and are on for a new one, as in the wizard.
    await expect(uno).toContainText('guards on');
    await expect(uno).not.toContainText('guard hook removed');
    await expect(duo).toContainText('guards on');
    // A long card starts folded: open it to read the change titles.
    await duo.getByRole('button', { name: 'Show Install' }).click();
    await expect(duo).toContainText('Claude Code deny rules (--no-verify');
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
