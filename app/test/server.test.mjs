import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { apply, context, preview } from '../src/runner.mjs';
import { CSP as BOARD_CSP } from '../src/board.mjs';
import { api, openBrowser, pickFolder, rejectReason, startServer } from '../src/server.mjs';
import { SKILLS_SPEC, globalPlan } from '../src/steps/global.mjs';
import { projectPlan } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());

let srv, port, cookie, key;
const changed = [];
before(async () => {
  const ctx = context({ home: mkdtempSync(join(TMP, 'bk-srv-')), run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const dist = mkdtempSync(join(TMP, 'bk-dist-'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>BenchKeeper</title>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets/app.js'), 'console.log(1)');
  const routes = { 'GET /api/overview': () => ({ ok: true }), 'POST /api/apply': (b) => { changed.push(b); return { done: true }; }, 'POST /api/board-ticket': api(ctx)['POST /api/board-ticket'], 'POST /api/shutdown': () => ({ stopping: true }) };
  const s = await startServer(ctx, { token: 'secret-token-123', dist, routes });
  srv = s.server;
  port = srv.address().port;
});
after(() => { if (srv.listening) srv.close(); });

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
const auth = (h = {}) => ({ cookie, 'x-benchkeeper': key, ...h });
const post = (h) => req('POST', '/api/apply', auth({ 'content-type': 'application/json', ...h }), '{"planId":"x"}');

test('the URL token works once and becomes an HttpOnly SameSite=Strict cookie', async () => {
  assert.equal((await req('GET', '/api/overview')).status, 401);
  assert.equal((await req('GET', '/?token=wrong')).status, 401);
  const r = await req('GET', '/?token=secret-token-123');
  // A page of this origin moves on to the app, so the next request is same-origin even after a file opened the link.
  assert.equal(r.status, 200);
  key = r.body.match(/<meta http-equiv="refresh" content="0;url=\/#k=([\w-]{43})">/)[1];
  assert.match(r.headers['set-cookie'][0], new RegExp(`^bk_session_${port}=[\\w-]{43}; HttpOnly; SameSite=Strict; Path=/$`));
  assert.ok(!r.headers['set-cookie'][0].includes('secret-token-123'));
  cookie = r.headers['set-cookie'][0].split(';')[0];
  assert.equal((await req('GET', '/?token=secret-token-123')).status, 401);
  const ok = await req('GET', '/api/overview', auth());
  assert.deepEqual([ok.status, JSON.parse(ok.body)], [200, { ok: true }]);
  assert.equal((await req('GET', '/api/overview', { cookie: `bk_session_${port}=guess` })).status, 401);
  // The session of a server on another port does not count here.
  assert.equal((await req('GET', '/api/overview', { cookie: cookie.replace(`bk_session_${port}=`, 'bk_session_1=') })).status, 401);
  // The cookie alone, as another server on 127.0.0.1 receives it, reaches no API route; the page still loads.
  for (const k of [undefined, '1', 'x'.repeat(43)]) assert.equal((await req('GET', '/api/overview', { cookie, ...(k ? { 'x-benchkeeper': k } : {}) })).status, 403);
  assert.equal((await req('GET', '/', { cookie })).status, 200);
});

test('the sessions board: the session cookie and a one-time ticket asked for with the API key; a CSP of its own that only this origin may frame', async () => {
  assert.equal((await req('GET', '/board')).status, 401);
  // The cookie alone, as another server on 127.0.0.1 receives and replays it, does not show the board.
  assert.equal((await req('GET', '/board', { cookie })).status, 403);
  assert.equal((await req('GET', '/board?ticket=guess', { cookie })).status, 403);
  assert.equal((await req('POST', '/api/board-ticket', { cookie, 'content-type': 'application/json' }, '{}')).status, 403);
  const { ticket } = JSON.parse((await req('POST', '/api/board-ticket', auth({ 'content-type': 'application/json' }), '{}')).body);
  const r = await req('GET', `/board?ticket=${ticket}`, { cookie });
  assert.deepEqual([r.status, r.headers['content-type'], r.headers['content-security-policy']], [200, 'text/html; charset=utf-8', `${BOARD_CSP}; frame-ancestors 'self'`]);
  assert.match(r.body, /<title>Sessions board<\/title>/);
  assert.equal((await req('GET', `/board?ticket=${ticket}`, { cookie })).status, 403, 'a ticket works once');
});

test('a session scan is reused for a minute: the board renders from it and is saved as board.html; force scans again', async () => {
  const { ctx, routes } = fixture();
  const first = routes['POST /api/sessions-scan']({});
  assert.ok(first.job);
  await finished(routes, first.job);
  const file = join(ctx.config, 'board.html');
  assert.match(readFileSync(file, 'utf8'), /<title>Sessions board<\/title>/);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(routes['POST /api/sessions-scan']({}), { fresh: true });
  assert.ok(routes['POST /api/sessions-scan']({ force: true }).job);
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
  assert.equal((await req('POST', '/api/apply', { cookie, 'content-type': 'application/json' }, '{}')).status, 403);
  assert.equal((await req('PUT', '/api/apply', auth(), '{}')).status, 405);
  assert.equal((await req('OPTIONS', '/api/apply', auth())).status, 405);
  assert.deepEqual(changed, []);
  const ok = await post({});
  assert.equal(ok.status, 200);
  assert.deepEqual(changed, [{ planId: 'x' }]);
  assert.equal((await req('POST', '/api/apply', auth(), 'not json')).status, 400);
});

test('static files stay inside the build folder; unknown paths get the app page', async () => {
  const js = await req('GET', '/assets/app.js', auth());
  assert.deepEqual([js.status, js.headers['content-type'], js.headers['cache-control']], [200, 'text/javascript', 'public, max-age=31536000, immutable']);
  assert.equal((await req('GET', '/', auth())).headers['cache-control'], 'no-store');
  for (const p of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/projects', '/assets', '/assets/']) {
    const r = await req('GET', p, auth());
    assert.equal(r.body, '<!doctype html><title>BenchKeeper</title>', p);
  }
  assert.match((await req('GET', '/', auth())).headers['content-security-policy'], /default-src 'self'/);
  assert.equal((await req('GET', '/%E0%A4%A', auth())).status, 400);
  assert.equal((await req('GET', '/api/overview', auth())).status, 200);
});

// Routes against a fixture home with Claude Code installed and its plugins enabled.
function fixture(extra = () => null) {
  const home = mkdtempSync(join(TMP, 'bk-routes-'));
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
// Polled, not a fixed wait: under a loaded test run a job may take longer.
const until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 10)); };
const finished = async (routes, id) => { let s; await until(() => (s = routes['GET /api/job'](new URLSearchParams({ id }))).done); return s; };

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

test('prerun: the global skill install is rehearsed in a job, its file diff per change id; the real home stays as it is', async () => {
  const { ctx, routes } = fixture((argv, o) => {
    if (argv[2] !== SKILLS_SPEC) return null;
    mkdirSync(join(o.env.HOME, '.claude/skills/find-skills'), { recursive: true });
    writeFileSync(join(o.env.HOME, '.claude/skills/find-skills/SKILL.md'), '# find-skills\n');
    return { code: 0, stdout: '', stderr: '' };
  });
  const plan = routes['GET /api/global-plan'](new URLSearchParams('agents=claude'));
  const skill = plan.changes.find((c) => c.step === 'tools:skill:find-skills');
  assert.equal(skill.prerun, true);
  assert.ok(plan.changes.filter((c) => c.kind === 'write').every((c) => c.prerun === false));
  const { job, total } = routes['POST /api/prerun']({ planId: plan.planId });
  assert.equal(total, 1);
  const s = await finished(routes, job);
  assert.deepEqual(s.results[skill.id].files.map((f) => f.path), [join(ctx.home, '.claude/skills/find-skills/SKILL.md')]);
  assert.ok(!existsSync(join(ctx.home, '.claude/skills/find-skills')));
  assert.equal(status(() => routes['POST /api/prerun']({ planId: 'gone' })), 409);
  // A result is kept: the same command again needs no second run.
  ctx.runAsync = (argv, o) => new Promise((r) => o.signal.addEventListener('abort', () => r({ code: 130, stdout: '', stderr: 'cancelled' })));
  const again = routes['GET /api/global-plan'](new URLSearchParams('agents=claude'));
  assert.deepEqual((await finished(routes, routes['POST /api/prerun']({ planId: again.planId }).job)).results[skill.id], s.results[skill.id]);
  // An apply drops kept results and stops a running rehearsal, whose files it changes; a rehearsal is not a running job.
  const write = (plan) => routes['POST /api/apply']({ planId: plan.planId, select: [plan.changes.find((c) => c.kind === 'write').id] }).job;
  await finished(routes, write(again));
  const next = routes['GET /api/global-plan'](new URLSearchParams('agents=claude'));
  const pre = routes['POST /api/prerun']({ planId: next.planId });
  assert.deepEqual(routes['GET /api/jobs'](), []);
  const applied = write(next);
  const stopped = await finished(routes, pre.job);
  assert.equal(stopped.cancelled, true);
  assert.match(stopped.results[skill.id].error, /cancelled/);
  await finished(routes, applied);
});

test('apply: answers at once with a job; the job shows the running command and its output, then the run; one at a time', async () => {
  const { ctx, routes } = fixture();
  let release;
  ctx.runAsync = (argv, o) => { o.onOutput('installing\n'); return new Promise((r) => { release = () => r({ code: 0, stdout: 'ok', stderr: '' }); }); };
  const plan = routes['GET /api/global-plan'](new URLSearchParams('agents=claude'));
  const command = plan.changes.find((c) => c.kind === 'command');
  const select = [plan.changes.find((c) => c.kind === 'write').id, command.id];
  const { job, total } = routes['POST /api/apply']({ planId: plan.planId, select });
  assert.equal(total, 2);
  await until(() => release && routes['GET /api/job'](new URLSearchParams({ id: job })).output[command.id]);
  let s = routes['GET /api/job'](new URLSearchParams({ id: job }));
  assert.equal(s.done, false);
  assert.equal(s.run.entries.at(-1).id, command.id);
  assert.equal(s.run.entries.at(-1).status, 'running');
  // Journaled before the command started, so a crash leaves it in history.
  assert.equal(ctx.ledger.get(s.run.id).entries.at(-1).status, 'running');
  assert.equal(s.output[command.id], 'installing\n');
  // A reloaded page finds the running job.
  assert.deepEqual(routes['GET /api/jobs'](), [{ id: job, kind: 'apply', title: 'global setup', total: 2 }]);
  const again = routes['GET /api/global-plan'](new URLSearchParams('agents=claude'));
  assert.equal(status(() => routes['POST /api/apply']({ planId: again.planId })), 409);
  // Undo and Update all wait too: they would edit the files and the run the apply still writes.
  assert.equal(status(() => routes['POST /api/undo']({ run: s.run.id })), 409);
  assert.equal(status(() => routes['POST /api/update-all']({ paths: [] })), 409);
  release();
  s = await finished(routes, job);
  assert.equal(s.done, true);
  assert.deepEqual(s.run.entries.map((e) => e.status), ['done', 'done']);
  assert.deepEqual(routes['GET /api/jobs'](), []);
  assert.equal(ctx.ledger.get(s.run.id).status, 'done');
  // The run report: the written file's diff; command output stays in the job, out of the ledger.
  const report = routes['GET /api/run'](new URLSearchParams({ id: s.run.id }));
  assert.match(report.entries[0].diff, /^--- .*\n\+\+\+ .*\n@@ -/);
  assert.equal(report.entries[1].output, undefined);
  assert.deepEqual(routes['POST /api/job-cancel']({ id: job }), { cancelled: false });
  assert.equal(status(() => routes['GET /api/job'](new URLSearchParams({ id: 'nope' }))), 404);
});

test('setup advice: one restricted, read-only agent session; only library ids pass; applies do not wait for it; CI refuses', async () => {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    const dir = mkdtempSync(join(TMP, 'bk-advice-proj-'));
    const answer = { env: { id: 'container', reason: 'has .devcontainer/' }, packs: [{ id: 'frontend', reason: 'package.json uses react' }, { id: 'nope' }], skills: [{ name: '../x' }], extra: 1 };
    let seen, release;
    const { ctx, routes } = fixture();
    ctx.runAsync = (argv, o) => { seen = { argv, cwd: o.cwd }; return new Promise((r) => { release = () => r({ code: 0, stdout: JSON.stringify({ result: `Here:\n${JSON.stringify(answer)}` }), stderr: '' }); }); };
    routes['POST /api/projects']({ path: dir });
    assert.deepEqual(routes['GET /api/project-setup'](new URLSearchParams({ dir })).advisers.map((a) => a.id), ['claude']);
    assert.equal(status(() => routes['POST /api/setup-advice']({ dir, agent: 'codex' })), 400);
    assert.equal(status(() => routes['POST /api/setup-advice']({ dir: TMP, agent: 'claude' })), 400);
    const { job } = routes['POST /api/setup-advice']({ dir, agent: 'claude' });
    await until(() => seen);
    assert.ok(seen.cwd === dir && ['--restricted', '--strict-mcp-config', 'Read,Grep,Glob'].every((x) => seen.argv.includes(x)) && !seen.argv.includes('Bash'));
    // A read-only job does not block applies.
    assert.equal(status(() => routes['POST /api/update-all']({ paths: [] })), 200);
    release();
    const s = await finished(routes, job);
    assert.deepEqual(s.results, { env: { id: 'container', reason: 'has .devcontainer/' }, packs: [{ id: 'frontend', reason: 'package.json uses react' }], skills: [] });
    process.env.CI = '1';
    assert.equal(status(() => routes['POST /api/setup-advice']({ dir, agent: 'claude' })), 400);
  } finally {
    if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
  }
});

test('evals: the plan names targets and sessions; the job runs them and stores results; CI refuses', async () => {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    const { routes } = fixture();
    const plan = routes['GET /api/eval-plan'](new URLSearchParams('agents=claude'));
    assert.deepEqual(plan.targets.map((t) => t.target).sort(), ['skill:designing-technical-uis', 'skill:workflow']);
    assert.equal(plan.sessions, plan.targets.reduce((n, t) => n + t.cases, 0));
    const { job, total } = routes['POST /api/eval']({ agents: 'claude' });
    assert.equal(total, plan.sessions);
    const s = await finished(routes, job);
    assert.equal(s.error, null);
    assert.deepEqual(s.results.map((r) => r.target).sort(), ['skill:designing-technical-uis', 'skill:workflow']);
    assert.ok(s.results.every((r) => !('details' in r)));
    assert.equal(routes['GET /api/evals']().length, 2);
    assert.equal(routes['GET /api/eval-plan'](new URLSearchParams('agents=claude')).sessions, 0);
    assert.equal(status(() => routes['POST /api/eval']({ agents: 'claude' })), 400);
    process.env.CI = '1';
    assert.equal(status(() => routes['GET /api/eval-plan'](new URLSearchParams())), 400);
  } finally {
    if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
  }
});

