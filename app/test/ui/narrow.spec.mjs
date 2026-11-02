// Long commands, keys and paths at 390 px: a CLI block wraps at spaces and never inside a flag, and a long key or path
// breaks only between its words. Read-only, so not part of the serial chain (ui-<n>-*.spec.mjs).
import { expect, test } from '@playwright/test';
import { ready } from './views.mjs';

test.describe.configure({ mode: 'parallel' });
test.beforeEach(({ page }) => page.setViewportSize({ width: 390, height: 844 }));

// The matches of pattern in the element's text that the browser laid out on more than one line, and how many lines the
// whole text takes. Measured on the rendered text, so it holds whatever markup does the breaking.
const layout = (locator, pattern, width, widths) => locator.evaluate(async (el, [source, max, widths]) => {
  // Measured in the app's font: the fallback is narrower and would hide a break.
  await document.fonts.ready;
  // A key or path as narrow as a phone column can get, so it must break wherever the page puts it.
  if (max) el.style.maxWidth = max;
  const overflow = el.scrollWidth > el.clientWidth + 1;
  const nodes = [];
  let text = '';
  for (const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); walk.nextNode();) {
    if (walk.currentNode.data) { nodes.push([walk.currentNode, text.length]); text += walk.currentNode.data; }
  }
  const at = (i) => { const [node, start] = nodes.findLast(([, s]) => s <= i); return [node, i - start]; };
  const lines = (range) => new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top))).size;
  const splitNow = () => [...text.matchAll(new RegExp(source, 'g'))].filter((m) => {
    const range = document.createRange();
    range.setStart(...at(m.index));
    const [end, offset] = at(m.index + m[0].length - 1);
    range.setEnd(end, offset + 1);
    return lines(range) > 1;
  }).map((m) => m[0]);
  const all = document.createRange();
  all.selectNodeContents(el);
  const result = { text, split: splitNow(), lines: lines(all), overflow };
  // Narrower and narrower: a break the page allows inside a match shows at one of these widths.
  for (const w of widths ?? []) { el.style.maxWidth = `${w}px`; result.split.push(...splitNow().map((m) => `${m} at ${w}px`)); }
  return result;
}, [pattern, width, widths]);

// A flag with its leading bracket: [--limit, --project, -h.
const FLAG = String.raw`\[?--?[A-Za-z][\w-]*`;
// The words of a key or path: camelCase parts and the runs between . / _ -
const WORD = '[A-Z]?[a-z0-9]+|[A-Z]+(?![a-z])';

test('390 px: a CLI block wraps at spaces and keeps every flag on one line', async ({ page }) => {
  await page.goto('/#/rules');
  await expect(ready(page)).toBeVisible();
  const cli = page.locator('pre').filter({ hasText: 'benchkeeper rules check' });
  const r = await layout(cli, FLAG, null, Array.from({ length: 19 }, (_, i) => 180 + i * 10));
  expect(r.overflow, 'the block scrolls sideways instead of wrapping').toBe(false);
  expect(r.text).toContain('benchkeeper rules check [--project <dir>] [--limit <tokens>]');
  expect(r.lines, 'the commands wrap at this width').toBeGreaterThan(r.text.split('\n').length);
  expect(r.split).toEqual([]);
});

test('390 px: a long setting key and an auto memory path break only between their words', async ({ page }) => {
  await page.goto('/#/agent-settings');
  await expect(ready(page)).toBeVisible();
  const key = page.locator('[id="setting-permissions.blockReadsOutsideWorkingDirectories"]');
  const k = await layout(key, WORD, '160px');
  expect(k.text).toBe('permissions.blockReadsOutsideWorkingDirectories');
  expect(k.lines, 'the key wraps at 160 px').toBeGreaterThan(1);
  expect(k.split).toEqual([]);

  // One auto memory folder of a project with a long path, as ui-5-settings-rules.spec.mjs stubs it.
  const folder = { project: '/home/user/workspaces/benchkeeper-projects/shop', path: '/home/user/.claude/projects/-shop/memory', enabled: true, notes: 2, bytes: 145, changed: '2026-02-03T04:05:06Z' };
  await page.route(/\/api\/rules$/, async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    await route.fulfill({ response: r, json: { ...body, agents: body.agents.map((a) => (a.id === 'claude' ? { ...a, memory: { lines: 200, bytes: 25600, folders: [folder] } } : a)) } });
  });
  await page.goto('/#/rules');
  await expect(ready(page)).toBeVisible();
  const path = page.getByRole('table', { name: 'Auto memory per project' }).locator('code').first();
  const p = await layout(path, WORD, '160px');
  expect(p.text).toBe(folder.project);
  expect(p.lines, 'the path wraps at 160 px').toBeGreaterThan(1);
  expect(p.split).toEqual([]);
});
