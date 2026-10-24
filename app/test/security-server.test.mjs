// Requests the local server must survive or refuse; the other limits of the server are in server.test.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { context } from '../src/runner.mjs';
import { api, startServer } from '../src/server.mjs';

let srv, port, cookie, key;
before(async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-secsrv-'));
  const ctx = context({ home, run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const dist = mkdtempSync(join(tmpdir(), 'bk-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>BenchKeeper</title>');
  mkdirSync(join(dist, 'assets'));
  srv = (await startServer(ctx, { token: 'tok', dist, routes: api(ctx) })).server;
  port = srv.address().port;
  const r = await req('GET', '/?token=tok');
  key = r.body.match(/#k=([\w-]{43})/)[1];
  cookie = r.headers['set-cookie'][0].split(';')[0];
});
after(() => srv.close());

function req(method, path, headers = {}, body) {
  return new Promise((ok, fail) => {
    const r = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: data }));
    });
    r.on('error', fail);
    r.setTimeout(3000, () => r.destroy(new Error('no answer')));
    r.end(body);
  });
}
const auth = (h = {}) => ({ cookie, 'x-benchkeeper': key, ...h });
const post = (path, body) => req('POST', path, auth({ 'content-type': 'application/json' }), typeof body === 'string' ? body : JSON.stringify(body));

test('a request target the URL parser refuses is a 400 and the server keeps answering', async () => {
  for (const path of ['//', '///', '//?x']) assert.equal((await req('GET', path)).status, 400, path);
  assert.equal((await req('GET', '/api/overview')).status, 401);
});

test('an unknown run is a 404 without a path of the machine in the answer', async () => {
  for (const r of [await req('GET', '/api/run?id=nope', auth()), await post('/api/undo', { run: 'nope' }), await post('/api/undo', {})]) {
    assert.ok([400, 404].includes(r.status), r.body);
    assert.doesNotMatch(r.body, /ENOENT|\/tmp|\.config/);
  }
});

test('a body that is not an object, and a select that is not a list of ids, are 400s that start nothing', async () => {
  for (const b of ['null', '5', '[]', '"x"']) assert.equal((await post('/api/apply', b)).status, 400, b);
  for (const select of ['w-1', { length: 1 }, [1], 'a']) assert.equal((await post('/api/apply', { planId: 'x', select })).status, 400, JSON.stringify(select));
});

test('a request from another port of this machine (same-site) is refused like a cross-site one', async () => {
  assert.equal((await req('GET', '/api/overview', auth({ 'sec-fetch-site': 'same-site' }))).status, 403);
  assert.equal((await req('GET', '/api/inventory', auth({ 'sec-fetch-site': 'same-origin' }))).status !== 403, true);
});
