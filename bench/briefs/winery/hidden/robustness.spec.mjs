// Hidden robustness tests for the winery briefs, scored separately from the feature tests (titles R1 to R8).
// Each follows from a sentence of the brief. They run after acceptance.spec.mjs against the same app instance.
import { test, expect } from '@playwright/test';
import { book, bookButton, confirmed, fill, seatsLeft, signIn, submit, TITLES } from './helpers.mjs';

// The tasting with the most seats left, so a mutant that used up seats in an earlier test does not fail a later one.
async function roomiest(page) {
  const left = [];
  for (const t of TITLES) left.push([await seatsLeft(page, t), t]);
  return left.sort((a, b) => b[0] - a[0])[0][1];
}

// "A booking can never take more seats than are left": two bookings for the last seats at the same time.
test('R1 simultaneous bookings for the last seats do not overbook', async ({ page, browser }) => {
  expect(await book(page, 'Riesling Evening', 8, 'r1@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  const left = await seatsLeft(page, 'Riesling Evening');
  const guests = Math.floor(left / 2) + 1; // each fits alone, both together do not
  const ctxs = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: new URL(page.url()).origin })));
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));
  for (const [i, p] of pages.entries()) expect(await fill(p, 'Riesling Evening', guests, `r1-${i}@example.org`)).toBe(true);
  await Promise.all(pages.map((p) => submit(p, bookButton(p))));
  await expect.poll(async () => (await Promise.all(pages.map((p) => confirmed(p).count()))).reduce((a, b) => a + b)).toBe(1);
  expect(await seatsLeft(page, 'Riesling Evening')).toBe(left - guests);
  await Promise.all(ctxs.map((c) => c.close()));
});

// "Invalid input is rejected with an error message shown next to the field it concerns" (winery-react; winery: "next to
// the form"): no booking, and either the browser's own validation message on a field or new text in the form's container.
async function rejected(page, guests, email, name) {
  const title = await roomiest(page); // a capacity error must not stand in for the input error
  const before = await seatsLeft(page, title);
  if (!(await fill(page, title, guests, email, name))) return; // a guests dropdown without this number
  const around = page.locator('form').filter({ has: bookButton(page) }).first().locator('xpath=..');
  const text = await around.innerText();
  await submit(page, bookButton(page));
  await expect(confirmed(page)).toHaveCount(0);
  const native = await page.locator('input, select, textarea').evaluateAll((es) => es.some((e) => e.validationMessage));
  if (!native) await expect.poll(() => around.innerText()).not.toBe(text);
  expect(await seatsLeft(page, title)).toBe(before);
}

test('R2 zero guests are rejected', async ({ page }) => rejected(page, 0, 'r2@example.org'));
test('R3 nine guests are rejected', async ({ page }) => rejected(page, 9, 'r3@example.org'));
test('R4 a fractional number of guests is rejected', async ({ page }) => rejected(page, '2.5', 'r4@example.org'));
test('R5 an empty name is rejected', async ({ page }) => rejected(page, 1, 'r5@example.org', ''));
test('R6 an empty email is rejected', async ({ page }) => rejected(page, 1, ''));

// "The page /staff asks for a password": no URL the signed-in staff page loads returns bookings without the session.
test('R7 booking data is not readable without sign-in', async ({ page, request }) => {
  expect(await book(page, await roomiest(page), 1, 'r7@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  const origin = new URL(page.url()).origin;
  const loaded = [];
  page.on('response', (r) => {
    if (r.request().method() === 'GET' && r.url().startsWith(origin)) loaded.push(r.text().then((t) => (t.includes('r7@example.org') ? r.url() : null), () => null));
  });
  await signIn(page);
  await expect(page.locator('body')).toContainText('r7@example.org');
  const urls = [...new Set((await Promise.all(loaded)).filter(Boolean))];
  expect(urls.length, 'URLs that returned the booking while signed in').toBeGreaterThan(0);
  // `request` shares no cookies with `page`: it is a client without a staff session.
  for (const u of urls) expect(await (await request.get(u)).text(), u).not.toContain('r7@example.org');
});

// Staff see the names guests typed: a name with HTML characters is shown as text, not rendered as markup.
test('R8 names with HTML characters are shown as text', async ({ page }) => {
  expect(await book(page, await roomiest(page), 1, 'r8@example.org', 'Erika <i>R8</i> Probe')).toBe(true);
  // Rejecting the name is safe too.
  if (!(await confirmed(page).waitFor({ timeout: 5000 }).then(() => true, () => false))) return;
  await signIn(page);
  await expect(page.locator('body')).toContainText('r8@example.org');
  await expect(page.locator('i', { hasText: 'R8' })).toHaveCount(0);
});
