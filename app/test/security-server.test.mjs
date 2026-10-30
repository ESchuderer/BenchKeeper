// Requests the local server must survive or refuse; the other limits of the server are in server.test.mjs.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { context } from '../src/runner.mjs';
import { TOKEN_MS, api, startServer } from '../src/server.mjs';
import { httpRequest } from './helpers.mjs';

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

const req = (method, path, headers, body) => httpRequest(port, method, path, headers, body, 3000);
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

test('the server listens on 127.0.0.1 only', () => {
  assert.equal(srv.address().address, '127.0.0.1');
});

test('a body over 1 MB is a 413 that reaches the client, and the server keeps answering', async () => {
  assert.equal((await post('/api/apply', JSON.stringify({ planId: 'x'.repeat(1.1e6) }))).status, 413);
  assert.equal((await req('GET', '/api/overview')).status, 401);
});

test('the token is not exchanged for a session when the Host is not this server', async () => {
  const fresh = await startServer(context({ home: mkdtempSync(join(tmpdir(), 'bk-secsrv-')) }), { token: 'tok2', routes: {} });
  const p = fresh.server.address().port;
  const r = await new Promise((ok, fail) => request({ host: '127.0.0.1', port: p, path: '/?token=tok2', headers: { host: 'attacker.example' } }, (res) => { res.resume(); res.on('end', () => ok(res)); }).on('error', fail).end());
  fresh.server.close();
  assert.equal(r.statusCode, 421);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('the URL token stops working after its lifetime', async () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-secsrv-')) });
  const open = async (tokenMs) => {
    const s = await startServer(ctx, { token: 'tok3', routes: {}, tokenMs });
    const p = s.server.address().port;
    const r = await new Promise((ok, fail) => request({ host: '127.0.0.1', port: p, path: '/?token=tok3', headers: { host: `127.0.0.1:${p}` } }, (res) => { res.resume(); res.on('end', () => ok(res)); }).on('error', fail).end());
    s.server.close();
    return r;
  };
  assert.ok((await open(60e3)).headers['set-cookie'], 'inside its lifetime the token becomes the session');
  assert.equal((await open(0)).headers['set-cookie'], undefined, 'after its lifetime it does not');
  assert.equal(TOKEN_MS, 10 * 60e3);
});

test('every answer forbids a base tag and form posts; a POST that is not JSON is a 415 before the route runs', async () => {
  const r = await req('GET', '/api/overview', auth());
  assert.match(r.headers['content-security-policy'], /base-uri 'none'/);
  assert.match(r.headers['content-security-policy'], /form-action 'none'/);
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'none'/);
  for (const type of [undefined, 'text/plain', 'multipart/form-data; boundary=x', 'application/x-www-form-urlencoded', 'application/jsonx']) {
    assert.equal((await req('POST', '/api/apply', auth(type ? { 'content-type': type } : {}), '{}')).status, 415, String(type));
  }
  assert.notEqual((await req('POST', '/api/apply', auth({ 'content-type': 'Application/JSON; charset=utf-8' }), '{}')).status, 415);
});
