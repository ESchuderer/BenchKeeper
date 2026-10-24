import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, get } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from './print.mjs';

// Raw request path: fetch() would normalize it before it is sent.
const request = (port, path) => new Promise((ok, fail) => get({ host: '127.0.0.1', port, path }, (res) => {
  let body = '';
  res.on('data', (c) => { body += c; }).on('end', () => ok({ status: res.statusCode, body }));
}).on('error', fail));

// <tmp>/site with index.html and sub/a.txt; <tmp>/secret.txt sits outside it.
function site() {
  const tmp = mkdtempSync(join(tmpdir(), 'static-'));
  mkdirSync(join(tmp, 'site/sub'), { recursive: true });
  writeFileSync(join(tmp, 'site/index.html'), 'home');
  writeFileSync(join(tmp, 'site/sub/a.txt'), 'a');
  writeFileSync(join(tmp, 'secret.txt'), 'secret');
  return join(tmp, 'site');
}

async function check(port) {
  assert.deepEqual(await request(port, '/'), { status: 200, body: 'home' });
  assert.deepEqual(await request(port, '/sub/a.txt'), { status: 200, body: 'a' });
  for (const path of ['/missing', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/sub/..%2f..%2fsecret.txt', '/..%5csecret.txt', '/%00', '/%']) {
    const r = await request(port, path);
    assert.equal(r.status, 404, path);
    assert.ok(!r.body.includes('secret'), path);
  }
}

test('static.mjs serves files under its root and nothing outside it', async () => {
  const probe = createServer().listen(0, '127.0.0.1');
  await new Promise((ok) => probe.once('listening', ok));
  const { port } = probe.address();
  await new Promise((ok) => probe.close(ok));
  const child = spawn(process.execPath, [new URL('./static.mjs', import.meta.url).pathname, site()], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await request(port, '/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await check(port);
  } finally { child.kill(); }
});

test('print.mjs server serves files under its root and nothing outside it', async () => {
  const server = await serve(site());
  try { await check(server.address().port); } finally { server.close(); }
});
