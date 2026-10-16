/** The rows of the compare view: the cartridge's length dimensions, in the detail page's order. */

import { FIELD_LABELS, FIELD_UNITS, GROUP_ORDER, orderedFields, type Group, type Record_ } from '@lib/core';

export interface CompareRow {
  symbol: string;
  /** `null` where that cartridge does not publish the symbol. */
  a: number | null;
  b: number | null;
}

/** The numeric millimetre fields of a record's cartridge side, tolerances left out, by sheet label. */
function lengths(record: Record_): Map<string, number> {
  const out = new Map<string, number>();
  const groups = record.cartridge;
  const names = [...GROUP_ORDER.cartridge.filter((name) => name in groups), ...Object.keys(groups).filter((name) => !GROUP_ORDER.cartridge.includes(name)).sort()];
  for (const name of names) {
    const group = groups[name];
    if (!group || Array.isArray(group)) continue;
    for (const field of orderedFields('cartridge', name, group as Group)) {
      const value = group[field];
      if (typeof value === 'number' && !(field in FIELD_UNITS)) out.set(FIELD_LABELS[field] ?? field, value);
    }
  }
  return out;
}

/** One row per symbol either record publishes: A's in A's order, then those only B publishes. */
export function compareRows(a: Record_, b: Record_): CompareRow[] {
  const [left, right] = [lengths(a), lengths(b)];
  return [...new Set([...left.keys(), ...right.keys()])].map((symbol) => ({ symbol, a: left.get(symbol) ?? null, b: right.get(symbol) ?? null }));
}
