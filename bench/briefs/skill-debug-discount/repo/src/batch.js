// Nightly invoice batch: prices every order of an orders file against fixtures/catalog.json.
// Usage: node src/batch.js <orders.json>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadCatalog } from './catalog.js';
import { formatCents } from './format.js';
import { priceCart } from './pricing.js';

export const runBatch = (orders, catalog) => orders.map((o) => ({ id: o.id, total: priceCart(o, catalog) }));

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const catalog = loadCatalog(new URL('../fixtures/catalog.json', import.meta.url));
  for (const r of runBatch(JSON.parse(readFileSync(process.argv[2], 'utf8')), catalog)) console.log(`${r.id}\t${formatCents(r.total)}`);
}
