// The sessions board page on its own, with generated rows (the app's frame is covered in ui.spec.mjs).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { boardHtml } from '../../src/board.mjs';

const NOW = '2026-10-28T12:00:00.000Z';
const ago = (days, hour = 10) => `${new Date(Date.parse(NOW) - days * 864e5).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
let seq = 0;
const row = (o = {}) => ({ agent: 'claude', id: `s${seq++}`, project: '/work/shop', branch: 'main', agentVersion: '2.1.0', start: ago(1), end: ago(1, 11), turns: 3, models: ['claude-sonnet-5-5'], costUSD: 2, busyMs: 600000, tokens: 1000,
  tier: { first: 'standard', last: 'standard', changeType: 'feature', movedUp: false }, skills: [], tests: 'pass', setup: ['BenchKeeper'], setupVersion: '6.24.0', pattern: 'single', subagents: 0, run: null, prs: [], title: 'Fix', ...o });
const many = (n, o, spread = 25) => Array.from({ length: n }, (_, i) => row({ ...(typeof o === 'function' ? o(i) : o), start: ago(1 + (i % spread)) }));
// Current period (30 days): shop 20 single, blog 19 group, api 1 loop. Previous 30 days: 10 shop sessions.
const data = () => [
  ...many(20, { project: '/work/shop', pattern: 'single' }),
  ...many(19, (i) => ({ project: '/work/blog', pattern: 'group', tests: i % 2 ? 'pass' : 'fail', prs: i === 0 ? [{ url: 'https://github.com/acme/blog/pull/9', state: 'merged' }] : [], branch: i < 5 ? 'feat/x' : 'main' })),
  row({ project: '/work/api', pattern: 'loop', start: ago(0, 11) }),
  ...Array.from({ length: 10 }, (_, i) => row({ project: '/work/shop', start: ago(31 + i) })),
];
const load = async (page, rows, registered = []) => { await page.setContent(boardHtml(rows, NOW, registered)); await expect(page.locator('#count')).toContainText(/sessions/); };
const errors = (page) => { const e = []; page.on('pageerror', (x) => e.push(x.message)); return e; };

test('the rail lists projects newest first with count and last tier; a click filters everything and a second click clears it', async ({ page }) => {
  const e = errors(page);
  await load(page, data());
  const cards = page.locator('#rail button.card:not(.all)');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toContainText('work/api');
  await expect(cards.nth(1)).toContainText('20 sessions, last tier standard');
  await cards.filter({ hasText: 'work/blog' }).click();
  await expect(page.locator('#f-project')).toHaveValue('/work/blog');
  await expect(page.locator('#count')).toHaveText('19 of 19 sessions');
  await expect(page.locator('#tiles .tile').first()).toContainText('19');
  // The project page: branches and pull request states.
  await expect(page.getByRole('heading', { level: 2, name: 'Project work/blog' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Branches, newest first' })).toContainText('feat/x');
  await expect(page.locator('#project-body')).toContainText('1 pull requests: 1 merged');
  await cards.filter({ hasText: 'work/blog' }).click();
  await expect(page.locator('#count')).toHaveText('40 of 40 sessions');
  await expect(page.locator('#project-page')).toBeHidden();
  expect(e).toEqual([]);
});

test('every figure shows the change against the previous period of the same length; All time has none', async ({ page }) => {
  await load(page, data());
  const tile = (name) => page.locator('#tiles .tile').filter({ has: page.locator('.label', { hasText: new RegExp(`^${name}$`) }) });
  await expect(tile('Sessions')).toContainText('up 300% vs previous 30 days');
  await expect(tile('Sessions')).toContainText('40');
  await expect(tile('Tests passed')).toContainText('points vs previous 30 days');
  await page.getByLabel('Period').selectOption('7');
  await expect(tile('Sessions')).toContainText('vs previous 7 days');
  await page.getByLabel('Period').selectOption('all');
  await expect(tile('Sessions')).toContainText('50');
  await expect(page.locator('#tiles .delta')).toHaveCount(0);
});

test('a metric switch redraws the stream; a legend chip hides its series and says so; the table follows', async ({ page }) => {
  await load(page, data());
  await page.locator('#metric').selectOption('sessions');
  await expect(page.locator('#chart svg')).toHaveAttribute('aria-label', /^Sessions per day by project/);
  const chips = page.locator('#legend button.chip');
  await expect(chips).toHaveCount(3);
  await page.locator('#chart-table').locator('xpath=..').locator('summary').click();
  await expect(page.locator('#chart-table th[scope=col]')).toContainText(['Day', 'work/shop', 'work/blog', 'work/api', 'Total']);
  await chips.filter({ hasText: 'work/shop' }).click();
  await expect(chips.filter({ hasText: 'work/shop' })).toHaveAttribute('aria-pressed', 'false');
  await expect(chips.filter({ hasText: 'work/shop' })).toBeFocused();
  await expect(page.locator('#chart-table th[scope=col]')).not.toContainText(['work/shop']);
  await chips.filter({ hasText: 'work/shop' }).click();
  await expect(chips.filter({ hasText: 'work/shop' })).toHaveAttribute('aria-pressed', 'true');
  // Tap or keyboard reads a day.
  await page.locator('#chart').focus();
  await page.keyboard.press('End');
  await expect(page.locator('#tip')).toContainText('2026-10-28');
});

test('a bar under 20 sessions is marked with its n and left out of the highest and lowest line; exactly 20 is not', async ({ page }) => {
  await load(page, data());
  // Pattern: single has 20 sessions (not marked), group 19 (marked), loop 1 (marked).
  const time = page.locator('#by-pattern .cmp').first();
  await expect(time.locator('li').filter({ hasText: 'single' })).toContainText('n=20');
  await expect(time.locator('li').filter({ hasText: 'single' })).not.toContainText('under 20');
  await expect(time.locator('li.low')).toHaveCount(2);
  await expect(time.locator('li').filter({ hasText: 'group' })).toContainText('n=19, under 20');
  await expect(time.locator('p.note')).toContainText('Fewer than two groups have 20 or more sessions');
  // Two groups with 20 or more: the line names both.
  await load(page, [...many(20, { pattern: 'single', busyMs: 600000 }), ...many(20, { pattern: 'group', busyMs: 1200000 })]);
  await expect(page.locator('#by-pattern .cmp').first().locator('p.note')).toContainText('Highest group 20m (n=20), lowest single 10m (n=20)');
});

test('a setup comparison and the tier chart show n per bar; empty and one-project states', async ({ page }) => {
  const e = errors(page);
  await load(page, [...data(), row({ agent: 'codex', tier: null, costUSD: null })]);
  await expect(page.locator('#by-setup li').first()).toContainText(/n=\d+/);
  await expect(page.locator('#by-tier li').first()).toContainText(/n=\d+/);
  await page.getByLabel('Agent', { exact: true }).selectOption('codex');
  await page.getByLabel('Tier', { exact: true }).selectOption('standard');
  await expect(page.getByText('No sessions match these filters.')).toHaveCount(11);
  await expect(page.locator('#chart svg')).toHaveCount(0);
  // One project, one session.
  await load(page, [row()]);
  await expect(page.locator('#rail button.card:not(.all)')).toHaveCount(1);
  await expect(page.locator('#by-pattern')).toContainText('Fewer than two groups');
  await expect(page.locator('#calendar')).toContainText('1 active days of 84, longest streak 1 day');
  expect(e).toEqual([]);
});

test('the calendar counts active days and the longest streak', async ({ page }) => {
  await load(page, [0, 1, 2, 5, 6, 9].map((n) => row({ start: ago(n) })));
  await expect(page.locator('#calendar')).toContainText('6 active days of 84, longest streak 3 days');
});

test('a title stays text; the cost per merged pull request counts a pull request once', async ({ page }) => {
  const pr = { url: 'https://github.com/acme/shop/pull/7', state: 'merged' };
  await load(page, [row({ title: 'x </script><img src=x onerror=alert(1)>', prs: [pr], costUSD: 3 }), row({ prs: [pr], costUSD: 5, start: ago(2) })]);
  await expect(page.locator('#sessions')).toContainText('</script><img src=x');
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('#by-prpr')).toContainText('$8.00 (1 merged)');
  await expect(page.locator('#tiles .tile').filter({ hasText: 'Merged pull requests' })).toContainText('1');
});

for (const [name, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test(`no axe violations at ${name} width, system and chosen light and dark`, async ({ page }) => {
    await page.setViewportSize(size);
    await load(page, data(), ['/work/shop']);
    // The first chart tooltip and a hidden series: the states a pointer or key leaves behind.
    await page.locator('#chart').focus();
    await page.keyboard.press('End');
    for (const [scheme, theme] of [['light', null], ['dark', null], ['light', 'dark'], ['dark', 'light']]) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.evaluate((t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }, theme);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.map((v) => `${scheme}/${theme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('every chart has a table of values behind a button', async ({ page }) => {
  await load(page, data());
  for (const id of ['chart', 'by-tier', 'by-pattern', 'by-setup', 'by-prpr', 'by-model', 'dist-time', 'dist-turns', 'calendar']) {
    const d = page.locator(id === 'chart' ? '#chart-table' : `#${id}`).locator(id === 'chart' ? 'xpath=..' : 'details');
    await expect(d.first().locator('summary')).toHaveText('Table of values');
  }
});

test('5000 sessions: the page is ready quickly and its weight is stated', async ({ page }, info) => {
  const rows = Array.from({ length: 5000 }, (_, i) => row({ project: `/work/p${i % 9}`, pattern: ['single', 'group', 'loop'][i % 3], start: ago(i % 120, i % 24), busyMs: 60000 * (1 + (i % 90)), costUSD: (i % 17) / 3, turns: 1 + (i % 30), models: [['claude-sonnet-5-5'], ['claude-opus-5-5'], ['gpt-5.5']][i % 3], tests: [null, 'pass', 'fail'][i % 3], title: `Session ${i}` }));
  const html = boardHtml(rows, NOW);
  const t = Date.now();
  await page.setContent(html);
  await expect(page.locator('#sessions table')).toBeVisible();
  const ms = Date.now() - t;
  info.annotations.push({ type: 'weight', description: `${html.length} bytes, ready in ${ms} ms` });
  console.log(`5000 sessions: ${html.length} bytes, ready in ${ms} ms`);
  expect(ms).toBeLessThan(4000);
});
