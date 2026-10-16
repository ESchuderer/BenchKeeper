// Hidden tests of step 3 (the review round, steps/3.md): the bug and the style point. Regressions: step2.spec.mjs.
import { test, expect } from '@playwright/test';
import { columns, formatValue, go, lengths, readTable, record, table } from './helpers.mjs';

const PAIRS = [['308_win', '300_win_mag'], ['9_mm_luger', '357_magnum']];

test('S3-bug a symbol only one cartridge publishes has a row with the other value and the difference empty', async ({ page }) => {
  for (const [a, b] of PAIRS) {
    const [ra, rb] = [record(a), record(b)];
    await go(page, `#/compare/${a}/${b}`);
    const t = await readTable(table(page, 'mm'));
    const [ia, ib, id] = columns(t, ra.name, rb.name);
    const [la, lb] = [lengths(ra), lengths(rb)];
    const only = [...[...la].filter(([s]) => !lb.has(s)).map(([s, v]) => [s, formatValue(v), '']),
      ...[...lb].filter(([s]) => !la.has(s)).map(([s, v]) => [s, '', formatValue(v)])];
    expect(only.length, `${a}/${b}: symbols only one publishes`).toBeGreaterThan(0);
    for (const [symbol, va, vb] of only) {
      expect(t.rows[symbol], `${a}/${b}: row ${symbol}`).toBeDefined();
      const cells = t.rows[symbol];
      expect([cells[ia], cells[ib], cells[id]], `${a}/${b} ${symbol}: A, B, Difference`).toEqual([va, vb, '']);
    }
  }
});

test('S3-style the A, B and Difference columns are right-aligned, headers included', async ({ page }) => {
  const [a, b] = PAIRS[0];
  await go(page, `#/compare/${a}/${b}`);
  const t = table(page, 'mm');
  const [ia, ib, id] = columns(await readTable(t), record(a).name, record(b).name);
  const aligns = await t.evaluate((el, idx) => [...el.querySelectorAll('tr')].flatMap((tr) =>
    idx.map((i) => tr.children[i]).filter(Boolean).map((c) => `${c.innerText.trim() || '(empty)'}: ${getComputedStyle(c).textAlign}`)), [ia, ib, id]);
  expect(aligns.length).toBeGreaterThan(3);
  expect(aligns.filter((s) => !/: (right|end|-webkit-right)$/.test(s)), 'cells not right-aligned').toEqual([]);
});
