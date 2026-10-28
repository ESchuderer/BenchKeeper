import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { listAccounts } from '../src/accounts.mjs';
import { addProject } from '../src/projects.mjs';
import { api } from '../src/server.mjs';
import { CLAUDE_TOKEN, grep, machine, win } from './fixtures/accounts.mjs';

// The accounts routes of the UI server against the fake agents of the accounts tests: nothing real is started.
const skip = win ? { skip: 'the fake agents are shell scripts' } : {};
const wait = async (f) => { for (let i = 0; i < 200; i++) { const v = await f(); if (v) return v; await new Promise((ok) => setTimeout(ok, 25)); } throw new Error('timed out'); };
const q = (o) => new URLSearchParams(o);
const job = (routes, id) => routes['GET /api/job'](q({ id }));

// Plan, then apply through the job route like the page does.
async function applyPlan(routes, body) {
  const plan = await routes['POST /api/accounts-plan'](body);
  const { job: id } = await routes['POST /api/apply']({ planId: plan.planId });
  await wait(() => job(routes, id).done);
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
  for (const [body, re] of [[{ op: 'add', name: 'Bad', agent: 'claude' }, /the name is 1 to 32/], [{ op: 'add', name: 'x', agent: 'claude', container: true }, /--mount is the absolute path/], [{ op: 'use', name: 'ghost' }, /no account ghost/], [{ op: 'frob', name: 'work' }, /op must be add, use or remove/], [{ op: 'add', name: 5, agent: 'claude' }, /the name is 1 to 32/]]) {
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
  const done = await wait(() => { const s = job(routes, id); return s.done && s; });
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
  assert.match((await wait(() => { const s = job(routes, bad.job); return s.done && s; })).error, /--email needs an address/);
  await assert.rejects(async () => routes['POST /api/accounts-code']({ job: id, code: 'x' }), /no sign-in waits for a code/);
});

test('sign-in job: the page pastes the code the browser shows; it reaches the agent and no record', skip, async () => {
  const m = machine({ flow: 'code' });
  const routes = api(m.ctx);
  await applyPlan(routes, { op: 'add', name: 'work', agent: 'claude' });
  const { job: id } = await routes['POST /api/accounts-login']({ name: 'work' });
  await wait(() => job(routes, id).login?.awaitingCode);
  assert.equal((await routes['GET /api/accounts']()).login, id);
  // A running sign-in holds the other changes.
  await assert.rejects(async () => routes['POST /api/accounts-login']({ name: 'work' }), (e) => e.status === 409);
  await routes['POST /api/accounts-code']({ job: id, code: ' PASTED-CODE-42 ' });
  const done = await wait(() => { const s = job(routes, id); return s.done && s; });
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
  await wait(() => job(routes, id).login?.awaitingCode);
  await routes['POST /api/job-cancel']({ id });
  const done = await wait(() => { const s = job(routes, id); return s.done && s; });
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
  const done = await wait(() => { const s = job(routes, id); return s.done && s; });
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
