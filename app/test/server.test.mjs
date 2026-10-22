import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { context } from '../src/runner.mjs';
import { startServer } from '../src/server.mjs';

let srv, port, cookie;
const changed = [];
before(async () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-srv-')), run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const dist = mkdtempSync(join(tmpdir(), 'bk-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>BenchKeeper</title>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets/app.js'), 'console.log(1)');
  const routes = { 'GET /api/overview': () => ({ ok: true }), 'POST /api/apply': (b) => { changed.push(b); return { done: true }; } };
  const s = await startServer(ctx, { token: 'secret-token-123', dist, routes });
  srv = s.server;
  port = srv.address().port;
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
    r.end(body);
  });
}
const auth = (h = {}) => ({ cookie, ...h });
const post = (h) => req('POST', '/api/apply', auth({ 'content-type': 'application/json', 'x-benchkeeper': '1', ...h }), '{"planId":"x"}');

test('the URL token works once and becomes an HttpOnly SameSite=Strict cookie', async () => {
  assert.equal((await req('GET', '/api/overview')).status, 401);
  assert.equal((await req('GET', '/?token=wrong')).status, 401);
  const r = await req('GET', '/?token=secret-token-123');
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/');
  assert.match(r.headers['set-cookie'][0], /^bk_session=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/$/);
  assert.ok(!r.headers['set-cookie'][0].includes('secret-token-123'));
  cookie = r.headers['set-cookie'][0].split(';')[0];
  assert.equal((await req('GET', '/?token=secret-token-123')).status, 401);
  const ok = await req('GET', '/api/overview', auth());
  assert.deepEqual([ok.status, JSON.parse(ok.body)], [200, { ok: true }]);
  assert.equal((await req('GET', '/api/overview', { cookie: 'bk_session=guess' })).status, 401);
});

test('rejected: other Host, foreign or null Origin, cross-site fetches', async () => {
  for (const host of ['localhost:' + port, `127.0.0.1:${port + 1}`, 'evil.example', `127.0.0.1:${port}.evil.example`]) {
    assert.equal((await req('GET', '/api/overview', auth({ host }))).status, 421, host);
  }
  for (const origin of ['http://evil.example', 'null', `http://localhost:${port}`, `https://127.0.0.1:${port}`]) {
    assert.equal((await req('GET', '/api/overview', auth({ origin }))).status, 403, origin);
    assert.equal((await post({ origin })).status, 403, origin);
  }
  assert.equal((await req('GET', '/api/overview', auth({ 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await req('GET', '/api/overview', auth({ origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }))).status, 200);
  assert.deepEqual(changed, []);
});

test('rejected: state changes on GET, without the custom header, other methods', async () => {
  assert.equal((await req('GET', '/api/apply', auth())).status, 405);
  assert.equal((await req('POST', '/api/apply', auth({ 'content-type': 'application/json' }), '{}')).status, 403);
  assert.equal((await req('PUT', '/api/apply', auth({ 'x-benchkeeper': '1' }), '{}')).status, 405);
  assert.equal((await req('OPTIONS', '/api/apply', auth())).status, 405);
  assert.deepEqual(changed, []);
  const ok = await post({});
  assert.equal(ok.status, 200);
  assert.deepEqual(changed, [{ planId: 'x' }]);
  assert.equal((await req('POST', '/api/apply', auth({ 'x-benchkeeper': '1' }), 'not json')).status, 400);
});

test('static files stay inside the build folder; unknown paths get the app page', async () => {
  const js = await req('GET', '/assets/app.js', auth());
  assert.deepEqual([js.status, js.headers['content-type']], [200, 'text/javascript']);
  for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/projects']) {
    const r = await req('GET', p, auth());
    assert.equal(r.body, '<!doctype html><title>BenchKeeper</title>', p);
  }
  assert.match((await req('GET', '/', auth())).headers['content-security-policy'], /default-src 'self'/);
  assert.equal((await req('GET', '/%E0%A4%A', auth())).status, 400);
  assert.equal((await req('GET', '/api/overview', auth())).status, 200);
});
