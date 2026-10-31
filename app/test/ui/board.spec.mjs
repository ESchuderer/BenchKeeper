// The sessions board page on its own, with generated rows (the app's frame is covered in ui-1-shell.spec.mjs).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { boardHtml } from '../../src/board.mjs';
import { CODEX_PRICES } from '../../src/sessions.mjs';

const NOW = '2026-10-28T12:00:00.000Z';
const ago = (days, hour = 10) => `${new Date(Date.parse(NOW) - days * 864e5).toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00.000Z`;
let seq = 0;
const row = (o = {}) => ({ agent: 'claude', id: `s${seq++}`, project: '/work/shop', branch: 'main', agentVersion: '2.1.0', start: ago(1), end: ago(1, 11), turns: 3, models: ['claude-sonnet-5-5'], costUSD: 2, busyMs: 600000, tokens: 1000,
  tier: { first: 'standard', last: 'standard', changeType: 'feature', movedUp: false }, skills: [], tests: 'pass', setup: ['BenchKeeper'], setupVersion: '6.24.0', pattern: 'single', subagents: 0, run: null, prs: [], title: 'Fix', ...o });
const many = (n, o, spread = 25) => Array.from({ length: n }, (_, i) => row({ ...(typeof o === 'function' ? o(i) : o), start: ago(1 + (i % spread)) }));
// Current period (30 days): shop 20 single, blog 19 group, api 1 loop. Previous 30 days: 10 shop sessions.
// Turns of the api session and one blog session overlap for 5 minutes; the api session waited 20 minutes for a usage limit.
const T = Date.parse(ago(0, 11)) / 1000;
const data = () => [
  ...many(20, { project: '/work/shop', pattern: 'single' }),
  ...many(19, (i) => ({ project: '/work/blog', pattern: 'group', tests: i % 2 ? 'pass' : 'fail', prs: i === 0 ? ['https://github.com/acme/blog/pull/9'] : [], branch: i < 5 ? 'feat/x' : 'main', ...(i === 0 && { active: [[T + 300, T + 900]], limits: [] }) })),
  row({ project: '/work/api', pattern: 'loop', start: ago(0, 11), active: [[T, T + 600]], limits: [[T, T + 1200, null]] }),
  ...Array.from({ length: 10 }, (_, i) => row({ project: '/work/shop', start: ago(31 + i) })),
];
// Registered projects as registeredPaths() gives them; the fixture's three by default.
const reg = (...paths) => paths.map((path) => ({ path, worktrees: [] }));
const load = async (page, rows, registered = reg('/work/shop', '/work/blog', '/work/api')) => { await page.setContent(boardHtml(rows, NOW, registered)); await expect(page.locator('#count')).toContainText(/sessions/); };
const errors = (page) => { const e = []; page.on('pageerror', (x) => e.push(x.message)); return e; };

