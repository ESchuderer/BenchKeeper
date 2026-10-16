import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shippingCost } from '../src/shipping.js';

const cost = (o) => shippingCost({ subtotal: 0, zone: "domestic", ...o });

test('base price per zone up to 1000 g', () => {
  assert.equal(cost({ weight: 1000 }), 490);
  assert.equal(cost({ weight: 1, zone: "eu" }), 990);
  assert.equal(cost({ weight: 1000, zone: "world" }), 1990);
});

test('each started 500 g above 1000 g', () => {
  assert.equal(cost({ weight: 1001 }), 590);
  assert.equal(cost({ weight: 1500, zone: "eu" }), 1240);
  assert.equal(cost({ weight: 2200, zone: "world" }), 1990 + 3 * 600);
});

test('express doubles the whole price', () => {
  assert.equal(cost({ weight: 1000, express: true }), 980);
  assert.equal(cost({ weight: 2000, zone: "eu", express: true }), 2 * (990 + 2 * 250));
});

test('standard domestic shipping is free from a subtotal of 5000', () => {
  assert.equal(cost({ weight: 3000, subtotal: 5000 }), 0);
  assert.equal(cost({ weight: 1000, subtotal: 4999 }), 490);
});

test('express and other zones are never free', () => {
  assert.equal(cost({ weight: 1000, subtotal: 9000, express: true }), 980);
  assert.equal(cost({ weight: 1000, subtotal: 9000, zone: "eu" }), 990);
});

test('invalid weight or zone throws RangeError', () => {
  assert.throws(() => cost({ weight: 0 }), RangeError);
  assert.throws(() => cost({ weight: 1.5 }), RangeError);
  assert.throws(() => cost({ weight: 100, zone: "moon" }), RangeError);
});
