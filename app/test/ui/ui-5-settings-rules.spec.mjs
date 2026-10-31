import { expect, test } from '@playwright/test';
import { nav } from './views.mjs';
import { noAxe, showMatching, stubSettings, openDiffs, opened } from './chain.mjs';

// Answers the rules view with the auto memory of Claude Code from get(), read again on every request.
const stubMemory = (page, get) => page.route(/\/api\/rules$/, async (route) => {
  const r = await route.fetch();
  const body = await r.json();
  await route.fulfill({ response: r, json: { ...body, agents: body.agents.map((a) => (a.id === 'claude' ? { ...a, memory: get() } : a)) } });
});

test.describe('views', () => {
  opened(test);

  test('Agent settings: the list with its notes, a change as plan and diff, undo; advanced lists every key; no axe violations', async ({ page }) => {
    await nav(page, 'Agent settings').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Agent settings' })).toBeVisible();
    await page.getByRole('button', { name: /^Show settings files/ }).click();
    await expect(page.getByRole('table', { name: 'Settings files' })).toContainText('.claude/settings.json');
    // The fixture home holds the setup's transcript days: its details say what it is, and BenchKeeper's setup writes it too.
    await page.getByRole('button', { name: 'Details of cleanupPeriodDays' }).click();
    await expect(page.getByRole('group', { name: 'About cleanupPeriodDays' })).toContainText('Days Claude Code keeps session transcripts');
    await expect(page.getByText("BenchKeeper's setup writes this key too").first()).toBeVisible();
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
    // An environment switch is set or removed.
    await showMatching(page);
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
    const view = await stubSettings(page, (body) => ({ ...body, notes: [conflict, ...body.notes] }));
    await nav(page, 'Agent settings').click();
    await expect(page.getByText(/^\d+ of \d+ settings with a suggestion differ from it in the user file\.$/)).toBeVisible();
    // The setup's retention differs from the suggestion to leave it unset; the update channel matches.
    const row = (key) => page.getByRole('row').filter({ has: page.locator(`[id="setting-${key}"]`) });
    await expect(row('cleanupPeriodDays')).toContainText('Differs from suggested');
    await expect(row('cleanupPeriodDays')).toContainText('leave unset');
    await page.getByRole('button', { name: 'Details of cleanupPeriodDays' }).click();
    await expect(page.getByText(/^Suggested: leave unset\. /)).toBeVisible();
    await showMatching(page);
    await expect(row('autoUpdatesChannel')).toContainText('Matches suggested');
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
    await expect(row('sandbox.enabled')).toContainText('Matches suggested (in your changes)');
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

  test('Agent settings: by default the differing settings are listed with their details closed and the matching ones folded; Keep mine moves a setting under Decided and Show again brings it back; no axe violations', async ({ page }) => {
    // The decision follows the stubbed store, so the fixture home keeps every setting for the other tests.
    let kept = false;
    const view = await stubSettings(page, (body) => ({ ...body, settings: body.settings.map((x) => (x.key === 'cleanupPeriodDays' ? { ...x, decided: kept } : x)) }));
    let sent;
    await page.route(/\/api\/settings-dismiss$/, (route) => { sent = route.request().postDataJSON(); kept = sent.dismissed; return route.fulfill({ json: { dismissed: [] } }); });
    await nav(page, 'Agent settings').click();
    const differing = page.getByRole('table', { name: 'Settings that differ from the suggestion' });
    const row = (key) => page.getByRole('row').filter({ has: page.locator(`[id="setting-${key}"]`) });
    await expect(differing.getByRole('row').filter({ has: page.locator('[id="setting-cleanupPeriodDays"]') })).toContainText('Differs from suggested');
    await expect(page.getByRole('button', { name: /^Matching or without a suggestion \(\d+\)$/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(row('autoUpdatesChannel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Details of cleanupPeriodDays' })).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('group', { name: 'About cleanupPeriodDays' })).toHaveCount(0);
    await noAxe(page);
    // Keep mine: the row leaves the table, Decided lists it, the status says so and focus is on the notes.
    const notes = page.getByRole('region', { name: 'Notes on the settings' });
    await page.getByRole('button', { name: 'Keep mine for cleanupPeriodDays' }).click();
    expect(sent).toEqual({ id: 'setting:claude:cleanupPeriodDays', dismissed: true });
    await expect(row('cleanupPeriodDays')).toHaveCount(0);
    await expect(notes).toBeFocused();
    await expect(notes.getByRole('status')).toHaveText('Decided: cleanupPeriodDays');
    await notes.getByRole('button', { name: 'Decided (1)' }).click();
    await expect(notes).toContainText('Kept: 14. Suggested: leave unset.');
    await notes.getByRole('button', { name: 'Show again: cleanupPeriodDays' }).click();
    expect(sent).toEqual({ id: 'setting:claude:cleanupPeriodDays', dismissed: false });
    await expect(row('cleanupPeriodDays')).toContainText('Differs from suggested');
    await expect(notes.getByRole('button', { name: /^Decided/ })).toHaveCount(0);
    await expect(notes.getByRole('status')).toHaveText('Shown again: cleanupPeriodDays');
    await expect(notes).toBeFocused();
    // A pending edit is no decision: Keep mine waits until it is reviewed or discarded.
    await page.getByRole('textbox', { name: 'cleanupPeriodDays value' }).fill('21');
    await expect(page.getByRole('button', { name: 'Keep mine for cleanupPeriodDays' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('button', { name: 'Keep mine for cleanupPeriodDays' })).toBeVisible();
    await page.unroute(view);
    await page.unroute(/\/api\/settings-dismiss$/);
  });

  test('Agent settings: Dismiss and Show again move a note between the lists, focus stays on the notes and the status says what happened', async ({ page }) => {
    // The note's list follows the stubbed dismissal, so the fixture home keeps its notes for the other tests.
    const note = { id: 'stub-note', level: 'info', kind: 'note', message: 'A stubbed note.', source: 'https://example.com/' };
    let off = false;
    // Only the view's own read: the setting facts the Dashboard reads for settings findings share the path and return a list.
    const view = await stubSettings(page, (body) => ({ ...body, notes: off ? [] : [note], dismissed: off ? [note] : [] }));
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
    const view = await stubSettings(page, (body) => ({ ...body, notes: [note], dismissed: [] }));
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
    // The fixture home holds the global setup's settings: the retention comes from the user file.
    await page.getByRole('button', { name: 'Details of cleanupPeriodDays' }).click();
    const retention = about(page, 'cleanupPeriodDays');
    await facts(retention);
    await expect(retention).toContainText('from the user file');
    // A catalog key that is not basic is listed in its group with every key.
    await page.getByRole('switch', { name: 'Advanced: every key' }).check();
    await page.getByLabel('Search settings').fill('includeGitInstructions');
    await page.getByRole('button', { name: 'Details of includeGitInstructions' }).click();
    await expect(about(page, 'includeGitInstructions')).toContainText('Current: the default');
    // A key outside the catalog: the reference description, no guessed text, the rest of the facts still there.
    await page.getByLabel('Search settings').fill('modelSettings');
    await page.getByRole('table', { name: 'Advanced keys' }).getByRole('button', { name: 'Details of modelSettings' }).click();
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
    await page.getByText('Every finding with its fix').click();
    await facts(about(page.getByRole('table', { name: 'Doctor findings' }), 'permissions.deny'));
    await nav(page, 'Insights').click();
    const denyRow = page.getByRole('article', { name: /No Read deny rule/ });
    await denyRow.getByRole('button', { name: /No Read deny rule/ }).click();
    await facts(about(denyRow, 'permissions.deny'));
    await noAxe(page);
    // The Apply drawer: the global settings change, planned again, lists the facts of each key it writes.
    await nav(page, 'Dashboard').click();
    await page.getByRole('button', { name: 'Fix everything' }).click();
    const fix = page.getByRole('dialog', { name: 'Fix everything' });
    // The recommendations make the Settings card long: it starts folded.
    await fix.getByRole('button', { name: 'Show Settings' }).click();
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
    await showMatching(page);
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
    await showMatching(page);
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
    await expect(page.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
    // The checks come before the files, in the summary strip; each limit is a bar that names who sets it.
    await expect(page.getByRole('region', { name: 'Summary' }).getByRole('region', { name: 'Checks' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: /^At the start of a session: .* tokens, limit set by BenchKeeper$/ }).first()).toBeVisible();
    const files = page.getByRole('list', { name: 'Claude Code instruction files' });
    const team = files.getByRole('listitem').filter({ hasText: /20-team\.md/ });
    await expect(team).toContainText('yours');
    await expect(team).toContainText('loads');
    // BenchKeeper's own rules file has no switch; the budget bar has one segment per source, largest first, named in its legend.
    await expect(files.getByRole('listitem').filter({ hasText: /00-global\.md/ })).toContainText('No switch: BenchKeeper wrote it');
    await expect(page.getByRole('list', { name: 'Claude Code sources' }).getByRole('listitem').first()).toContainText('00-global.md');
    await expect(page.getByText('tokens at the start of a session').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Checks' })).toContainText('No rule file is over a limit or broken');
    // The estimate note is behind an info control, not a paragraph.
    await expect(page.getByText('A token is counted as four bytes: an estimate.')).toBeHidden();
    await page.getByRole('button', { name: 'How Claude Code tokens are counted' }).click();
    await expect(page.getByText('A token is counted as four bytes: an estimate.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('A token is counted as four bytes: an estimate.')).toBeHidden();
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

  test('Rules: the summary strip shows each agent\'s budget bar split by source, largest first, beside the checks; Claude Code is the open tab, Codex one click away', async ({ page }) => {
    const view = /\/api\/rules$/;
    await page.route(view, async (route) => {
      const r = await route.fetch();
      const body = await r.json();
      const [claude] = body.agents;
      const codex = { ...claude, id: 'codex', name: 'Codex', memory: undefined, rows: [{ ...claude.rows[0], agent: 'codex', path: '/home/u/.codex/AGENTS.md', shown: '~/.codex/AGENTS.md' }], budget: { ...claude.budget, items: [{ kind: 'rules', label: '~/.codex/AGENTS.md', tokens: 11000 }, { kind: 'rules', label: '~/.codex/extra.md', tokens: 3000 }], total: 12000, over: true, largest: { label: '~/.codex/AGENTS.md', tokens: 11000 }, limits: [{ ...claude.budget.limits[0], value: 12000 }] } };
      await route.fulfill({ response: r, json: { ...body, agents: [claude, codex] } });
    });
    await nav(page, 'Rules').click();
    const strip = page.getByRole('region', { name: 'Summary' });
    await expect(strip).toContainText(/Claude Code: [\d,]+ of 10,000 tokens at the start of a session \(limit set by BenchKeeper\)/);
    await expect(strip).toContainText('Codex: 12,000 of 10,000 tokens at the start of a session (limit set by BenchKeeper)');
    await expect(strip.getByRole('list', { name: 'Claude Code sources' }).getByRole('listitem').first()).toContainText(/00-global\.md\s*[\d,]+/);
    await expect(strip.getByRole('list', { name: 'Codex sources' }).getByRole('listitem').first()).toContainText(/~\/\.codex\/AGENTS\.md\s*11,000/);
    await expect(strip.getByRole('progressbar')).toHaveCount(2);
    await expect(strip.getByRole('progressbar', { name: 'At the start of a session: 12,000 of 10,000 tokens, limit set by BenchKeeper' })).toBeVisible();
    await expect(strip).toContainText('More than 10,000 tokens');
    const over = strip.getByRole('progressbar', { name: /^At the start of a session: 12,000/ });
    await expect(over).toHaveAttribute('aria-valuenow', '10000');
    await expect(over).toHaveAttribute('aria-valuetext', '12,000 of 10,000 tokens');
    await expect(strip).toContainText('About 2,000 tokens of these sources may not load: Codex stops adding files at its size limit.');
    await expect(strip.getByRole('region', { name: 'Checks' })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Agents' });
    await expect(tabs.getByRole('tab', { name: 'Claude Code' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('list', { name: 'Claude Code instruction files' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Codex instruction files' })).toBeHidden();
    await noAxe(page);
    await tabs.getByRole('tab', { name: 'Codex' }).click();
    await expect(page.getByRole('list', { name: 'Codex instruction files' })).toContainText('~/.codex/AGENTS.md');
    await expect(page.getByRole('list', { name: 'Codex instruction files' })).not.toContainText('00-global.md');
    await expect(strip.getByRole('list', { name: 'Codex sources' })).not.toContainText('00-global.md');
    await expect(page.getByRole('list', { name: 'Claude Code instruction files' })).toBeHidden();
    await noAxe(page);
    await page.unroute(view);
  });

  test('Rules: the file rows come right after the budget and auto memory below them; the legend names every segment of the bar', async ({ page }) => {
    const memory = { lines: 150, bytes: 10 * 1024, folders: [{ project: '/work/app', path: '/home/u/.claude/projects/-work-app/memory', enabled: true, notes: 3, bytes: 4096, changed: '2026-02-03T04:05:06.000Z', over: false }] };
    await stubMemory(page, () => memory);
    await nav(page, 'Rules').click();
    const [files, notes] = await Promise.all([page.getByRole('region', { name: 'Claude Code files' }).boundingBox(), page.getByRole('region', { name: 'Claude Code auto memory' }).boundingBox()]);
    expect(files.y).toBeLessThan(notes.y);
    const total = Number((await page.getByRole('region', { name: 'Summary' }).getByRole('progressbar', { name: /^At the start of a session/ }).getAttribute('aria-valuetext')).match(/^[\d,]+/)[0].replace(/,/g, ''));
    const legend = await page.getByRole('list', { name: 'Claude Code sources' }).getByRole('listitem').allInnerTexts();
    expect(legend.reduce((n, t) => n + Number(t.match(/([\d,]+)\s*$/)[1].replace(/,/g, '')), 0)).toBe(total);
    await noAxe(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await noAxe(page);
    // The bar and the count wrap under the path: nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
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
    const team = page.getByRole('list', { name: 'Claude Code instruction files' }).getByRole('listitem').filter({ hasText: /20-team\.md/ });
    await team.getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes).toContainText(/What it does: Claude Code stops loading this file: about [\d,]+ tokens less in each turn it loads for matching files\./);
    await changes.getByRole('button', { name: 'Cancel' }).click();
    await page.unroute(view);
  });

  test('Rules: auto memory per project in numbers, read-only, over the load limit flagged, nothing flagged where off; no axe violations at 390 px', async ({ page }) => {
    const view = /\/api\/rules$/;
    const folders = [
      { project: '/work/app', path: '/home/u/.claude/projects/-work-app/memory', enabled: true, notes: 3, bytes: 4096, changed: '2026-02-03T04:05:06.000Z', over: true },
      { project: '-work-old', path: '/home/u/.claude/projects/-work-old/memory', enabled: true, notes: 0, bytes: 120, changed: '2026-01-01T00:00:00.000Z', over: false },
    ];
    let memory = { lines: 150, bytes: 10 * 1024, folders };
    await stubMemory(page, () => memory);
    await nav(page, 'Rules').click();
    await page.setViewportSize({ width: 390, height: 844 });
    const section = page.getByRole('region', { name: 'Claude Code auto memory' });
    const table = page.getByRole('table', { name: 'Auto memory per project' });
    await expect(section).toContainText('the first 150 lines or 10 KB of MEMORY.md');
    await expect(table.getByRole('row', { name: /\/work\/app/ })).toContainText('over the load limit');
    await expect(table.getByRole('row', { name: /-work-old/ })).toContainText('120 bytes');
    await expect(section.getByRole('button')).toHaveCount(0);
    await expect(section).not.toContainText('Auto memory is off');
    await noAxe(page);
    // A project with auto memory off: its row loads nothing, the others keep their badge.
    memory = { ...memory, folders: [{ ...folders[0], enabled: false }, folders[1]] };
    await page.reload();
    await expect(section).toContainText('Auto memory is off for the rows marked not loaded');
    await expect(table.getByRole('row', { name: /\/work\/app/ })).toContainText('not loaded');
    await expect(table.getByRole('row', { name: /-work-old/ })).toContainText('within the load limit');
    // With auto memory off everywhere the folders stay, nothing loads and nothing is over a limit.
    memory = { ...memory, folders: folders.map((m) => ({ ...m, enabled: false })) };
    await page.reload();
    await expect(section).toContainText('Auto memory is off');
    await expect(table.getByRole('row', { name: /\/work\/app/ })).toContainText('not loaded');
    await expect(table).not.toContainText('load limit');
    await expect(section).not.toContainText('at the start of a session');
    await noAxe(page);
    await page.setViewportSize({ width: 1280, height: 720 });
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
    await expect(page.getByRole('region', { name: 'Checks' })).toContainText('1 finding');
    await expect(page.getByRole('region', { name: 'Checks' }).getByRole('table', { name: 'Rule findings' })).toBeVisible();
    await noAxe(page);
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
    const team = page.getByRole('list', { name: 'Claude Code instruction files' }).getByRole('listitem').filter({ hasText: /20-team\.md/ });
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
    await page.getByRole('list', { name: 'Claude Code instruction files' }).getByRole('listitem').filter({ hasText: /20-team\.md/ }).getByRole('button', { name: /Show text of/ }).click();
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
    await page.getByRole('list', { name: 'Claude Code instruction files' }).getByRole('listitem').filter({ hasText: /20-team\.md/ }).getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
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
    // The run reloads the view: wait for that handler, or the unroute answers its request first.
    await page.unrouteAll({ behavior: 'wait' });
    await changes.getByRole('button', { name: 'Undo run' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /Undone|Undo failed/ })).toContainText(/changes undone/);
  });

  test('A plan: while the apply request is out, Cancel ignores input and the job shows when it starts', async ({ page }) => {
    let answer;
    const held = new Promise((resolve) => { answer = resolve; });
    await page.route(/\/api\/apply$/, async (route) => { await held; await route.continue(); });
    await nav(page, 'Rules').click();
    await page.getByRole('list', { name: 'Claude Code instruction files' }).getByRole('listitem').filter({ hasText: /20-team\.md/ }).getByRole('switch', { name: /Load .*20-team\.md in Claude Code/ }).click({ force: true });
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
    const team = page.getByRole('list', { name: 'Claude Code instruction files' }).getByRole('listitem').filter({ hasText: /20-team\.md/ });
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
});
