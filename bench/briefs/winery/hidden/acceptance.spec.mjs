// Hidden acceptance tests for the winery brief. Never mounted into the agent sandbox.
// One test per required feature. They run in order against one app instance; each makes its own
// bookings and checks seat counts relative to what it read, so one failing feature does not fail or skip the others.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const PASSWORD = process.env.STAFF_PASSWORD;
const TITLES = ['Riesling Evening', 'Red Wine Cellar Tour', 'Winter Tasting'];
const AXE_OUT = process.env.AXE_OUT || 'axe.json';
const SHOT_DIR = process.env.SHOT_DIR;

// Axe scan plus, when SHOT_DIR is set, a full-page screenshot for manual comparison.
async function scan(page, key) {
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${key}.jpg`, fullPage: true, type: 'jpeg', quality: 70 });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  let all = {};
  try { all = JSON.parse(readFileSync(AXE_OUT, 'utf8')); } catch {}
  all[key] = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
  writeFileSync(AXE_OUT, JSON.stringify(all, null, 2));
}

// Deepest element holding this tasting's title and a seat count but no other tasting's title.
const card = (page, title) => page.locator('body *').filter({ hasText: title }).filter({ hasText: /seats left/i })
  .filter({ hasNotText: new RegExp(TITLES.filter((t) => t !== title).join('|')) }).last();

async function seatsLeft(page, title) {
  await page.goto('/');
  // innerText keeps the separators between table cells, so "EUR 25" and "12 seats left" do not merge.
  const m = /(\d+)\s+seats left/i.exec(await card(page, title).innerText());
  expect(m, `seat count for ${title}`).not.toBeNull();
  return Number(m[1]);
}

const field = (page, label) => page.getByLabel(label, { exact: true }).filter({ visible: true });

// Fills and submits the booking form; returns false when a guests dropdown has no such option (the app refuses the number).
async function book(page, title, guests, email) {
  await page.goto('/');
  await page.getByRole('link', { name: `Book ${title}` }).or(page.getByRole('button', { name: `Book ${title}` })).first().click();
  await field(page, 'Name').fill('Erika Probe');
  await field(page, 'Email').fill(email);
  const g = field(page, 'Guests');
  if ((await g.evaluate((e) => e.tagName)) === 'SELECT') {
    const values = await g.locator('option').evaluateAll((os) => os.map((o) => o.value || o.textContent.trim()));
    if (!values.includes(String(guests))) return false;
    await g.selectOption(String(guests));
  } else await g.fill(String(guests));
  await page.getByRole('button', { name: 'Book', exact: true }).filter({ visible: true }).click();
  // Single-page apps submit asynchronously: wait for the request before any check or navigation.
  await page.waitForLoadState('networkidle');
  return true;
}

const confirmed = (page) => page.getByRole('heading', { name: 'Booking confirmed' });

// Signs in when the staff page asks for it; F5 alone tests that it must.
async function signIn(page) {
  await page.goto('/staff');
  if (!(await field(page, 'Password').count())) return;
  await field(page, 'Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle');
}

test('F1 start page lists tastings with seats left', async ({ page }) => {
  for (const [t, n] of [['Riesling Evening', 12], ['Red Wine Cellar Tour', 8], ['Winter Tasting', 10]]) {
    expect(await seatsLeft(page, t), t).toBe(n);
  }
  await scan(page, 'start');
});

test('F2 booking shows confirmation and takes seats', async ({ page }) => {
  const before = await seatsLeft(page, 'Red Wine Cellar Tour');
  expect(await book(page, 'Red Wine Cellar Tour', 2, 'f2@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  await expect(page.locator('body')).toContainText('Red Wine Cellar Tour');
  await expect(page.locator('body')).toContainText(/64/);
  await scan(page, 'confirmation');
  expect(await seatsLeft(page, 'Red Wine Cellar Tour')).toBe(before - 2);
});

test('F3 booking more seats than left is rejected', async ({ page }) => {
  // Bring the tasting below 8 seats first, so the request is valid except for capacity.
  expect(await book(page, 'Red Wine Cellar Tour', 2, 'f3@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  const left = await seatsLeft(page, 'Red Wine Cellar Tour');
  expect(left).toBeLessThan(8);
  await book(page, 'Red Wine Cellar Tour', left + 1, 'f3b@example.org');
  await expect(confirmed(page)).toHaveCount(0);
  expect(await seatsLeft(page, 'Red Wine Cellar Tour')).toBe(left);
});

test('F4 invalid email is rejected', async ({ page }) => {
  const before = await seatsLeft(page, 'Winter Tasting');
  expect(await book(page, 'Winter Tasting', 1, 'not-an-email')).toBe(true);
  await expect(confirmed(page)).toHaveCount(0);
  await scan(page, 'form');
  expect(await seatsLeft(page, 'Winter Tasting')).toBe(before);
});

test('F5 staff page needs the password', async ({ page }) => {
  expect(await book(page, 'Winter Tasting', 1, 'f5@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  await page.goto('/staff');
  await expect(page.locator('body')).not.toContainText('f5@example.org');
  await field(page, 'Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).not.toContainText('f5@example.org');
  await page.goto('/staff');
  await field(page, 'Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.locator('body')).toContainText('f5@example.org');
  await expect(page.locator('body')).toContainText('Erika Probe');
  await scan(page, 'staff');
});

test('F6 cancelling frees the seats', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  const before = await seatsLeft(page, 'Riesling Evening');
  expect(await book(page, 'Riesling Evening', 3, 'f6@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  expect(await seatsLeft(page, 'Riesling Evening')).toBe(before - 3);
  await signIn(page);
  const cancel = page.getByRole('button', { name: 'Cancel' });
  await page.locator('body *').filter({ hasText: 'f6@example.org' }).filter({ has: cancel }).last().locator(cancel).first().click();
  await expect.poll(() => seatsLeft(page, 'Riesling Evening')).toBe(before);
});
