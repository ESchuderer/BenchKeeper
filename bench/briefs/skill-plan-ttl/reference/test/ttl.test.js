import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { toCsv } from '../tools/export-csv.js';

const file = () => join(mkdtempSync(join(tmpdir(), 'tinykv-')), 'store.json');

test('an entry expires after its ttl on every read path', () => {
  let t = 1000;
  const s = openStore(file(), { now: () => t });
  s.set('a', 1, { ttl: 100 });
  s.set('b', 2);
  t = 1099;
  assert.equal(s.get('a'), 1);
  t = 1100;
  assert.equal(s.get('a'), undefined);
  assert.equal(s.has('a'), false);
  assert.deepEqual(s.keys(), ['b']);
  assert.equal(s.size, 1);
});

test('expiry survives save and reopen; the file stays format 1 for the export', () => {
  const f = file();
  const s = openStore(f, { now: () => 1000 });
  s.set('a', 1, { ttl: 100 });
  s.save();
  assert.equal(openStore(f, { now: () => 1050 }).has('a'), true);
  assert.equal(openStore(f, { now: () => 1100 }).has('a'), false);
  assert.match(toCsv(readFileSync(f, 'utf8')), /^key,value,updatedAt\na,1,/);
});

test('an invalid ttl throws', () => {
  assert.throws(() => openStore(file()).set('a', 1, { ttl: -1 }), RangeError);
});
