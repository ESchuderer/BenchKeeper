// Shared by the parts of the serial UI chain (ui-<n>-*.spec.mjs). The parts run in that order on one server, as
// projects that depend on each other (playwright.config.mjs): later tests read what earlier ones left there
// (registered and set-up projects, applied plans, undone runs), so a test cannot run alone. Read-only checks of every
// view are in views-axe.spec.mjs.
import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BATCH = join(tmpdir(), 'bk-ui-batch-4410');
export const ONE = join(tmpdir(), 'bk-ui-one-4410');
// While this file exists, the stubbed suggestion for duo and quatro waits (serve.mjs).
export const GATE = join(tmpdir(), 'bk-ui-gate-4410');
// While this file exists, the stubbed automations runner answers (serve.mjs).
export const RUNNER = join(tmpdir(), 'bk-ui-runner-4410');
// axe in both color schemes on the page as it is, after drawer and modal transitions.
export async function noAxe(page) {
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
// Agent settings: the settings that match the suggestion or have none start folded.
export const showMatching = (page) => page.getByRole('button', { name: /^Matching or without a suggestion \(\d+\)$/ }).click();
// Agent settings of Claude Code with the server's answer passed through edit; returns the route to unroute.
export const stubSettings = async (page, edit) => {
  const view = /\/api\/settings\?agent=claude$/;
  await page.route(view, async (route) => { const r = await route.fetch(); await route.fulfill({ response: r, json: edit(await r.json()) }); });
  return view;
};
export const openDiffs = async (scope) => {
  const buttons = scope.getByRole('button', { name: /^Show file diff of / });
  await expect(buttons.first()).toBeVisible();
  // An opened fold renames its button, so the first one left is always the next.
  for (let n = await buttons.count(); n > 0; n--) await buttons.first().click();
};

// Serial, and each test starts on the Dashboard with the app up.
export function opened(test) {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ context, page }) => {
    // Projects as a table unless a test picks Cards: the tests of the rows predate the cards.
    await context.addInitScript(() => { if (localStorage.getItem('bk-projects-layout') === null) localStorage.setItem('bk-projects-layout', 'table'); });
    await page.goto('/');
    // Shortcuts and the skip link exist once the app is up, behind the starting screen.
    await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
  });
}
