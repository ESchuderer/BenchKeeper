// Print check of the cartridges app: for each cartridge, the detail view printed to PDF (A4 portrait) must be one page and
// its drawing at least 80% of the printable width (A4 width minus the @page side margins, measured in print media).
// Drawing locator and page count as in bench/briefs/cartridges/hidden/acceptance.spec.mjs. Needs Chromium (Playwright image).
// Usage: node bench/scorer/print.mjs <app-dir> <brief.md> [rendered-detail.html]   prints JSON; the app is served on localhost
import { createServer } from 'node:http';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const A4_PX = 793.7;
const pdfPages = (pdf) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;

export const cartridgeNames = (brief) => readFileSync(brief, 'utf8').split('\n').flatMap((l) => (l.startsWith('{') ? [JSON.parse(l).name] : []));

export function serve(dir) {
  const root = resolve(dir);
  const realRoot = realpathSync(root);
  const server = createServer((req, res) => {
    try {
      let p = normalize(decodeURIComponent(new URL(req.url, 'https://localhost').pathname));
      if (p.endsWith('/')) p += 'index.html';
      const file = join(root, p);
      if (!file.startsWith(root + sep)) throw new Error('outside the root');
      const real = realpathSync(file);
      if (!real.startsWith(realRoot + sep)) throw new Error('outside the root');
      const body = readFileSync(real);
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// Left plus right @page margin in px (print media), 0 when none is declared.
const pageMargins = () => {
  const px = (v) => { const m = /^(-?[\d.]+)(mm|cm|in|pt|px)?$/.exec(v.trim()); return m ? Number(m[1]) * ({ mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 96 / 72, px: 1 }[m[2] || 'px']) : 0; };
  let sum = 0;
  const walk = (rules) => { for (const r of rules) {
    if (r instanceof CSSPageRule) sum = px(r.style.marginLeft || '0') + px(r.style.marginRight || '0');
    else if (r.cssRules && (!r.media || /print/.test(r.media.mediaText))) walk(r.cssRules);
  } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch { /* cross-origin sheet */ } }
  return sum;
};

async function drawing(page, name) {
  const label = `${name} drawing`;
  const named = page.getByRole('img', { name: label, exact: true })
    .or(page.locator('svg').filter({ has: page.locator(':scope > title', { hasText: label }) }))
    .or(page.locator(`svg[aria-label="${label}"]`)).filter({ visible: true }).first();
  await named.waitFor({ state: 'visible', timeout: 5000 });
  return (await named.evaluate((e) => e.localName)) === 'svg' ? named : named.locator('svg').first();
}

export async function measurePrint(dir, names, detailOut) {
  // browser first: a failed launch must not leave the server open (node --test would never exit)
  const browser = await chromium.launch();
  const server = await serve(dir);
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    for (const name of names) {
      /** @type {{ name: string, pages: number | null, width_share: number | null, pass: boolean, error?: string }} */
      const r = { name, pages: null, width_share: null, pass: false };
      try {
        await page.emulateMedia({ media: null });
        await page.setViewportSize({ width: 794, height: 1123 });
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.getByRole('link', { name, exact: true }).filter({ visible: true }).first().click({ timeout: 5000 });
        await page.getByRole('heading', { name, exact: true }).filter({ visible: true }).first().waitFor({ timeout: 5000 });
        const svg = await drawing(page, name);
        if (detailOut && name === names.find((n) => n === '308 Win.')) writeFileSync(detailOut, await page.content());
        r.pages = pdfPages(await page.pdf({ format: 'A4' }));
        await page.emulateMedia({ media: 'print' });
        const printable = A4_PX - (await page.evaluate(pageMargins));
        await page.setViewportSize({ width: Math.round(printable), height: 1123 });
        r.width_share = Math.round(1000 * (await svg.evaluate((e) => e.getBoundingClientRect().width)) / printable) / 1000;
        r.pass = r.pages === 1 && r.width_share >= 0.8;
      } catch (e) { r.error = String(e.message).split('\n')[0]; }
      results.push(r);
    }
  } finally { await browser.close(); server.close(); }
  return { total: names.length, pass: results.filter((r) => r.pass).length, one_page: results.filter((r) => r.pages === 1).length,
    wide_enough: results.filter((r) => r.width_share >= 0.8).length, cartridges: results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await measurePrint(process.argv[2], cartridgeNames(process.argv[3]), process.argv[4])));
}
