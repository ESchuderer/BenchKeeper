import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../tools/export-csv.js';

test('CSV with header, quoted fields', () => {
  const text = JSON.stringify({ version: 1, entries: { a: { value: 'x,y', updatedAt: 0 } } });
  assert.equal(toCsv(text), 'key,value,updatedAt\na,"""x,y""",1970-01-01T00:00:00.000Z\n');
});
