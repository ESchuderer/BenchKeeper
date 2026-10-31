import { expect, test } from '@playwright/test';
import { nav } from './views.mjs';
import { noAxe, openDiffs, opened } from './chain.mjs';

test.describe('views', () => {
  opened(test);

  test('History: a run report with numbered diffs, split or unified; undo of one step, then of the run', async ({ page }) => {
    await nav(page, 'History').click();
    // The fixture's global setup, the oldest global run: other tests apply global plans of their own.
    await page.getByRole('navigation', { name: 'Runs' }).getByRole('link', { name: /^Apply: global setup/ }).last().click();
    const run = page.getByRole('region', { name: /^Run / });
    await expect(run.getByRole('article', { name: /Claude Code rules/ })).toBeVisible();
    await expect(run.getByRole('group', { name: 'Summary' })).toContainText(/\d+ done/);
    // Steps open folded: each names its file and line counts, the diff opens on demand.
    await expect(run.getByRole('group', { name: /^Diff of / })).toHaveCount(0);
    await expect(run.getByRole('article', { name: /^Ponytail level/ })).toContainText(/ponytail\/config\.json \+4 -0/);
    await openDiffs(run);
    await expect(run.getByRole('button', { name: /^Hide file diff of / }).first()).toHaveAttribute('aria-expanded', 'true');
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

  test('Fix everything: the Apply step tells a project written in its checkout from one that gets a branch', async ({ page }) => {
    const project = (name, extra) => ({ path: `/work/${name}`, setupVersion: '0.1.0', current: false, changes: [], repo: true, clean: true, ...extra });
    await page.route(/\/api\/projects(\?|$)/, (route) => route.fulfill({ json: [project('local-a'), project('local-b'), project('shared', { share: true }), project('shared-local', { share: true }), project('no-github', { share: true })] }));
    await page.getByRole('button', { name: 'Fix everything' }).click();
    const fix = page.getByRole('dialog', { name: 'Fix everything' });
    const summary = fix.getByRole('list', { name: 'What Apply does' });
    await fix.getByRole('button', { name: 'Next' }).click();
    await fix.getByRole('checkbox', { name: 'local-a' }).check();
    await fix.getByRole('button', { name: 'Next' }).click();
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(summary).toContainText('Projects: 1 written in their checkout');
    await expect(summary).not.toContainText('as a branch');
    await fix.getByRole('button', { name: 'Back' }).click();
    await fix.getByRole('button', { name: 'Back' }).click();
    await fix.getByRole('button', { name: 'Select all' }).click();
    await fix.getByRole('button', { name: 'Next' }).click();
    await fix.getByRole('button', { name: 'Next' }).click();
    await expect(summary).toContainText('Projects: 2 written in their checkout, 3 as a branch');
    await page.keyboard.press('Escape');
  });

  test('an apply in Global setup shows up in History and the header without a reload', async ({ page }) => {
    await nav(page, 'History').click();
    const runs = page.getByRole('navigation', { name: 'Runs' }).getByRole('link');
    await expect(runs.first()).toBeVisible();
    const before = await runs.count();
    await nav(page, 'Global setup').click();
    await page.getByRole('button', { name: /^Plan (setup for \d+ agents?|\d+ items?)$/ }).click();
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
    await page.getByRole('button', { name: /^Plan (setup for \d+ agents?|\d+ items?)$/ }).click();
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
    // Results first; how evals work and the CLI stay folded below Run evals until opened.
    const fold = page.locator('details', { hasText: 'How evals work' });
    await expect(targets).toBeVisible();
    await expect(fold).not.toHaveAttribute('open');
    await expect(page.getByText('Evals test exactly that.')).toBeHidden();
    await expect(page.getByText('benchkeeper evals run --all')).toBeHidden();
    await fold.getByText('How evals work').click();
    await expect(page.getByText('Evals test exactly that.')).toBeVisible();
    await expect(fold.getByRole('listitem')).toHaveText([/^Miss: /, /^False trigger: /]);
    await expect(page.getByText('benchkeeper evals run --all')).toBeVisible();
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

  test('Preferences: Views is the open tab; Sessions history and Advanced, with Clear last, show on their tabs', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const tabs = page.getByRole('tablist', { name: 'Preferences' });
    await expect(tabs.getByRole('tab')).toHaveText(['Views', 'Sessions history', 'Advanced']);
    await expect(tabs.getByRole('tab', { name: 'Views' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Views and their cost' })).toContainText('Terminal tier strip: off by default.');
    await expect(page.getByRole('table', { name: 'Keyboard shortcuts' })).toBeVisible();
    for (const hidden of ['Sessions history', 'Profile', 'Advanced', 'Files', 'Sessions cache']) await expect(page.getByRole('region', { name: hidden })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Clear the sessions cache' })).toBeHidden();
    await tabs.getByRole('tab', { name: 'Advanced' }).click();
    const panel = page.getByRole('tabpanel', { name: 'Advanced' });
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Profile', 'Advanced', 'Files', 'Sessions cache']);
    await expect(page.getByRole('region', { name: 'Views and their cost' })).toBeHidden();
    await noAxe(page);
  });

  test('Preferences: the sessions cache has a retention and Clear', async ({ page }) => {
    await nav(page, 'Preferences').click();
    await page.getByRole('tab', { name: 'Sessions history' }).click();
    const history = page.getByRole('region', { name: 'Sessions history' });
    await expect(history).toContainText('sessions in the cache');
    await history.getByRole('switch', { name: 'Drop summaries after a number of days' }).click({ force: true });
    await expect(history.getByText('Retention set.')).toBeVisible();
    await expect(history.getByRole('textbox', { name: 'Days since the last activity' })).toHaveValue('30');
    await history.getByRole('switch', { name: 'Drop summaries after a number of days' }).click({ force: true });
    await expect(history.getByText('Summaries are kept.')).toBeVisible();
    await page.getByRole('tab', { name: 'Advanced' }).click();
    const cache = page.getByRole('region', { name: 'Sessions cache' });
    const count = await cache.getByText(/\d+ sessions in the cache/).textContent();
    const clear = cache.getByRole('button', { name: 'Clear the sessions cache' });
    const ask = page.getByRole('dialog', { name: 'Clear the sessions cache?' });
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(ask).toContainText('are gone for good');
    await ask.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(ask).toBeHidden();
    await expect(cache.getByText(count)).toBeVisible();
    await expect(cache.getByText('Cache cleared.')).toBeHidden();
    await clear.click();
    await ask.getByRole('button', { name: 'Clear the cache' }).click();
    await expect(cache.getByText('Cache cleared.')).toBeVisible();
    await expect(cache).toContainText('0 sessions in the cache');
    await page.getByRole('tab', { name: 'Sessions history' }).click();
    await expect(history).toContainText('0 sessions in the cache');
  });

  test('Preferences: the Clear dialog reads the count again when it opens', async ({ page }) => {
    await nav(page, 'Preferences').click();
    await page.getByRole('tab', { name: 'Advanced' }).click();
    const cache = page.getByRole('region', { name: 'Sessions cache' });
    await expect(cache).toContainText('sessions in the cache');
    // Another tab scans meanwhile: the server now holds 7 summaries.
    await page.route(/\/api\/sessions-cache$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { sessions: 7, keepDays: null } }) : r.continue()));
    await cache.getByRole('button', { name: 'Clear the sessions cache' }).click();
    await expect(page.getByRole('dialog', { name: 'Clear the sessions cache?' })).toContainText('7 session summaries go');
  });

  test('Preferences: a profile import clears the export warnings', async ({ page }) => {
    await nav(page, 'Preferences').click();
    await page.getByRole('tab', { name: 'Advanced' }).click();
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
    await page.getByRole('tab', { name: 'Advanced' }).click();
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
});
