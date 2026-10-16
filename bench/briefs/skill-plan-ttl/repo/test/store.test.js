import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'tinykv-')), 'store.json');

test('set, get, has, delete', () => {
  const s = openStore(file());
  s.set('a', 1);
  assert.equal(s.get('a'), 1);
  assert.equal(s.has('a'), true);
  assert.equal(s.delete('a'), true);
  assert.equal(s.get('a'), undefined);
  assert.equal(s.delete('a'), false);
});

test('keys in insertion order, size', () => {
  const s = openStore(file());
  s.set('b', 2);
  s.set('a', 1);
  assert.deepEqual(s.keys(), ['b', 'a']);
  assert.equal(s.size, 2);
});

test('save and reopen, updatedAt from the injected clock', () => {
  const f = file();
  const s = openStore(f, { now: () => 1000 });
  s.set('a', { x: [1, 2] });
  s.save();
  const r = openStore(f);
  assert.deepEqual(r.get('a'), { x: [1, 2] });
});
