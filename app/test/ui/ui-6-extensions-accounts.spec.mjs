import { expect, test } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAME as IDE } from '../../src/orca/index.mjs';
import { nav, setUp } from './views.mjs';
import { ONE, GATE, RUNNER, noAxe, openDiffs, opened } from './chain.mjs';

test.describe('views', () => {
  opened(test);

  test('Editors: off, no sidebar entry and no route; on, a file is edited with live validation, planned, applied and undone; no axe violations at desktop and phone width', async ({ page }) => {
    const entry = page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Orchestrator policy' });
    await expect(entry).toHaveCount(0);
    await page.goto('/#/editors');
    await expect(page.getByRole('heading', { level: 2, name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(async () => (await fetch('/api/params?dir=x', { headers: { 'x-benchkeeper': localStorage.getItem('benchkeeper-key') } })).status)).toBe(404);
    await nav(page, 'Preferences').click();
    await page.getByRole('tab', { name: 'Advanced' }).click();
    const editors = page.getByRole('switch', { name: 'Editors' });
    await editors.click();
    await expect(page.getByRole('group', { name: 'Advanced' })).toBeVisible();
    await entry.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Orchestrator policy' })).toBeVisible();
    await page.getByRole('combobox', { name: 'File' }).click();
    await page.getByRole('option', { name: 'docs/agents/orchestration.json', exact: true }).click();
    const text = page.getByRole('textbox', { name: 'docs/agents/orchestration.json' });
    await expect(text).toHaveValue(/"schemaVersion": 1/);
    await noAxe(page);
    // The loader's errors show while typing, and Review waits for a valid text.
    await text.fill('{ "schemaVersion": 1, "workersPerProject": 0 }');
    const errors = page.getByRole('list', { name: 'Errors in docs/agents/orchestration.json' });
    await expect(errors).toContainText('range at workersPerProject');
    await expect(page.getByRole('button', { name: 'Review change' })).toBeDisabled();
    await noAxe(page);
    await text.fill('{ "schemaVersion": 1, "// why": "kept", "workersPerProject": 2 }\n');
    await expect(errors).toBeHidden();
    await page.getByRole('button', { name: 'Review change' }).click();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('Write docs/agents/orchestration.json');
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
    await expect(page.getByRole('heading', { level: 2, name: 'Orchestrator policy' })).toBeVisible();
    await noAxe(page);
    // Off again: the entry and the route are gone.
    await page.goto('/#/settings');
    await page.getByRole('tab', { name: 'Advanced' }).click();
    await editors.click();
    await expect(editors).not.toBeChecked();
    await expect(entry).toHaveCount(0);
  });

  test('Extensions: one row per server, hook and subagent with owner and the runs-code chip, Remove leads to the Doctor, an empty state, the command folded, no secret value; no axe violations', async ({ page }) => {
    await nav(page, 'Extensions').click();
    const list = page.getByRole('list', { name: 'Claude Code extensions' });
    const server = list.getByRole('listitem').filter({ hasText: 'MCP server' });
    await expect(server).toContainText('files');
    await expect(server).toContainText('owner yours');
    await expect(server).toContainText('runs code');
    await expect(server).toContainText('npx -y files-server');
    await expect(server).toContainText('The global plan offers removal (full level)');
    await expect(server.getByRole('link', { name: 'Remove files' })).toHaveAttribute('href', '#/agents?plan=1');
    const subagent = list.getByRole('listitem').filter({ hasText: 'Subagent' });
    await expect(subagent).toContainText('reviewer');
    await expect(subagent).not.toContainText('runs code');
    await expect(subagent.getByRole('link')).toHaveCount(0);
    // Default state: Codex has none and shows the empty state; the command line stays folded until Command opens.
    await expect(page.getByRole('region', { name: 'Codex extensions' })).toContainText('Nothing found.');
    await expect(page.getByRole('list', { name: 'Codex extensions' })).toHaveCount(0);
    const cli = page.getByText('benchkeeper extensions list', { exact: false });
    await expect(cli).toBeHidden();
    await page.locator('summary').getByText('Command', { exact: true }).click();
    await expect(cli).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/dummy-(env|hook)-secret/);
    await noAxe(page);
    // A project adds its own: a hook whose command carries a secret shows it masked.
    await page.getByRole('combobox', { name: 'Show' }).click();
    await page.getByRole('option', { name: /bk-ui-proj/ }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Claude Code extensions for this project' })).toBeVisible();
    const hook = page.getByRole('list', { name: 'Claude Code extensions' }).getByRole('listitem').filter({ hasText: /Hook[\s\S]*AUDIT_TOKEN/ });
    await expect(hook).toContainText('PreToolUse');
    await expect(hook).toContainText('runs code');
    await expect(hook).toContainText('AUDIT_TOKEN=***');
    await expect(hook).toContainText('scope local');
    await expect(page.locator('body')).not.toContainText(/dummy-(env|hook)-secret/);
    await noAxe(page);
  });

  // Before the Automations test: without its runner the multi-agent IDE is not installed.
  test('Runs: a one-sentence intro, a section without data is one line with its reason, the command folded; no axe violations', async ({ page }) => {
    await nav(page, 'Runs').click();
    await expect(page.getByText('Orchestrated runs and tasks in the registered projects and their worktrees with cost and tokens, each project\'s last setup change and the multi-agent IDE\'s runs, read when the view opens and on Refresh: nothing runs while it is closed.', { exact: true })).toBeVisible();
    const runs = page.getByRole('region', { name: 'Orchestrated runs', exact: true });
    await expect(runs).toContainText(/^Orchestrated runs: no orchestrated sessions in a registered project or its worktrees, from the sessions read \d{4}-\d\d-\d\d \d\d:\d\d UTC\.$/);
    await expect(runs.getByRole('heading', { level: 3, name: 'Orchestrated runs' })).toBeVisible();
    await expect(runs.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('region', { name: IDE, exact: true })).toHaveText(`${IDE}: not installed, or its run list could not be read.`);
    // Projects are registered: their section keeps its heading and list.
    await expect(page.getByRole('region', { name: 'Last setup change' }).getByRole('heading', { name: 'Last setup change' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    const cli = page.getByText('benchkeeper sessions list --run <id>', { exact: true });
    await expect(cli).toBeHidden();
    await page.locator('summary').getByText('Command', { exact: true }).click();
    await expect(cli).toBeVisible();
    await noAxe(page);
  });

  test('Automations without the runner: one setup panel with Check again, the templates behind Show templates', async ({ page }) => {
    await nav(page, 'Automations').click();
    const panel = page.getByRole('alert').filter({ hasText: 'Set up Orca' });
    await expect(panel).toContainText('put orca-ide on the PATH. Install, update and remove need its CLI');
    await expect(page.getByText('A template is one scheduled agent run')).toBeHidden();
    const table = page.getByRole('table', { name: 'Automations' });
    await expect(table).toBeHidden();
    await page.getByRole('button', { name: 'Show templates' }).click();
    await expect(page.getByText('A template is one scheduled agent run')).toBeVisible();
    await expect(table.getByRole('button', { name: 'Install Pull request watch' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Hide templates' })).toHaveAttribute('aria-expanded', 'true');
    // The runner appears: Check again shows the view as it is with the runner.
    writeFileSync(RUNNER, '');
    try {
      await panel.getByRole('button', { name: 'Check again' }).focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeHidden();
      await expect(page.getByRole('heading', { name: 'Templates' })).toBeFocused();
      await expect(page.getByRole('status').filter({ hasText: 'Orca found' })).toBeAttached();
      await expect(page.getByRole('button', { name: /^(Show|Hide) templates$/ })).toBeHidden();
      await expect(table.getByRole('button', { name: 'Install Pull request watch' })).toBeEnabled();
    } finally {
      rmSync(RUNNER, { force: true });
    }
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
    // Usage limits (with the CLI) and the token section start folded to a one-line summary.
    const limits = page.getByRole('region', { name: 'Usage limits' }), token = page.getByRole('region', { name: 'Token for unattended containers' });
    await expect(limits.locator('summary')).toHaveText('Usage limits default minimum 5-hour 8%, 7-day 3%, auto-pick off');
    await expect(token.locator('summary')).toContainText('kept in the OS credential store');
    await expect(limits.getByText('Auto-pick is off')).toBeHidden();
    await expect(limits.getByText('CLI', { exact: true })).toBeHidden();
    await expect(token.getByText(/never in a file/)).toBeHidden();
    await limits.locator('summary').click();
    await token.locator('summary').click();
    await expect(limits.getByText(/Auto-pick is off/)).toBeVisible();
    await expect(limits.getByText(/^Below the minimum headroom/)).toHaveText('Below the minimum headroom of a window (100 minus the used percentage), benchkeeper run warns and asks before it starts; a notice shows before that. Defaults: minimum 5-hour 8%, 7-day 3%, notice below 5-hour 16%, 7-day 6%. Usage of a Claude Code account is read from its status line once tracked, and for a signed-in Codex host account from its app-server at each check.');
    await expect(limits.getByText('benchkeeper accounts limits', { exact: false })).toBeVisible();
    await expect(token.getByText(/never in a file/)).toBeVisible();
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
    // work stays for the status line test, which removes it.
    await home.getByRole('button', { name: /^Remove / }).click();
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await changes.getByRole('button', { name: 'Close' }).click();
  });

  test('Preferences: the status line style of the tracked account work is a plan on its settings.json, applied, shown after the reload and undone; no axe violations at 390 px', async ({ page }) => {
    await nav(page, 'Preferences').click();
    const views = page.getByRole('region', { name: 'Views and their cost' });
    const select = views.getByRole('combobox', { name: 'Status line of account work' });
    await expect(select).toHaveValue('Usage and Ponytail level');
    const file = await views.getByText(/accounts\/work\/settings\.json$/).textContent();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await noAxe(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    // The select ignores input while its plan is asked for.
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/status-style$/, async (route) => { if (route.request().method() === 'POST') await held; await route.continue(); });
    await select.click();
    await page.getByRole('option', { name: 'Usage only', exact: true }).click();
    await expect(select).toBeDisabled();
    answer();
    const changes = views.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText('Why: You chose the status line style benchkeeper for account work in Preferences.');
    await page.unroute(/\/api\/status-style$/);
    await expect(changes).toContainText(file);
    await expect(select).toHaveValue('Usage only');
    await expect(views).toContainText('Apply or cancel in Changes below');
    await changes.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(changes.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await expect(select).toBeEnabled();
    await expect(select).toHaveValue('Usage only');
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
    await changes.getByRole('button', { name: 'Close' }).click();
    await page.reload();
    await expect(views.getByRole('combobox', { name: 'Status line of account work' })).toHaveValue('Usage and Ponytail level');
    // Back to no account, as the other tests expect the machine.
    await nav(page, 'Accounts').click();
    await page.getByRole('article', { name: 'work' }).getByRole('button', { name: /^Remove / }).click();
    const removal = page.getByRole('region', { name: 'Changes' });
    await removal.getByRole('button', { name: /^Apply 1 change$/ }).click();
    await expect(removal.getByRole('region', { name: /^Run / }).getByRole('article').first()).toBeVisible();
    await removal.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('region', { name: 'Accounts' })).toContainText('No account yet');
    await nav(page, 'Preferences').click();
    await expect(views).toContainText('An account in a dev container sets its style in its own settings.json');
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
    await setUp(page, 'Set up global only');
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
    await setUp(page, 'Set up global only');
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
      await setUp(page, 'Set up everything');
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
    await setUp(page, 'Set up projects');
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
      await setUp(page, 'Set up projects');
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
      await setUp(page, 'Set up projects');
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
