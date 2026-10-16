import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runBatch } from '../src/batch.js';
import { loadCatalog } from '../src/catalog.js';
import { lineTotal, priceCart } from '../src/pricing.js';

const catalog = () => loadCatalog(new URL('../fixtures/catalog.json', import.meta.url));
const orders = JSON.parse(readFileSync(new URL('../fixtures/orders.json', import.meta.url), 'utf8'));

test('the batch prices each order as if it were priced alone, and leaves the catalog unchanged', () => {
  const c = catalog();
  assert.deepEqual(runBatch(orders, c).map((r) => r.total), [2590, 4001, 6910, 3290]);
  assert.deepEqual(c, catalog());
});

test('the same product on two lines of one order', () => {
  assert.equal(priceCart({ id: 1, items: [{ sku: 'TEE', qty: 1 }, { sku: 'TEE', qty: 2 }] }, catalog()), 3 * 2450);
});

test('line total', () => {
  assert.equal(lineTotal({ price: 2, qty: 3 }), 6);
});
