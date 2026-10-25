// Helpers shared by the hidden test files (not a test file itself: no `.spec` in the name).
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync } from 'node:fs';

export const PASSWORD = process.env.STAFF_PASSWORD;
export const TITLES = ['Riesling Evening', 'Red Wine Cellar Tour', 'Winter Tasting'];
const AXE_OUT = process.env.AXE_OUT || 'axe.json';
const SHOT_DIR = process.env.SHOT_DIR;

// Axe scan plus, when SHOT_DIR is set, a full-page screenshot for manual comparison.
export async function scan(page, key) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${key}.jpg`, fullPage: true, type: 'jpeg', quality: 70 });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  let all = {};
  try { all = JSON.parse(readFileSync(AXE_OUT, 'utf8')); } catch {}
  all[key] = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  writeFileSync(AXE_OUT, JSON.stringify(all, null, 2));
}

// Deepest element holding this tasting's title and a seat count but no other tasting's title.
export const card = (page, title) => page.locator('body *').filter({ hasText: title }).filter({ hasText: /seats? left/i })
  .filter({ hasNotText: new RegExp(TITLES.filter((t) => t !== title).join('|')) }).last();

export async function seatsLeft(page, title) {
  await page.goto('/');
  // innerText keeps the separators between table cells, so "EUR 25" and "12 seats left" do not merge.
  const m = /(-?(?<!\d)\d+(?:[.,]\d+)?)\s+seats? left/i.exec(await card(page, title).innerText());
  expect(m, `seat count for ${title}`).not.toBeNull();
  return Number(m[1].replace(',', '.'));
}

export const field = (page, label) => page.getByLabel(label, { exact: true }).filter({ visible: true });

// Opens and fills the booking form; returns false when a guests dropdown has no such option (the app refuses the number).
export async function fill(page, title, guests, email, name = 'Erika Probe') {
  await page.goto('/');
  await page.getByRole('link', { name: `Book ${title}` }).or(page.getByRole('button', { name: `Book ${title}` })).first().click();
  await field(page, 'Name').fill(name);
  await field(page, 'Email').fill(email);
  const g = field(page, 'Guests');
  if ((await g.evaluate((e) => e.tagName)) === 'SELECT') {
    const values = await g.locator('option').evaluateAll((os) => os.map((o) => o.value || o.textContent.trim()));
    if (!values.includes(String(guests))) return false;
    await g.selectOption(String(guests));
  } else await g.fill(String(guests));
  return true;
}

export const bookButton = (page) => page.getByRole('button', { name: 'Book', exact: true }).filter({ visible: true });

// Fills and submits the booking form; returns false when a guests dropdown has no such option (the app refuses the number).
export async function book(page, title, guests, email, name) {
  if (!(await fill(page, title, guests, email, name))) return false;
  await submit(page, bookButton(page));
  return true;
}

// Clicks and waits for the request it triggers: a form post (new document) or a single-page app's fetch.
// No request within 5 s (for example client-side validation) is fine; a check or navigation follows either way.
export async function submit(page, button) {
  const sent = page.waitForResponse((r) => r.request().method() !== 'GET', { timeout: 5000 }).catch(() => null);
  await button.click();
  await sent;
  await page.waitForLoadState('load');
}

export const confirmed = (page) => page.getByRole('heading', { name: 'Booking confirmed' });

// Signs in when the staff page asks for it; F5 alone tests that it must.
export async function signIn(page) {
  await page.goto('/staff');
  // Wait until the page shows either the sign-in form or the signed-in list (it may load the session first).
  await expect(field(page, 'Password').or(page.getByRole('button', { name: 'Cancel' })).first()).toBeVisible();
  if (!(await field(page, 'Password').count())) return;
  await field(page, 'Password').fill(PASSWORD);
  await submit(page, page.getByRole('button', { name: 'Sign in' }));
}
