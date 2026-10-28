import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBrowser } from '../../src/server.mjs';
import { TOKENS } from '../../src/tokens.mjs';

const TOKEN = 'ui-test-token-0123456789';
const BATCH = join(tmpdir(), 'bk-ui-batch-4410');
const ONE = join(tmpdir(), 'bk-ui-one-4410');
// While this file exists, the stubbed suggestion for duo and quatro waits (serve.mjs).
const GATE = join(tmpdir(), 'bk-ui-gate-4410');
// While this file exists, the stubbed automations runner answers (serve.mjs).
const RUNNER = join(tmpdir(), 'bk-ui-runner-4410');
// Sidebar label and route of every view, in sidebar order.
const VIEWS = [['Dashboard', 'dashboard'], ['History', 'history'], ['Projects', 'projects'], ['Catalog', 'catalog'], ['Sessions', 'sessions'], ['Runs', 'runs'], ['Insights', 'insights'], ['Evals', 'evals'],
  ['Global setup', 'agents'], ['Agent settings', 'agent-settings'], ['Rules', 'rules'], ['Extensions', 'extensions'], ['Accounts', 'accounts'], ['Automations', 'automations'], ['Preferences', 'settings']];
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
    // Shortcuts and the skip link exist once the app is up, behind the starting screen.
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
  });

  for (const [view] of VIEWS) {
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
  for (const [view, route] of VIEWS) {
    for (const scheme of ['light', 'dark']) {
      test(`no axe violations in ${view}, ${scheme} mode, phone width`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`/#/${route}`);
        await expect(page.getByText('CLI', { exact: true })).toBeVisible();
        await page.evaluate((s) => document.documentElement.setAttribute('data-mantine-color-scheme', s), scheme);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')} ${v.nodes[0].failureSummary}`)).toEqual([]);
      });
    }
  }

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
    let jobs = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/jobs') jobs++; });
    await expect(page.getByText('CLI', { exact: true })).toBeVisible();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
    await page.waitForTimeout(2200);
    const hidden = jobs;
    await page.waitForTimeout(4400);
    expect(jobs).toBe(hidden);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => jobs).toBeGreaterThan(hidden);
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

  test('Sessions board: one entry per repository with its worktree sessions folded in; Registered only keeps the registered project and is remembered', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    const cards = board.locator('#rail button.card:not(.all)');
    await board.getByLabel('Period').selectOption('all');
    await expect(cards.filter({ hasText: /^bk-ui-proj/ })).toContainText('2 sessions, 2 worktrees');
    await expect(cards.filter({ hasText: /^blog/ })).toContainText('1 session');
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
    let hits = 0;
    await page.route(/\/api\/overview(\?|$)/, (r) => { hits++; return r.abort('connectionreset'); });
    // Closing the one-run drawer calls refresh().
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByRole('dialog', { name: 'Command palette' }).getByLabel('Search').fill('Set up projects in one run');
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'One-run setup' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    // The read is asked twice (a lost connection is retried once), then the overview clears.
    await expect.poll(() => hits).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { level: 2, name: 'Preferences' })).toBeVisible();
    await expect(page.getByText('Starting')).toHaveCount(0);
  });

  test('Dashboard: flow diagram links, install health counts, recent runs', async ({ page }) => {
    await expect(page.getByRole('group', { name: /^Setup flow/ }).getByRole('link', { name: /^Projects 1 registered, 0 behind ok$/ })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Items by state: .*\d+ modified/ })).toBeVisible();
    await expect(page.getByRole('region', { name: 'BenchKeeper plugin' })).toContainText(/available \d+\.\d+\.\d+/);
    await expect(page.getByRole('region', { name: 'Install level' })).toContainText('full');
    await page.getByRole('region', { name: 'Recent runs' }).getByRole('link').first().click();
    await expect(page).toHaveURL(/#\/history\?run=/);
  });

  test('Dashboard: installed, health and coverage figures are links with a keyboard path; the catalog by pack is a sorted list', async ({ page }) => {
    const installed = page.getByRole('table', { name: 'Installed skills and packs' });
    await expect(installed.getByRole('row', { name: /^Global/ }).getByRole('link', { name: /^Claude Code \d+$/ })).toHaveAttribute('href', '#/agents?agent=claude');
    await expect(installed.getByRole('row', { name: /bk-ui-proj/ }).getByRole('link', { name: 'frontend' })).toHaveAttribute('href', '#/catalog?pack=frontend');
    // The legend counts what the bar draws; the table of values repeats every figure.
    const health = page.getByRole('region', { name: 'Health' });
    await expect(health.getByRole('list', { name: 'Items by state, all scopes' }).getByRole('link', { name: /modified/ })).toBeVisible();
    await health.getByText('Table of values').click();
    await expect(health.getByRole('link', { name: /^Global: 1 modified$/ })).toHaveAttribute('href', '#/agents?plan=1');
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
    await expect(page.getByRole('banner').getByRole('link', { name: /^Doctor: \d+ errors, \d+ warnings$/ })).toBeVisible();
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

  test('Insights: Apply opens the plan, Dismiss and Snooze hide a card and a reload keeps it, Show again brings it back; other evidence and an ended snooze show; no axe violations', async ({ page }) => {
    await nav(page, 'Insights').click();
    const card = (re) => page.getByRole('article', { name: re });
    const market = card(/marketplace benchkeeper$/), deny = card(/No Read deny rule/), scrub = card(/SUBPROCESS_ENV_SCRUB/);
    // The seeded dismissal belongs to other evidence and the seeded snooze has ended: both findings show.
    await expect(deny).toBeVisible();
    await expect(scrub).toBeVisible();
    await expect(deny.getByRole('link', { name: 'Apply' })).toHaveAttribute('href', /^#\/agent-settings/);
    await expect(deny).toContainText('permissions.deny');
    await noAxe(page);
    await card(/plugin benchkeeper@benchkeeper$/).getByRole('link', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/#\/agents\?plan=1$/);
    await expect(page.getByRole('region', { name: 'Changes' })).toBeVisible();
    await nav(page, 'Insights').click();
    await market.getByRole('button', { name: 'Dismiss' }).click();
    await expect(market).toHaveCount(0);
    await scrub.getByRole('button', { name: 'Snooze 7 days' }).click();
    await expect(scrub).toHaveCount(0);
    await page.reload();
    await expect(deny).toBeVisible();
    await expect(market).toHaveCount(0);
    await expect(scrub).toHaveCount(0);
    const hidden = page.getByRole('region', { name: 'Hidden findings' });
    await hidden.getByRole('button', { name: 'Hidden (2)' }).click();
    const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await expect(hidden).toContainText('Dismissed');
    await expect(hidden).toContainText(`Snoozed until ${week}`);
    await noAxe(page);
    await hidden.getByRole('button', { name: 'Show again' }).first().click();
    await expect(market.or(scrub)).toHaveCount(1);
    await hidden.getByRole('button', { name: 'Show again' }).click();
    await expect(hidden).toHaveCount(0);
    await expect(market).toBeVisible();
    await expect(scrub).toBeVisible();
  });

  test('Insights narrative: the input is on the page, the first run asks for consent, the text is marked as model text and a dismissal drops it; no axe violations', async ({ page }) => {
    await nav(page, 'Insights').click();
    const narrative = page.getByRole('region', { name: 'Adviser narrative' });
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
    const hidden = page.getByRole('region', { name: 'Hidden findings' });
    await hidden.getByRole('button', { name: /^Hidden/ }).click();
    await hidden.getByRole('button', { name: 'Show again' }).click();
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

  test('Catalog: a pack file that is not a pack is listed with its reason and can be removed; no axe violations', async ({ page }) => {
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
    await bad.getByRole('button', { name: 'Remove broken.json' }).click();
    expect((await sent).postDataJSON()).toEqual({ action: 'remove', id: 'broken.json' });
    await page.unroute(/\/api\/catalog(\?|$)/);
    await page.unroute(/\/api\/packs$/);
  });

  test('Projects: the drift board row, its plan, skill toggle and doctor, and Update all progress per project', async ({ page }) => {
    await nav(page, 'Projects').click();
    const row = page.getByRole('table', { name: 'Projects' }).getByRole('row').nth(1);
    await expect(row).toContainText('current, shared');
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
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    // The project's setup is shared: a pull request, so Update all asks first and names the count.
    const ask = page.getByRole('dialog', { name: 'Open up to 1 pull request?' });
    await noAxe(page);
    await ask.getByRole('button', { name: 'Cancel' }).click();
    await expect(ask).toBeHidden();
    await expect(page.getByRole('progressbar', { name: /^Update all:/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    await ask.getByRole('button', { name: 'Update all and open up to 1 pull request' }).click();
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
    await expect(page.getByRole('table', { name: 'Projects' })).toContainText('not set up');
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
    await expect(table.getByRole('link', { name: 'Marketing site', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Project \// })).toContainText('owner: ana');
    // The name and the notes are searched; the filter and the sort narrow and order the rows.
    await page.getByLabel('Search projects').fill('ana');
    await expect(table.getByRole('row')).toHaveCount(2);
    await page.getByLabel('Search projects').fill('zzz');
    await expect(page.getByText('No project matches the search and filter.')).toBeVisible();
    await page.getByLabel('Search projects').fill('');
    await choose(page, 'Show', 'Not set up');
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table).not.toContainText('bk-ui-proj');
    await choose(page, 'Show', 'All projects');
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
    await table.getByRole('checkbox', { name: 'Select all shown projects' }).check();
    await expect(bar(page)).toContainText('3 selected');
    await table.getByRole('checkbox', { name: 'Select all shown projects' }).uncheck();
    await unregister(page, ['Marketing site']);
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
    const moved = join(dir, '..', 'mv-moved');
    renameSync(dir, moved);
    await page.reload();
    await choose(page, 'Show', 'Folder not found');
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
    await choose(page, 'Show', 'All projects');
    await expect(table.getByRole('link', { name: 'Docs site', exact: true })).toBeVisible();
    await expect(table).not.toContainText('Folder not found');
    await unregister(page, ['Docs site']);
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

  test('Projects: pack switches preview the removal of a pack and Copy packs from project sets them; no axe violations', async ({ page }) => {
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, join(ONE, 'uno'));
    await table.getByRole('link', { name: /^bk-ui-proj/ }).click();
    const packs = page.getByRole('region', { name: 'Packs' });
    const frontend = packs.getByRole('switch', { name: 'Frontend' });
    await expect(frontend).toBeChecked();
    await frontend.click();
    await expect(frontend).not.toBeChecked();
    const changes = page.getByRole('region', { name: /^Changes in / });
    await expect(changes).toContainText('Remove:');
    await expect(changes).toContainText('designing-technical-uis');
    await noAxe(page);
    await frontend.click();
    await expect(frontend).toBeChecked();
    // Copy packs from a project with none: the pack goes off in the plan, nothing is written yet.
    await choose(page, 'Copy packs from project', 'uno: no packs');
    await expect(frontend).not.toBeChecked();
    await expect(changes).toContainText('Remove:');
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
    await own.getByRole('button', { name: /^Update/ }).click();
    const update = page.getByRole('dialog', { name: 'Update designing-technical-uis in sk-proj' });
    await update.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
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
    await expect(reset.getByRole('group', { name: /^Diff of .*SKILL\.md$/ })).toContainText('edited here');
    await noAxe(page);
    await reset.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
    await expect(reset.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await reset.getByRole('button', { name: 'Close' }).click();
    await expect(own).toContainText('current');
    // Adopt a library skill that is there without a setup: it becomes a single pick, its folder kept.
    await untracked.getByRole('row').filter({ hasText: 'mermaid-diagrams' }).getByRole('button', { name: /^Adopt/ }).click();
    const adopt = page.getByRole('dialog', { name: 'Adopt mermaid-diagrams in sk-proj' });
    await adopt.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
    await expect(adopt.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await adopt.getByRole('button', { name: 'Close' }).click();
    const adopted = mine.filter({ hasText: 'mermaid-diagrams' });
    await expect(adopted).toBeVisible();
    expect(existsSync(join(skills, 'mine/SKILL.md'))).toBe(true);
    // Remove takes the single pick out of the project; the untracked folder is still there.
    await adopted.getByRole('button', { name: /^Remove/ }).click();
    const remove = page.getByRole('dialog', { name: 'Remove mermaid-diagrams in sk-proj' });
    await expect(remove).toContainText('remove skill mermaid-diagrams');
    await remove.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
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
    // Frameworks are workflow owners, listed with their evidence and chosen explicitly; none is preselected. Agent files are a pick of their own.
    const fw = drawer.getByRole('region', { name: 'Frameworks' });
    // Each one is listed once, as a checkbox; no owner checked keeps BenchKeeper's workflow skill.
    await expect(fw.getByRole('radio')).toHaveCount(0);
    await expect(fw.getByRole('checkbox')).toHaveCount(1);
    await expect(drawer.getByRole('checkbox', { name: /^Superpowers/ })).toHaveCount(1);
    await expect(fw.getByRole('checkbox', { name: /^Superpowers/ })).not.toBeChecked();
    await expect(fw).not.toContainText('give way in this project');
    await fw.getByRole('checkbox', { name: /^Superpowers/ }).check();
    await expect(fw).toContainText('cost higher in every with/without test but one');
    await expect(fw).toContainText("BenchKeeper's workflow skill and the issue-tracker specs give way in this project.");
    await expect(drawer.getByRole('checkbox', { name: 'engineering-frontend-developer' })).not.toBeChecked();
    await noAxe(page);
    await fw.getByRole('checkbox', { name: /^Superpowers/ }).uncheck();
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
    await expect(drawer).toContainText(/\d+ changes in this checkout, in files git ignores/);
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
    await expect(drawer).toContainText('skill designing-technical-uis (own)');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Continue' }).click();
    await drawer.getByRole('button', { name: 'Create branch and pull request' }).click();
    await expect(drawer.getByRole('alert')).toContainText('committed');
    // The result step repeats what only the user can start.
    await expect(drawer).toContainText('After merging, start in the project');
    await expect(drawer).toContainText('/benchkeeper:setting-up-projects stack skills');
    await noAxe(page);
    await drawer.getByRole('button', { name: 'Next project' }).click();
    await expect(drawer).toBeHidden();
  });

  test('Projects: Change setup starts from the state file', async ({ page }) => {
    // A saved owner and a saved pack load checked; a second owner row (not in the library today) is off while the first is checked.
    await page.route(/\/api\/project-setup\?/, async (route) => {
      const body = await (await route.fetch()).json();
      body.state = { ...body.state, frameworks: ['superpowers'], packs: [...body.state.packs, 'matt-pocock'] };
      body.frameworks = [...body.frameworks, { ...body.frameworks[0], id: 'other-owner', title: 'Other owner' }];
      await route.fulfill({ json: body });
    });
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: /bk-ui-proj$/ }).click();
    await page.getByRole('button', { name: 'Change setup' }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await expect(drawer.getByRole('heading', { name: /Change project setup/ })).toBeVisible();
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('radio', { name: /^Agent on the host/ })).toBeChecked();
    await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer.getByRole('checkbox', { name: /^Frontend/ })).toBeChecked();
    await expect(drawer.getByRole('checkbox', { name: /^Matt Pocock's skills/ })).toBeChecked();
    const fw = drawer.getByRole('region', { name: 'Frameworks' });
    await expect(fw.getByRole('checkbox', { name: /^Superpowers/ })).toBeChecked();
    await expect(fw.getByRole('checkbox', { name: /^Other owner/ })).toBeDisabled();
    await expect(fw).toContainText('Off while Superpowers owns the workflow: a project has at most one owner.');
    await noAxe(page);
    await fw.getByRole('checkbox', { name: /^Superpowers/ }).uncheck();
    await expect(fw.getByRole('checkbox', { name: /^Other owner/ })).toBeEnabled();
    await expect(fw).not.toContainText('Off while');
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
    await expect(fix.getByRole('checkbox', { name: /^global skill find-skills/ })).toBeChecked();
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
    await expect(fix.getByRole('table', { name: 'Doctor findings' }).or(fix.getByText('No problems found.'))).toBeVisible();
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

  test('an apply in Global setup shows up in History and the header without a reload', async ({ page }) => {
    await nav(page, 'History').click();
    const runs = page.getByRole('navigation', { name: 'Runs' }).getByRole('link');
    await expect(runs.first()).toBeVisible();
    const before = await runs.count();
    await nav(page, 'Global setup').click();
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

  test('Preferences: the sessions cache has a retention and Clear', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const history = page.getByRole('region', { name: 'Sessions history' });
    await expect(history).toContainText('sessions in the cache');
    await history.getByRole('switch', { name: 'Drop summaries after a number of days' }).click({ force: true });
    await expect(history.getByText('Retention set.')).toBeVisible();
    await expect(history.getByRole('textbox', { name: 'Days since the last activity' })).toHaveValue('30');
    await history.getByRole('switch', { name: 'Drop summaries after a number of days' }).click({ force: true });
    await expect(history.getByText('Summaries are kept.')).toBeVisible();
    await history.getByRole('button', { name: 'Clear the sessions cache' }).click();
    await expect(history.getByText('Cache cleared.')).toBeVisible();
    await expect(history).toContainText('0 sessions in the cache');
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
    await expect(page.getByRole('region', { name: 'Global changes' })).toBeVisible();
    await noAxe(page);
  });


  test('Agent settings: the list with its notes, a change as plan and diff, undo; advanced lists every key; no axe violations', async ({ page }) => {
    await nav(page, 'Agent settings').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Agent settings' })).toBeVisible();
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
    await changes.getByRole('button', { name: /^Apply 1 changes$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    // An environment switch is set or removed; the advisor with a telemetry switch shows the note on both rows.
    await page.getByRole('switch', { name: 'env.DISABLE_TELEMETRY value' }).check();
    await page.getByRole('button', { name: 'Review 1 change' }).click();
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
    await expect(page.getByRole('table', { name: 'Settings files' })).toContainText('.codex/config.toml');
  });


  test('Rules: files with owner and load state, a switch as plan and undo, the text in a drawer, the budget; no axe violations', async ({ page }) => {
    await nav(page, 'Rules').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Claude Code' })).toBeVisible();
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
    // A switch is a plan with a diff; the file itself is never changed.
    // The switch's track lies over its input, which Playwright's hit test refuses.
    await team.getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('claudeMdExcludes');
    await changes.getByRole('button', { name: /^Apply 1 changes$/ }).click();
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
    await expect(changes).toContainText('write .benchkeeper/pins.json');
    await expect(changes).toContainText('"// why": "kept"');
    await page.mouse.move(0, 0);
    await noAxe(page);
    await changes.getByRole('button', { name: /^Apply 1 changes$/ }).click();
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
      await noAxe(page);
      await changes.getByRole('button', { name: /^Apply \d+ changes$/ }).focus();
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
      await expect(changes).toContainText('Remove: remove the');
      await expect(changes.getByRole('checkbox', { name: /^Remove: / })).toBeChecked();
      await changes.getByRole('button', { name: /^Apply \d+ changes$/ }).focus();
      await page.keyboard.press('Enter');
      await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
      await expect(row).toContainText('Not installed');
    } finally {
      rmSync(RUNNER, { force: true });
    }
  });

  test('Accounts: an account is added as a plan and undone; the container risk and the token note are stated; no axe violations', async ({ page }) => {
    await nav(page, 'Accounts').click();
    await expect(page.getByText('No account yet.')).toBeVisible();
    await expect(page.getByText('A hijacked session in a container can read the credentials in its volume.')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Token for unattended containers' })).toContainText('never in a file');
    await expect(page.getByRole('region', { name: 'Usage limits' })).toContainText('Auto-pick is off');
    await expect(page.getByRole('region', { name: 'Usage limits' })).toContainText('minimum 5-hour 8%, 7-day 3%');
    await page.getByLabel('Name', { exact: true }).fill('work');
    await page.getByRole('button', { name: 'Plan the new account' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('add claude account work');
    await noAxe(page);
    await changes.getByRole('button', { name: /^Apply 1 changes$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    const row = page.getByRole('table', { name: 'Accounts' }).getByRole('row', { name: /work/ });
    await expect(row).toContainText('default for Claude Code');
    await expect(row.getByRole('button', { name: 'Sign in work' })).toBeVisible();
    // The container form asks for the mount path.
    await page.getByRole('radio', { name: 'In a dev container' }).check({ force: true });
    await expect(page.getByRole('button', { name: 'Plan the new account' })).toBeDisabled();
    await noAxe(page);
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    await page.reload();
    await expect(page.getByText('No account yet.')).toBeVisible();
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