test('cancel: an apply skips the changes not started yet; an eval stops and stores no partial target', async () => {
  const ci = process.env.CI;
  delete process.env.CI;
  try {
    const { ctx, routes } = fixture();
    const plan = routes['GET /api/global-plan'](new URLSearchParams('agents=claude'));
    const select = [plan.changes.find((c) => c.kind === 'write').id, plan.changes.find((c) => c.kind === 'command' && !c.unit).id];
    const { job } = routes['POST /api/apply']({ planId: plan.planId, select });
    // The job has its run but no change yet: the check before each change sees the cancel.
    assert.deepEqual(routes['POST /api/job-cancel']({ id: job }), { cancelled: true });
    const s = await finished(routes, job);
    assert.deepEqual(s.run.entries.map((e) => [e.status, e.reason]), [['skipped', 'cancelled'], ['skipped', 'cancelled']]);
    assert.equal(s.run.status, 'cancelled');
    assert.equal(s.cancelled, true);
    assert.equal(status(() => routes['POST /api/job-cancel']({ id: 'nope' })), 404);
    // Evals: the stub session ends at once; the cancel lands before the second case.
    const before = routes['GET /api/evals']().length;
    const e = routes['POST /api/eval']({ agents: 'claude' });
    routes['POST /api/job-cancel']({ id: e.job });
    const es = await finished(routes, e.job);
    assert.equal(es.error, 'cancelled');
    assert.equal(routes['GET /api/evals']().length, before);
    assert.equal(es.results, null);
  } finally {
    if (ci === undefined) delete process.env.CI; else process.env.CI = ci;
  }
});

