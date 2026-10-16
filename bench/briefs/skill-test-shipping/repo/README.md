# shop-shipping

Shipping costs of the shop, in cents (`src/shipping.js`), and price formatting (`src/format.js`).

Rules of `shippingCost({ weight, subtotal, zone, express })`:

- `weight` in grams, a whole number above 0; `zone` is `domestic`, `eu` or `world`; otherwise a `RangeError`.
- Base price per zone (domestic 490, eu 990, world 1990) covers up to 1000 g; each started 500 g above that adds
  domestic 100, eu 250, world 600.
- Express doubles the price.
- Standard domestic shipping is free from a subtotal of 5000 (50.00); express is never free.

Tests: `npm test` (Node.js 22, `node:test`, no dependencies).
