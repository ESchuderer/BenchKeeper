import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines } from '../src/diff.mjs';
import { sideBySide } from '../ui/diff.js';

test('side by side: context on both sides, changed runs paired, extra lines against an empty cell, hunks apart', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
  const after = ['a', 'B', 'B2', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
  assert.deepEqual(sideBySide(diffLines(before, after, 'f')), [
    { old: ' a', new: ' a' }, { old: '-b', new: '+B' }, { old: null, new: '+B2' }, { old: ' c', new: ' c' }, { old: ' d', new: ' d' }, { old: ' e', new: ' e' },
    { gap: true },
    { old: ' g', new: ' g' }, { old: ' h', new: ' h' }, { old: ' i', new: ' i' }, { old: '-j', new: null },
  ]);
  assert.deepEqual(sideBySide(diffLines(null, 'x', 'f')), [{ old: null, new: '+x' }]);
  assert.deepEqual(sideBySide(''), []);
});
