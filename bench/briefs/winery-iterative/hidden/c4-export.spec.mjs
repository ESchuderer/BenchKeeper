// Checkpoint 4 (changes/4.md): staff export bookings as CSV; without a session the export holds no bookings.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { book, confirmed, signIn } from './helpers.mjs';

test('C4 staff export bookings as CSV, not without a session', async ({ page, request }) => {
  expect(await book(page, 'Riesling Evening', 1, 'c4@example.org')).toBe(true);
  await expect(confirmed(page)).toBeVisible();
  await signIn(page);
  const link = page.getByRole('link', { name: 'Export CSV' }).or(page.getByRole('button', { name: 'Export CSV' })).first();
  const href = await link.getAttribute('href');
  // A download, or a page that shows the file.
  const download = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), link.click()]).then(([d]) => d, () => null);
  const text = download ? readFileSync(await download.path(), 'utf8') : await (await page.request.get(href)).text();
  const [header, ...rows] = text.trim().split(/\r?\n/);
  expect(header.toLowerCase()).toMatch(/name/);
  expect(header.toLowerCase()).toMatch(/email/);
  expect(rows.some((r) => r.includes('c4@example.org'))).toBe(true);
  // A client without the session: the export URL must not return bookings (a file built in the browser has no URL).
  if (href && !href.startsWith('blob:') && !href.startsWith('data:')) {
    expect(await (await request.get(new URL(href, page.url()).href)).text()).not.toContain('c4@example.org');
  }
});
