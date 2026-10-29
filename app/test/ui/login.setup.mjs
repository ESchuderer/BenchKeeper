// Runs before the spec files: the URL token works once per server, so this signs in and saves the cookie and the API
// key as the storage state every test starts with (playwright.config.mjs).
import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { openBrowser } from '../../src/server.mjs';
import { STATE } from '../../playwright.config.mjs';

const TOKEN = 'ui-test-token-0123456789';

test('the token becomes a cookie and an API key; both leave the address bar', async ({ page, context }) => {
  // The token comes through the file the app opens the browser with, so the cookie must survive that cross-site start.
  await page.goto(pathToFileURL(openBrowser(`http://127.0.0.1:4410/?token=${TOKEN}`, { open: () => {}, confined: () => false })).href);
  await page.waitForURL('http://127.0.0.1:4410/');
  const [cookie] = await context.cookies();
  expect(await page.evaluate(() => localStorage.getItem('benchkeeper-key'))).toMatch(/^[\w-]{43}$/);
  expect(cookie).toMatchObject({ name: "bk_session_4410", httpOnly: true, sameSite: 'Strict' });
  await expect(page.getByRole('heading', { level: 1, name: 'BenchKeeper' })).toBeVisible();
  await context.storageState({ path: STATE });
});