test('a session cookie of other bytes but the same length in characters is refused, not thrown', () => {
  const session = 'a'.repeat(43);
  const req = { method: 'GET', headers: { host: '127.0.0.1:9', cookie: `bk_session_9=${'\u00e9'.repeat(43)}` } };
  assert.deepEqual(rejectReason(req, { port: 9, session, key: 'k' }), [401, 'no session']);
});

test('reveal opens registered projects only', () => {
  const { ctx, routes } = fixture();
  const opened = [];
  ctx.open = (p) => opened.push(p);
  const dir = mkdtempSync(join(TMP, 'bk-reveal-'));
  assert.equal(status(() => routes['POST /api/reveal']({ path: dir })), 400);
  routes['POST /api/projects']({ path: dir });
  routes['POST /api/reveal']({ path: dir });
  assert.deepEqual(opened, [dir]);
});

test('pick-folder: the first dialog found answers; a cancel is null; no tool is unavailable', () => {
  const calls = [];
  const answer = (byTool) => fixture((argv) => { calls.push(argv[0]); return byTool[argv[0]] ?? null; }).ctx;
  const desktop = { DISPLAY: ':0' };
  assert.deepEqual(pickFolder(answer({ zenity: { code: 0, stdout: '/home/me/code/app\n' } }), 'linux', desktop), { path: '/home/me/code/app' });
  assert.deepEqual(pickFolder(answer({ zenity: { code: 1, stdout: '' } }), 'linux', desktop), { path: null });
  calls.length = 0;
  assert.deepEqual(pickFolder(answer({ kdialog: { code: 0, stdout: '/srv/x\n' } }), 'linux', { WAYLAND_DISPLAY: 'wayland-0' }), { path: '/srv/x' });
  assert.deepEqual(calls, ['zenity', 'kdialog']);
  assert.deepEqual(pickFolder(answer({}), 'linux', desktop), { path: null, unavailable: true });
  // Without a display zenity exits 1 as on a cancel: no dialog is tried.
  calls.length = 0;
  assert.deepEqual(pickFolder(answer({ zenity: { code: 1, stdout: '' } }), 'linux', {}), { path: null, unavailable: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(pickFolder(answer({ osascript: { code: 0, stdout: '/Users/me/app/\n' } }), 'darwin'), { path: '/Users/me/app' });
  assert.deepEqual(pickFolder(answer({}), 'win32'), { path: null, unavailable: true });
});

test('scan needs an absolute root and leaves out registered folders; doctor and project-plan need a registered dir', () => {
  const { routes } = fixture();
  assert.equal(status(() => routes['POST /api/scan']({ root: 'code' })), 400);
  assert.equal(status(() => routes['POST /api/scan']({})), 400);
  const root = mkdtempSync(join(TMP, 'bk-scan-'));
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
  const dir = mkdtempSync(join(TMP, 'bk-pp-'));
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

test('packs: save, export, import and remove; bad input is a 400', () => {
  const { routes } = fixture();
  const packs = routes['POST /api/packs'];
  const skill = routes['GET /api/catalog']().skills[0].name;
  assert.equal(status(() => packs({ action: 'save', id: 'Bad Id', skills: [skill] })), 400);
  assert.equal(status(() => packs({ action: 'save', id: 'mine', skills: ['not-in-library'] })), 400);
  assert.equal(status(() => packs({ action: 'import', text: 'not json' })), 400);
  assert.equal(status(() => packs({ action: 'import', text: '{"kind":"other"}' })), 400);
  assert.equal(status(() => packs({ action: 'drop' })), 400);
  assert.equal(packs({ action: 'save', id: 'mine', skills: [skill] }).id, 'mine');
  const { name, text } = routes['GET /api/pack-export'](new URLSearchParams({ id: 'mine' }));
  assert.equal(name, 'mine.json');
  assert.equal(packs({ action: 'import', text, id: 'copy' }).id, 'copy');
  assert.equal(status(() => routes['GET /api/pack-export'](new URLSearchParams({ id: 'nope' }))), 400);
  packs({ action: 'remove', id: 'copy' });
  assert.equal(status(() => packs({ action: 'remove', id: 'copy' })), 400);
  assert.deepEqual(routes['GET /api/pack-warnings'](new URLSearchParams({ skills: 'a,b,c,d,e,f' })), []);
});

test('profile import: a bad kind is a 400; register saves packs and projects, then returns the plans', async () => {
  const { routes } = fixture();
  const imp = routes['POST /api/profile-import'];
  assert.equal(status(() => imp({ text: '{"kind":"benchkeeper-pack","schemaVersion":1}' })), 400);
  assert.equal(status(() => imp({ text: 'nope' })), 400);
  // An unknown agent fails before any pack or project is saved.
  assert.equal(status(() => imp({ register: true, text: JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['nope'] }, packs: [{ id: 'early', skills: ['x'] }], projects: [] }) })), 400);
  assert.ok(!routes['GET /api/catalog']().packs.some((p) => p.id === 'early'));
  const dir = mkdtempSync(join(TMP, 'bk-prof-'));
  const skill = routes['GET /api/catalog']().skills[0].name;
  const text = JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['claude'], packs: [] }, packs: [{ id: 'own', skills: [skill] }],
    projects: [{ path: dir, answers: { agents: ['claude'], packs: ['own'] } }, { path: '/nowhere/x' }] });
  const preview = imp({ text });
  assert.deepEqual(preview.projects, [{ path: dir, here: true }, { path: '/nowhere/x', here: false }]);
  assert.deepEqual(await routes['GET /api/projects'](), []);
  const r = imp({ text, register: true });
  assert.deepEqual([r.packs, r.projects, r.missing], [['own'], [dir], ['/nowhere/x']]);
  assert.ok(r.global.planId && r.plans.length === 1 && r.plans[0].changes.some((c) => c.title.includes(skill)));
  assert.match(routes['GET /api/profile-export'](new URLSearchParams({ agents: 'claude' })).text, /"benchkeeper-profile"/);
});

