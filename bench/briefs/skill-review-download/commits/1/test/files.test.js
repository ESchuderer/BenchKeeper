import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

test('download an attachment', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'att-'));
  writeFileSync(join(root, 'q3 report.txt'), 'numbers');
  const server = createServer({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/files/q3%20report.txt`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), "attachment; filename*=UTF-8''q3%20report.txt");
  assert.equal(await res.text(), 'numbers');
});