test('the rail lists projects newest first with count and last tier; a click filters everything and a second click clears it', async ({ page }) => {
  const e = errors(page);
  await load(page, data());
  const cards = page.locator('#rail button.card:not(.all)');
  await expect(cards).toHaveCount(3);
  // No project is older than 30 days: no Show older and no stray text in its place.
  await expect(page.locator('#rail-list')).not.toContainText(/null|Show older/);
  await expect(cards.first()).toContainText('api');
  await expect(cards.nth(1)).toHaveAccessibleDescription(/20 sessions, last tier standard/);
  // One line: dot, name, last tier, sparkline and the session count.
  await expect(cards.nth(1).locator('.psub')).toHaveText('standard');
  await expect(cards.nth(1).locator('.pcount')).toHaveText('20');
  expect((await cards.nth(1).boundingBox()).height).toBeLessThanOrEqual(34);
  await cards.filter({ hasText: 'blog' }).click();
  await expect(cards.filter({ hasText: 'blog' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#count')).toHaveText('19 of 19 sessions');
  await expect(page.locator('#tiles .tile').first()).toContainText('19');
  // The project page: branches and their pull requests.
  await expect(page.getByRole('heading', { level: 2, name: 'Project blog' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Branches, newest first' })).toContainText('feat/x');
  await expect(page.locator('#project-body')).toContainText('1 pull requests');
  await expect(page.getByRole('table', { name: 'Branches, newest first' })).toContainText('#9');
  await cards.filter({ hasText: 'blog' }).click();
  await expect(page.locator('#count')).toHaveText('40 of 40 sessions');
  await expect(page.locator('#project-page')).toBeHidden();
  expect(e).toEqual([]);
});

test('one entry per repository: worktrees fold in, also a removed one, the same folder name adds its parent, a plain folder goes under Other; the registered one comes first; Registered only keeps it', async ({ page }) => {
  const e = errors(page);
  // /wt/shop-b was removed after its session: its repository came from the cache. A row cached without one folds in by the registered worktree list.
  const rows = [
    row({ project: '/home/u', repo: null, start: ago(0) }),
    row({ project: '/wt/shop-a', repo: '/src/shop', start: ago(1) }),
    row({ project: '/old/shop', repo: '/old/shop', start: ago(2) }),
    row({ project: '/wt/shop-b', repo: '/src/shop', start: ago(3) }),
    row({ project: '/wt/shop-a', start: ago(4) }),
  ];
  await load(page, rows, [{ path: '/src/shop', worktrees: ['/wt/shop-a'] }]);
  const cards = page.locator('#rail button.card:not(.all)');
  const sessions = page.locator('#tiles .tile').first().locator('.value');
  await expect(page.locator('#f-project')).toHaveCount(0);
  expect(await cards.evaluateAll((els) => els.map((e) => [e.querySelector('.pname').textContent, document.getElementById(e.getAttribute('aria-describedby')).textContent]))).toEqual([
    ['src/shop', expect.stringMatching(/^3 sessions, 2 worktrees, last tier/)], ['old/shop', expect.stringMatching(/^1 session, last tier/)], ['Other', expect.stringMatching(/^1 session, 1 folder, last tier/)]]);
  await expect(page.locator('#rail-list > *').first()).toHaveText('Recent');
  await expect(page.locator('#rail-list > *').nth(2)).toHaveClass('card all');
  // A choice the switch hides falls back to All.
  await cards.filter({ hasText: 'old/shop' }).click();
  await page.getByLabel('Registered only').check();
  await expect(cards).toHaveCount(1);
  await expect(cards).toHaveAccessibleDescription(/^3 sessions, 2 worktrees/);
  await expect(page.locator('#rail button.all')).toHaveText('All registered projects');
  await expect(page.locator('#rail button.all')).toHaveAttribute('aria-pressed', 'true');
  await expect(sessions).toHaveText('3');
  await expect(page.locator('#count')).toHaveText('3 of 3 sessions');
  await page.getByLabel('Registered only').uncheck();
  await expect(sessions).toHaveText('5');
  // Nothing registered: the switch is off and disabled, with the reason beside it.
  await load(page, rows, []);
  await expect(page.getByLabel('Registered only')).toBeDisabled();
  await expect(page.getByLabel('Registered only')).toHaveAccessibleDescription('No project is registered in the app.');
  await expect(cards).toHaveCount(3);
  expect(e).toEqual([]);
});

// 300 worktree folders over 12 repositories, two of them registered; r11 and its folders last ran 40 days ago.
const fleet = () => Array.from({ length: 300 }, (_, i) => row({ repo: `/src/r${i % 12}`, project: `/wt/r${i % 12}/w${i}`, start: ago(i % 12 === 11 ? 40 : 1 + (i % 12)) }));

test('300 folders over 12 repositories: registered first, All, one entry per repository that expands to its folders, a search narrows it, the full path on hover', async ({ page }) => {
  const e = errors(page);
  await load(page, fleet(), reg('/src/r3', '/src/r7'));
  await page.getByLabel('Period').selectOption('all');
  const cards = page.locator('#rail button.card:not(.all)');
  await expect(cards).toHaveCount(12);
  await expect(page.locator('#rail-list > .item .card')).toHaveText([/^r3/, /^r7/, /^r0/, /^r1/, /^r2/, /^r4/, /^r5/, /^r6/, /^r8/, /^r9/, /^r10/]);
  await expect(page.locator('#rail-list > .item').nth(2).locator('xpath=preceding-sibling::*[1]')).toHaveClass('card all');
  await expect(cards.first()).toHaveAttribute('title', '/src/r3');
  await expect(cards.first()).toHaveAccessibleDescription(/25 sessions, 25 worktrees/);
  // Under Show older: r11, its newest session 40 days old.
  await expect(page.locator('.older summary')).toHaveText('Show older (1)');
  await expect(page.locator('.older .card')).toHaveText(/^r11/);
  // A repository expands to its folders, each by its short name with the full path as the tooltip.
  const r5 = page.locator('.item').filter({ has: page.locator('.card[title="/src/r5"]') });
  await r5.getByRole('button', { name: 'Folders of r5' }).click();
  await expect(r5.getByRole('button', { name: 'Folders of r5' })).toHaveAttribute('aria-expanded', 'true');
  await expect(r5.locator('.folder')).toHaveCount(25);
  await expect(r5.locator('.folder').first()).toHaveAttribute('title', '/wt/r5/w101');
  await expect(r5.locator('.folder').first()).toHaveText('w101 1');
  // The same rows as a click on the repository did before; a folder narrows to its own.
  await cards.filter({ hasText: /^r5/ }).click();
  await expect(page.locator('#count')).toHaveText('25 of 25 sessions');
  await r5.locator('.folder').first().click();
  await expect(page.locator('#count')).toHaveText('1 of 1 sessions');
  await expect(page.locator('#rail-toggle')).toContainText('r5 / w101');
  // A search by name or path; a folder match shows that folder under its repository.
  await page.getByLabel('Find a project').fill('r7');
  await expect(page.locator('#rail-list .item:visible .card')).toHaveText([/^r7/]);
  await page.getByLabel('Find a project').fill('w299');
  await expect(page.locator('#rail-list .item:visible .card')).toHaveText([/^r11/]);
  await expect(page.locator('.folder:visible')).toHaveText(['w299 1']);
  await page.getByLabel('Find a project').press('Escape');
  await expect(page.getByLabel('Find a project')).toHaveValue('');
  await expect(cards.filter({ visible: true })).toHaveCount(12);
  expect(e).toEqual([]);
});

test('no side scroll with 300 folders over 12 repositories, folders of no repository and a long name, at desktop and phone width', async ({ page }) => {
  const rows = [...fleet(), ...Array.from({ length: 6 }, (_, i) => row({ repo: null, project: `/home/u/scratch-${i}` })), row({ repo: '/src/r0', project: `/wt/r0/${'very-long-worktree-name-'.repeat(8)}` })];
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await load(page, rows, reg('/src/r3', '/src/r7'));
  await page.getByLabel('Period').selectOption('all');
  await expect(page.locator('#rail button.card:not(.all)').last()).toHaveAccessibleDescription(/^6 sessions, 6 folders/);
  await page.getByRole('button', { name: 'Folders of r0' }).click();
  await page.getByRole('button', { name: 'Folders of Other' }).click();
  expect(await fits()).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#rail-toggle').click();
  await expect(page.locator('#rail-toggle')).toHaveText(/^All projects, 12 projects/);
  expect(await fits()).toBe(true);
});

test('at phone width the list opens as a popover with the search first and Recent above the entries; the search hides Recent and a click outside closes it', async ({ page }) => {
  await load(page, data());
  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.locator('#rail-toggle');
  await toggle.click();
  await expect(page.getByLabel('Find a project')).toBeFocused();
  expect(await page.locator('#rail-panel').evaluate((n) => getComputedStyle(n).position)).toBe('absolute');
  await expect(page.locator('#rail-list .gh')).toHaveText('Recent');
  await page.getByLabel('Find a project').fill('blog');
  await expect(page.locator('#rail-list .gh')).toBeHidden();
  await page.mouse.click(380, 830);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#rail-panel')).toBeHidden();
});

test('framed at phone width, the project chip with a long chosen name wraps inside the frame', async ({ page }) => {
  const long = `/work/${'verylongprojectname'.repeat(6)}`;
  const html = boardHtml([row({ project: long, repo: long }), row()], NOW, reg(long, '/work/shop'));
  await page.route('http://board.test/', (r) => r.fulfill({ body: '<iframe src="/board" style="width:390px;height:800px;border:0"></iframe>', contentType: 'text/html' }));
  await page.route('http://board.test/board', (r) => r.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('http://board.test/');
  const board = page.frameLocator('iframe');
  await board.getByRole('button', { name: 'Filters' }).click();
  await board.locator('#rail-toggle').click();
  await board.locator(`.card[title="${long}"]`).click();
  await expect(board.locator('#rail-toggle')).toHaveText(/^verylongprojectname/);
  expect(await board.locator('html').evaluate((d) => d.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('framed, the filters stand in a column beside the figures; at phone width one Filters button opens them, and Escape or a click outside closes them', async ({ page }) => {
  const html = boardHtml([row()], NOW, []);
  await page.route('http://board.test/', (r) => r.fulfill({ body: '<iframe src="/board" style="width:1000px;height:800px;border:0"></iframe>', contentType: 'text/html' }));
  await page.route('http://board.test/board', (r) => r.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('http://board.test/');
  const board = page.frameLocator('iframe');
  const filters = board.locator('#filters'), toggle = board.getByRole('button', { name: 'Filters' });
  await expect(toggle).toBeHidden();
  await expect(filters).toBeVisible();
  const f = await filters.boundingBox(), t = await board.locator('#tiles').boundingBox();
  expect(t.x).toBeGreaterThanOrEqual(f.x + f.width);
  await page.locator('iframe').evaluate((e) => { e.style.width = '390px'; });
  await expect(toggle).toBeVisible();
  await expect(filters).toBeHidden();
  await toggle.click();
  await expect(filters).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await board.locator('#rail-toggle').click();
  await page.keyboard.press('Escape');
  await expect(board.locator('#rail-panel')).toBeHidden();
  await expect(filters).toBeVisible();
  await board.locator('#f-agent').focus();
  await page.keyboard.press('Escape');
  await expect(filters).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await board.locator('#tiles').click();
  await expect(filters).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await board.locator('#tiles summary').focus();
  await page.keyboard.press('Escape');
  await expect(filters).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('the last choice is remembered, chosen with the keyboard, and named on the project page after a reload', async ({ page }) => {
  const html = boardHtml(fleet(), NOW, reg('/src/r3'));
  await page.route('http://board.test/', (r) => r.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('http://board.test/');
  const r5 = page.locator('.card[title="/src/r5"]');
  await r5.focus();
  await page.keyboard.press('Enter');
  await expect(r5).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(r5).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Project r5' })).toBeVisible();
  await expect(page.locator('#count')).toHaveText('25 of 25 sessions');
  await page.locator('#rail button.all').press('Enter');
  await page.reload();
  await expect(page.locator('#rail button.all')).toHaveAttribute('aria-pressed', 'true');
});

test('a repository with one folder has no count of worktrees and nothing to expand; the keyboard moves through the list and opens a repository', async ({ page }) => {
  await load(page, [row({ repo: '/src/one', project: '/src/one', start: ago(0) }), row({ repo: '/src/two', project: '/wt/a' }), row({ repo: '/src/two', project: '/wt/b' })], []);
  const one = page.locator('.item').filter({ has: page.locator('.card[title="/src/one"]') });
  await expect(one.locator('.card')).toHaveAccessibleDescription(/^1 session, last tier/);
  await expect(one.locator('.exp')).toHaveCount(0);
  await page.getByLabel('Find a project').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#rail button.all')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.card[title="/src/one"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: 'Folders of two' })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.folder')).toHaveCount(2);
  await expect(page.locator('.folder').first()).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.folder').first()).toBeHidden();
});

test('at phone width the rail is one button with the choice that opens the list; Escape closes it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page, data());
  const toggle = page.locator('#rail-toggle');
  await expect(toggle).toHaveText(/^All projects, 3 projects/);
  await expect(page.getByLabel('Find a project')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Find a project')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator('#rail button.card:not(.all)').filter({ hasText: 'blog' }).click();
  await expect(toggle).toHaveText(/^blog, 3 projects/);
  await expect(page.getByLabel('Find a project')).toBeHidden();
  await expect(page.locator('#count')).toHaveText('19 of 19 sessions');
});

test('quick facts first, then test runs; each shows the change against the previous period of the same length; All time has none', async ({ page }) => {
  await load(page, data());
  const tile = (name) => page.locator('#tiles .tile').filter({ has: page.locator('.label', { hasText: new RegExp(`^${name}$`) }) });
  await expect(page.locator('#tiles > .facts .label')).toHaveText(['Sessions', 'Agent time', 'Cost', 'Tokens']);
  await expect(page.locator('#tiles details.more')).not.toHaveJSProperty('open', true);
  await page.locator('#tiles summary', { hasText: 'More figures' }).click();
  await expect(page.locator('#tiles details.more > .facts:not(.small) .label')).toHaveText(['Agents at once', 'Busiest day', 'Active days', 'Blocked by limits']);
  await expect(page.locator('#tiles .small .label')).toHaveText(['Most used agent', 'Longest streak', 'Tests passed']);
  await expect(tile('Sessions')).toContainText('+300% vs previous 30 days');
  await expect(tile('Sessions')).toContainText('40');
  await expect(tile('Most used agent')).toContainText('Claude Code40 of 40 sessions');
  // 20 minutes of turns over 15 minutes of wall-clock; sessions cached before these were read are left out.
  await expect(tile('Agents at once')).toContainText('1.3on average while any turn ran, peak 2');
  await expect(tile('Blocked by limits')).toContainText('20m1 usage limit wait across sessions, Claude Code only');
  await expect(tile('Active days')).toContainText('of 30 days');
  await expect(tile('Tests passed')).toContainText('points vs previous 30 days');
  await expect(page.locator('#history')).toBeHidden();
  await page.getByLabel('Period').selectOption('7');
  await expect(tile('Sessions')).toContainText('vs previous 7 days');
  await expect(page.locator('#tiles details.more')).toHaveJSProperty('open', true);
  await page.getByLabel('Period').selectOption('all');
  await expect(tile('Sessions')).toContainText('50');
  await expect(page.locator('#tiles .delta', { hasText: /vs previous/ })).toHaveCount(0);
});

test('a metric switch redraws the stream; a legend chip hides its series and says so; the table follows', async ({ page }) => {
  await load(page, data());
  await page.locator('#metric').selectOption('sessions');
  await expect(page.locator('#chart svg')).toHaveAttribute('aria-label', /^Sessions per day by project/);
  const chips = page.locator('#legend button.chip');
  await expect(chips).toHaveCount(3);
  await expect(page.locator('#chart-table th[scope=col]')).toContainText(['Day', 'shop', 'blog', 'api', 'Total']);
  await chips.filter({ hasText: 'shop' }).click();
  await expect(chips.filter({ hasText: 'shop' })).toHaveAttribute('aria-pressed', 'false');
  await expect(chips.filter({ hasText: 'shop' })).toBeFocused();
  await expect(page.locator('#chart-table th[scope=col]')).not.toContainText(['shop']);
  await chips.filter({ hasText: 'shop' }).click();
  await expect(chips.filter({ hasText: 'shop' })).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.getByText('No sessions match these filters.')).toHaveCount(10);
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

test('a title stays text; a pull request shows as its number', async ({ page }) => {
  const pr = 'https://github.com/acme/shop/pull/7';
  await load(page, [row({ title: 'x </script><img src=x onerror=alert(1)>', prs: [pr], costUSD: 3 }), row({ prs: [pr], costUSD: 5, start: ago(2) })]);
  await expect(page.locator('#sessions')).toContainText('</script><img src=x');
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.locator('#sessions')).toContainText('#7');
});

test('more than 6 repositories: 6 series and Other, which the legend explains; the legend and the Show select work with the keyboard', async ({ page }) => {
  const e = errors(page);
  await load(page, Array.from({ length: 9 }, (_, p) => many(9 - p, { project: `/work/p${p}`, repo: `/work/p${p}` }, 5)).flat(), []);
  const chips = page.locator('#legend button.chip');
  await expect(chips).toHaveText(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'Other (3 more projects)']);
  await page.locator('#metric').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#metric')).toHaveValue('time');
  await chips.first().focus();
  await page.keyboard.press('Enter');
  await expect(chips.first()).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#chart-table th[scope=col]')).not.toContainText(['p0']);
  expect(e).toEqual([]);
});

test('Stack by switches the chart between projects and agents and the legend follows; the agent filter is All by default', async ({ page }) => {
  await load(page, [...data(), row({ agent: 'codex', costUSD: null, project: '/work/api' })]);
  await expect(page.getByLabel('Agent', { exact: true })).toHaveValue('');
  await page.locator('#metric').selectOption('sessions');
  await page.getByRole('button', { name: 'Agent', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Agent', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#legend button.chip')).toHaveText(['Claude Code', 'Codex']);
  await expect(page.locator('#chart svg')).toHaveAttribute('aria-label', 'Sessions per day by agent');
  await expect(page.locator('#tiles .tile').filter({ hasText: 'Cost' })).toContainText('1 Codex session without a cost');
  await page.getByRole('button', { name: 'Project', exact: true }).click();
  await expect(page.locator('#legend button.chip')).toHaveText(['shop', 'blog', 'api']);
});

test('an estimated Codex cost is summed, marked in its row and named in the cost note with the price date', async ({ page }) => {
  await load(page, [row({ costUSD: 2 }), row({ agent: 'codex', title: 'Estimated', costUSD: 0.5, costEstimated: true }), row({ agent: 'codex', costUSD: null })]);
  const cost = page.locator('#tiles .tile').filter({ hasText: 'Cost' });
  await expect(cost).toContainText('$2.50');
  await expect(cost).toContainText(`Codex estimated at OpenAI API prices of ${CODEX_PRICES.date}, priced models only; 1 Codex session without a cost`);
  await expect(page.locator('#sessions tr').filter({ hasText: 'Estimated' })).toContainText('$0.50 (estimated)');
});

test('no session before the period: no change text on any card and one History starts line under the header', async ({ page }) => {
  await load(page, data().slice(0, 40));
  await expect(page.locator('#tiles .delta', { hasText: /vs previous/ })).toHaveCount(0);
  await expect(page.locator('#history')).toBeVisible();
  await expect(page.locator('#history')).toHaveText(/^History starts 2026-10-08: older sessions are no longer on this machine \(Claude Code keeps transcripts for 30 days, cleanupPeriodDays\)\.$/);
  // A filter whose previous window is empty while the machine has older sessions: no change text and no history line.
  await load(page, data());
  await page.getByLabel('Pattern', { exact: true }).selectOption('group');
  await expect(page.locator('#tiles .delta', { hasText: /vs previous/ })).toHaveCount(0);
  await expect(page.locator('#history')).toBeHidden();
});

test('the export card: names hidden by default, shown on request, theme from the page or the dialog, saved as PNG and SVG without a network request', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => { if (!r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url()); });
  await load(page, [...data(), row({ project: '/home/alice/secret-repo', title: 'Prompt text here', start: ago(2) })]);
  await page.getByRole('button', { name: 'Export card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export card' });
  await expect(dialog).toBeVisible();
  const src = () => page.locator('#x-preview svg').evaluate((n) => n.outerHTML);
  let svg = await src();
  expect(svg).toContain('Project A');
  for (const leak of ['shop', 'blog', 'api', 'secret-repo', '/home', 'alice', 'Prompt text']) expect(svg).not.toContain(leak);
  await expect(page.locator('#x-preview svg')).toHaveAttribute('width', '1200');
  await dialog.getByLabel('Show project names').check();
  svg = await src();
  expect(svg).toContain('>shop<');
  for (const leak of ['/work', '/home', 'alice', 'Prompt text']) expect(svg).not.toContain(leak);
  await dialog.getByLabel('Theme').selectOption('dark');
  expect(await src()).toContain('#17181c');
  const [png] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Save PNG' }).click()]);
  expect(png.suggestedFilename()).toBe('sessions-card.png');
  const bytes = Buffer.concat(await (await png.createReadStream()).toArray());
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
  const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Save SVG' }).click()]);
  expect(file.suggestedFilename()).toBe('sessions-card.svg');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  expect(requests).toEqual([]);
});

for (const [name, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test(`no axe violations at ${name} width, system and chosen light and dark`, async ({ page }) => {
    await page.setViewportSize(size);
    await load(page, data(), reg('/work/shop'));
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

test('every chart has a table for screen readers and a CSV download of the same rows; no table of values is left; the heatmap comes before the per-project chart', async ({ page }) => {
  await load(page, data());
  await expect(page.locator('details summary', { hasText: 'Table of values' })).toHaveCount(0);
  const order = await page.locator('section h2').allTextContents();
  expect(order.indexOf('Activity, last 12 weeks')).toBeLessThan(order.indexOf('Per day by project'));
  await expect(page.locator('#calendar .tick')).toContainText(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Aug', 'Sep', 'Oct']);
  for (const id of ['chart-table', 'by-tier', 'by-pattern', 'by-setup', 'by-model', 'dist-time', 'dist-turns', 'calendar']) {
    const box = page.locator(`#${id}`);
    for (const [i, t] of (await box.locator('.sr table').all()).entries()) {
      const rows = await t.locator('tr').evaluateAll((trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent)));
      const [download] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: /^Download data \(CSV\)/ }).nth(i).click()]);
      const csv = (await (await download.createReadStream()).toArray()).join('');
      expect(csv).toBe(`${rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')).join('\r\n')}\r\n`);
    }
    await expect(box.getByRole('button', { name: /^Download data \(CSV\)/ }).first()).toBeVisible();
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

test('Ponytail ledger: the source is named per row and its figures sit in their own column, only when a row has them', async ({ page }) => {
  const e = errors(page);
  await load(page, data().slice(0, 3));
  await expect(page.locator('#sessions th')).not.toContainText(['Ponytail ledger']);
  const ledger = { costUSD: 2.32, turns: 4, agentMinutes: 8.7, reusePct: 8, tests: 'pass', level: 'full' };
  await load(page, [row({ title: 'Both', source: 'transcript and Ponytail ledger', ponytail: ledger }), row({ title: null, agent: 'claude', source: 'Ponytail ledger only', ponytail: { ...ledger, costUSD: null, reusePct: null, agentMinutes: null, tests: null, level: null } }), row({ title: 'Plain', source: 'transcript' })]);
  await expect(page.locator('#sessions th')).toContainText(['Source', 'Ponytail ledger']);
  const rows = page.locator('#sessions tbody tr');
  await expect(rows.filter({ hasText: 'Both' })).toContainText('transcript and Ponytail ledger');
  await expect(rows.filter({ hasText: 'Both' })).toContainText('$2.32, 4 turns, 8.7m, reuse 8%, pass, full');
  await expect(rows.filter({ hasText: 'Ponytail ledger only' })).toContainText('4 turns');
  await expect(rows.filter({ hasText: 'Plain' })).toContainText('transcript');
  expect(e).toEqual([]);
});
