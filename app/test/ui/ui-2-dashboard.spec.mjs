import { expect, test } from '@playwright/test';
import { nav } from './views.mjs';
import { noAxe, opened } from './chain.mjs';

test.describe('views', () => {
  opened(test);

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

  test('Dashboard: the status panel counts what needs attention and where, the health bar and the scopes follow; the flow folds away', async ({ page }) => {
    // The fixture has items in the global setup and a project: no one view shows both, so only the parts link.
    await expect(page.getByRole('link', { name: /items need attention/ })).toHaveCount(0);
    await expect(page.getByText(/^Global \d+, /).getByRole('link', { name: 'Global' })).toHaveAttribute('href', '#/agents?plan=1');
    await expect(page.getByRole('link', { name: /^\d+ doctor findings, open the Doctor section$/ })).toHaveAttribute('href', '#/dashboard?panel=doctor');
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

  test('Dashboard: the Set up menu holds the three one-run setups; no axe violations with it open, light and dark', async ({ page }) => {
    await page.getByRole('button', { name: 'Set up', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Set up everything', 'Set up global only', 'Set up projects']);
    await noAxe(page);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    // By keyboard: Enter opens the menu on its first item, the arrow keys move on, Enter opens that one-run mode (the third, Set up projects, has no global setup).
    await page.getByRole('button', { name: 'Set up', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(menu.getByRole('menuitem', { name: 'Set up everything' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'One-run setup' }).getByRole('checkbox', { name: 'Global setup' })).not.toBeChecked();
    await page.keyboard.press('Escape');
  });

  test('Dashboard: a project that cannot be read is named in the status panel, also when nothing else needs attention', async ({ page }) => {
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
    await expect(installed.getByRole('row', { name: /bk-ui-proj/ }).getByRole('link', { name: 'frontend' })).toHaveAttribute('href', '#/skills?pack=frontend');
    // The rows under the bar count what it draws.
    const health = page.getByRole('region', { name: 'Health' });
    await expect(health.getByRole('list', { name: 'Items by state, all scopes' }).getByRole('link', { name: /modified/ })).toBeVisible();
    // Coverage rows are the packs a project chose; the others are one line of links under the table.
    const coverage = page.getByRole('region', { name: 'Coverage' });
    const packRows = coverage.getByRole('table', { name: 'Pack coverage' }).locator('tbody tr');
    await expect(packRows.first()).toBeVisible();
    await expect(packRows.filter({ has: page.getByRole('link', { name: / for .*: \d+ projects?$/ }) })).toHaveCount(await packRows.count());
    await expect(coverage.getByText(/^In no project: /).getByRole('link', { name: 'Testing' })).toHaveAttribute('href', '#/skills?pack=testing');
    // A plugin pack has no skills to filter by: it opens Packs.
    await expect(coverage.getByText(/^In no project: /).getByRole('link', { name: 'Ponytail' })).toHaveAttribute('href', '#/packs');
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

  test('Skills opens with the pack and agent a link names', async ({ page }) => {
    await page.goto('/#/skills?pack=frontend&agent=codex');
    await expect(page.getByRole('combobox', { name: 'Pack' })).toHaveValue('Frontend');
    await expect(page.getByRole('combobox', { name: 'Agent' })).toHaveValue('Codex');
  });

  test('Dashboard: the Doctor section shows the worst three findings, errors first, one line each with its action, a link to all in Insights, and the full table folded', async ({ page }) => {
    // An info finding: it ranks after the warnings.
    const info = { level: 'info', check: 'allow-rules', message: 'Claude Code allows WebFetch', fix: 'information only, nothing is changed' };
    await page.route(/\/api\/doctor(\?|$)/, async (route) => route.fulfill({ json: [...await (await route.fetch()).json(), info] }));
    await page.reload();
    const doctor = page.getByRole('region', { name: 'Doctor' });
    const worst = doctor.getByRole('list', { name: 'Worst doctor findings' }).getByRole('listitem');
    await expect(worst).toHaveCount(3);
    await expect(worst.nth(0)).toContainText(/^error/i);
    await expect(worst.nth(1)).toContainText(/^error/i);
    await expect(worst.nth(2)).toContainText(/^warning/i);
    await expect(worst.getByRole('link', { name: /^(Plan fix|Review removal|Open settings|Plan project)$/ }).first()).toBeVisible();
    for (const line of await worst.all()) expect(await line.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(40);
    const count = (await page.getByRole('banner').getByRole('link', { name: /^Doctor: / }).textContent()).match(/\d+/g).map(Number).reduce((a, b) => a + b);
    await expect(doctor.getByRole('link', { name: `All ${count} in Insights` })).toHaveAttribute('href', '#/insights');
    await expect(page.getByText('items need attention', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Counts /)).toHaveCount(0);
    await expect(doctor.getByRole('table', { name: 'Doctor findings' })).toBeHidden();
    // A link to the section (the header's doctor count) opens the table.
    await page.getByRole('banner').getByRole('link', { name: /^Doctor: / }).click();
    await expect(doctor.getByRole('table', { name: 'Doctor findings' })).toBeVisible();
    // Closed again, the same link opens it again.
    await doctor.getByText('Every finding with its fix').click();
    await expect(doctor.getByRole('table', { name: 'Doctor findings' })).toBeHidden();
    await expect(page).toHaveURL(/#\/dashboard$/);
    await page.getByRole('banner').getByRole('link', { name: /^Doctor: / }).click();
    await expect(doctor.getByRole('table', { name: 'Doctor findings' })).toBeVisible();
  });

  test('Dashboard: a doctor finding opens the plan that fixes it', async ({ page }) => {
    const doctor = page.getByRole('region', { name: 'Doctor' });
    await doctor.getByText('Every finding with its fix').click();
    await doctor.getByRole('row', { name: /Claude Code rules/ }).getByRole('link', { name: 'Plan fix' }).click();
    await expect(page.getByRole('region', { name: 'Changes' })).toContainText('Claude Code rules');
    await expect(page.getByRole('banner').getByRole('link', { name: /^Doctor: \d+ errors?, \d+ warnings?$/ })).toBeVisible();
  });

  test('Dashboard: Dismiss moves a doctor finding under Dismissed, Show again brings it back', async ({ page }) => {
    const doctor = page.getByRole('region', { name: 'Doctor' });
    await doctor.getByText('Every finding with its fix').click();
    const table = doctor.getByRole('table', { name: 'Doctor findings' });
    // Only an opinion has Dismiss; a missing part of the setup is declined in the plan instead.
    await expect(table.getByRole('row', { name: /Claude Code rules/ }).getByRole('button', { name: /^Dismiss: / })).toHaveCount(0);
    const engine = table.getByRole('row', { name: /no container engine/ });
    await engine.getByRole('button', { name: 'Dismiss: no container engine (podman or docker)' }).click();
    await expect(engine).toHaveCount(0);
    await doctor.getByRole('button', { name: /^Dismissed \(\d+\)$/ }).click();
    await doctor.getByRole('list', { name: 'Dismissed doctor findings' }).getByRole('button', { name: 'Show again: no container engine (podman or docker)' }).click();
    await expect(engine).toHaveCount(1);
  });

  test('Dashboard: a doctor cell shows the action, a source URL sits behind a link, a run id opens History', async ({ page }) => {
    await page.getByRole('region', { name: 'Doctor' }).getByText('Every finding with its fix').click();
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
    await page.goto('/#/dashboard?panel=doctor');
    await page.reload();
    const badge = page.getByRole('banner').getByRole('link', { name: /^Doctor: / });
    await expect(badge).toHaveText(/^Doctor: \d+ errors?, \d+ warnings?, 1 info$/);
    const counts = (await badge.textContent()).slice('Doctor: '.length);
    await expect(page.getByRole('region', { name: 'Doctor' }).getByRole('row', { name: /allows WebFetch/ }).locator('.bk-dot')).toHaveAttribute('style', /--mantine-color-blue-filled/);
    await expect(page.getByText(counts, { exact: true })).toHaveCount(2);
    await nav(page, 'Insights').click();
    await expect(page.getByText(new RegExp(`^\\d+ findings: ${counts}\\. Do first: `))).toBeVisible();
  });

  test('Insights: the summary names the count and the first finding, findings are grouped by severity and area; errors are cards, warnings are one-line rows whose title opens the evidence and fix and whose More menu holds Dismiss and Snooze; a long path shows its last parts, in full on hover and in the opened row; a card names its action as the Doctor table does and links its fix source, the action opens the plan, Dismiss and Snooze hide a card and a reload keeps it, Show again brings it back; focus moves to the next finding or the list and the status says what happened; other evidence and an ended snooze show; no axe violations', async ({ page }) => {
    await nav(page, 'Insights').click();
    const card = (re) => page.getByRole('article', { name: re });
    const market = card(/marketplace benchkeeper$/), deny = card(/No Read deny rule/), scrub = card(/SUBPROCESS_ENV_SCRUB/);
    // The seeded dismissal belongs to other evidence and the seeded snooze has ended: both findings show.
    await expect(deny).toBeVisible();
    await expect(scrub).toBeVisible();
    await expect(deny.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', /^#\/agent-settings/);
    // By default a warning is one line: its title, its fix button and More; an error card shows Dismiss and Snooze.
    await expect(deny).not.toContainText('permissions.deny');
    await expect(deny.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
    await expect(deny.getByRole('button', { name: 'More' })).toBeVisible();
    await expect(market.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    const toggle = deny.getByRole('button', { name: /No Read deny rule/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(deny).toContainText('permissions.deny');
    // A changed-file warning names the file by its last two path parts; the hover and the opened row hold the full path.
    const changed = card(/^\u2026\/rules\/00-global\.md changed since run /);
    const path = await changed.getByRole('button', { name: /00-global\.md/ }).getAttribute('title');
    expect(path).toMatch(/^\/.+\/\.claude\/rules\/00-global\.md changed since run /);
    await changed.getByRole('button', { name: /00-global\.md/ }).click();
    await expect(changed).toContainText(path);
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
    await scrub.getByRole('button', { name: 'More' }).focus();
    await page.keyboard.press('Enter');
    // The menu takes focus once it has opened; the arrow keys then move through its items.
    await page.waitForFunction(() => document.activeElement?.closest('[role="menu"]'));
    await page.keyboard.press('ArrowDown');
    await expect(scrub.getByRole('menuitem', { name: 'Dismiss' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(scrub.getByRole('menuitem', { name: 'Snooze 7 days' })).toBeFocused();
    // The snooze ends 7 days from the click; read the date on both sides of it, as the click may fall on midnight UTC.
    const week = () => new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const weeks = [week()];
    await page.keyboard.press('Enter');
    await expect(scrub).toHaveCount(0);
    weeks.push(week());
    await expect(page.locator(`[id="${next}"]`)).toBeFocused();
    await expect(status).toHaveText(/^Snoozed for 7 days: .*SUBPROCESS_ENV_SCRUB/);
    await page.reload();
    await expect(deny).toBeVisible();
    await expect(market).toHaveCount(0);
    await expect(scrub).toHaveCount(0);
    const hidden = page.getByRole('region', { name: 'Dismissed and snoozed findings' });
    await hidden.getByRole('button', { name: 'Dismissed and snoozed (2)' }).click();
    await expect(hidden).toContainText('Dismissed');
    await expect(hidden).toContainText(new RegExp(`Snoozed until (${weeks.join('|')})`));
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
    await expect(page.getByRole('article', { name: /SUBPROCESS_ENV_SCRUB/ }).getByRole('button', { name: 'More' })).toBeDisabled();
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
    const scrub = page.getByRole('article', { name: /SUBPROCESS_ENV_SCRUB/ });
    await scrub.getByRole('button', { name: 'More' }).click();
    await scrub.getByRole('menuitem', { name: 'Dismiss' }).click();
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

  test('a 401 (a restarted server, another browser) says to start the app again, with no Try again', async ({ page }) => {
    await page.route(/\/api\/overview(\?|$)/, (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"no session"}' }));
    await page.reload();
    await expect(page.getByText(/Run npx benchkeeper again and open the link it prints/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
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
});
