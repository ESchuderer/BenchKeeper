// The product catalog: a Map of SKU to { sku, name, price, noDiscount? }, price in cents.
import { readFileSync } from 'node:fs';

export const loadCatalog = (file) => new Map(JSON.parse(readFileSync(file, 'utf8')).map((p) => [p.sku, p]));
