// Hidden acceptance tests for the cartridges brief. Never mounted into the agent sandbox.
// One test per required feature (C1 to C6). The app is static: C1 to C5 run over HTTP (the scorer's static server),
// C6 opens the delivered files from disk (APP_DIR, mounted read-only). Each test starts from the start page.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const AXE_OUT = process.env.AXE_OUT || 'axe.json';
const SHOT_DIR = process.env.SHOT_DIR;
const APP_DIR = process.env.APP_DIR || '/app';
const NAMES = [
  '17 HMR', '223 Rem.', '22 Long Rifle', '22 Win. Mag. R.F.', '243 Win.', '270 Win.', '30-06 Spring.', '300 Win. Mag.',
  '308 Win.', '338 Lapua Mag.', '357 Magnum', '38 Special', '40 S.& W.', '44 Rem. Mag.', '45 Auto', '6,5 Creedmoor',
  '6,5 x 55 SE', '7,62 x 39', '7 mm Rem. Mag.', '7 x 64', '7 x 65 R', '8 x 57 IS', '9,3 x 62', '9,3 x 74 R', '9 mm Luger',
];
// Detail views screenshotted and scanned: one per geometry rule (key, name).
const SHOWN = [
  ['308_win', '308 Win.'], ['300_win_mag', '300 Win. Mag.'], ['9_3_x_74_r', '9,3 x 74 R'],
  ['9_mm_luger', '9 mm Luger'], ['22_long_rifle', '22 Long Rifle'], ['44_rem_mag', '44 Rem. Mag.'],
];

// Axe scan plus, when SHOT_DIR is set, a full-page screenshot for the app review.
async function scan(page, key) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${key}.jpg`, fullPage: true, type: 'jpeg', quality: 70 });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  let all = {};
  try { all = JSON.parse(readFileSync(AXE_OUT, 'utf8')); } catch {}
  all[key] = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  writeFileSync(AXE_OUT, JSON.stringify(all, null, 2));
}

const link = (page, name) => page.getByRole('link', { name, exact: true }).filter({ visible: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true }).filter({ visible: true }).first();

// A detail view is showing: its heading and the "All cartridges" link (a list page may also carry the names).
async function isDetail(page, name) {
  await expect(heading(page, name)).toBeVisible();
  await expect(link(page, 'All cartridges').first()).toBeVisible();
}

async function open(page, name) {
  await page.goto('/');
  await link(page, name).first().click();
  await isDetail(page, name);
}

// The cartridge names currently listed, in NAMES order.
async function listed(page) {
  const out = [];
  for (const n of NAMES) if (await link(page, n).count()) out.push(n);
  return out;
}

// The drawing: an <svg> named "<name> drawing" (role img with aria-label, or a <title>), or the <svg> inside an
// element with that name.
async function drawing(page, name) {
  const label = `${name} drawing`;
  const named = page.getByRole('img', { name: label, exact: true })
    .or(page.locator('svg').filter({ has: page.locator(':scope > title', { hasText: label }) }))
    .or(page.locator(`svg[aria-label="${label}"]`)).filter({ visible: true }).first();
  await expect(named, label).toBeVisible();
  return (await named.evaluate((e) => e.localName)) === 'svg' ? named : named.locator('svg').first();
}

// A table row whose symbol cell is exactly `symbol` and whose text matches every pattern.
const row = (page, symbol, ...texts) => texts.reduce((l, t) => l.filter({ hasText: t }), page.getByRole('row').filter({
  has: page.getByRole('cell', { name: symbol, exact: true }).or(page.getByRole('rowheader', { name: symbol, exact: true })),
}));

const pdfPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

test('C1 start page lists all cartridges', async ({ page }) => {
  await page.goto('/');
  await expect(heading(page, 'Cartridges')).toBeVisible();
  await expect.poll(() => listed(page)).toEqual(NAMES);
  await expect(page.getByText(/\b25 cartridges\b/).first()).toBeVisible();
  await scan(page, 'list');
});

test('C2 search by alternative name and filter by family', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search', { exact: true }).fill('7,62 x 51');
  await expect.poll(() => listed(page)).toEqual(['308 Win.']);
  await page.goto('/');
  const family = page.getByLabel('Family', { exact: true });
  const belted = await family.locator('option').evaluateAll((os) => os.find((o) => o.textContent.trim().toLowerCase() === 'belted')?.value);
  expect(belted, 'option "belted"').toBeDefined();
  await family.selectOption(belted);
  await expect.poll(async () => (await listed(page)).sort()).toEqual(['300 Win. Mag.', '7 mm Rem. Mag.']);
  await expect(page.getByText(/\b2 cartridges\b/).first()).toBeVisible();
});

test('C3 detail view shows the published values', async ({ page }) => {
  for (const [key, name] of SHOWN) {
    await open(page, name);
    await scan(page, `detail-${key}`);
  }
  await open(page, '308 Win.');
  await expect(row(page, 'L3', '51.18').first()).toBeVisible();
  await expect(row(page, 'Pmax', '4150', 'bar').first()).toBeVisible();
  await expect(row(page, 'L1', '39.62', /[-−]\s?0\.2(?!\d)/).first()).toBeVisible();
  await expect(page.locator('body')).toContainText('mm');
  await open(page, '338 Lapua Mag.');
  await expect(row(page, 'α', /39°\s?59['′’]\s?49["″”]/).first()).toBeVisible();
});

test('C4 drawing is computed from the values', async ({ page }) => {
  for (const [name, l3, l6, capped] of [
    ['308 Win.', '51.18', '71.12', true], ['9 mm Luger', '19.15', '29.69', false],
    ['22 Long Rifle', '15.57', '25.4', false], ['300 Win. Mag.', '66.55', '84.84', true],
  ]) {
    await open(page, name);
    const svg = await drawing(page, name);
    const text = await svg.evaluate((e) => e.textContent);
    for (const s of ['L3', l3, 'L6', l6]) expect(text, `${name} drawing shows ${s}`).toContain(s);
    // 1 user unit = 1 mm: the viewBox holds the whole cartridge and is not in pixels.
    const width = await svg.evaluate((e) => e.viewBox?.baseVal?.width || 0);
    expect(width, `${name} viewBox width`).toBeGreaterThanOrEqual(Number(l6));
    if (capped) expect(width, `${name} viewBox width`).toBeLessThanOrEqual(4 * Number(l6));
  }
});

test('C5 print view', async ({ page }) => {
  await open(page, '308 Win.');
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print', exact: true }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByLabel('Search', { exact: true }).filter({ visible: true })).toHaveCount(0);
  await drawing(page, '308 Win.');
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/print-308_win.jpg`, fullPage: true, type: 'jpeg', quality: 70 });
  for (const name of ['308 Win.', '9,3 x 74 R']) {
    // Back to no emulation: page.pdf() renders print CSS only then (emulated screen media would print as screen).
    await page.emulateMedia({ media: null });
    await open(page, name);
    expect(pdfPages(await page.pdf({ format: 'A4' })), `${name} printed pages`).toBe(1);
  }
});

test('C6 opens from disk with an address per detail view', async ({ page }) => {
  const remote = [];
  page.on('request', (r) => { if (/^(https?|wss?):/.test(r.url())) remote.push(r.url()); });
  page.on('websocket', (w) => remote.push(w.url()));
  await page.goto(`file://${APP_DIR}/index.html`);
  await link(page, '9 mm Luger').first().click();
  await isDetail(page, '9 mm Luger');
  await page.reload();
  await isDetail(page, '9 mm Luger');
  expect(remote).toEqual([]);
});
