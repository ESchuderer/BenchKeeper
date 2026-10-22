import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines } from '../src/diff.mjs';
import { parseDiff, sideBySide } from '../ui/diff.js';

test('parsed diff: numbered hunks, counts, changed runs paired side by side', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
  const after = ['a', 'B', 'B2', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].join('\n');
  const d = parseDiff(diffLines(before, after, 'f'));
  assert.deepEqual([d.added, d.removed, d.hunks.map((h) => h.head)], [2, 2, ['@@ -1,5 +1,6 @@', '@@ -7,4 +8,3 @@']]);
  const cell = (l) => l && `${l.kind}${l.text}:${l.a ?? ''}/${l.b ?? ''}`;
  assert.deepEqual(sideBySide(d.hunks[0].lines).map((r) => [cell(r.old), cell(r.new)]), [
    [' a:1/1', ' a:1/1'], ['-b:2/', '+B:/2'], [null, '+B2:/3'], [' c:3/4', ' c:3/4'], [' d:4/5', ' d:4/5'], [' e:5/6', ' e:5/6'],
  ]);
  assert.deepEqual(sideBySide(d.hunks[1].lines).at(-1), { old: { kind: '-', text: 'j', a: 10 }, new: null });
  const created = parseDiff(diffLines(null, 'x\ny', 'f'));
  assert.deepEqual([created.hunks[0].head, created.hunks[0].lines.map((l) => l.b)], ['@@ -0,0 +1,2 @@', [1, 2]]);
  assert.deepEqual(parseDiff(''), { hunks: [], added: 0, removed: 0 });
});

test('a long file with one changed line diffs only around it; a huge middle shows as removed then added', () => {
  const lines = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
  const changed = lines.map((l, i) => (i === 10000 ? 'changed' : l));
  const t = Date.now();
  assert.equal(diffLines(lines.join('\n'), changed.join('\n'), 'f'), ['--- f', '+++ f', '@@ -9998,7 +9998,7 @@', ' line 9997', ' line 9998', ' line 9999', '-line 10000', '+changed', ' line 10001', ' line 10002', ' line 10003'].join('\n'));
  assert.ok(Date.now() - t < 1000);
  assert.equal(diffLines('same', 'same'), '');
  const big = diffLines(Array.from({ length: 3000 }, (_, i) => `a${i}`).join('\n'), Array.from({ length: 3000 }, (_, i) => `b${i}`).join('\n'), 'f').split('\n');
  assert.deepEqual([big[3], big.at(-1)], ['-a0', '+b2999']);
});
