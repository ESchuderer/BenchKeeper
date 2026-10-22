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

test('a long file with one changed line diffs only around it; a huge middle shows as removed then added', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
  const changed = lines.map((l, i) => (i === 10000 ? 'changed' : l));
  const t = Date.now();
  assert.equal(diffLines(lines.join('\n'), changed.join('\n'), 'f'), ['--- f', '+++ f', '@@', ' line 9997', ' line 9998', ' line 9999', '-line 10000', '+changed', ' line 10001', ' line 10002', ' line 10003'].join('\n'));
  assert.ok(Date.now() - t < 1000);
  assert.equal(diffLines('same', 'same'), '');
  const big = diffLines(Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n'), Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n'), 'f').split('\n');
  assert.deepEqual([big[3], big.at(-1)], ['-a0', '+b2999']);
});
