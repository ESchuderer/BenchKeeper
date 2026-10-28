import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { ENTRY, logFile, payload, post, sendWebhook, webhookStatus } from '../src/webhook.mjs';

const TOKEN = 'dummy-webhook-bearer';

function machine() {
  const kept = new Map();
  const credentials = { name: 'fake-store', set: (n, t) => kept.set(n, t), get: (n) => kept.get(n) ?? null, has: (n) => kept.has(n), delete: (n) => kept.delete(n) };
  return { ctx: { home: mkdtempSync(join(tmpdir(), 'bk-hook-')), credentials }, kept };
}

async function cli(ctx, args, { lines = [], tty = false } = {}) {
  let text = '';
  const input = Readable.from(lines.map((l) => `${l}\n`));
  input.isTTY = tty;
  const code = await main(args, { out: new Writable({ write(c, _, done) { text += c; done(); } }), err: new Writable({ write(_, __, done) { done(); } }), ctx, input });
  return { code, text };
}

// A fake receiver on this machine: answer decides the reply per request (none: it never answers).
async function receiver(t, answer = (req, res) => res.end('ok')) {
  const got = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { got.push({ method: req.method, url: req.url, headers: req.headers, body }); answer(req, res); });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}/hook`, got };
}

const until = async (check, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (check()) return;
  assert.fail('timed out');
};

test('webhook: off by default, send does nothing and exits 0', async (t) => {
  const { ctx } = machine(), r = await receiver(t);
  assert.deepEqual(sendWebhook(ctx, { state: 'finished', run: 'run-1' }), { sent: false });
  const c = await cli(ctx, ['webhook', 'send', '--state', 'finished', '--run', 'run-1']);
  assert.equal(c.code, 0);
  assert.match(c.text, /no webhook set/);
  assert.match((await cli(ctx, ['webhook', 'status'])).text, /configured: no[\s\S]*last failure: none/);
  await new Promise((done) => setTimeout(done, 200));
  assert.equal(r.got.length, 0);
  // A store that cannot be read is the same as none.
  ctx.credentials = { ...ctx.credentials, get: () => { throw new Error('no secret service'); } };
  assert.deepEqual(sendWebhook(ctx, { state: 'failed', automation: 'pr-watch' }), { sent: false });
});

test('webhook set: from stdin only, https or this machine, kept encoded under one entry', async () => {
  const { ctx, kept } = machine();
  assert.equal((await cli(ctx, ['webhook', 'set'], { tty: true })).code, 2);
  for (const bad of ['http://example.com/hook', 'https://user:pw@example.com/hook', 'not a url', '']) {
    assert.equal((await cli(ctx, ['webhook', 'set'], { lines: [bad] })).code, 2, bad);
  }
  assert.equal(kept.size, 0);
  const c = await cli(ctx, ['webhook', 'set'], { lines: ['https://hooks.example.com/abc', TOKEN] });
  assert.equal(c.code, 0);
  assert.doesNotMatch(c.text, /example|dummy/);
  assert.deepEqual([...kept.keys()], [ENTRY]);
  assert.doesNotMatch(kept.get(ENTRY), /example|dummy/);
  assert.deepEqual(JSON.parse(Buffer.from(kept.get(ENTRY), 'base64url').toString()), { url: 'https://hooks.example.com/abc', token: TOKEN });
  assert.match((await cli(ctx, ['webhook', 'set'], { lines: ['http://localhost:9/x'] })).text, /replaced/);
  const s = await cli(ctx, ['webhook', 'status']);
  assert.match(s.text, /configured: yes \(fake-store, entry app\.webhook\)/);
  assert.doesNotMatch(s.text, /localhost/);
  assert.equal((await cli(ctx, ['webhook', 'remove'], { lines: ['n'] })).code, 1);
  assert.equal(kept.size, 1);
  assert.equal((await cli(ctx, ['webhook', 'remove', '--yes'])).code, 0);
  assert.equal(kept.size, 0);
  assert.match((await cli(ctx, ['webhook', 'remove'])).text, /no webhook set/);
});

test('webhook send: ids and the state only; other shapes and misplaced flags exit 2', async () => {
  const time = new Date('2026-10-28T10:00:00Z');
  assert.deepEqual(payload({ state: 'needs-person', run: 'r.1', automation: 'pr-watch', task: 'task_ab' }, time), { event: 'run', state: 'needs-person', run: 'r.1', automation: 'pr-watch', task: 'task_ab', time: time.toISOString() });
  assert.deepEqual(payload({ state: 'finished', automation: 'digest' }, time), { event: 'run', state: 'finished', automation: 'digest', time: time.toISOString() });
  const { ctx } = machine();
  for (const args of [['--state', 'done', '--run', 'r'], ['--state', 'finished'], ['--state', 'finished', '--run', 'fix the login bug'], ['--state', 'finished', '--run', 'x'.repeat(65)],
    ['--state', 'finished', '--automation', 'PR_watch'], ['--state', 'finished', '--run', 'r', '--task', 'a b']]) {
    assert.equal((await cli(ctx, ['webhook', 'send', ...args])).code, 2, args.join(' '));
  }
  assert.equal((await cli(ctx, ['webhook', 'status', '--state', 'finished'])).code, 2);
  assert.equal((await cli(ctx, ['webhook'])).code, 2);
});

test('webhook send: one POST with the payload and the token reaches a fake receiver', async (t) => {
  const { ctx } = machine(), r = await receiver(t);
  await cli(ctx, ['webhook', 'set'], { lines: [r.url, TOKEN] });
  const c = await cli(ctx, ['webhook', 'send', '--state', 'failed', '--run', 'run-7', '--task', 'task_3']);
  assert.equal(c.code, 0);
  assert.doesNotMatch(c.text, /127\.0\.0\.1|dummy/);
  await until(() => r.got.length === 1);
  const [req] = r.got;
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/hook');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
  const body = JSON.parse(req.body);
  assert.deepEqual(Object.keys(body), ['event', 'state', 'run', 'task', 'time']);
  assert.deepEqual({ ...body, time: null }, { event: 'run', state: 'failed', run: 'run-7', task: 'task_3', time: null });
});

test('webhook send: a hung receiver blocks nothing; the failure is logged once, without URL or token', async (t) => {
  const { ctx } = machine(), r = await receiver(t, () => {});
  await cli(ctx, ['webhook', 'set'], { lines: [r.url, TOKEN] });
  const start = Date.now();
  assert.deepEqual(sendWebhook(ctx, { state: 'finished', run: 'run-1' }), { sent: true });
  assert.ok(Date.now() - start < 1000, 'send waited for the receiver');
  await until(() => r.got.length === 1);
  // The detached sender gives up on its own at the limit.
  await until(() => webhookStatus(ctx).lastFailure !== null);
  const log = readFileSync(logFile(ctx), 'utf8');
  assert.match(log, /^\S+ not sent: timeout\n$/);
  assert.equal(statSync(logFile(ctx)).mode & 0o777, 0o600);
  assert.match((await cli(ctx, ['webhook', 'status'])).text, /last failure: \S+ not sent: timeout/);
});

test('webhook post: an error status, a redirect and a dropped connection are one code line each, never the host', async (t) => {
  const { ctx } = machine(), log = logFile(ctx);
  const r = await receiver(t, (req, res) => {
    if (req.url === '/hook') { res.writeHead(302, { location: '/moved' }); res.end(); } else if (req.url === '/drop') req.socket.destroy(); else if (req.url !== '/slow') { res.writeHead(500); res.end('secret body'); }
  });
  const job = (url) => ({ url, token: TOKEN, payload: { event: 'run', state: 'finished', run: 'r' }, log });
  assert.equal(await post(job(r.url.replace('/hook', '/fail'))), 'HTTP 500');
  assert.equal(await post(job(r.url)), 'TypeError');
  assert.deepEqual(r.got.map((g) => g.url), ['/fail', '/hook'], 'the redirect was followed');
  assert.match(await post(job(r.url.replace('/hook', '/drop'))), /^[A-Z_]+$/);
  assert.equal(await post(job(r.url.replace('/hook', '/slow')), 100), 'timeout');
  const text = readFileSync(log, 'utf8');
  assert.equal(text.trim().split('\n').length, 4);
  assert.doesNotMatch(text, /127\.0\.0\.1|dummy|secret|hook/);
});
