// Helpers shared by the hidden test files (not a test file itself: no `.spec` in the name).
// Expected values come from the baseline commit (BASE_DIR: its lib/ and data/), never from the agent's copy.
import { expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const BASE = process.env.BASE_DIR || '/base';
const SHOT_DIR = process.env.SHOT_DIR;
const { formatValue } = await import(`${BASE}/lib/core/format.ts`);
const { FIELD_LABELS, FIELD_UNITS } = await import(`${BASE}/lib/core/fields.ts`);
const { adaptMetallic, caseOuterProfile } = await import(`${BASE}/lib/shapes2d/case.ts`);
export { formatValue };

const DATA = `${BASE}/data/cartridges`;
export function record(key) {
  const family = readdirSync(DATA).find((f) => existsSync(`${DATA}/${f}/${key}.json`));
  return JSON.parse(readFileSync(`${DATA}/${family}/${key}.json`, 'utf8'));
}

// The rows steps/2.md defines: numeric millimetre fields of the cartridge side, no tolerances, by sheet label.
export function lengths(rec) {
  const out = new Map();
  for (const group of Object.values(rec.cartridge)) {
    if (Array.isArray(group)) continue;
    for (const [field, value] of Object.entries(group)) {
      if (typeof value === 'number' && !field.endsWith('Tol') && !(field in FIELD_UNITS)) out.set(FIELD_LABELS[field] ?? field, value);
    }
  }
  return out;
}

export const outline = (rec) => caseOuterProfile(adaptMetallic(rec));

// In-app navigation: the start page, then a hash change (only S2-route reloads).
export async function go(page, hash) {
  await page.goto('/');
  await page.evaluate((h) => { location.hash = h; }, hash);
}

export async function setUnits(page, label) {
  await go(page, '#/data');
  await page.getByLabel('Default units', { exact: true }).selectOption({ label });
}

export const table = (page, unit) => page.getByRole('table', { name: `Dimensions (${unit})`, exact: true });

// { headers: [...], rows: { symbol: [cell texts] } } from the table's rows, th or td alike.
export async function readTable(locator) {
  await expect(locator).toBeVisible();
  return locator.evaluate((t) => {
    const trs = [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => c.innerText.trim()));
    const rows = {};
    for (const cells of trs.slice(1)) rows[cells[0]] = cells;
    return { headers: trs[0] ?? [], rows };
  });
}

// Column indexes of A, B and Difference by their exact header text.
export function columns(t, a, b) {
  const idx = [a, b, 'Difference'].map((h) => t.headers.indexOf(h));
  expect(idx, `headers ${JSON.stringify(t.headers)}`).not.toContain(-1);
  expect(t.headers[0], 'first header').toBe('Symbol');
  return idx;
}

// A number as the page writes it: a typographic minus or a plus sign is accepted.
export const num = (text) => Number(String(text).replace(/[−‒–]/g, '-').replace(/^\+/, '').replace(/\s/g, ''));

export async function drawing(page, a, b) {
  const label = `Profiles of ${a} and ${b}`;
  const named = page.getByRole('img', { name: label, exact: true })
    .or(page.locator('svg').filter({ has: page.locator(':scope > title', { hasText: label }) }))
    .filter({ visible: true }).first();
  await expect(named, label).toBeVisible();
  return (await named.evaluate((e) => e.localName)) === 'svg' ? named : named.locator('svg').first();
}

// Every path, polyline and polygon in the drawing, sampled along its length, in page pixels.
async function sampled(svg) {
  // Elements under a tenth of the drawing's size (arrows, ticks, hatching) cannot be an outline; skipping them keeps
  // a drawing with many of them fast.
  return svg.evaluate((root) => [...root.querySelectorAll('path, polyline, polygon')].map((el) => {
    const [r, e] = [root.getBoundingClientRect(), el.getBoundingClientRect()];
    if (Math.max(e.width, e.height) < Math.max(r.width, r.height) / 10) return [];
    const total = el.getTotalLength?.() || 0;
    const m = el.getScreenCTM();
    if (!total || !m) return [];
    const n = 4000;
    return Array.from({ length: n + 1 }, (_, i) => {
      const p = el.getPointAtLength((total * i) / n).matrixTransform(m);
      return [p.x, p.y];
    });
  }));
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function toSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}
// Distance from p to the sampled polyline; long jumps between samples are subpath moves, not lines.
function toPolyline(p, pts, step) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    best = Math.min(best, dist(p, pts[i]));
    if (i && dist(pts[i - 1], pts[i]) <= 3 * step) best = Math.min(best, toSegment(p, pts[i - 1], pts[i]));
  }
  return best;
}

