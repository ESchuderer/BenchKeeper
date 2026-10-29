import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { listAccounts } from '../src/accounts.mjs';
import { addProject } from '../src/projects.mjs';
import { api } from '../src/server.mjs';
import { jobDone, waitFor } from './fakes/job.mjs';
import { CLAUDE_TOKEN, grep, machine, win } from './fixtures/accounts.mjs';

// The accounts routes of the UI server against the fake agents of the accounts tests: nothing real is started.
const skip = win ? { skip: 'the fake agents are shell scripts' } : {};
const q = (o) => new URLSearchParams(o);
const job = (routes, id) => routes['GET /api/job'](q({ id }));

// Plan, then apply through the job route like the page does.
async function applyPlan(routes, body) {
  const plan = await routes['POST /api/accounts-plan'](body);
  const { job: id } = await routes['POST /api/apply']({ planId: plan.planId });
  await jobDone(routes, id);
  return { plan, state: job(routes, id) };
}

test('add, use and remove are plans applied through /api/apply; a duplicate is a change that cannot be made', skip, async () => {
  const m = machine();
  const routes = api(m.ctx);
  assert.deepEqual((await routes['GET /api/accounts']()).accounts, []);
  const { plan, state } = await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude', label: 'job' });
  assert.match(plan.changes[0].title, /add claude account work/);
  assert.equal(state.error, null);
  await applyPlan(routes, { op: 'add', name: 'dev', agent: 'codex', container: true, mount: '/data/accounts/dev' });
  const list = await routes['GET /api/accounts']();
  assert.deepEqual(list.accounts.map((a) => [a.name, a.mode, a.default, a.token.kept]), [['work', 'host', true, false], ['dev', 'container', true, false]]);
  assert.equal(list.store, 'fake-store');
  assert.equal(list.login, null);
  const dup = await routes['POST /api/accounts-plan']({ op: 'add', name: 'work', agent: 'claude' });
  assert.match(dup.changes[0].error, /account work exists/);
  assert.equal(dup.changes[0].selected, false);
  await applyPlan(routes, { op: 'add', name: 'home', agent: 'claude' });
  await applyPlan(routes, { op: 'use', name: 'home' });
  assert.deepEqual(listAccounts(m.ctx).filter((a) => a.agent === 'claude').map((a) => [a.name, !!a.default]), [['work', false], ['home', true]]);
  await applyPlan(routes, { op: 'remove', name: 'home' });
  assert.deepEqual(listAccounts(m.ctx).map((a) => a.name), ['work', 'dev']);
  for (const [body, re] of [[{ op: 'add', name: 'Bad', agent: 'claude' }, /the name is 1 to 32/], [{ op: 'add', name: 'x', agent: 'claude', container: true }, /--mount is the absolute path/], [{ op: 'use', name: 'ghost' }, /no account ghost/], [{ op: 'frob', name: 'work' }, /op must be add, use, track or remove/], [{ op: 'add', name: 5, agent: 'claude' }, /the name is 1 to 32/]]) {
    await assert.rejects(async () => routes['POST /api/accounts-plan'](body), (e) => e.status === 400 && re.test(e.message), JSON.stringify(body));
  }
});

test('an account that keeps a token is not removed from the page, the command deletes the token too', skip, async () => {
  const m = machine();
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  writeFileSync(join(m.ctx.config, 'accounts.json'), JSON.stringify({ schemaVersion: 1, accounts: listAccounts(m.ctx).map((a) => ({ ...a, token: { created: '2026-01-01T00:00:00.000Z' } })) }));
  await assert.rejects(async () => routes['POST /api/accounts-plan']({ op: 'remove', name: 'work' }), /benchkeeper accounts remove work/);
  assert.deepEqual((await routes['GET /api/accounts']()).accounts[0].token, { kept: true, created: '2026-01-01T00:00:00.000Z' });
  writeFileSync(join(m.ctx.config, 'accounts.json'), '{');
  await assert.rejects(async () => routes['GET /api/accounts'](), (e) => e.status === 409 && /not valid JSON/.test(e.message));
});

test('status reads the sign-in of an account; a project must be registered', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  const s = await routes['GET /api/accounts-status'](q({ name: 'work' }));
  assert.equal(s.loggedIn, false);
  assert.equal(s.findings[0].fix, 'benchkeeper accounts login work');
  await assert.rejects(async () => routes['GET /api/accounts-status'](q({ name: 'work', project: m.root })), /register the project first/);
  await assert.rejects(async () => routes['GET /api/accounts-status'](q({ name: 'ghost' })), /no account ghost/);
});