test('evals: results without details; broken lines are left out', () => {
  const { ctx, routes } = fixture();
  mkdirSync(join(ctx.config, 'evals'), { recursive: true });
  writeFileSync(join(ctx.config, 'evals/results.jsonl'), `${JSON.stringify({ target: 'skill:x', missRate: 0.5, details: [{ id: 1 }] })}\nnot json\n`);
  assert.deepEqual(routes['GET /api/evals'](), [{ target: 'skill:x', missRate: 0.5 }]);
});

test('run report: each of two edits of one file diffs against what it left; a file changed since has no diff', () => {
  const { ctx, routes } = fixture();
  const f = join(ctx.home, 'f.txt');
  writeFileSync(f, 'a\n');
  const run = apply([
    { id: '1', step: 's', title: 'one', kind: 'write', path: f, after: 'a\nb\n' },
    { id: '2', step: 't', title: 'two', kind: 'write', path: f, after: 'a\nb\nc\n' },
  ], ctx);
  const diffs = () => routes['GET /api/run'](new URLSearchParams({ id: run.id })).entries.map((e) => e.diff);
  assert.deepEqual(diffs().map((d) => d.split('\n').filter((l) => /^[+-][^+-]/.test(l))), [['+b'], ['+c']]);
  writeFileSync(f, 'mine\n');
  assert.deepEqual(diffs().map((d) => d && d.split('\n').at(-2)), ['+b', null]);
});

