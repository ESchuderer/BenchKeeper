import { expect, test } from '@playwright/test';
import { TOKENS } from '../../src/tokens.mjs';
import { nav } from './views.mjs';
import { noAxe, opened } from './chain.mjs';

test.describe('views', () => {
  opened(test);

  test('the board tokens are the app variables in both schemes; buttons do not move on hover; reduced motion removes the transitions', async ({ page }) => {
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
    await button.hover();
    expect(await button.evaluate((el) => [getComputedStyle(el).transform, getComputedStyle(el).transitionDuration])).toEqual(['none', '0s']);
    // The app adds no transition of its own, so a probe element carries one.
    const duration = () => page.evaluate(() => {
      const el = document.body.appendChild(Object.assign(document.createElement('div'), { style: 'transition: opacity 1s' }));
      const d = getComputedStyle(el).transitionDuration;
      el.remove();
      return d;
    });
    expect(await duration()).toBe('1s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await duration()).toBe('0s');
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

  test('Sessions board: the project choice opens closed as a chip at the head of the filter line, the quick facts right below; it opens the list and filters as before', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    const toggle = board.getByRole('group', { name: 'Filters' }).locator('#rail-toggle');
    await expect(toggle).toHaveText(/^All projects, /);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(board.getByLabel('Find a project')).toBeHidden();
    const bar = await board.locator('#filters').boundingBox(), tiles = await board.locator('#tiles').boundingBox();
    expect(tiles.y - (bar.y + bar.height)).toBeLessThan(20);
    await board.getByLabel('Period').selectOption('all');
    await toggle.click();
    await expect(board.getByLabel('Find a project')).toBeFocused();
    await board.locator('#rail button.card:not(.all)').filter({ hasText: /^bk-ui-proj/ }).click();
    await expect(toggle).toHaveText(/^bk-ui-proj, /);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(board.locator('#count')).toHaveText('2 of 2 sessions');
  });

  test('Sessions board: a click on the app outside the frame closes the open project list', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const toggle = page.frameLocator('iframe[title="Sessions board"]').locator('#rail-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('heading', { name: 'Sessions' }).first().click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('Sessions board: one entry per repository with its worktree sessions folded in, a folder of no repository under Other; Registered only keeps the registered project and is remembered', async ({ page }) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    const cards = board.locator('#rail button.card:not(.all)');
    await board.getByLabel('Period').selectOption('all');
    await expect(cards.filter({ hasText: /^bk-ui-proj/ })).toHaveAccessibleDescription(/2 sessions, 2 worktrees/);
    await expect(cards.filter({ hasText: /^Other/ })).toHaveAccessibleDescription(/3 sessions, 2 folders/);
    await board.getByLabel('Registered only').check();
    await expect(cards).toHaveCount(1);
    await expect(cards).toHaveAccessibleDescription(/^2 sessions, 2 worktrees/);
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
    // Keyboard: arrow keys read day by day, Escape closes. The last day is the day the board was read, not the clock's.
    const read = (await board.locator('.head .muted').textContent()).match(/\d{4}-\d{2}-\d{2}/)[0];
    await board.locator('#chart').focus();
    await page.keyboard.press('End');
    await expect(board.locator('#tip')).toContainText(read);
    await expect(board.locator('#tip-live')).toContainText(read);
    await page.keyboard.press('ArrowLeft');
    await expect(board.locator('#tip')).not.toContainText(read);
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
    await expect(board.getByText('No sessions match these filters.')).toHaveCount(10);
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
    await expect(page.getByText(/^\d+ agents? not installed$/)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+2');
    await expect(page).toHaveURL(/#\/history$/);
    await page.keyboard.press('ControlOrMeta+3');
    await expect(nav(page, 'Projects')).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveURL(/#\/projects$/);
  });

  test('sidebar: six groups in order, and Preferences lists the nine view keys by name', async ({ page }) => {
    const sidebar = page.getByRole('navigation', { name: 'Views' });
    await expect(sidebar.getByRole('group')).toHaveText([/^Overview/, /^Projects/, /^Catalog/, /^Analysis/, /^Agent configuration/, /^Machine/]);
    await expect(sidebar.getByRole('group', { name: 'Catalog' }).getByRole('link')).toHaveText([/^Skills/, /^Packs/]);
    await expect(sidebar.getByRole('group', { name: 'Machine' }).getByRole('link')).toHaveText([/^Automations/, /^Preferences/]);
    await nav(page, 'Preferences').click();
    const keys = page.getByRole('table', { name: 'Keyboard shortcuts' });
    for (const [n, view] of [[1, 'Dashboard'], [3, 'Projects'], [4, 'Skills'], [9, 'Evals']]) await expect(keys.getByRole('row', { name: new RegExp(`^(Ctrl|Cmd)\\+${n} ${view}$`) })).toBeVisible();
  });
});