test('sign-in job: the steps, the link opened in a private window, no credential in the job', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  const { job: id } = await routes['POST /api/accounts-login']({ name: 'work', email: 'me@example.com' });
  const done = await jobDone(routes, id);
  assert.equal(done.error, null);
  assert.equal(done.login.step, 'done');
  assert.equal(done.login.loggedIn, true);
  assert.equal(done.login.browser, 'Firefox');
  assert.match(done.login.url, /^https:\/\/claude\.ai\//);
  assert.ok(done.login.lines.some((l) => /Opened a private window in Firefox/.test(l)));
  assert.deepEqual(m.opened, [done.login.url]);
  assert.deepEqual(m.calls().find((x) => x.args[1] === 'login').args, ['auth', 'login', '--email', 'me@example.com']);
  assert.ok(!JSON.stringify(done).includes('dummy-oauth-access'));
  // Not offered over HTTP: a token is the command's.
  assert.deepEqual(grep(m.ctx.config, CLAUDE_TOKEN), []);
  // Errors: unknown account, bad address, a container account without a project, a code nobody waits for.
  await assert.rejects(async () => routes['POST /api/accounts-login']({ name: 'ghost' }), /no account ghost/);
  const bad = await routes['POST /api/accounts-login']({ name: 'work', email: '-x' });
  assert.match((await jobDone(routes, bad.job)).error, /--email needs an address/);
  await assert.rejects(async () => routes['POST /api/accounts-code']({ job: id, code: 'x' }), /no sign-in waits for a code/);
});

test('sign-in job: the page pastes the code the browser shows; it reaches the agent and no record', skip, async () => {
  const m = machine({ flow: 'code' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  const { job: id } = await routes['POST /api/accounts-login']({ name: 'work' });
  await waitFor(() => job(routes, id).login?.awaitingCode, `login of job ${id}`);
  assert.equal((await routes['GET /api/accounts']()).login, id);
  // A running sign-in holds the other changes.
  await assert.rejects(async () => routes['POST /api/accounts-login']({ name: 'work' }), (e) => e.status === 409);
  await routes['POST /api/accounts-code']({ job: id, code: ' PASTED-CODE-42 ' });
  const done = await jobDone(routes, id);
  assert.equal(done.error, null);
  assert.equal(readFileSync(join(m.bin, 'pasted'), 'utf8'), 'PASTED-CODE-42');
  assert.ok(!JSON.stringify(done).includes('PASTED-CODE-42'));
  assert.deepEqual(grep(m.ctx.config, 'PASTED-CODE-42'), []);
  assert.equal((await routes['GET /api/accounts']()).login, null);
});

test('cancel ends a sign-in that waits for a code', skip, async () => {
  const m = machine({ flow: 'code' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  const { job: id } = await routes['POST /api/accounts-login']({ name: 'work' });
  await waitFor(() => job(routes, id).login?.awaitingCode, `login of job ${id}`);
  await routes['POST /api/job-cancel']({ id });
  const done = await jobDone(routes, id);
  assert.match(done.error, /cancelled/);
  assert.equal(done.login.awaitingCode, false);
});

test('a container account signs in inside the dev container of a registered project', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{}\n');
  mkdirSync(join(project, '.git'));
  await applyPlan(routes, { op: 'add', name: 'boxed', agent: 'claude', container: true, mount: '/data/accounts/boxed' });
  await assert.rejects(async () => routes['POST /api/accounts-login']({ name: 'boxed' }), /choose the project/);
  await assert.rejects(async () => routes['POST /api/accounts-login']({ name: 'boxed', project }), /register the project first/);
  addProject(m.ctx, project);
  m.mode('container-login', 'yes');
  const { job: id } = await routes['POST /api/accounts-login']({ name: 'boxed', project });
  const done = await jobDone(routes, id);
  assert.equal(done.error, null);
  assert.equal(done.login.loggedIn, true);
  assert.ok(m.calls().some((x) => x.me === 'devcontainer' && x.args[0] === 'up'));
});

test('the page data carries the thresholds and the settings; status carries the usage the status line kept', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  const list = await routes['GET /api/accounts']();
  assert.deepEqual(list.accounts[0].limits, { minimum: { fiveHour: 8, sevenDay: 3 }, warn: { fiveHour: 16, sevenDay: 6 } });
  assert.deepEqual([list.settings.autoPick, list.settings.whenNone, list.settings.continueBelow], [false, 'stop', false]);
  assert.equal((await routes['GET /api/accounts-status'](q({ name: 'work' }))).usage.tracked, false);
  const dir = listAccounts(m.ctx)[0].dir;
  mkdirSync(join(dir, 'benchkeeper'), { recursive: true });
  const now = Date.now();
  writeFileSync(join(dir, 'benchkeeper', 'usage.json'), JSON.stringify({ checkedAt: new Date(now).toISOString(), fiveHour: { used: 96, resetsAt: Math.floor(now / 1000) + 3600 } }));
  const s = await routes['GET /api/accounts-status'](q({ name: 'work' }));
  assert.deepEqual([s.usage.fiveHour.state, s.usage.fiveHour.remaining, s.usage.sevenDay.state], ['low', 4, 'unknown']);
  assert.ok(s.findings.some((f) => /5-hour window has 4% left/.test(f.message)));
});

test('add by sign-in: no question up front, the name from the identity with a number on a clash, the default folder, no credential kept', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  m.mode('email', 'John.Doe@example.com');
  const added = async (agent) => {
    const { job: id } = await routes['POST /api/accounts-add']({ agent });
    const done = await jobDone(routes, id);
    assert.equal(done.error, null);
    assert.equal(done.login.browser, 'Firefox');
    assert.ok(!JSON.stringify(done).includes('dummy-oauth-access') && !JSON.stringify(done).includes('dummy-codex-access'));
    return done.login.account;
  };
  assert.equal(await added('claude'), 'john-doe');
  assert.equal(await added('claude'), 'john-doe-2');
  assert.equal(await added('codex'), 'codex');
  const base = join(m.home, '.local/share/benchkeeper/accounts');
  assert.deepEqual(listAccounts(m.ctx).map((a) => [a.name, a.agent, a.dir, !!a.default]), [['john-doe', 'claude', join(base, 'claude'), true], ['john-doe-2', 'claude', join(base, 'claude-2'), false], ['codex', 'codex', join(base, 'codex'), true]]);
  const s = await routes['GET /api/accounts-status'](q({ name: 'john-doe' }));
  assert.deepEqual([s.loggedIn, s.email, s.plan], [true, 'John.Doe@example.com', 'max']);
  // The registry, its ledger runs and backups are under the config folder; the page data comes from them.
  for (const secret of ['dummy-oauth-access', 'dummy-codex-access']) {
    assert.deepEqual(grep(m.ctx.config, secret), []);
    assert.ok(!JSON.stringify(await routes['GET /api/accounts']()).includes(secret));
    assert.ok(!JSON.stringify(s).includes(secret));
  }
  await assert.rejects(async () => routes['POST /api/accounts-add']({ agent: 'gemini' }), (e) => e.status === 400 && /agent must be one of claude, codex/.test(e.message));
});

test('add by sign-in: the name trims dashes and underscores at both ends as the earlier /^[-_]+|[-_]+$/g did', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  const before = (email) => email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 29).replace(/^[-_]+|[-_]+$/g, '') || 'claude';
  for (const email of ['__Jo--Do__@example.com', '.a.b.@example.com', '-_-@example.com', `x${'-'.repeat(40)}@example.com`]) {
    m.mode('email', email);
    const { job: id } = await routes['POST /api/accounts-add']({ agent: 'claude' });
    const done = await jobDone(routes, id);
    assert.equal(done.login.account, before(email), email);
  }
  assert.deepEqual(listAccounts(m.ctx).map((a) => a.name), ['jo--do', 'a-b', 'claude', 'x']);
});

