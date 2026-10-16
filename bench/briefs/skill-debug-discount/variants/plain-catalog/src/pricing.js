// Prices one order against the catalog (rules: README.md).
const DISCOUNTS = { SAVE10: 10, SAVE25: 25 };

export function linesOf(order, catalog) {
  return order.items.map(({ sku, qty }) => {
    const product = Object.hasOwn(catalog, sku) ? catalog[sku] : undefined;
    if (!product) throw new Error(`order ${order.id}: unknown SKU ${sku}`);
    return { ...product, qty };
  });
}

export function applyDiscount(lines, code) {
  const pct = DISCOUNTS[code] ?? 0;
  return lines.map((line) => (line.noDiscount ? line : { ...line, price: Math.round((line.price * (100 - pct)) / 100) }));
}

export function priceCart(order, catalog) {
  const lines = applyDiscount(linesOf(order, catalog), order.code);
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}
