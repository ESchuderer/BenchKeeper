# invoicing

Prices orders (`src/pricing.js`) and runs the nightly invoice batch (`src/batch.js`). Amounts are in cents.

- A line costs its product's unit price times its quantity.
- A discount code takes a percentage off the unit price of each product without `noDiscount`, rounded to the cent
  (half up). Codes: `SAVE10` (10 %), `SAVE25` (25 %).

Batch: `npm run batch` prints one line per order. Tests: `npm test` (Node.js 22, no dependencies).
