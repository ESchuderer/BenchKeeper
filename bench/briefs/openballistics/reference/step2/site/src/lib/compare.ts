/** The rows of the compare view: the cartridge's length dimensions, in the detail page's order. */

import { FIELD_LABELS, FIELD_UNITS, GROUP_ORDER, orderedFields, type Group, type Record_ } from '@lib/core';

export interface CompareRow {
  symbol: string;
  a: number;
  b: number;
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

/** One row per symbol both records publish, in A's order. */
export function compareRows(a: Record_, b: Record_): CompareRow[] {
  const right = lengths(b);
  return [...lengths(a)].filter(([symbol]) => right.has(symbol)).map(([symbol, value]) => ({ symbol, a: value, b: right.get(symbol)! }));
}