test('a failed sign-in adds no account', skip, async () => {
  const m = machine({ flow: 'fail' });
  const routes = api(m.ctx);
  const { job: id } = await routes['POST /api/accounts-add']({ agent: 'claude' });
  const done = await jobDone(routes, id);
  assert.match(done.error, /exit 1/);
  assert.equal(done.login.account, null);
  assert.deepEqual(listAccounts(m.ctx), []);
});

test('usage tracking is a plan for a host account, written in its folder; a container account is told the command', skip, async () => {
  const m = machine({ flow: 'callback' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude', dir: join(m.root, 'elsewhere/work') });
  assert.equal((await routes['GET /api/accounts-status'](q({ name: 'work' }))).tracking, false);
  const { state } = await applyPlan(routes, { op: 'track', name: 'work' });
  assert.equal(state.error, null);
  assert.equal(state.run.status, 'done');
  assert.equal((await routes['GET /api/accounts-status'](q({ name: 'work' }))).tracking, true);
  assert.match(readFileSync(join(m.root, 'elsewhere/work/settings.json'), 'utf8'), /statusLine/);
  await applyPlan(routes, { op: 'add', name: 'boxed', agent: 'claude', container: true, mount: '/data/accounts/boxed' });
  const boxed = await routes['GET /api/accounts-status'](q({ name: 'boxed' }));
  assert.deepEqual([boxed.usage, boxed.notAvailable, boxed.tracking], [null, undefined, undefined]);
  await assert.rejects(async () => routes['POST /api/accounts-plan']({ op: 'track', name: 'boxed' }), (e) => e.status === 400 && /benchkeeper accounts track boxed --project/.test(e.message));
});