test('run report: the undo of a created file shows its removal as a diff', () => {
  const { ctx, routes } = fixture();
  const f = join(ctx.home, 'new.txt');
  const run = apply([{ id: '1', step: 's', title: 'create', kind: 'write', path: f, after: 'x\ny\n' }], ctx);
  const u = routes['POST /api/undo']({ run: run.id });
  const [e] = routes['GET /api/run'](new URLSearchParams({ id: u.id })).entries;
  assert.equal(e.removed, true);
  assert.match(e.diff, /\n@@ -1,3 \+0,0 @@\n-x\n-y/);
});

test('run report: a failed session undo (no files recorded) still opens', () => {
  const { ctx, routes } = fixture();
  const run = apply([], ctx);
  run.entries.push({ id: 'session', step: 'session', title: 'undo: agent session', kind: 'session', status: 'failed', error: 'changed after the session' });
  ctx.ledger.save(run);
  assert.equal(routes['GET /api/run'](new URLSearchParams({ id: run.id })).entries[0].status, 'failed');
});

test('the browser opens a file only this user can read, which forwards to the URL; the URL stays out of the arguments', () => {
  let opened;
  const file = openBrowser('http://127.0.0.1:1/?token=a&b', { wait: 0, open: (f) => { opened = f; }, confined: () => false });
  assert.equal(opened, file);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(readFileSync(file, 'utf8'), /content="0;url=http:\/\/127\.0\.0\.1:1\/\?token=a&#38;b"/);
});

