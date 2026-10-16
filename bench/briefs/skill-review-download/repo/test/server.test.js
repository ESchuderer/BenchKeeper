import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

async function serve(t) {
  const server = createServer({ root: mkdtempSync(join(tmpdir(), 'att-')) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('health', async (t) => {
  const res = await fetch(`${await serve(t)}/health`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('unknown route', async (t) => {
  assert.equal((await fetch(`${await serve(t)}/nope`)).status, 404);
});
