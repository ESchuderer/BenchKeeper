import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { apply, context, preview } from '../src/runner.mjs';
import { api, pickFolder, startServer } from '../src/server.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { projectPlan } from '../src/steps/project.mjs';

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

// Routes against a fixture home with Claude Code installed and its plugins enabled.
function fixture(extra = () => null) {
  const home = mkdtempSync(join(tmpdir(), 'bk-routes-'));
  const run = (argv, o) => {
    const cmd = argv.join(' ');
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    const r = extra(argv, o);
    if (r) return r;
    if (cmd === 'claude --version') return ok('2.1.0 (Claude Code)');
    if (cmd === 'claude plugin list --json') return ok(JSON.stringify([{ id: 'benchkeeper@benchkeeper', enabled: true, scope: 'user' }, { id: 'ponytail@ponytail', enabled: true, scope: 'user' }]));
    if (cmd === 'claude plugin marketplace list --json') return ok(JSON.stringify([{ name: 'benchkeeper' }, { name: 'ponytail' }]));
    if (argv[0] === 'claude') return ok('[]');
    return { code: 127, stdout: '', stderr: 'not installed' };
  };
  const ctx = context({ home, run });
  return { ctx, routes: api(ctx) };
}
const status = (f) => { try { f(); } catch (e) { return e.status ?? 500; } return 200; };

test('inventory: an edited rules file is modified, enabled plugins current, a missing tool missing', () => {
  const { ctx, routes } = fixture();
  apply(preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' })).filter((c) => c.kind === 'write'), ctx);
  appendFileSync(join(ctx.home, '.claude/rules/00-global.md'), 'a local line\n');
  const items = routes['GET /api/inventory']();
  const state = (step) => items.filter((i) => i.step === step).map((i) => i.state);
  assert.deepEqual(state('rules:claude'), ['modified']);
  assert.deepEqual(state('settings:claude'), ['current']);
  assert.deepEqual(state('plugin:claude:benchkeeper@benchkeeper'), ['current']);
  assert.deepEqual(state('tools:devcontainer'), ['missing']);
  assert.ok(items.every((i) => i.agent === (i.step.split(':')[1] === 'claude' ? 'claude' : 'machine')));
});

test('pick-folder: the first dialog found answers; a cancel is null; no tool is unavailable', () => {
  const calls = [];
  const answer = (byTool) => fixture((argv) => { calls.push(argv[0]); return byTool[argv[0]] ?? null; }).ctx;
  assert.deepEqual(pickFolder(answer({ zenity: { code: 0, stdout: '/home/me/code/app\n' } }), 'linux'), { path: '/home/me/code/app' });
  assert.deepEqual(pickFolder(answer({ zenity: { code: 1, stdout: '' } }), 'linux'), { path: null });
  calls.length = 0;
  assert.deepEqual(pickFolder(answer({ kdialog: { code: 0, stdout: '/srv/x\n' } }), 'linux'), { path: '/srv/x' });
  assert.deepEqual(calls, ['zenity', 'kdialog']);
  assert.deepEqual(pickFolder(answer({}), 'linux'), { path: null, unavailable: true });
  assert.deepEqual(pickFolder(answer({ osascript: { code: 0, stdout: '/Users/me/app/\n' } }), 'darwin'), { path: '/Users/me/app' });
  assert.deepEqual(pickFolder(answer({}), 'win32'), { path: null, unavailable: true });
});

test('scan needs an absolute root and leaves out registered folders; doctor and project-plan need a registered dir', () => {
  const { routes } = fixture();
  assert.equal(status(() => routes['POST /api/scan']({ root: 'code' })), 400);
  assert.equal(status(() => routes['POST /api/scan']({})), 400);
  const root = mkdtempSync(join(tmpdir(), 'bk-scan-'));
  for (const d of ['a', 'b']) { mkdirSync(join(root, d)); writeFileSync(join(root, d, 'AGENTS.md'), '# x\n'); }
  routes['POST /api/projects']({ action: 'add', path: join(root, 'a') });
  assert.deepEqual(routes['POST /api/scan']({ root }), [join(root, 'b')]);
  const q = (o) => new URLSearchParams(o);
  assert.equal(status(() => routes['GET /api/doctor'](q({ dir: join(root, 'b') }))), 400);
  assert.ok(Array.isArray(routes['GET /api/doctor'](q({ dir: join(root, 'a') }))));
  assert.equal(status(() => routes['GET /api/project-plan'](q({ dir: join(root, 'b') }))), 400);
});

test('project-plan: disable and enable only name skills the project has', () => {
  const { ctx, routes } = fixture();
  const dir = mkdtempSync(join(tmpdir(), 'bk-pp-'));
  const pctx = { ...ctx, roots: [dir] };
  apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude'], packs: ['frontend'] } }).changes).filter((c) => c.kind !== 'command'), pctx, { scope: dir });
  routes['POST /api/projects']({ action: 'add', path: dir });
  const q = (extra) => new URLSearchParams([['dir', dir], ...extra]);
  const plan = routes['GET /api/project-plan'](q([]));
  const skill = plan.chosen[0].name;
  assert.ok(plan.chosen.every((s) => !s.disabled));
  assert.equal(status(() => routes['GET /api/project-plan'](q([['disable', 'not-a-skill']]))), 400);
  assert.equal(status(() => routes['GET /api/project-plan'](q([['enable', '../../etc']]))), 400);
  const off = routes['GET /api/project-plan'](q([['disable', skill]]));
  assert.ok(off.chosen.find((s) => s.name === skill).disabled);
});