test('a snap or Flatpak browser cannot read the file and gets the URL', () => {
  let opened;
  openBrowser('http://127.0.0.1:1/?token=a', { open: (f) => { opened = f; }, confined: () => true });
  assert.equal(opened, 'http://127.0.0.1:1/?token=a');
});

// Last: it stops the shared server.
test('Stop: the API key is needed; the server closes after its answer', async () => {
  assert.equal((await req('POST', '/api/shutdown', { cookie, 'content-type': 'application/json' }, '{}')).status, 403);
  const closed = new Promise((ok) => srv.once('close', ok));
  const r = await req('POST', '/api/shutdown', auth({ 'content-type': 'application/json' }), '{}');
  assert.deepEqual([r.status, JSON.parse(r.body)], [200, { stopping: true }]);
  await closed;
  assert.equal(srv.listening, false);
});

// Real git for the fixture's project folders; everything else answers as the fixture does.
const realGit = (argv, o) => {
  if (argv[0] !== 'git') return null;
  try { return { code: 0, stdout: execFileSync('git', argv.slice(1), { cwd: o?.cwd, encoding: 'utf8', stdio: 'pipe' }), stderr: '' }; } catch (e) { return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
};
const repo = (name) => {
  const d = mkdtempSync(join(TMP, `bk-one-${name}-`));
  execFileSync('git', ['init', '-q', '-b', 'main', d]);
  writeFileSync(join(d, 'README.md'), `# ${name}\n`);
  return d;
};
const q = (o) => new URLSearchParams(o);

test('one-run: lists the agents, the advisers and each project with its state and why one is left to Update all', async () => {
  const { ctx, routes } = fixture(realGit);
  const fresh = repo('fresh'), local = repo('local'), shared = repo('shared'), plain = mkdtempSync(join(TMP, 'bk-one-plain-'));
  for (const [dir, share] of [[local, false], [shared, true]]) {
    const pctx = { ...ctx, roots: [dir] };
    apply(preview(projectPlan({ ctx: pctx, dir, answers: { agents: ['claude'], env: 'host', share } }).changes).filter((c) => c.kind !== 'command'), pctx, { scope: dir });
  }
  for (const path of [fresh, local, shared, plain]) routes['POST /api/projects']({ path });
  const r = await routes['GET /api/one-run']();
  assert.deepEqual(r.agents.map((a) => a.id), ['claude']);
  assert.deepEqual(r.advisers.map((a) => a.id), ['claude']);
  const by = Object.fromEntries(r.projects.map((p) => [p.path, p]));
  assert.deepEqual([by[fresh].state, by[fresh].blocked], ['none', null]);
  assert.equal(by[local].blocked, null);
  assert.match(by[shared].blocked, /shared setup/);
  assert.match(by[plain].blocked, /no repository/);
});

// The plans of one run: the global plan and two projects, as the review page keeps them.
function plansOf(routes) {
  const global = routes['GET /api/global-plan'](q({ agents: 'claude' }));
  const dirs = [repo('a'), repo('b')];
  const projects = dirs.map((dir) => {
    routes['POST /api/projects']({ path: dir });
    return routes['GET /api/project-plan'](q({ dir, setup: '1', agents: 'claude', env: 'host', sandbox: '0', share: '0', tier: '' }));
  });
  return { global, projects, dirs };
}
const defaults = (plan) => plan.changes.filter((c) => c.selected && !c.error).map((c) => c.id);

test('apply-all: one job, a section per plan in order, each its own run; a failed section leaves the others; one job at a time', async () => {
  const { ctx, routes } = fixture(realGit);
  let release;
  const failing = (argv) => argv[0] === 'claude' || argv[0] === 'npx';
  ctx.runAsync = (argv, o) => (failing(argv) ? new Promise((r) => { release = () => r({ code: 1, stdout: '', stderr: 'boom' }); }) : Promise.resolve(ctx.run(argv, o)));
  const { global, projects, dirs } = plansOf(routes);
  const command = global.changes.find((c) => c.kind === 'command' && !c.unit);
  const sections = [{ planId: global.planId, select: [command.id] }, ...projects.map((p) => ({ planId: p.planId, select: defaults(p) }))];
  const { job, total } = routes['POST /api/apply-all']({ sections });
  assert.equal(total, 3);
  await until(() => release);
  let s = routes['GET /api/job'](q({ id: job }));
  assert.deepEqual(s.sections.map((x) => [x.scope, x.status]), [['global', 'running'], [dirs[0], 'waiting'], [dirs[1], 'waiting']]);
  assert.deepEqual(routes['GET /api/jobs'](), [{ id: job, kind: 'apply-all', title: 'one-run setup', total: 3 }]);
  assert.equal(status(() => routes['POST /api/apply-all']({ sections: [] })), 409);
  assert.equal(status(() => routes['POST /api/undo']({ run: s.sections[0].run.id })), 409);
  release();
  s = await finished(routes, job);
  assert.deepEqual(s.sections.map((x) => x.status), ['failed', 'done', 'done']);
  assert.match(s.sections[0].error, /boom/);
  assert.equal(s.sections[1].total, defaults(projects[0]).length);
  for (const x of s.sections) assert.equal(ctx.ledger.get(x.run.id).scope, x.scope);
  assert.ok(existsSync(join(dirs[1], 'CLAUDE.local.md')));
  assert.equal(s.error, null);
});

test('apply-all: a plan that expired or was never made is a 409 and nothing runs; sections need a list', () => {
  const { routes } = fixture(realGit);
  assert.equal(status(() => routes['POST /api/apply-all']({})), 400);
  assert.equal(status(() => routes['POST /api/apply-all']({ sections: [] })), 400);
  const { projects } = plansOf(routes);
  assert.equal(status(() => routes['POST /api/apply-all']({ sections: [{ planId: projects[0].planId }, { planId: 'gone' }] })), 409);
  // One plan is single-use, also within one request.
  assert.equal(status(() => routes['POST /api/apply-all']({ sections: [{ planId: projects[0].planId }, { planId: projects[0].planId }] })), 400);
  // The plan that was fine stays usable: the whole request is refused before anything is taken.
  const { job } = routes['POST /api/apply-all']({ sections: [{ planId: projects[0].planId, select: defaults(projects[0]) }] });
  assert.ok(job);
});

test('apply-all: a cancel stops after the running change; later changes are skipped, later sections never start', async () => {
  const { ctx, routes } = fixture(realGit);
  let release, calls = 0;
  ctx.runAsync = (argv) => (argv[0] === 'npx' && !calls++ ? new Promise((r) => { release = () => r({ code: 0, stdout: '', stderr: '' }); }) : Promise.resolve({ code: 0, stdout: '', stderr: '' }));
  const { projects, dirs } = plansOf(routes);
  // Skill installs are commands, one per skill: several changes after the first one.
  const dir = repo('packs');
  routes['POST /api/projects']({ path: dir });
  const packs = routes['GET /api/project-plan'](q({ dir, setup: '1', agents: 'claude', env: 'host', sandbox: '0', share: '0', pack: 'frontend' }));
  assert.ok(packs.changes.filter((c) => c.kind === 'command').length > 1);
  const { job } = routes['POST /api/apply-all']({ sections: [{ planId: packs.planId, select: defaults(packs) }, { planId: projects[0].planId, select: defaults(projects[0]) }] });
  await until(() => release);
  assert.deepEqual(routes['POST /api/job-cancel']({ id: job }), { cancelled: true });
  release();
  const s = await finished(routes, job);
  assert.equal(s.cancelled, true);
  assert.deepEqual(s.sections.map((x) => x.status), ['cancelled', 'cancelled']);
  const statuses = s.sections[0].run.entries.map((e) => e.status);
  const first = statuses.indexOf('skipped');
  assert.ok(first > 0 && statuses.slice(0, first).every((x) => x === 'done') && statuses.slice(first).every((x) => x === 'skipped'), statuses.join());
  assert.equal(s.sections[1].run, null);
  assert.ok(!existsSync(join(dirs[0], 'CLAUDE.local.md')));
});
