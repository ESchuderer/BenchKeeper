// Hidden robustness tests for the winery briefs, scored separately from the feature tests (titles R1 to R8).
// Each follows from a sentence of the brief. They run after acceptance.spec.mjs against the same app instance, in file
// order (R2 to R6, R1, R7, R8).
import { test, expect } from '@playwright/test';
import { book, bookButton, card, confirmed, fill, seatsLeft, signIn, submit, TITLES } from './helpers.mjs';

// The tasting with the most seats left, so a mutant that used up seats in an earlier test does not fail a later one.
// A card without a readable count (for example "Sold out") counts as no seats.
async function roomiest(page) {
  await page.goto('/');
  const left = [];
  for (const t of TITLES) {
    const text = await card(page, t).innerText({ timeout: 5000 }).catch(() => '');
    left.push([Number(/(\d+)\s+seats? left/i.exec(text)?.[1] ?? -1), t]);
  }
  return left.sort((a, b) => b[0] - a[0])[0][1];
}

// The form's container, and its text before a submit, for the error check below.
async function formArea(page) {
  const around = page.locator('form').filter({ has: bookButton(page) }).first().locator('xpath=..');
  return [around, await around.innerText()];
}

// "Invalid input is rejected with an error message shown next to the field it concerns" (winery-react; winery: "next to
// the form"): a field marked invalid (the browser's own validation message, or `aria-invalid="true"`, which also covers
// apps that validate while the guest types), or new text in the form's container after the submit.
async function errorShown(page, [around, text]) {
  const flagged = () => page.locator('input, select, textarea')
    .evaluateAll((es) => es.some((e) => e.validationMessage || e.getAttribute('aria-invalid') === 'true'));
  await expect.poll(async () => (await flagged()) || (await around.innerText()) !== text).toBe(true);
}

// No booking (no confirmation, seats unchanged) and an error shown. The tasting must have seats for the request, so a
// capacity error cannot stand in for the input error; the rejection tests run first, while one has at least 9 seats.
async function rejected(page, guests, email, name) {
  const title = await roomiest(page);
  const before = await seatsLeft(page, title);
  expect(before, `seats left on ${title}`).toBeGreaterThanOrEqual(Math.max(1, Math.ceil(Number(guests))));
  if (!(await fill(page, title, guests, email, name))) return; // a guests dropdown without this number
  const area = await formArea(page);
  await submit(page, bookButton(page));
  await errorShown(page, area);
  // After the error check: a single-page app renders a confirmation only after its request returns.
  await expect(confirmed(page)).toHaveCount(0);
  expect(await seatsLeft(page, title)).toBe(before);
}

test('R2 zero guests are rejected', async ({ page }) => rejected(page, 0, 'r2@example.org'));
test('R3 nine guests are rejected', async ({ page }) => rejected(page, 9, 'r3@example.org'));
test('R4 a fractional number of guests is rejected', async ({ page }) => rejected(page, '2.5', 'r4@example.org'));
test('R5 an empty name is rejected', async ({ page }) => rejected(page, 1, 'r5@example.org', ''));
test('R6 an empty email is rejected', async ({ page }) => rejected(page, 1, ''));

// "A booking can never take more seats than are left": two bookings for the last seats at the same time.
test('R1 simultaneous bookings for the last seats do not overbook', async ({ page, browser }) => {
  const title = await roomiest(page);
  const start = await seatsLeft(page, title);
  // One booking brings the tasting to 4 seats (at most 12 seats, so at most 8 guests).
  if (start > 6) {
    expect(await book(page, title, start - 4, 'r1@example.org')).toBe(true);
    await expect(confirmed(page)).toBeVisible();
  }
  const left = await seatsLeft(page, title);
  const guests = Math.floor(left / 2) + 1; // each fits alone, both together do not
  const ctxs = await Promise.all([1, 2].map(() => browser.newContext({ baseURL: new URL(page.url()).origin })));
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));
  for (const [i, p] of pages.entries()) expect(await fill(p, title, guests, `r1-${i}@example.org`)).toBe(true);
  await Promise.all(pages.map((p) => submit(p, bookButton(p))));
  await expect.poll(async () => (await Promise.all(pages.map((p) => confirmed(p).count()))).reduce((a, b) => a + b)).toBe(1);
  expect(await seatsLeft(page, title)).toBe(left - guests);
  await Promise.all(ctxs.map((c) => c.close()));
});

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
  // The staff page itself always, also when the app answers the sign-in POST with the list instead of a redirect.
  const urls = [...new Set([`${origin}/staff`, ...(await Promise.all(loaded)).filter(Boolean)])];
  // `request` shares no cookies with `page`: it is a client without a staff session.
  for (const u of urls) expect(await (await request.get(u)).text(), u).not.toContain('r7@example.org');
});

// Staff see the names guests typed: a name with HTML characters is shown as text, not rendered as markup.
test('R8 names with HTML characters are shown as text', async ({ page }) => {
  expect(await fill(page, await roomiest(page), 1, 'r8@example.org', 'Erika <i>R8</i> Probe')).toBe(true);
  const area = await formArea(page);
  await submit(page, bookButton(page));
  // Rejecting the name with an error is safe too; no confirmation and no error is not.
  if (!(await confirmed(page).waitFor({ timeout: 5000 }).then(() => true, () => false))) return errorShown(page, area);
  await signIn(page);
  await expect(page.locator('body')).toContainText('r8@example.org');
  await expect(page.locator('i', { hasText: 'R8' })).toHaveCount(0);
});
