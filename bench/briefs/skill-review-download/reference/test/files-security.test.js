import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

async function serve(t) {
  const dir = mkdtempSync(join(tmpdir(), 'att-'));
  mkdirSync(join(dir, 'attachments'));
  mkdirSync(join(dir, 'attachments-old'));
  writeFileSync(join(dir, 'secret.txt'), 'secret');
  writeFileSync(join(dir, 'attachments-old', 'old.txt'), 'secret');
  const server = createServer({ root: join(dir, 'attachments') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  // Raw paths: fetch() would normalize `..` before sending.
  return (path) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port: server.address().port, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c)).on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject).end();
  });
}

test('no file outside the attachments directory', async (t) => {
  const get = await serve(t);
  for (const p of ['/files/..%2Fsecret.txt', '/files/%2e%2e%2fsecret.txt', '/files/..%2Fattachments-old%2Fold.txt', '/files/%2Fetc%2Fhostname']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.body, /secret/, p);
  }
});

test('missing file, directory and bad encoding answer without stopping the server', async (t) => {
  const get = await serve(t);
  assert.equal((await get('/files/nope.txt')).status, 404);
  assert.equal((await get('/files/')).status, 404);
  assert.equal((await get('/files/%E0%A4%A')).status, 400);
  assert.equal((await get('/health')).body, 'ok');
});
