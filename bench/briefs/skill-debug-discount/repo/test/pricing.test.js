import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../src/catalog.js';
import { formatCents } from '../src/format.js';
import { priceCart } from '../src/pricing.js';

const catalog = () => loadCatalog(new URL('../fixtures/catalog.json', import.meta.url));

test('an order without a code', () => {
  assert.equal(priceCart({ id: 1, items: [{ sku: 'MUG', qty: 2 }] }, catalog()), 2590);
});

test('SAVE10 takes 10 % off each unit price, not off gift cards', () => {
  assert.equal(priceCart({ id: 2, code: 'SAVE10', items: [{ sku: 'TEE', qty: 1 }, { sku: 'GIFT', qty: 1 }] }, catalog()), 2205 + 2500);
});

test('unknown SKU', () => {
  assert.throws(() => priceCart({ id: 3, items: [{ sku: 'NOPE', qty: 1 }] }, catalog()), /unknown SKU NOPE/);
});

test('formatCents', () => {
  assert.equal(formatCents(7047), '70.47 EUR');
});
