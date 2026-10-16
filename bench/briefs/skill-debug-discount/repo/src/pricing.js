// Prices one order against the catalog (rules: README.md).
const DISCOUNTS = { SAVE10: 10, SAVE25: 25 };

export function linesOf(order, catalog) {
  return order.items.map(({ sku, qty }) => {
    const product = catalog.get(sku);
    if (!product) throw new Error(`order ${order.id}: unknown SKU ${sku}`);
    return Object.assign(product, { qty });
  });
}

export function applyDiscount(lines, code) {
  const pct = DISCOUNTS[code] ?? 0;
  for (const line of lines) if (!line.noDiscount) line.price = Math.round((line.price * (100 - pct)) / 100);
  return lines;
}

export function priceCart(order, catalog) {
  const lines = applyDiscount(linesOf(order, catalog), order.code);
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}
