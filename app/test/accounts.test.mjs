import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { CLAUDE_TOKEN, CODEX_TOKEN, URL1, grep, machine, win } from './fixtures/accounts.mjs';
import { accountChecks, accountEnv, accountStatus, accountStatusAsync, findAccount, listAccounts } from '../src/accounts.mjs';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { runCommand } from '../src/runner.mjs';

function cli(m, answers = []) {
  let text = '', errText = '';
  const sink = (set) => new Writable({ write(c, _, done) { set(String(c)); done(); } });
  const input = Readable.from(answers);
  const exec = (args, { tty = false } = {}) => { input.isTTY = tty; return main(args, { out: sink((c) => { text += c; }), err: sink((c) => { errText += c; }), ctx: m.ctx, input }); };
  return { exec, text: () => text, err: () => errText, json: () => JSON.parse(text) };
}

const skip = win ? { skip: 'the fake agents are shell scripts' } : {};

test('add, list, use and remove: plans with a diff, a ledger run each, undo restores the registry', skip, async () => {
  const m = machine(), c = cli(m);
  assert.equal(await c.exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']), 0);
  assert.equal(await c.exec(['accounts', 'add', 'home', '--agent', 'claude', '--label', 'private plan', '--yes']), 0);
  assert.equal(await c.exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']), 0);
  const list = listAccounts(m.ctx);
  assert.deepEqual(list.map((a) => [a.name, a.agent, !!a.default]), [['work', 'claude', true], ['home', 'claude', false], ['dev', 'codex', true]]);
  assert.equal(list[0].dir, join(m.home, '.local/share/benchkeeper/accounts/work'));
  assert.equal(list[1].label, 'private plan');
  assert.deepEqual(list[0].token, null);
  assert.equal(await c.exec(['accounts', 'use', 'home', '--yes']), 0);
  assert.deepEqual(listAccounts(m.ctx).map((a) => !!a.default), [false, true, true]);
  const c2 = cli(m);
  assert.equal(await c2.exec(['accounts', 'list']), 0);
  assert.match(c2.text(), /^work {13}claude {2}host {5}/m);
  assert.match(c2.text(), /home .*default .*private plan/);
  // A run per change, with an undo.
  const runs = m.ctx.ledger.list();
  assert.equal(runs.length, 4);
  const c3 = cli(m);
  assert.equal(await c3.exec(['accounts', 'remove', 'work', '--yes']), 0);
  assert.match(c3.text(), /the sign-in in .*work is left/);
  assert.deepEqual(listAccounts(m.ctx).map((a) => a.name), ['home', 'dev']);
  const last = m.ctx.ledger.list().find((r) => r.entries[0].title.startsWith('remove account'));
  const u = cli(m);
  assert.equal(await u.exec(['undo', last.id]), 0, u.text());
  assert.deepEqual(listAccounts(m.ctx).map((a) => a.name), ['work', 'home', 'dev']);
  // Without --yes the plan is shown and asked; no answer is a no.
  const c4 = cli(m, ['n\n']);
  assert.equal(await c4.exec(['accounts', 'remove', 'home']), 1);
  assert.match(c4.text(), /remove account home from the registry/);
  assert.equal(listAccounts(m.ctx).length, 3);
});

test('add asks for what is missing, then offers the sign-in', skip, async () => {
  const m = machine({ flow: 'callback' });
  const c = cli(m, ['personal\n', 'claude\n', 'n\n', 'y\n', 'y\n']);
  assert.equal(await c.exec(['accounts', 'add']), 0);
  assert.match(c.text(), /Account name: .*Agent \(claude or codex\): .*dev container .*apply\?.*Sign in personal now\?/s);
  assert.equal(findAccount(m.ctx, 'personal').agent, 'claude');
  assert.match(c.text(), /personal: signed in/);
  assert.equal(m.opened.length, 1);
  // With --yes nothing is asked: a missing name is a usage error.
  const d = cli(m);
  assert.equal(await d.exec(['accounts', 'add', '--yes']), 1);
  assert.match(d.text(), /the name is 1 to 32 characters/);
});

test('refusals: bad names and agents, duplicates, a folder inside the config folder, a broken registry', skip, async () => {
  const m = machine();
  const cases = [
    [['accounts', 'add', 'Bad Name', '--agent', 'claude', '--yes'], /the name is 1 to 32/],
    [['accounts', 'add', 'x', '--agent', 'gemini', '--yes'], /the agent is one of claude, codex/],
    [['accounts', 'add', 'x', '--agent', 'copilot', '--yes'], /accounts is not available for GitHub Copilot CLI/],
    [['accounts', 'add', 'x', '--agent', 'claude', '--dir', join(m.ctx.config, 'accounts/x'), '--yes'], /outside the BenchKeeper config folder/],
    [['accounts', 'add', 'x', '--agent', 'claude', '--container', '--mount', '../etc', '--yes'], /--mount is the absolute path/],
    [['accounts', 'add', 'x', '--agent', 'claude', '--container', '--yes'], /--mount is the absolute path/],
    [['accounts', 'use', 'ghost', '--yes'], /no account ghost/],
    [['accounts', 'login'], /needs an account name/],
    [['accounts', 'frob'], /accounts needs list/],
    [['accounts', 'list', 'a', 'b'], /unexpected argument b/],
  ];
  for (const [args, re] of cases) { const x = cli(m); assert.notEqual(await x.exec(args), 0, args.join(' ')); assert.match(x.text(), re); }
  assert.equal(await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']), 0);
  const dup = cli(m);
  assert.equal(await dup.exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']), 1);
  assert.match(dup.text(), /cannot merge: account work exists/);
  for (const bad of ['{', '{"accounts":{}}', '{"accounts":[{"name":"../x","agent":"claude","mode":"host","dir":"/x"}]}',
    '{"accounts":[{"name":"x","agent":"claude","mode":"container","volume":"v,target=/etc","mount":"/m"}]}',
    '{"accounts":[{"name":"x","agent":"claude","mode":"host","dir":"/x","label":{"a":1}}]}',
    '{"accounts":[{"name":"x","agent":"claude","mode":"host","dir":"/x","token":{}}]}',
    '{"accounts":[{"name":"x","agent":"claude","mode":"host","dir":"/x","token":{"created":"not a date"}}]}']) {
    writeFileSync(join(m.ctx.config, 'accounts.json'), bad);
    const b = cli(m);
    assert.equal(await b.exec(['accounts', 'list']), 2, bad);
    assert.match(b.text(), /the accounts file/);
  }
});

test('list and status --json: the documented keys, an error document for a broken registry', skip, async () => {
  const m = machine({ flow: 'callback' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  await cli(m).exec(['accounts', 'add', 'box', '--agent', 'codex', '--container', '--mount', '/data/accounts/box', '--yes']);
  const l = cli(m);
  assert.equal(await l.exec(['accounts', 'list', '--json']), 0);
  const doc = l.json();
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.command, 'accounts list');
  assert.deepEqual(doc.accounts.map((a) => Object.keys(a).sort()), [
    ['agent', 'default', 'dir', 'label', 'limits', 'mode', 'name', 'pool', 'token'],
    ['agent', 'default', 'label', 'limits', 'mode', 'mount', 'name', 'pool', 'token', 'volume']]);
  assert.deepEqual(doc.accounts[0].token, { kept: false, created: null });
  const s = cli(m);
  assert.equal(await s.exec(['accounts', 'status', 'work', '--json']), 0);
  assert.equal(s.json().command, 'accounts status');
  assert.equal(s.json().accounts[0].loggedIn, false);
  assert.equal(s.json().accounts[0].findings[0].fix, 'benchkeeper accounts login work');
  const none = cli(m);
  assert.equal(await none.exec(['accounts', 'status', 'ghost', '--json']), 2);
  assert.match(none.json().error, /no account ghost/);
  writeFileSync(join(m.ctx.config, 'accounts.json'), '{');
  const bad = cli(m);
  assert.equal(await bad.exec(['accounts', 'list', '--json']), 2);
  assert.match(bad.json().error, /not valid JSON/);
});

test('login (Claude Code): the link opens in a private window, the account folder is private and signed in', skip, async () => {
  const m = machine({ flow: 'callback' }), c = cli(m);
  await c.exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  const l = cli(m);
  assert.equal(await l.exec(['accounts', 'login', 'work', '--email', 'me@example.com']), 0);
  assert.deepEqual(m.opened, [URL1]);
  assert.match(l.text(), /Opened a private window in Firefox/);
  assert.match(l.text(), /work: signed in/);
  const a = m.calls().find((x) => x.args[1] === 'login');
  assert.deepEqual(a.args, ['auth', 'login', '--email', 'me@example.com']);
  // Exactly the account's folder, the browser kept off, no inherited credential.
  assert.equal(a.env.CLAUDE_CONFIG_DIR, findAccount(m.ctx, 'work').dir);
  assert.equal(a.env.BROWSER, 'true');
  assert.equal(a.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(a.env.GH_TOKEN, undefined);
  assert.equal(a.env.CODEX_HOME, undefined);
  assert.equal(statSync(findAccount(m.ctx, 'work').dir).mode & 0o777, 0o700);
  assert.match(readFileSync(join(findAccount(m.ctx, 'work').dir, '.credentials.json'), 'utf8'), /dummy-oauth-access/);
  assert.equal(await cli(m).exec(['accounts', 'login', 'work', '--email=-bad']), 1);
});

test('login: one test per branch of the link (private window, no browser, --no-browser, unknown host)', skip, async () => {
  const m = machine({ flow: 'callback' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  // No supported browser: the URL is printed for the user.
  m.ctx.openPrivate = () => null;
  const a = cli(m);
  assert.equal(await a.exec(['accounts', 'login', 'work']), 0);
  assert.match(a.text(), new RegExp(`Open this link in a private browser window: ${URL1.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
  // --no-browser never calls the launcher.
  let called = 0;
  m.ctx.openPrivate = () => { called++; return 'Firefox'; };
  const b = cli(m);
  assert.equal(await b.exec(['accounts', 'login', 'work', '--no-browser']), 0);
  assert.equal(called, 0);
  assert.match(b.text(), /Open this link in a private browser window/);
  // A link that is not the provider's: printed with a warning, never opened.
  const evil = join(m.bin, 'claude');
  writeFileSync(evil, readFileSync(evil, 'utf8').replace('https://claude.ai/oauth', 'https://evil.example/oauth'));
  const d = cli(m);
  assert.equal(await d.exec(['accounts', 'login', 'work']), 0);
  assert.equal(called, 0);
  assert.match(d.text(), /its host is not a known sign-in host, check it/);
});

test('login: a code the browser shows is pasted and reaches the agent; a failed login says how to sign in by hand', skip, async () => {
  const m = machine({ flow: 'code' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  const c = cli(m, ['\n', 'PASTE-CODE-123\n']);
  assert.equal(await c.exec(['accounts', 'login', 'work']), 0);
  assert.equal(readFileSync(join(m.bin, 'pasted'), 'utf8'), 'PASTE-CODE-123');
  assert.match(c.text(), /paste it here/);
  m.flow('fail');
  const f = cli(m);
  assert.equal(await f.exec(['accounts', 'login', 'work']), 1);
  assert.match(f.text(), /claude auth ended with exit 1/);
  // The agent's own error line carried a token: it is masked.
  assert.ok(!f.text().includes(CLAUDE_TOKEN));
  // Not signed in after a "successful" end is reported.
  m.flow('callback');
  writeFileSync(join(m.bin, 'claude'), readFileSync(join(m.bin, 'claude'), 'utf8').replace("write(dir, '.credentials.json', { accessToken: 'dummy-oauth-access' }); process.exit(0); }, 100)", 'process.exit(0); }, 100)'));
  await cli(m).exec(['accounts', 'add', 'fresh', '--agent', 'claude', '--yes']);
  const g = cli(m);
  assert.equal(await g.exec(['accounts', 'login', 'fresh']), 1);
  assert.match(g.text(), /still not signed in/);
});

test('login (Codex): device auth prints the link and the code, opens a private window, uses CODEX_HOME', skip, async () => {
  const m = machine();
  await cli(m).exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'login', 'dev']), 0);
  assert.deepEqual(m.opened, ['https://auth.openai.com/codex/device']);
  assert.match(c.text(), /ABCD-12345/);
  const a = m.calls().find((x) => x.args[0] === 'login' && x.args[1] === '--device-auth');
  assert.equal(a.env.CODEX_HOME, findAccount(m.ctx, 'dev').dir);
  assert.equal(a.env.CLAUDE_CONFIG_DIR, undefined);
  assert.ok(existsSync(join(findAccount(m.ctx, 'dev').dir, 'auth.json')));
});

test('token (Claude Code): setup-token kept in the credential store, recorded without its value, never shown', skip, async () => {
  const m = machine();
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  const c = cli(m, ['CODE\n']);
  assert.equal(await c.exec(['accounts', 'login', 'work', '--token']), 0);
  assert.equal(m.kept.get('work'), CLAUDE_TOKEN);
  assert.match(c.text(), /a token was received and is not shown/);
  assert.match(c.text(), /token kept in the OS credential store \(fake-store\)/);
  assert.ok(!c.text().includes(CLAUDE_TOKEN) && !c.err().includes(CLAUDE_TOKEN));
  assert.match(findAccount(m.ctx, 'work').token.created, /^\d{4}-\d\d-\d\dT/);
  // The acceptance grep: no file of the state folder (registry, ledger, backups, everything under the config folder) or of
  // the home outside the agent's own account folder holds the token or the inherited ones.
  const accountFolder = join(m.home, '.local/share/benchkeeper/accounts');
  for (const secret of [CLAUDE_TOKEN, 'inherited-oauth-token-dummy', 'dummy-api-key', 'dummy-gh']) {
    assert.deepEqual(grep(m.ctx.config, secret), [], secret);
    assert.deepEqual(grep(m.home, secret).filter((p) => !p.startsWith(accountFolder)), [], secret);
  }
  // The list shows that a token is kept, and when.
  const l = cli(m);
  await l.exec(['accounts', 'list']);
  assert.match(l.text(), /token kept since \d{4}-\d\d-\d\d/);
  // A store that refuses stops the login before the agent runs.
  m.ctx.credentials = { ...m.ctx.credentials, has: () => { throw new Error('no secret service'); } };
  const n = m.calls().length;
  const r = cli(m);
  assert.equal(await r.exec(['accounts', 'login', 'work', '--token']), 1);
  assert.match(r.text(), /no secret service/);
  assert.equal(m.calls().length, n);
});

test('token (Codex): the access token comes from a pipe, goes to codex login on its stdin and is kept nowhere else', skip, async () => {
  const m = machine();
  await cli(m).exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  const tty = cli(m);
  assert.equal(await tty.exec(['accounts', 'login', 'dev', '--token'], { tty: true }), 2);
  assert.match(tty.text(), /pipe the access token on stdin/);
  const bad = cli(m, ['short\n']);
  assert.equal(await bad.exec(['accounts', 'login', 'dev', '--token']), 1);
  const c = cli(m, [`${CODEX_TOKEN}\n`]);
  assert.equal(await c.exec(['accounts', 'login', 'dev', '--token']), 0);
  assert.equal(readFileSync(join(m.bin, 'stdin-token'), 'utf8'), CODEX_TOKEN);
  const call = m.calls().find((x) => x.args[1] === '--with-access-token');
  assert.deepEqual(call.args, ['login', '--with-access-token']);
  // The agent echoed the token in its output: masked by value.
  assert.ok(!c.text().includes(CODEX_TOKEN));
  assert.equal(findAccount(m.ctx, 'dev').token, null);
  assert.equal(m.kept.size, 0);
  assert.deepEqual(grep(m.ctx.config, CODEX_TOKEN), []);
});

test('run: the agent gets the filtered environment plus the account folder, after the sign-in check', skip, async () => {
  const m = machine({ flow: 'callback' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  const refused = cli(m);
  assert.equal(await refused.exec(['run', '--account', 'work', '--', 'claude', '--resume']), 1);
  assert.match(refused.text(), /not signed in, or the login expired: benchkeeper accounts login work/);
  await cli(m).exec(['accounts', 'login', 'work']);
  const before = m.calls().length;
  assert.equal(await cli(m).exec(['run', '--account', 'work', '--', 'claude', '--resume', 'abc']), 0);
  const launch = m.calls().slice(before).find((x) => x.args[0] === '--resume');
  assert.deepEqual(launch.args, ['--resume', 'abc']);
  assert.equal(launch.env.CLAUDE_CONFIG_DIR, findAccount(m.ctx, 'work').dir);
  // Nothing inherited that looks like a credential, no other agent's folder, and nothing but the folder variable beyond the filtered base.
  for (const k of Object.keys(launch.env)) assert.ok(!/token|secret|passw|credential|auth|api[_-]?key|private/i.test(k), k);
  assert.equal(launch.env.CODEX_HOME, undefined);
  assert.equal(launch.env.ANTHROPIC_API_KEY, undefined);
  const base = new Set(Object.keys(accountEnv(m.ctx, { agent: 'claude', mode: 'container' })));
  const extra = Object.keys(launch.env).filter((k) => !base.has(k) && !['PWD', 'SHLVL', '_', 'OLDPWD', '__CF_USER_TEXT_ENCODING'].includes(k) && !k.startsWith('NODE_'));
  assert.deepEqual(extra, ['CLAUDE_CONFIG_DIR'], JSON.stringify(Object.keys(launch.env)));
  // The default account of the agent when --account is left out; a usage error without the agent.
  const d = cli(m);
  assert.equal(await d.exec(['run', '--', 'claude']), 0);
  assert.equal(await d.exec(['run', '--account', 'work', '--']), 2);
  assert.equal(await d.exec(['run', '--account', 'work', '--', 'codex']), 1);
  assert.match(d.text(), /account work is a claude account/);
  assert.equal(await d.exec(['run', '--', 'codex']), 1);
  assert.match(d.text(), /no default codex account/);
});

test('run --token: the stored token is the one extra variable, for Claude Code on the host only', skip, async () => {
  const m = machine({ flow: 'callback' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  const none = cli(m);
  assert.equal(await none.exec(['run', '--account', 'work', '--token', '--', 'claude']), 1);
  assert.match(none.text(), /keeps no token/);
  await cli(m, ['CODE\n']).exec(['accounts', 'login', 'work', '--token']);
  const before = m.calls().length;
  // Signed in only by the token: the preflight sees the token variable too.
  const c = cli(m);
  assert.equal(await c.exec(['run', '--account', 'work', '--token', '--', 'claude', '-p', 'hi']), 0);
  const launch = m.calls().slice(before).find((x) => x.args[0] === '-p');
  assert.equal(launch.env.CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_TOKEN);
  assert.equal(launch.env.CLAUDE_CONFIG_DIR, findAccount(m.ctx, 'work').dir);
  assert.ok(!c.text().includes(CLAUDE_TOKEN));
  // Without --token the inherited token variable never reaches the agent.
  await cli(m).exec(['accounts', 'login', 'work']);
  await cli(m).exec(['run', '--account', 'work', '--', 'claude', '-p', 'again']);
  assert.equal(m.calls().filter((x) => x.args[0] === '-p').at(-1).env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  // The store lost it: a launch says so.
  m.kept.clear();
  const lost = cli(m);
  assert.equal(await lost.exec(['run', '--account', 'work', '--token', '--', 'claude']), 1);
  assert.match(lost.text(), /not in the credential store/);
  // Codex keeps no token variable.
  await cli(m).exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  assert.equal(await cli(m).exec(['run', '--account', 'dev', '--token', '--', 'codex']), 1);
});

test('the usage feed of a Codex account is reported as not available, in the CLI and in the status document', skip, async () => {
  const m = machine();
  await cli(m).exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  const s = cli(m);
  assert.equal(await s.exec(['accounts', 'status', 'dev']), 0);
  assert.match(s.text(), /usage +the usage feed is not available for Codex/);
  assert.equal(accountStatus(m.ctx, findAccount(m.ctx, 'dev')).notAvailable, 'the usage feed is not available for Codex');
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  assert.equal(accountStatus(m.ctx, findAccount(m.ctx, 'work')).notAvailable, undefined);
});

test('plan names what an agent has no surface for', skip, async () => {
  const m = machine(), p = cli(m);
  await p.exec(['plan', '--agents', 'gemini']);
  assert.match(p.text(), /^the tier strip is not available for Gemini CLI$/m);
  assert.doesNotMatch(p.text(), /not available for Claude/);
});

test('status and doctor: signed out, a token in its 11th month, an expired token; each with the command that fixes it', skip, async () => {
  const m = machine({ flow: 'callback' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  await cli(m).exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  const s = cli(m);
  assert.equal(await s.exec(['accounts', 'status']), 0);
  assert.match(s.text(), /work +claude +not signed in/);
  assert.match(s.text(), /dev +codex +not signed in/);
  assert.match(s.text(), /fix: benchkeeper accounts login dev/);
  await cli(m).exec(['accounts', 'login', 'work']);
  await cli(m).exec(['accounts', 'login', 'dev']);
  const ok = cli(m);
  await ok.exec(['accounts', 'status']);
  assert.match(ok.text(), /work +claude +signed in \(claude\.ai\)/);
  assert.match(ok.text(), /dev +codex +signed in/);
  // A kept token's age comes from the registry.
  const age = (days) => {
    const list = listAccounts(m.ctx).map((a) => (a.name === 'work' ? { ...a, token: { created: new Date(Date.now() - days * 864e5).toISOString() } } : a));
    writeFileSync(join(m.ctx.config, 'accounts.json'), JSON.stringify({ schemaVersion: 1, accounts: list }));
  };
  age(100);
  assert.deepEqual(accountChecks(m.ctx), []);
  age(340);
  assert.deepEqual(accountChecks(m.ctx).map((i) => [i.level, i.fix]), [['warning', 'benchkeeper accounts login work --token']]);
  age(400);
  const stub = { ...m.ctx, run: (argv, o) => (['claude', 'codex'].includes(argv[0]) ? runCommand(argv, o) : { code: argv[0] === 'npm' ? 1 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' }) };
  const found = doctor(stub, { agents: [], dir: m.home }).filter((i) => i.check === 'accounts');
  assert.deepEqual(found.map((i) => i.level), ['error']);
  assert.match(found[0].message, /account work: the stored token is 400 days old and has run out/);
  const st = cli(m);
  assert.equal(await st.exec(['accounts', 'status', 'work']), 1);
  assert.match(st.text(), /token 400 days old/);
  const j = cli(m);
  assert.equal(await j.exec(['accounts', 'status', '--json']), 1);
  assert.equal(j.json().accounts[0].tokenAgeDays, 400);
  // A status that cannot be read is not a login problem.
  writeFileSync(join(m.bin, 'claude'), '#!/bin/sh\necho oops\nexit 5\n');
  assert.equal(accountStatus(m.ctx, findAccount(m.ctx, 'work')).loggedIn, null);
  assert.equal(accountStatus({ ...m.ctx, env: { PATH: '/nonexistent' } }, findAccount(m.ctx, 'work')).findings[0].message, 'account work: claude is not installed');
  // A broken registry is one error in doctor.
  writeFileSync(join(m.ctx.config, 'accounts.json'), '{');
  assert.match(accountChecks(m.ctx)[0].message, /not valid JSON/);
  // No registry: doctor reports nothing about accounts.
  assert.deepEqual(accountChecks(machine().ctx), []);
});

test('dev container accounts: a volume per account, mounted at devcontainer up, the folder variable through --remote-env, devcontainer.json untouched', skip, async () => {
  const m = machine({ flow: 'callback' });
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  const config = '{ "name": "x", "image": "node:22" }\n';
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), config);
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/accounts/boxed', '--yes']), 0);
  const a = findAccount(m.ctx, 'boxed');
  assert.deepEqual([a.mode, a.volume, a.mount, a.dir], ['container', 'benchkeeper-claude-boxed', '/data/accounts/boxed', undefined]);
  // Not checked without a project: said so, nothing run.
  const s0 = cli(m);
  assert.equal(await s0.exec(['accounts', 'status', 'boxed']), 0);
  assert.match(s0.text(), /not checked/);
  // The sign-in runs in the container: the mount is checked, the folder variable is the mount path, the browser stays out.
  m.mode('container-login', 'yes');
  const l = cli(m, ['\n']);
  assert.equal(await l.exec(['accounts', 'login', 'boxed', '--project', project]), 0);
  const calls = m.calls().filter((x) => x.me === 'devcontainer');
  const up = calls.find((x) => x.args[0] === 'up');
  assert.ok(up.args.includes('type=volume,source=benchkeeper-claude-boxed,target=/data/accounts/boxed'));
  assert.ok(up.args.includes('podman') || up.args.includes('docker'));
  const exec = calls.filter((x) => x.args[0] === 'exec').find((x) => x.args.includes('login'));
  assert.ok(exec.args.includes('CLAUDE_CONFIG_DIR=/data/accounts/boxed'));
  assert.equal(exec.env.CLAUDE_CONFIG_DIR, undefined, 'the host-side process carries no account variable');
  assert.equal(readFileSync(join(project, '.devcontainer/devcontainer.json'), 'utf8'), config);
  assert.deepEqual(readdirSync(join(project, '.devcontainer')), ['devcontainer.json']);
  // A container that lacks the mount: the command that recreates it, with every account's volume.
  m.mode('mounted', 'no');
  const miss = cli(m);
  assert.equal(await miss.exec(['accounts', 'login', 'boxed', '--project', project]), 1);
  assert.match(miss.text(), /is not mounted at \/data\/accounts\/boxed/);
  assert.match(miss.text(), /devcontainer up .*--mount type=volume,source=benchkeeper-claude-boxed,target=\S+ --remove-existing-container/);
  // A project without a dev container, no engine.
  const bare = mkdtempSync(join(tmpdir(), 'bk-acct-bare-'));
  const nb = cli(m);
  assert.equal(await nb.exec(['accounts', 'login', 'boxed', '--project', bare]), 1);
  assert.match(nb.text(), /has no dev container configuration/);
  m.mode('mounted', 'yes');
  m.mode('engine', 'none');
  const ne = cli(m);
  assert.equal(await ne.exec(['accounts', 'login', 'boxed', '--project', project]), 1);
  assert.match(ne.text(), /no container engine/);
});

test('dev container run: the preflight runs in the container, a kept token is a --remote-env of that one launch only', skip, async () => {
  const m = machine({ flow: 'callback' });
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{}\n');
  await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/accounts/boxed', '--yes']);
  const out = cli(m);
  assert.equal(await out.exec(['run', '--account', 'boxed', '--project', project, '--', 'claude']), 1);
  assert.match(out.text(), /not signed in/);
  m.mode('container-login', 'yes');
  assert.equal(await cli(m).exec(['run', '--account', 'boxed', '--project', project, '--', 'claude', '--resume']), 0);
  const exec = m.calls().filter((x) => x.me === 'devcontainer' && x.args[0] === 'exec' && x.args.includes('--resume')).at(-1);
  assert.deepEqual(exec.args.slice(exec.args.indexOf('--remote-env'), exec.args.indexOf('--remote-env') + 2), ['--remote-env', 'CLAUDE_CONFIG_DIR=/data/accounts/boxed']);
  assert.equal(exec.args.filter((a) => /TOKEN/.test(a)).length, 0);
  // The token: kept in the store by a sign-in in the container, given to the next launch only.
  m.kept.set('boxed', CLAUDE_TOKEN);
  writeFileSync(join(m.ctx.config, 'accounts.json'), JSON.stringify({ schemaVersion: 1, accounts: listAccounts(m.ctx).map((x) => ({ ...x, token: { created: new Date().toISOString() } })) }));
  assert.equal(await cli(m).exec(['run', '--account', 'boxed', '--project', project, '--token', '--', 'claude', '-p', 'x']), 0);
  const withToken = m.calls().filter((x) => x.me === 'devcontainer' && x.args.includes('-p')).at(-1);
  assert.ok(withToken.args.includes(`CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_TOKEN}`));
  // Only the launch carries it: the preflight command line of that run does not.
  assert.equal(m.calls().filter((x) => x.me === 'devcontainer' && x.args.join(' ').includes(CLAUDE_TOKEN)).length, 1);
  assert.equal(withToken.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.deepEqual(grep(m.ctx.config, CLAUDE_TOKEN), []);
  assert.deepEqual(grep(project, CLAUDE_TOKEN), []);
  // Codex in a container: the token goes through stdin to codex login in that container, into the mount.
  await cli(m).exec(['accounts', 'add', 'cbox', '--agent', 'codex', '--container', '--mount', '/data/accounts/cbox', '--yes']);
  const cx = cli(m, [`${CODEX_TOKEN}\n`]);
  assert.equal(await cx.exec(['accounts', 'login', 'cbox', '--token', '--project', project]), 0);
  const call = m.calls().filter((x) => x.me === 'devcontainer' && x.args.includes('--with-access-token')).at(-1);
  assert.ok(call.args.includes('CODEX_HOME=/data/accounts/cbox'));
  assert.ok(!call.args.join(' ').includes(CODEX_TOKEN));
});

test('accountEnv: an inherited folder variable of either agent is replaced, never added to', () => {
  const ctx = { env: { PATH: '/bin', CLAUDE_CONFIG_DIR: '/x', claude_config_dir: '/y', CODEX_HOME: '/z', CLAUDE_CODE_OAUTH_TOKEN: 't', OPENAI_API_KEY: 'k', CLAUDE_CODE_USE_BEDROCK: '1' } };
  const host = accountEnv(ctx, { agent: 'codex', mode: 'host', dir: '/acct' });
  assert.equal(host.CODEX_HOME, '/acct');
  assert.equal(host.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(host.OPENAI_API_KEY, undefined);
  assert.equal(accountEnv(ctx, { agent: 'claude', mode: 'host', dir: '/acct' }, { token: 'tok-dummy' }).CLAUDE_CODE_OAUTH_TOKEN, 'tok-dummy');
  // The launch that carries a token takes no endpoint from the shell, also when BENCHKEEPER_PASS_ENV names it.
  const routed = { env: { PATH: '/bin', ANTHROPIC_BASE_URL: 'https://example.invalid', BENCHKEEPER_PASS_ENV: 'ANTHROPIC_BASE_URL' } };
  assert.equal(accountEnv(routed, { agent: 'claude', mode: 'host', dir: '/acct' }, { token: 'tok-dummy' }).ANTHROPIC_BASE_URL, undefined);
  assert.equal(accountEnv(routed, { agent: 'claude', mode: 'host', dir: '/acct' }).ANTHROPIC_BASE_URL, 'https://example.invalid');
  // In a container the account variable is a --remote-env of the command, not part of the host environment.
  const box = accountEnv(ctx, { agent: 'claude', mode: 'container' }, { token: 'tok-dummy' });
  assert.equal(box.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(box.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(box.CLAUDE_CODE_USE_BEDROCK, '1');
});

test('status in a container: a failing devcontainer exec is not read as a login state of the agent', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{}\n');
  await cli(m).exec(['accounts', 'add', 'cbox', '--agent', 'codex', '--container', '--mount', '/data/accounts/cbox', '--yes']);
  const a = findAccount(m.ctx, 'cbox');
  // devcontainer exec fails with its own exit code (1: no container, 127: not found): neither says anything about Codex.
  for (const code of [1, 127]) {
    const failing = { ...m.ctx, runAsync: undefined, run: (argv) => (argv[1] === '--version' ? { code: 0, stdout: '', stderr: '' } : { code, stdout: '', stderr: 'no container' }) };
    for (const s of [accountStatus(failing, a, { dir: project }), await accountStatusAsync(failing, a, { dir: project })]) {
      assert.equal(s.loggedIn, null, String(code));
      assert.deepEqual(s.findings.map((f) => f.level), ['info']);
      assert.match(s.findings[0].message, /login state not read/);
    }
  }
});

test('status with the async runner reads the same state as the blocking one', skip, async () => {
  const m = machine({ flow: 'callback' });
  await cli(m).exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  await cli(m).exec(['accounts', 'login', 'work']);
  const a = findAccount(m.ctx, 'work');
  assert.equal(typeof m.ctx.runAsync, 'function');
  assert.deepEqual(await accountStatusAsync(m.ctx, a), accountStatus(m.ctx, a));
  assert.equal((await accountStatusAsync(m.ctx, a)).loggedIn, true);
});
