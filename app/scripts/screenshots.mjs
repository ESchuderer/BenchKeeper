// Saves the app screenshots of the site's /app/ page (web/public/app/<view>-<light|dark>.png) from the UI test server in
// demo mode: a fixture home and fixture projects under one temporary root, stubbed agent commands, never the real machine.
// Run in the dev container: `cd app && npm run build && node scripts/screenshots.mjs`.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBrowser } from '../src/server.mjs';

// The port and token of test/ui/serve.mjs, which starts a server when imported.
const PORT = 4410, TOKEN = 'ui-test-token-0123456789';
const app = resolve(fileURLToPath(import.meta.url), '../..');
const out = resolve(app, '../web/public/app');
// A fixed name: the paths in the screenshots read /tmp/demo/projects/shop.
const root = join(tmpdir(), 'demo');
rmSync(root, { recursive: true, force: true });
const home = join(root, 'home');
// The server gets no other variable of this shell: the doctor reads the environment (DO_NOT_TRACK, tokens).
// What a screenshot must not show: the caller's home and the repository this runs in.
const forbidden = [...new Set([process.env.HOME, homedir(), resolve(app, '..')].filter((p) => p && p.length > 1))];

const server = spawn(process.execPath, ['test/ui/serve.mjs'], { cwd: app, env: { PATH: process.env.PATH, HOME: home, BK_DEMO_ROOT: root }, stdio: ['ignore', 'pipe', 'inherit'] });
const stop = () => { server.kill(); rmSync(root, { recursive: true, force: true }); };
process.on('exit', stop);
await new Promise((ok, fail) => {
  server.stdout.on('data', (d) => /^ready /m.test(String(d)) && ok());
  server.on('exit', (c) => fail(new Error(`the demo server exited with ${c}`)));
});

const nav = (page, view) => page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view === 'Settings' ? /^Settings$/ : view });
// [file name, steps that bring the app to the pictured state, what to cut out: a locator, or the whole window]
const VIEWS = [
  ['dashboard', async () => {}],
  ['doctor', async (page) => { await page.getByRole('region', { name: 'Doctor' }).scrollIntoViewIfNeeded(); }, (page) => page.getByRole('region', { name: 'Doctor' })],
  ['fix', async (page) => {
    await page.getByRole('button', { name: 'Fix everything' }).click();
    await expect(page.getByRole('dialog', { name: 'Fix everything' }).getByRole('checkbox').first()).toBeVisible();
  }],
  ['projects', async (page) => {
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: 'shop', exact: true }).click();
    await expect(page.getByRole('region', { name: /^Changes in / })).toBeVisible();
  }],
  ['setup', async (page) => {
    await nav(page, 'Projects').click();
    await page.getByRole('table', { name: 'Projects' }).getByRole('link', { name: 'blog', exact: true }).click();
    await page.getByRole('button', { name: 'Set up this project' }).click();
    const drawer = page.getByRole('dialog', { name: 'Set up projects' });
    await expect(drawer.getByRole('checkbox', { name: 'Claude Code' })).toBeChecked();
    // The summary step lists the answers and what the setup writes.
    for (let i = 0; i < 4; i++) await drawer.getByRole('button', { name: 'Next' }).click();
    await expect(drawer).toContainText(/\d+ changes in this checkout, in files git ignores/);
  }],
  ['sessions', async (page) => {
    await nav(page, 'Sessions').click();
    const board = page.frameLocator('iframe[title="Sessions board"]');
    await board.getByLabel('Period').selectOption('all');
    await expect(board.getByRole('table', { name: 'Sessions, newest first' })).toContainText('Fix the cart total');
  }],
  ['history', async (page) => {
    await nav(page, 'History').click();
    await page.getByRole('navigation', { name: 'Runs' }).getByRole('link', { name: /^Apply: global setup/ }).first().click();
    await expect(page.getByRole('region', { name: /^Run / })).toBeVisible();
  }],
];

// The text of the page, its dialogs and the board frame: none of it may hold a path of the machine this runs on.
async function assertFixtureOnly(page, name) {
  const texts = await Promise.all(page.frames().map((f) => f.evaluate(() => document.documentElement.outerHTML)));
  for (const p of forbidden) if (texts.some((t) => t.includes(p))) throw new Error(`${name} shows ${p}, which is not fixture data`);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  // The URL token works once per server: the first context takes the cookie and key the others reuse.
  let cookie, key;
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ baseURL: `http://127.0.0.1:${PORT}/`, viewport: { width: 1600, height: 900 }, colorScheme: scheme });
    const page = await context.newPage();
    if (!cookie) {
      await page.goto(pathToFileURL(openBrowser(`http://127.0.0.1:${PORT}/?token=${TOKEN}`, { open: () => {}, confined: () => false })).href);
      await page.waitForURL(`http://127.0.0.1:${PORT}/`);
      [cookie] = await context.cookies();
      key = await page.evaluate(() => localStorage.getItem('benchkeeper-key'));
    } else {
      await context.addCookies([cookie]);
      await context.addInitScript((k) => localStorage.setItem('benchkeeper-key', k), key);
    }
    for (const [name, steps, cut] of VIEWS) {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'BenchKeeper' })).toBeVisible();
      await steps(page);
      // Transitions of drawers and charts must have finished.
      // The board is a frame of its own.
      for (const f of page.frames()) await f.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { polling: 'raf' });
      await assertFixtureOnly(page, `${name}-${scheme}`);
      await (cut ? cut(page) : page).screenshot({ path: join(out, `${name}-${scheme}.png`) });
      console.log(`${name}-${scheme}.png`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}
