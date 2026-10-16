// Hidden tests of step 2 (the compare view). One test per check id; expected values from the baseline's records and
// libraries (helpers.mjs). Every test but S2-route navigates inside the app, so a broken reload fails only S2-route.
import { test, expect } from '@playwright/test';
import { checkOverlay, columns, formatValue, go, lengths, num, readTable, record, setUnits, table } from './helpers.mjs';

const PAIRS = [['308_win', '300_win_mag'], ['9_mm_luger', '357_magnum']];

async function headersOf(page, a, b) {
  const t = await readTable(table(page, 'mm'));
  columns(t, record(a).name, record(b).name);
}

test('S2-route a compare URL opens directly and survives a reload, ids in either order', async ({ page }) => {
  await page.goto('/#/compare/308_win/300_win_mag');
  await headersOf(page, '308_win', '300_win_mag');
  await page.reload();
  await headersOf(page, '308_win', '300_win_mag');
  await page.goto('/#/compare/300_win_mag/308_win');
  await page.reload();
  await headersOf(page, '300_win_mag', '308_win');
});

test('S2-delta A, B and the difference B minus A per symbol both cartridges publish', async ({ page }) => {
  for (const [a, b] of PAIRS) {
    const [ra, rb] = [record(a), record(b)];
    await go(page, `#/compare/${a}/${b}`);
    const t = await readTable(table(page, 'mm'));
    const [ia, ib, id] = columns(t, ra.name, rb.name);
    const lb = lengths(rb);
    for (const [symbol, va] of lengths(ra)) {
      if (!lb.has(symbol)) continue;
      const vb = lb.get(symbol), cells = t.rows[symbol];
      expect(cells, `${a}/${b}: row ${symbol}`).toBeDefined();
      expect([cells[ia], cells[ib]], `${a}/${b} ${symbol}: A and B as formatValue writes them`).toEqual([formatValue(va), formatValue(vb)]);
      expect(Math.abs(num(cells[id]) - (vb - va)), `${a}/${b} ${symbol}: difference "${cells[id]}", expected ${vb - va}`).toBeLessThan(1e-9);
    }
  }
});

test('S2-overlay both outer profiles on one axis, matching caseOuterProfile', async ({ page }) => {
  for (const [a, b] of PAIRS) {
    await go(page, `#/compare/${a}/${b}`);
    await checkOverlay(page, a, b);
  }
});

test('S2-units lengths follow the Default units preference, converted without rounding', async ({ page }) => {
  const [a, b] = PAIRS[0], [ra, rb] = [record(a), record(b)];
  await setUnits(page, 'Imperial');
  await page.evaluate((h) => { location.hash = h; }, `#/compare/${a}/${b}`);
  const t = await readTable(table(page, 'in'));
  const [ia, ib, id] = columns(t, ra.name, rb.name);
  const lb = lengths(rb);
  for (const [symbol, va] of lengths(ra)) {
    if (!lb.has(symbol)) continue;
    const cells = t.rows[symbol];
    expect(cells, `row ${symbol}`).toBeDefined();
    for (const [cell, v, who] of [[cells[ia], va, ra.name], [cells[ib], lb.get(symbol), rb.name]]) {
      expect(Math.abs(num(cell) - v / 25.4), `${who} ${symbol}: "${cell}" in, expected ${v / 25.4}`).toBeLessThan(1e-9);
    }
    // Sign-free: the sign is S2-delta's.
    const d = Math.abs(lb.get(symbol) - va) / 25.4;
    expect(Math.abs(Math.abs(num(cells[id])) - d), `difference ${symbol}: "${cells[id]}" in, expected ${d} in magnitude`).toBeLessThan(1e-9);
  }
  await setUnits(page, 'Metric');
  await page.evaluate((h) => { location.hash = h; }, `#/compare/${a}/${b}`);
  await expect(table(page, 'mm')).toBeVisible();
});

test('S2-link the detail page opens the compare view', async ({ page }) => {
  await go(page, '#/c/308_win');
  await page.getByLabel('Compare with', { exact: true }).selectOption({ label: '300 Win. Mag.' });
  await page.getByRole('button', { name: 'Compare', exact: true }).or(page.getByRole('link', { name: 'Compare', exact: true })).first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/compare/308_win/300_win_mag');
  await headersOf(page, '308_win', '300_win_mag');
});
