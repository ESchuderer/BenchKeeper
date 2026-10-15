// Follow-up check for static briefs: <dir>/index.html loads from file:// without page errors and shows at least one
// link (a blocked module script or fetch leaves a blank page without a page error). Usage: node opens.mjs <dir>
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Chromium resolves a missing file:// page to an error page instead of failing the navigation.
if (!existsSync(`${process.argv[2]}/index.html`)) process.exit(1);

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e));
const loaded = await page.goto(`file://${process.argv[2]}/index.html`).then(() => true, () => false);
await page.waitForTimeout(1000);
const links = loaded ? await page.getByRole('link').filter({ visible: true }).count() : 0;
await browser.close();
process.exit(loaded && links && !errors.length ? 0 : 1);
