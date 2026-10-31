import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nav } from './views.mjs';
import { BATCH, ONE, noAxe, openDiffs, opened } from './chain.mjs';

test.describe('views', () => {
  opened(test);

  test('Skills: search, then the detail panel with the skill text and its eval results', async ({ page }) => {
    await nav(page, 'Skills').click();
    await page.getByRole('textbox', { name: 'Search' }).fill('technical-uis');
    await page.getByRole('table', { name: 'Skills' }).getByRole('link', { name: 'designing-technical-uis' }).click();
    const detail = page.getByRole('region', { name: 'Skill designing-technical-uis' });
    await expect(detail.getByText('# Designing technical UIs')).toBeVisible();
    await expect(detail.getByRole('table', { name: 'Eval runs' }).getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('table', { name: 'Skills' }).getByRole('row')).toHaveCount(2);
    // The library packs that name the skill are its areas, in the row and in the detail; no pack button until a skill is ticked.
    await expect(page.getByRole('table', { name: 'Skills' }).getByRole('row', { name: /designing-technical-uis/ })).toContainText('Frontend');
    await expect(detail).toContainText('Docs');
    await expect(page.getByRole('button', { name: /^Build pack/ })).toHaveCount(0);
    // An own skill of the library has no Edit or Remove.
    await expect(page.getByRole('table', { name: 'Skills' }).getByRole('button')).toHaveCount(0);
  });

  test('Skills: the pack builder removes a skill with focus kept, finds no overlapping descriptions in the library and saves an own pack; Packs exports it', async ({ page }) => {
    await nav(page, 'Skills').click();
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
    await nav(page, 'Packs').click();
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

  test('Skills: a skill of your own is created, edited, picked into an own pack that is not exported, and removed once no pack names it', async ({ page }) => {
    await nav(page, 'Skills').click();
    const table = page.getByRole('table', { name: 'Skills' });
    const apply = async (region) => {
      await region.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
      await expect(region.getByRole('button', { name: 'Undo run' })).toBeVisible();
      await region.getByRole('button', { name: 'Close editor' }).click();
    };
    await page.getByRole('button', { name: 'New skill' }).click();
    const create = page.getByRole('dialog', { name: 'New skill' });
    await create.getByRole('textbox', { name: 'Name' }).fill('Bad--name');
    // Typed text keeps the dialog open against Escape.
    await page.keyboard.press('Escape');
    await expect(create).toBeVisible();
    await create.getByRole('button', { name: 'Save' }).click();
    await expect(create.getByText(/^skill name: 1 to 64/)).toBeVisible();
    await create.getByRole('textbox', { name: 'Name' }).fill('ui-own-skill');
    await expect(create.getByRole('textbox', { name: 'SKILL.md' })).toHaveValue(/^---\nname: ui-own-skill\n/);
    await create.getByRole('button', { name: 'Save' }).click();
    await expect(create.getByText('your skill ui-own-skill: new SKILL.md')).toBeVisible();
    await noAxe(page);
    await apply(create);
    await table.getByRole('link', { name: 'ui-own-skill' }).click();
    const detail = page.getByRole('region', { name: 'Skill ui-own-skill' });
    await expect(table.getByRole('row', { name: /ui-own-skill/ })).toContainText('yours');
    await expect(detail).toContainText('Source: your skills');
    await table.getByRole('button', { name: 'Edit ui-own-skill' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit skill ui-own-skill' });
    const body = edit.getByRole('textbox', { name: 'SKILL.md' });
    await body.fill((await body.inputValue()).replace('What this skill does', 'Edited in the UI. What it does'));
    await edit.getByRole('button', { name: 'Save' }).click();
    await apply(edit);
    await expect(page.getByRole('region', { name: 'Skill ui-own-skill' })).toContainText('Edited in the UI');
    // Picked into an own pack: the pack file is not exported, and the skill cannot be removed while the pack names it.
    await table.getByRole('checkbox', { name: 'Add ui-own-skill to the pack' }).check();
    await page.getByRole('button', { name: 'Build pack (1)' }).click();
    const drawer = page.getByRole('dialog', { name: 'Build a pack' });
    await drawer.getByLabel(/^Pack id/).fill('with-own');
    await drawer.getByRole('button', { name: 'Save pack' }).click();
    await expect(drawer).toBeHidden();
    await table.getByRole('button', { name: 'Remove ui-own-skill' }).click();
    const remove = page.getByRole('dialog', { name: 'Remove skill ui-own-skill' });
    await expect(remove.getByText(/in use by pack with-own/)).toBeVisible();
    await remove.getByRole('button', { name: 'Close editor' }).click();
    await nav(page, 'Packs').click();
    const packs = page.getByRole('table', { name: 'Packs' });
    await packs.getByRole('button', { name: 'Export with-own' }).click();
    await expect(page.getByText('with-own names your own skills (ui-own-skill): a pack file carries library skills only, so this pack stays on this machine')).toBeVisible();
    await packs.getByRole('button', { name: 'Remove with-own' }).click();
    await expect(packs.getByRole('button', { name: 'Remove with-own' })).toHaveCount(0);
    await nav(page, 'Skills').click();
    await table.getByRole('link', { name: 'ui-own-skill' }).click();
    await page.getByRole('region', { name: 'Skill ui-own-skill' }).getByRole('button', { name: 'Remove' }).click();
    const removing = page.getByRole('dialog', { name: 'Remove skill ui-own-skill' });
    await expect(removing.getByText('remove your skill ui-own-skill')).toBeVisible();
    await apply(removing);
    await expect(table.getByRole('link', { name: 'ui-own-skill' })).toHaveCount(0);
  });

  test('Packs: a pack file that is not a pack is listed with its reason and can be removed with focus kept; no axe violations', async ({ page }) => {
    await page.route(/\/api\/catalog(\?|$)/, async (route) => {
      const r = await route.fetch();
      await route.fulfill({ response: r, json: { ...(await r.json()), invalidPacks: [{ file: 'broken.json', reason: 'not valid JSON' }] } });
    });
    await page.route(/\/api\/packs$/, (route) => route.fulfill({ json: { removed: 'broken.json' } }));
    await page.reload();
    await nav(page, 'Packs').click();
    const bad = page.getByRole('region', { name: 'Pack files that are not packs' });
    await expect(bad).toContainText('broken.json');
    await expect(bad).toContainText('not valid JSON');
    await noAxe(page);
    const sent = page.waitForRequest((q) => q.url().endsWith('/api/packs') && q.method() === 'POST');
    await bad.getByRole('button', { name: 'Remove broken.json' }).focus();
    await page.keyboard.press('Enter');
    expect((await sent).postDataJSON()).toEqual({ action: 'remove', id: 'broken.json' });
    // Its last file takes the section with it: focus moves to the packs heading.
    await expect(page.getByRole('heading', { level: 3, name: 'Library and own packs', exact: true })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Removed: broken.json' })).toHaveCount(1);
    // The removal reloads the catalog: wait for that stubbed answer.
    await page.unrouteAll({ behavior: 'wait' });
  });

  test('Projects: the drift board row, its plan, skill toggle and doctor, and Update all progress per project', async ({ page }) => {
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
    // After the last of the 2 projects the page reloads the list.
    let updated = 0;
    const reloaded = page.waitForResponse((r) => {
      if (r.url().endsWith('/api/update-all')) updated++;
      return updated === 2 && /\/api\/projects(\?|$)/.test(r.url()) && r.request().method() === 'GET';
    });
    // The project's setup is shared: Update all commits on a local branch and asks nothing first.
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Update all: 2 of 2 projects' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Update all results' })).toContainText(/stopped|current|committed/);
    await reloaded;
  });

  test('Projects: Update all of a shared setup runs without asking and names the push command', async ({ page }) => {
    const project = (name, extra) => ({ path: `/work/${name}`, setupVersion: '0.1.0', current: false, changes: [], repo: true, clean: true, ...extra });
    const push = "git -C '/work/shared' push -u origin chore/agent-setup-0.2.0";
    await page.route(/\/api\/projects(\?|$)/, (route) => route.fulfill({ json: [project('shared', { share: true })] }));
    await page.route(/\/api\/update-all$/, (route) => route.fulfill({ json: [{ path: '/work/shared', status: 'committed', branch: 'chore/agent-setup-0.2.0', push }] }));
    await nav(page, 'Projects').click();
    const sent = page.waitForRequest((q) => q.url().endsWith('/api/update-all'));
    await page.getByRole('button', { name: 'Update all', exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ paths: ['/work/shared'] });
    await expect(page.getByRole('dialog', { name: /pull request/ })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Update all results' })).toContainText(`committed, push with ${push}`);
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

  test('Projects: a new folder from a preset is a plan, then registered; the check after it lists each recommendation with its reason', async ({ page }) => {
    await nav(page, 'Projects').click();
    await page.getByRole('button', { name: 'New from preset' }).click();
    const form = page.getByRole('region', { name: 'New project from a preset' });
    await expect(form.getByLabel('Preset')).toHaveValue('web-shop');
    await form.getByLabel('New folder').fill(tmpdir());
    await form.getByRole('button', { name: 'Show the plan' }).click();
    await expect(form).toContainText('exists already');
    await form.getByLabel('New folder').fill(join(mkdtempSync(join(tmpdir(), 'bk-ui-new-')), 'fresh'));
    await form.getByRole('button', { name: 'Show the plan' }).click();
    await expect(form.getByRole('button', { name: /^Apply \d+ changes$/ })).toBeEnabled();
    await noAxe(page);
    // The fixture has no other project with the same agents and no global skill: one recommendation is added to the real answer.
    await page.route(/\/api\/recommendations\?/, async (route) => {
      const r = await (await route.fetch()).json();
      await route.fulfill({ json: { ...r, items: [...r.items, { action: 'add', kind: 'pack', name: 'docs', reason: 'on in 2 of 2 registered projects with the same agents' }] } });
    });
    await form.getByRole('button', { name: /^Apply \d+ changes$/ }).click();
    const rec = form.getByRole('region', { name: 'Recommendations' });
    await expect(rec.getByRole('listitem')).toHaveText('Add the pack docs: on in 2 of 2 registered projects with the same agents');
    await noAxe(page);
    await expect(page.getByRole('table', { name: 'Projects' }).getByRole('row', { name: /fresh/ })).toBeVisible();
    await unregister(page, ['fresh']);
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
  // The project page keeps its secondary actions in the More menu.
  const more = async (page, item) => { await page.getByRole('region', { name: /^Project \// }).getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); };
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
    await more(page, 'Edit name and notes');
    await page.getByLabel('Display name').fill('Marketing site');
    await page.getByLabel('Notes').fill('owner: qzv');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Marketing site' })).toBeVisible();
    await expect(page.getByRole('region', { name: /^Project \// })).toContainText('owner: qzv');
    await page.getByRole('link', { name: 'All projects' }).click();
    await expect(table.getByRole('link', { name: 'Marketing site', exact: true })).toBeVisible();
    // The name and the notes are searched; the filter and the sort narrow and order the rows.
    await page.getByLabel('Search projects').fill('qzv');
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
    await board.getByRole('button', { name: 'Filters' }).click();
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
    // One row per pack: switch, sentence and chips show; the other facts wait under Details.
    await expect(packs.getByText('The repository has a web UI')).toBeVisible();
    await expect(packs.getByText(/^Impact: copies/)).toBeHidden();
    const details = packs.getByRole('button', { name: 'Details of Frontend' });
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await details.click();
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(packs.getByText(/^Impact: copies/)).toBeVisible();
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

  test('Project page: Change setup is the one button and the other actions sit in the More menu, by keyboard; the packs not in use are a grid of cards, one column at 390 px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: /^bk-ui-proj/ }).click();
    const head = page.getByRole('region', { name: /^Project \// });
    await expect(head.getByRole('button', { name: 'Change setup' })).toBeVisible();
    for (const name of ['Open folder', 'Edit name and notes', 'Relocate', 'Remove from list']) await expect(head.getByRole('button', { name })).toHaveCount(0);
    const menu = head.getByRole('button', { name: 'More', exact: true });
    await menu.focus();
    await page.keyboard.press('Enter');
    for (const name of ['Open folder', 'Edit name and notes', 'Relocate', 'Remove from list']) await expect(head.getByRole('menuitem', { name })).toBeVisible();
    await noAxe(page);
    await page.keyboard.press('Escape');
    await expect(head.getByRole('menuitem')).toHaveCount(0);
    await expect(menu).toBeFocused();
    await page.getByRole('tab', { name: 'Installs' }).click();
    const rest = page.getByRole('region', { name: 'Packs' }).getByRole('group', { name: /^More packs, \d+$/ });
    const switches = rest.getByRole('switch');
    await expect(switches.nth(1)).toBeVisible();
    const pair = async () => [await switches.nth(0).boundingBox(), await switches.nth(1).boundingBox()];
    let [a, b] = await pair();
    expect(Math.abs(a.y - b.y) < 8 && b.x > a.x).toBe(true);
    // The scope and the state wait under Details of a card.
    await expect(rest).not.toContainText(/only this project|also global/);
    await rest.getByRole('button', { name: /^Details of / }).first().click();
    await expect(rest).toContainText(/only this project|also global/);
    await page.setViewportSize({ width: 390, height: 900 });
    // The layout follows the new width a frame later.
    await expect.poll(async () => { [a, b] = await pair(); return Math.abs(a.x - b.x) < 8 && b.y > a.y; }).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await noAxe(page);
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

  test('Global setup: installed agents as rows, the others folded with every sentence; parts that need attention open; only global items, the pointer to Projects and the Accounts link; each per-project control is in the Installs tab; a part opens by keyboard; 390 px', async ({ page }) => {
    // The per-project controls, each a region of switches in a project's Installs tab and none on the global page.
    const MOVED = ['Packs', 'Workflow owner', 'Skills', 'Agent files'];
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/#/agents');
    const main = page.getByRole('main');
    await expect(main).toContainText('Per-project setup lives in each project');
    await expect(main.getByRole('link', { name: 'Projects', exact: true })).toHaveAttribute('href', '#/projects');
    await expect(main.getByRole('link', { name: 'Accounts', exact: true })).toHaveAttribute('href', '#/accounts');
    // The test server has Claude Code only: one row, the other agents behind one closed fold.
    await expect(main.getByRole('table', { name: 'Agents', exact: true }).getByRole('row', { name: /^Claude Code/ })).toBeVisible();
    await expect(main.getByRole('table', { name: 'Agents', exact: true }).getByRole('row')).toHaveCount(2);
    const missing = main.getByRole('table', { name: 'Agents not installed' });
    await expect(missing).toBeHidden();
    await main.getByText(/^\d+ agents not installed$/).click();
    const codex = missing.getByRole('row', { name: /^Codex/ });
    await expect(codex.getByRole('listitem')).toHaveText(['the usage feed is not available for Codex', 'the tier strip is not available for Codex']);
    await expect(codex.getByRole('cell', { name: 'not installed', exact: true })).toBeVisible();
    // A part with items that need attention is open; the others are closed.
    const global = main.getByRole('region', { name: 'Installed globally' });
    for (const part of await global.getByRole('region').all()) {
      const name = await part.getAttribute('aria-label');
      const attention = /need attention\)$/.test(await part.getByText(new RegExp(`^${name} \\(`)).textContent());
      await expect(part.getByRole('button', { name: `${attention ? 'Hide' : 'Show'} items of ${name}` })).toHaveAttribute('aria-expanded', String(attention));
    }
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

  test('Global setup: an installed agent shows a short chip per missing feature, the sentence as its tooltip on hover and focus and as text', async ({ page }) => {
    await page.route(/\/api\/overview(\?|$)/, async (route) => {
      const r = await route.fetch();
      const d = await r.json();
      for (const a of d.agents) if (a.id === 'codex') Object.assign(a, { installed: true, version: '0.1.0' });
      await route.fulfill({ response: r, json: d });
    });
    await page.goto('/#/agents');
    await page.reload();
    const codex = page.getByRole('table', { name: 'Agents', exact: true }).getByRole('row', { name: /^Codex/ });
    const chip = codex.locator('[tabindex="0"]', { hasText: 'the usage feed is not available for Codex' });
    await expect(chip).toHaveText('the usage feed is not available for Codex');
    // The sentence opens as a tooltip on keyboard focus too, not only on hover.
    await chip.focus();
    await expect(page.getByRole('tooltip')).toHaveText('the usage feed is not available for Codex');
    await page.unroute(/\/api\/overview(\?|$)/);
  });

  test('Projects: a moved folder shows Folder not found with Relocate; the notes follow it', async ({ page }) => {
    const dir = folder('mv-gone');
    await nav(page, 'Projects').click();
    const table = page.getByRole('table', { name: 'Projects' });
    await addFolder(page, dir);
    await table.getByRole('link', { name: 'mv-gone', exact: true }).click();
    await more(page, 'Edit name and notes');
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
    // A missing folder: Open folder and Remove BenchKeeper setup are not offered, and Change setup waits for Relocate.
    await detail.getByRole('button', { name: 'More', exact: true }).click();
    await expect(detail.getByRole('menuitem', { name: 'Remove from list' })).toBeVisible();
    await expect(detail.getByRole('menuitem', { name: 'Open folder' })).toHaveCount(0);
    await expect(detail.getByRole('menuitem', { name: 'Remove BenchKeeper setup' })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Change setup' })).toHaveCount(0);
    await page.keyboard.press('Escape');
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
    await more(page, 'Edit name and notes');
    await page.getByLabel('Display name').fill('Beta');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await page.getByRole('link', { name: 'All projects' }).click();
    await table.getByRole('link', { name: 'mv-pal-a', exact: true }).click();
    await more(page, 'Edit name and notes');
    await page.getByLabel('Display name').fill('Alpha');
    await page.getByRole('button', { name: /^Search/ }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByLabel('Search').fill(b);
    await expect(palette.locator('[data-selected]')).toContainText(b);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Beta' })).toBeVisible();
    await expect(page.getByLabel('Display name')).toHaveCount(0);
    await more(page, 'Edit name and notes');
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
    // A shared setup is listed too, and becomes a commit on a local branch.
    await table.getByRole('checkbox', { name: 'Select mv-local' }).uncheck();
    await table.getByRole('checkbox', { name: /^Select bk-ui-proj/ }).check();
    await bar(page).getByRole('button', { name: 'Remove setup' }).click();
    await expect(ask).toContainText('Shared setup: a commit on branch chore/remove-agent-setup removes these files, for you to push');
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

  test('Project page: skill states, activate and deactivate, reset a modified skill with its diff, adopt and remove; untracked folders stay; no axe violations', async ({ page }) => {
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
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: 'sk-proj', exact: true }).click();
    await page.getByRole('tab', { name: 'Installs' }).click();
    const states = page.getByRole('table', { name: 'Skill states' });
    const mine = states.getByRole('row');
    const own = mine.filter({ hasText: 'designing-technical-uis' });
    // The folder is gone: Update writes it again through a run (undoable), which also makes a later edit visible as modified.
    await expect(own).toContainText('removed');
    await expect(own).toContainText('BenchKeeper');
    // Check for updates keeps the button focused and the table while it loads; the check is answered without it, offline.
    let answer;
    const held = new Promise((r) => { answer = r; });
    await page.route(/\/api\/skills\?.*&check=1$/, async (route) => { await held; await route.fulfill({ response: await route.fetch({ url: route.request().url().replace('&check=1', '') }) }); });
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
    await check.click();
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
    // The switches above reload with it.
    const switches = page.getByRole('region', { name: 'Skills', exact: true });
    await expect(switches.getByRole('switch', { name: 'mermaid-diagrams' })).toBeVisible();
    expect(existsSync(join(skills, 'mine/SKILL.md'))).toBe(true);
    // Remove takes the single pick out of the project; the untracked folder is still there.
    await adopted.getByRole('button', { name: /^Remove/ }).click();
    const remove = page.getByRole('dialog', { name: 'Remove mermaid-diagrams in sk-proj' });
    await expect(remove.getByRole('group', { name: 'Remove', exact: true })).toContainText('Remove skill mermaid-diagrams');
    await remove.getByRole('button', { name: /^Apply \d+ changes?$/ }).click();
    await expect(remove.getByRole('button', { name: 'Undo run' })).toBeVisible();
    await remove.getByRole('button', { name: 'Close' }).click();
    await expect(mine.filter({ hasText: 'mermaid-diagrams' })).toHaveCount(0);
    await expect(switches.getByRole('switch', { name: 'mermaid-diagrams' })).toHaveCount(0);
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
    // No .devcontainer/ and no statement in AGENTS.md: the host.
    await expect(drawer.getByRole('radio', { name: /^Everything on the host/ })).toBeChecked();
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
    await expect(answers).toContainText('Everything on the host');
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
    await drawer.getByRole('button', { name: 'Create branch' }).click();
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

  test('Projects: Prefill all asks once, suggests per project in turn, and a shared project lands as its own branch', async ({ page }) => {
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
    await drawer.getByRole('button', { name: 'Create branch' }).click();
    await expect(drawer.getByRole('alert', { name: 'committed' })).toContainText(/push it with git -C '.*alpha' push -u origin chore\/agent-setup-/);
    await drawer.getByRole('button', { name: 'Next project' }).click();
    // No suggestion for broken: its form starts from the defaults.
    await expect(drawer.getByText(/^Prefilled from/)).toBeHidden();
    await drawer.getByRole('button', { name: 'Close' }).click();
  });
});
