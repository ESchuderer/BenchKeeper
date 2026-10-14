// Hidden acceptance tests for the winery brief. Never mounted into the agent sandbox.
// One test per required feature; they share one app instance and run in order.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';

const PASSWORD = process.env.STAFF_PASSWORD;
const GUEST = { name: 'Erika Probe', email: 'erika.probe@example.org' };
const axe = {};

async function scan(page, key) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  axe[key] = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
}

const card = (page, title) => page.locator('li, article, section, tr, div').filter({ hasText: title }).filter({ hasText: /seats left/i }).last();

async function book(page, title, guests, email = GUEST.email) {
  await page.goto('/');
  await page.getByRole('link', { name: `Book ${title}` }).or(page.getByRole('button', { name: `Book ${title}` })).first().click();
  await page.getByLabel('Name', { exact: true }).fill(GUEST.name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Guests', { exact: true }).fill(String(guests));
  await page.getByRole('button', { name: 'Book', exact: true }).click();
}

test.describe.serial('winery', () => {
  test.afterAll(() => writeFileSync(process.env.AXE_OUT || 'axe.json', JSON.stringify(axe, null, 2)));

  test('F1 start page lists tastings with seats left', async ({ page }) => {
    await page.goto('/');
    for (const [t, n] of [['Riesling Evening', 12], ['Red Wine Cellar Tour', 8], ['Winter Tasting', 10]]) {
      await expect(card(page, t)).toContainText(new RegExp(`\\b${n} seats left`, 'i'));
    }
    await scan(page, 'start');
  });

  test('F2 booking shows confirmation and takes seats', async ({ page }) => {
    await book(page, 'Red Wine Cellar Tour', 2);
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible();
    await expect(page.locator('body')).toContainText('Red Wine Cellar Tour');
    await expect(page.locator('body')).toContainText(/64/);
    await scan(page, 'confirmation');
    await page.goto('/');
    await expect(card(page, 'Red Wine Cellar Tour')).toContainText(/\b6 seats left/i);
  });

  test('F3 booking more seats than left is rejected', async ({ page }) => {
    await book(page, 'Red Wine Cellar Tour', 7);
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toHaveCount(0);
    await page.goto('/');
    await expect(card(page, 'Red Wine Cellar Tour')).toContainText(/\b6 seats left/i);
  });

  test('F4 invalid email is rejected', async ({ page }) => {
    await book(page, 'Winter Tasting', 1, 'not-an-email');
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toHaveCount(0);
    await scan(page, 'form');
    await page.goto('/');
    await expect(card(page, 'Winter Tasting')).toContainText(/\b10 seats left/i);
  });

  test('F5 staff page needs the password', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.locator('body')).not.toContainText(GUEST.email);
    await page.getByLabel('Password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('body')).not.toContainText(GUEST.email);
    await page.goto('/staff');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('body')).toContainText(GUEST.email);
    await expect(page.locator('body')).toContainText(GUEST.name);
    await scan(page, 'staff');
  });

  test('F6 cancelling frees the seats', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto('/staff');
    if (await page.getByLabel('Password', { exact: true }).count()) {
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
    }
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.locator('body')).not.toContainText(GUEST.email);
    await page.goto('/');
    await expect(card(page, 'Red Wine Cellar Tour')).toContainText(/\b8 seats left/i);
  });
});
