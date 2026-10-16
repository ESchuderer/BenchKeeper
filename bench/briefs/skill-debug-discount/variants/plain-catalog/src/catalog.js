// The product catalog: a frozen object of SKU to frozen { sku, name, price, noDiscount? }, price in cents.
import { readFileSync } from 'node:fs';

export const loadCatalog = (file) => Object.freeze(Object.fromEntries(JSON.parse(readFileSync(file, 'utf8')).map((p) => [p.sku, Object.freeze(p)])));
