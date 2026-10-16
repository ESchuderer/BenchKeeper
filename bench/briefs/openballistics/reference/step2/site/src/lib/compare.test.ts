import { describe, expect, it } from 'vitest';
import type { Record_ } from '@lib/core';
import { compareRows } from './compare';

const record = (cartridge: Record_['cartridge']): Record_ => ({ key: 'k', name: 'n', family: 'rimless', cartridge, chamber: {} });

describe('compare rows', () => {
  it('pairs the millimetre fields both records publish, without tolerances, pressures or angles', () => {
    const a = record({ lengths: { L1: 30.45, L1Tol: -0.2, L3: 41 }, pressures: { Pmax: 3800 }, caseHead: { eMin: 1.4, beta: 45 } });
    const b = record({ lengths: { L3: 51.18, L1: 39.62 }, caseHead: { eMin: 1.2, R3: 13 }, pressures: { Pmax: 4150 } });
    expect(compareRows(a, b)).toEqual([
      { symbol: 'L1', a: 30.45, b: 39.62 },
      { symbol: 'L3', a: 41, b: 51.18 },
      { symbol: 'e min', a: 1.4, b: 1.2 }
    ]);
  });
});