/**
 * The best fit of a profile (half-profile [r, z] in mm) onto one drawn element: the element's bounding box fixes the
 * similarity (axis along x or y, either direction, full section or half profile), then the profile's vertices and
 * segment midpoints must lie on the element. Returns the largest deviation in mm and the mapping.
 */
function fit(profile, pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const box = { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
  const zs = profile.map((p) => p[1]), rs = profile.map((p) => p[0]);
  const [zlo, zhi, rmax, rmin] = [Math.min(...zs), Math.max(...zs), Math.max(...rs), Math.min(...rs)];
  const samples = profile.flatMap((p, i) => (i ? [[(p[0] + profile[i - 1][0]) / 2, (p[1] + profile[i - 1][1]) / 2], p] : [p]));
  // Sample spacing, ignoring the few long jumps where a subpath starts.
  const step = Math.max(pts.slice(1).map((p, i) => dist(p, pts[i])).sort((x, y) => x - y)[pts.length - 12] ?? 0, 1e-9);
  let best = { err: Infinity };
  for (const alongX of [true, false]) for (const zs_ of [1, -1]) for (const rs_ of [1, -1]) for (const [rlo, rhi] of [[-rmax, rmax], [rmin, rmax], [0, rmax]]) {
    const [a0, a1] = alongX ? box.x : box.y, [c0, c1] = alongX ? box.y : box.x;
    const s = (a1 - a0) / (zhi - zlo);
    if (!(s > 0) || Math.abs(c1 - c0 - s * (rhi - rlo)) > 0.2 * s) continue;
    const map = ([r, z]) => {
      const a = zs_ > 0 ? a0 + s * (z - zlo) : a1 - s * (z - zlo), c = rs_ > 0 ? c0 + s * (r - rlo) : c1 - s * (r - rlo);
      return alongX ? [a, c] : [c, a];
    };
    let err = 0;
    for (const p of samples) { err = Math.max(err, toPolyline(map(p), pts, step) / s); if (err >= best.err) break; }
    if (err < best.err) best = { err, s, alongX, zs: zs_, head: map([0, 0]) };
  }
  return best;
}

/** Checks that both outlines are drawn as caseOuterProfile computes them, on one axis at one scale, heads aligned. */
export async function checkOverlay(page, keyA, keyB, tolMm = 0.1) {
  const [ra, rb] = [record(keyA), record(keyB)];
  const svg = await drawing(page, ra.name, rb.name);
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/compare-${keyA}-${keyB}.jpg`, fullPage: true, type: 'jpeg', quality: 70 });
  const elements = (await sampled(svg)).filter((pts) => pts.length > 1);
  const best = (profile, skip) => elements.map((pts, i) => ({ i, ...(i === skip ? { err: Infinity } : fit(profile, pts)) }))
    .reduce((x, y) => (y.err < x.err ? y : x), { err: Infinity });
  const fa = best(outline(ra), -1);
  expect(fa.err, `${ra.name}: largest deviation of the drawn outline from caseOuterProfile, mm`).toBeLessThanOrEqual(tolMm);
  const fb = best(outline(rb), fa.i);
  expect(fb.err, `${rb.name}: largest deviation of the drawn outline from caseOuterProfile, mm`).toBeLessThanOrEqual(tolMm);
  expect(Math.abs(fa.s - fb.s) / fa.s, 'both outlines at one scale').toBeLessThan(0.01);
  expect([fa.alongX, fa.zs], 'both outlines facing the same way').toEqual([fb.alongX, fb.zs]);
  expect(dist(fa.head, fb.head) / fa.s, 'head faces at one point on one axis, mm').toBeLessThanOrEqual(2 * tolMm);
}
