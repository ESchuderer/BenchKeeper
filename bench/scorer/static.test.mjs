import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, get } from 'node:http';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './print.mjs';

// Raw request path: fetch() would normalize it before it is sent.
const request = (port, path) => new Promise((ok, fail) => get({ host: '127.0.0.1', port, path }, (res) => {
  let body = '';
  res.on('data', (c) => { body += c; }).on('end', () => ok({ status: res.statusCode, body }));
}).on('error', fail));

// A temp folder with index.html, sub/a.txt and link.txt (a symlink to secret.txt in another temp folder, outside it).
function site() {
  const dir = mkdtempSync(join(tmpdir(), 'static-'));
  const outside = mkdtempSync(join(tmpdir(), 'static-outside-'));
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'index.html'), 'home');
  writeFileSync(join(dir, 'sub/a.txt'), 'a');
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
  return dir;
}

async function check(port) {
  assert.deepEqual(await request(port, '/'), { status: 200, body: 'home' });
  assert.deepEqual(await request(port, '/sub/a.txt'), { status: 200, body: 'a' });
  for (const path of ['/missing', '/link.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/sub/..%2f..%2fsecret.txt', '/..%5csecret.txt', '/%00', '/%']) {
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
  const child = spawn(process.execPath, [fileURLToPath(new URL('./static.mjs', import.meta.url)), site()], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50; i++) { try { await request(port, '/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    await check(port);
  } finally { child.kill(); }
});

test('print.mjs server serves files under its root and nothing outside it', async () => {
  const server = await serve(site());
  try { await check(server.address().port); } finally { server.close(); }
});

test('both servers refuse a folder outside /app and the temp folder', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./static.mjs', import.meta.url)), '/etc'], { stdio: 'ignore' });
  assert.notEqual(r.status, 0);
  assert.throws(() => serve('/etc'), /not \/app or a folder/);
});
