// The per-machine GitHub App bot (bot.mjs): the manifest flow against a fake GitHub (an injected fetch), the key in a fake
// credential store, tokens, the session wiring and the guard in a bot session. No real App, token, keychain or git config.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { initRepo } from './helpers.mjs';
import { CLAUDE_TOKEN, machine as accountsMachine, win } from './fixtures/accounts.mjs';
import { KEY_ENTRY, PERMISSIONS, TOKEN_ENTRY, appJwt, appName, botChecks, configFile, encodeKey, hostSlug, identity, manifest, mintToken, readConfig, realGh, repoOf, sessionEnv, setupBot, wrapperDir } from '../src/bot.mjs';
import { main } from '../src/cli.mjs';
import { decide, denyReason } from '../src/guard-hook.mjs';
import { sessionRole } from '../src/orca/index.mjs';
import { context } from '../src/runner.mjs';

const CLIENT = 'Iv23liDUMMYclient', CLIENT_SECRET = 'dummy-client-secret-0123456789', WEBHOOK_SECRET = 'dummy-webhook-secret-0123456789';
const SLUG = 'benchkeeper-agent-box', REPO = 'octo/proj', CODE = 'dummy-manifest-code';
const MINTED = (n) => `ghs_DUMMYinstallationTOKEN${String(n).padStart(4, '0')}`;
const GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find((p) => existsSync(p));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const PEM_LINE = PEM.split('\n')[5];

// A fake GitHub: the REST calls the bot makes, JWTs checked against the key it handed out.
function github({ installed = true } = {}) {
  const gh = { installed, calls: [], minted: 0, fail: null };
  const json = (status, o) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const jwtOk = (auth) => {
    const [h, p, s] = String(auth).replace(/^Bearer /, '').split('.');
    const claims = JSON.parse(Buffer.from(p ?? '', 'base64url').toString() || '{}');
    return createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s ?? '', 'base64url')) && claims.iss === CLIENT;
  };
  gh.fetch = async (url, init = {}) => {
    const u = new URL(url), auth = init.headers?.authorization;
    gh.calls.push({ method: init.method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null, auth });
    if (gh.fail) return gh.fail(u);
    if (init.method === 'POST' && u.pathname === `/app-manifests/${CODE}/conversions`) {
      return json(201, { id: 4242, slug: SLUG, name: SLUG, client_id: CLIENT, client_secret: CLIENT_SECRET, webhook_secret: WEBHOOK_SECRET, pem: PEM, owner: { login: 'octo' }, html_url: `https://github.com/apps/${SLUG}` });
    }
    if (u.pathname === `/repos/${REPO}/installation`) return !jwtOk(auth) ? json(401, { message: 'bad JWT' }) : gh.installed ? json(200, { id: 777, account: { login: 'octo' } }) : json(404, { message: 'Not Found' });
    if (u.pathname === `/users/${encodeURIComponent(`${SLUG}[bot]`)}`) return json(200, { id: 99001, login: `${SLUG}[bot]`, type: 'Bot' });
    if (init.method === 'POST' && u.pathname === '/app/installations/777/access_tokens') {
      if (!jwtOk(auth)) return json(401, { message: 'bad JWT' });
      gh.minted += 1;
      return json(201, { token: MINTED(gh.minted), expires_at: new Date(Date.now() + 3600e3).toISOString() });
    }
    return json(404, { message: 'Not Found' });
  };
  return gh;
}

function machine(gh = github()) {
  const home = mkdtempSync(join(tmpdir(), 'bk-bot-'));
  const kept = new Map();
  const credentials = { name: 'fake-store', set: (n, t) => kept.set(n, t), get: (n) => kept.get(n) ?? null, has: (n) => kept.has(n), delete: (n) => kept.delete(n) };
  const ctx = { ...context({ home }), credentials, fetch: gh.fetch, env: { PATH: '/usr/bin:/bin', HOME: home } };
  return { ctx, kept, gh, home };
}

// The user in the browser: loads the local page, sends its form to GitHub (here: reads it), comes back with the code, installs.
const unescape = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
function browser(seen = {}) {
  return (url) => {
    seen.opened = [...(seen.opened ?? []), url];
    if (!url.startsWith('http://127.0.0.1')) return 'opened';
    const base = new URL(url).origin;
    seen.done = (async () => {
      const page = await (await fetch(url)).text();
      seen.action = unescape(page.match(/action="([^"]+)"/)[1]);
      seen.manifest = JSON.parse(unescape(page.match(/name="manifest" value="([^"]+)"/)[1]));
      const state = new URL(seen.action).searchParams.get('state');
      const created = () => fetch(`${base}/created?code=${CODE}&state=${state}`, { redirect: 'manual' });
      const first = await created();
      seen.location = first.headers.get('location');
      // A reload of the answer finds the code used; then the user installs the App, and the redirect nudges the check.
      seen.statuses = [first.status, (await created()).status];
      if (seen.install) seen.install();
      await fetch(`${base}/installed?installation_id=777&setup_action=install`).catch(() => {});
    })();
    return 'opened';
  };
}

async function cli(m, args, { lines = [], tty = false, input } = {}) {
  let text = '', err = '';
  const source = input ?? Readable.from(lines.map((l) => `${l}\n`));
  source.isTTY = tty;
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  out.isTTY = tty;
  const code = await main(args, { out, err: new Writable({ write(c, _, done) { err += c; done(); } }), ctx: m.ctx, input: source });
  return { code, text, err };
}

// A machine whose bot setup finished, written as setup leaves it.
function ready(m) {
  m.kept.set(KEY_ENTRY, encodeKey(PEM));
  mkdirSync(m.ctx.config, { recursive: true });
  writeFileSync(configFile(m.ctx), JSON.stringify({ version: 1, prefix: 'benchkeeper-agent', host: 'box', repo: REPO, appId: 4242, slug: SLUG, name: SLUG, clientId: CLIENT, owner: 'octo', installation: { id: 777, account: 'octo' }, user: { id: 99001, login: `${SLUG}[bot]` } }));
  return m;
}
// Every file below dir whose bytes contain one of the needles.
const grep = (dir, needles) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((p) => statSync(p).isFile() && needles.some((n) => readFileSync(p).includes(n))) : []);
const SECRETS = [PEM_LINE, CLIENT_SECRET, WEBHOOK_SECRET, MINTED(1), MINTED(2), MINTED(3)];

test('bot: the JWT is RS256 with iat 60 seconds back, a 9 minute life and the client id as issuer', () => {
  const now = Date.UTC(2026, 10, 1, 12);
  const [h, p, s] = appJwt(CLIENT, privateKey, now).split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p, 'base64url')), { iat: now / 1000 - 60, exp: now / 1000 + 540, iss: CLIENT });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')));
});

test('bot: the key is kept as PKCS#8 DER in base64, and a PEM that does not read stores nothing', () => {
  const kept = encodeKey(PEM);
  assert.match(kept, /^[A-Za-z0-9+/=]+$/);
  assert.ok(!kept.includes(PEM_LINE));
  assert.throws(() => encodeKey('-----BEGIN RSA PRIVATE KEY-----\nnot a key\n-----END RSA PRIVATE KEY-----'), (e) => !e.message.includes('not a key') && /nothing was stored/.test(e.message));
});

test('bot: App name, host slug, roles and repository addresses', () => {
  assert.equal(hostSlug('Mac-Studio.local'), 'mac-studio');
  assert.equal(hostSlug('...'), 'host');
  assert.equal(appName('benchkeeper-agent', 'devstudio'), 'benchkeeper-agent-devstudio');
  const long = appName('benchkeeper-agent', 'a-very-long-host-name-of-a-build-machine');
  assert.ok(long.length <= 34 && !long.endsWith('-'), long);
  for (const bad of ['Bad', 'a--b', '-a', 'x'.repeat(26)]) assert.throws(() => appName(bad, 'h'), /--prefix/);
  for (const u of ['https://github.com/octo/proj.git', 'git@github.com:octo/proj.git', 'ssh://git@github.com/octo/proj', 'https://x-access-token@github.com/octo/proj/']) assert.equal(repoOf(u), REPO, u);
  for (const u of ['https://gitlab.com/octo/proj', 'git@github.com:octo', '', undefined, 'https://github.com/a/b/c']) assert.equal(repoOf(u), null, String(u));
  assert.equal(sessionRole(['claude', '-p', 'fix the tests']), 'orchestrator');
  assert.equal(sessionRole(['claude', 'You are working inside Orca, a multi-agent IDE.\nYour task ID is: t-1\n']), 'worker');
  const m = manifest({ name: 'n', repo: REPO, base: 'http://127.0.0.1:9' });
  assert.deepEqual([m.url, m.redirect_url, m.setup_url, m.public, m.hook_attributes], [`https://github.com/${REPO}`, 'http://127.0.0.1:9/created', 'http://127.0.0.1:9/installed', false, undefined]);
  assert.deepEqual(m.default_permissions, PERMISSIONS);
  assert.equal(PERMISSIONS.administration ?? PERMISSIONS.workflows, undefined, 'no settings and no workflow changes');
});

test('bot setup: the manifest flow creates the App, keeps the key in the credential store only and installs it, with a fake GitHub', async () => {
  const m = machine(github({ installed: false }));
  const seen = { install: () => { m.gh.installed = true; } };
  m.ctx.openUrl = browser(seen);
  const dir = mkdtempSync(join(tmpdir(), 'bk-bot-repo-'));
  initRepo(dir);
  execFileSync(GIT, ['-C', dir, 'remote', 'add', 'origin', `git@github.com:${REPO}.git`]);
  const r = await cli(m, ['bot', 'setup', '--project', dir, '--prefix', 'benchkeeper-agent']);
  await seen.done;
  assert.equal(r.code, 0, r.text);
  assert.match(seen.action, /^https:\/\/github\.com\/settings\/apps\/new\?state=[0-9a-f]{32}$/);
  assert.match(seen.manifest.name, /^benchkeeper-agent-[a-z0-9-]+$/);
  assert.equal(seen.manifest.url, `https://github.com/${REPO}`);
  assert.deepEqual(seen.statuses, [302, 410]);
  assert.equal(seen.location, `https://github.com/apps/${SLUG}/installations/new?state=${new URL(seen.action).searchParams.get('state')}`);
  // The key went to the store, bot.json holds ids and names only, the secrets of the answer are gone.
  assert.deepEqual([...m.kept.keys()].sort(), [KEY_ENTRY, TOKEN_ENTRY].sort());
  const c = readConfig(m.ctx);
  assert.deepEqual([c.appId, c.slug, c.clientId, c.owner, c.repo, c.installation, c.user], [4242, SLUG, CLIENT, 'octo', REPO, { id: 777, account: 'octo' }, { id: 99001, login: `${SLUG}[bot]` }]);
  assert.equal(statSync(configFile(m.ctx)).mode & 0o777, 0o600);
  assert.deepEqual(identity(c), { name: `${SLUG}[bot]`, email: `99001+${SLUG}[bot]@users.noreply.github.com` });
  assert.match(r.text, /bot ready: the App benchkeeper-agent-box .*installed on octo\/proj \(installation 777\)/);
  assert.match(r.text, /commits as benchkeeper-agent-box\[bot\] <99001\+benchkeeper-agent-box\[bot\]@users\.noreply\.github\.com>/);
  assert.match(r.text, /a test token was minted .* and not shown/);
  // The conversion took no credential; every other App call carried a JWT; the user lookup none.
  const conv = m.gh.calls.find((x) => x.path.startsWith('/app-manifests/'));
  assert.equal(conv.auth, undefined);
  assert.equal(m.gh.calls.find((x) => x.path.startsWith('/users/')).auth, undefined);
  assert.deepEqual(grep(m.home, SECRETS), []);
  assert.ok(!SECRETS.some((s) => r.text.includes(s) || r.err.includes(s)));
  // A second setup is refused; status shows what was kept.
  assert.equal((await cli(m, ['bot', 'setup', '--repo', REPO])).code, 2);
  const s = await cli(m, ['bot', 'status']);
  assert.match(s.text, /installation: 777[\s\S]*key: in the credential store \(fake-store\)[\s\S]*settings\/apps\/benchkeeper-agent-box\/advanced/);
});

test('bot setup: an organization form, a wrong state, host or second answer, and a failed conversion', async () => {
  const m = machine(), seen = {};
  let base;
  m.ctx.openUrl = (url) => { base = new URL(url).origin; seen.url = url; return null; };
  m.gh.fail = () => new Response(JSON.stringify({ message: `rate limited ${MINTED(3)}` }), { status: 422 });
  const said = [];
  const started = setupBot(m.ctx, { repo: REPO, org: 'acme', host: 'box', say: (l) => said.push(l), open: m.ctx.openUrl, createTimeout: 5000 });
  // Settled as soon as it fails, so the failure is not an unhandled rejection while the requests below run.
  const run = started.then(() => null, (e) => e);
  await new Promise((r) => setTimeout(r, 50));
  assert.match(said[0], /open http:\/\/127\.0\.0\.1:\d+\/start\?state=/);
  const page = await (await fetch(seen.url)).text();
  assert.match(unescape(page), /action="https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/);
  assert.equal((await fetch(`${base}/start?state=nope`)).status, 404);
  assert.equal((await fetch(`${base}/created?code=${CODE}&state=nope`)).status, 400);
  const other = await new Promise((ok) => { import('node:http').then(({ request }) => request({ host: '127.0.0.1', port: new URL(base).port, path: '/installed', headers: { host: 'evil.example' } }, (res) => ok(res.statusCode)).end()); });
  assert.equal(other, 421);
  const state = new URL(seen.url).searchParams.get('state');
  const failed = await fetch(`${base}/created?code=${CODE}&state=${state}`, { redirect: 'manual' });
  assert.equal(failed.status, 500);
  const e = await run;
  assert.match(e.message, /^GitHub answered 422 \(creating the App from the manifest\): rate limited \*\*\*$/);
  assert.equal(m.kept.size, 0);
  assert.equal(existsSync(configFile(m.ctx)), false);
  // Refused before anything starts: a bad organization, nothing to resume, a store that cannot be used.
  await assert.rejects(setupBot(m.ctx, { repo: REPO, org: '-x', say() {}, open() {} }), /--org/);
  await assert.rejects(setupBot(m.ctx, { repo: REPO, resume: true, say() {}, open() {} }), /nothing to resume/);
  m.ctx.credentials = { ...m.ctx.credentials, has: () => { throw new Error('no credential store is supported on plan9'); } };
  assert.match((await cli(m, ['bot', 'setup', '--repo', REPO, '--no-browser'])).text, /plan9/);
  assert.equal((await cli(m, ['bot', 'setup', '--repo', 'not a repo'])).code, 2);
});

test('bot setup: an installation not seen in time names --resume, which finishes it', async () => {
  const m = machine(github({ installed: false })), seen = {}, said = [];
  await assert.rejects(setupBot(m.ctx, { repo: REPO, host: 'box', say: (l) => said.push(l), open: browser(seen), installTimeout: 300, interval: 50 }), /not installed on octo\/proj yet: install it at https:\/\/github\.com\/apps\/benchkeeper-agent-box\/installations\/new, then run benchkeeper bot setup --resume/);
  assert.ok(m.gh.calls.filter((x) => x.path.endsWith('/installation')).length >= 2, 'it asked GitHub again');
  assert.ok(m.kept.has(KEY_ENTRY));
  assert.equal(readConfig(m.ctx).installation, undefined);
  const d = botChecks(m.ctx);
  assert.match(d[0].message, /did not finish/);
  // A second plain setup is refused; resume opens the install page and finishes once GitHub shows the installation.
  assert.match((await cli(m, ['bot', 'setup', '--repo', REPO])).text, /bot setup --resume/);
  m.gh.installed = true;
  const r = await cli(m, ['bot', 'setup', '--resume', '--no-browser']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /install the App benchkeeper-agent-box on octo\/proj: open https:\/\/github\.com\/apps\/benchkeeper-agent-box\/installations\/new/);
  assert.deepEqual(botChecks(m.ctx), []);
  // A create step nobody finishes times out with the way back.
  const idle = machine();
  await assert.rejects(setupBot(idle.ctx, { repo: REPO, host: 'box', say() {}, open: () => null, createTimeout: 100 }), /no App was created within/);
});

test('bot tokens: one repository and the fixed permissions, cached until 5 minutes before expiry', async () => {
  const m = ready(machine());
  const a = await mintToken(m.ctx, REPO);
  const call = m.gh.calls.find((x) => x.path.endsWith('/access_tokens'));
  assert.deepEqual(call.body, { repositories: ['proj'], permissions: PERMISSIONS });
  assert.equal(a.token, MINTED(1));
  assert.deepEqual(await mintToken(m.ctx, REPO), a, 'the cached token');
  assert.equal(m.gh.minted, 1);
  assert.equal((await mintToken(m.ctx, REPO, { now: Date.now() + 56 * 60e3 })).token, MINTED(2), 'refreshed 5 minutes before expiry');
  assert.equal((await mintToken(m.ctx, REPO, { fresh: true })).token, MINTED(3));
  // Another repository: not installed there, with the install link; a cache of a broken shape is minted over.
  await assert.rejects(mintToken(m.ctx, 'octo/other'), /not installed on octo\/other: https:\/\/github\.com\/apps\/benchkeeper-agent-box\/installations\/new/);
  await assert.rejects(mintToken(m.ctx, 'nope'), /owner\/name/);
  m.kept.set(TOKEN_ENTRY, 'not-base64-json');
  assert.equal((await mintToken(m.ctx, REPO)).token, MINTED(4));
  // GitHub down, or an answer without a token.
  m.gh.fail = () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  await assert.rejects(mintToken(m.ctx, REPO, { fresh: true }), /GitHub did not answer \(installation on octo\/proj\): ECONNREFUSED/);
  m.gh.fail = (u) => new Response(u.pathname.endsWith('/installation') ? JSON.stringify({ id: 777 }) : '{}', { status: 201 });
  await assert.rejects(mintToken(m.ctx, REPO, { fresh: true }), /GitHub sent no installation token/);
  m.gh.fail = () => new Response('{}', { status: 200 });
  await assert.rejects(mintToken(m.ctx, REPO, { fresh: true }), /GitHub sent no installation id/);
  m.gh.fail = () => new Response('not json', { status: 502 });
  await assert.rejects(mintToken(m.ctx, REPO, { fresh: true }), (e) => e.message === 'GitHub answered 502 (installation on octo/proj)');
  // Without a finished setup, or without the key, nothing is minted.
  m.kept.delete(KEY_ENTRY);
  m.gh.fail = null;
  await assert.rejects(mintToken(m.ctx, REPO, { fresh: true }), /private key is not in the credential store/);
  await assert.rejects(mintToken(machine().ctx, REPO), /no bot is set up/);
});

test('bot token and git-credential: only into a pipe, github.com only, the key and tokens never shown', async () => {
  const m = ready(machine());
  const tty = await cli(m, ['bot', 'token', '--repo', REPO], { tty: true });
  assert.deepEqual([tty.code, tty.text], [2, '']);
  assert.match(tty.err, /only into a pipe/);
  const piped = await cli(m, ['bot', 'token', '--repo', REPO]);
  assert.deepEqual([piped.code, piped.text], [0, `${MINTED(1)}\n`]);
  // In a bot session the session's repository; a folder without a GitHub origin is a usage error.
  m.ctx.env.BENCHKEEPER_BOT_REPO = REPO;
  assert.equal((await cli(m, ['bot', 'token'])).text, `${MINTED(1)}\n`);
  delete m.ctx.env.BENCHKEEPER_BOT_REPO;
  const none = await cli(m, ['bot', 'token', '--project', m.home]);
  assert.equal(none.code, 2);
  assert.match(none.err, /has no GitHub origin/);
  const get = await cli(m, ['bot', 'git-credential', 'get'], { lines: ['protocol=https', 'host=github.com', 'path=octo/proj.git', ''] });
  assert.equal(get.text, `username=x-access-token\npassword=${MINTED(1)}\n`);
  assert.equal((await cli(m, ['bot', 'git-credential', 'get'], { lines: ['protocol=https', 'host=gitlab.com'] })).text, '');
  for (const op of ['store', 'erase']) assert.deepEqual((await cli(m, ['bot', 'git-credential', op], { lines: ['password=x'] })).text, '');
  assert.equal((await cli(m, ['bot', 'git-credential'])).code, 2);
  assert.equal((await cli(m, ['bot', 'git-credential', 'get', 'extra'])).code, 2);
  assert.equal((await cli(m, ['bot', 'git-credential', 'get'], { tty: true })).code, 2);
  assert.equal((await cli(m, ['bot', 'nope'])).code, 2);
  // An error of GitHub that quotes a token is masked before it is shown.
  m.gh.fail = () => new Response(JSON.stringify({ message: `bad credentials for ${MINTED(9)}` }), { status: 401 });
  const leak = await cli(m, ['bot', 'status', '--check']);
  assert.equal(leak.code, 1);
  assert.ok(!leak.text.includes(MINTED(9)) && !leak.err.includes(MINTED(9)));
  assert.deepEqual(grep(m.home, SECRETS), []);
});

test('bot session env: author, committer, the credential helper alone and the gh wrapper, nothing written to git, gh or shell config', { skip: win && 'sh helpers' }, () => {
  const m = ready(machine());
  const fake = join(m.home, 'fake-node');
  // Stands in for node: git runs the helper as "<node> <entry> bot git-credential get"; this one answers as the bot would.
  writeFileSync(fake, '#!/bin/sh\nprintf "username=x-access-token\\npassword=bot-session-token\\n"\n');
  chmodSync(fake, 0o755);
  const ghDir = join(m.home, 'tools');
  mkdirSync(ghDir);
  writeFileSync(join(ghDir, 'gh'), '#!/bin/sh\n');
  chmodSync(join(ghDir, 'gh'), 0o755);
  const env = sessionEnv(m.ctx, { repo: REPO, role: 'worker', env: { PATH: `${ghDir}:/usr/bin:/bin` }, node: fake, host: 'Box.local' });
  assert.deepEqual([env.GIT_AUTHOR_NAME, env.GIT_COMMITTER_EMAIL, env.BENCHKEEPER_BOT_REPO, env.BENCHKEEPER_AGENT_HOST, env.BENCHKEEPER_AGENT_ROLE, env.BENCHKEEPER_BOT_GH], [`${SLUG}[bot]`, `99001+${SLUG}[bot]@users.noreply.github.com`, REPO, 'box', 'worker', join(ghDir, 'gh')]);
  assert.equal(env.GH_TOKEN, undefined);
  assert.ok(env.PATH.startsWith(`${wrapperDir(m.ctx)}:`));
  assert.equal(statSync(join(wrapperDir(m.ctx), 'gh')).mode & 0o777, 0o700);
  assert.equal(realGh(env.PATH, wrapperDir(m.ctx)), join(ghDir, 'gh'), 'the wrapper is never the real gh');
  assert.throws(() => sessionEnv(m.ctx, { repo: REPO, role: 'boss' }), /--role/);
  // Real git in a temporary home whose global config has a login helper of the user: the bot's helper alone answers.
  const home = mkdtempSync(join(tmpdir(), 'bk-bot-home-')), dir = join(home, 'repo');
  mkdirSync(dir);
  const global = join(home, '.gitconfig');
  writeFileSync(global, '[credential]\n\thelper = "!printf \'username=me\\\\npassword=user-login\\\\n\'"\n[credential "https://github.com"]\n\thelper = "!printf \'password=user-gh\\\\n\'"\n');
  const before = readFileSync(global, 'utf8');
  const gitEnv = { ...env, HOME: home, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  const g = (args, input) => spawnSync(GIT, ['-C', dir, ...args], { env: gitEnv, input, encoding: 'utf8' });
  g(['init', '-q']);
  const fill = g(['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
  assert.equal(fill.stdout, 'protocol=https\nhost=github.com\nusername=x-access-token\npassword=bot-session-token\n', fill.stderr);
  assert.match(g(['var', 'GIT_AUTHOR_IDENT']).stdout, /^benchkeeper-agent-box\[bot\] <99001\+benchkeeper-agent-box\[bot\]@users\.noreply\.github\.com>/);
  g(['remote', 'add', 'origin', `git@github.com:${REPO}.git`]);
  assert.equal(g(['remote', 'get-url', '--push', 'origin']).stdout.trim(), `https://github.com/${REPO}.git`, 'a push to the ssh address goes over https');
  assert.equal(g(['remote', 'get-url', 'origin']).stdout.trim(), `git@github.com:${REPO}.git`, 'fetches keep the address');
  // Nothing was written to the user's git config, a gh config, or a shell start file.
  assert.equal(readFileSync(global, 'utf8'), before);
  assert.deepEqual(readdirSync(home).sort(), ['.gitconfig', 'repo']);
  assert.deepEqual(readdirSync(join(m.ctx.config, 'bot', 'gh')), []);
  // The wrapper (written again for the real node) without a real gh, and without a bot set up: it stops before any gh runs.
  sessionEnv(m.ctx, { repo: REPO, role: 'worker', env: { PATH: '/usr/bin:/bin' } });
  const wrapper = join(wrapperDir(m.ctx), 'gh');
  const noGh = spawnSync(wrapper, ['pr', 'list'], { env: { PATH: '/usr/bin:/bin', BENCHKEEPER_BOT_GH: '' }, encoding: 'utf8' });
  assert.deepEqual([noGh.status, noGh.stderr], [127, 'gh is not installed (BenchKeeper bot session)\n']);
  const noBot = spawnSync(wrapper, ['pr', 'list'], { env: { PATH: '/usr/bin:/bin', BENCHKEEPER_BOT_GH: join(ghDir, 'gh'), BENCHKEEPER_HOME: mkdtempSync(join(tmpdir(), 'bk-bot-none-')), BENCHKEEPER_BOT_REPO: REPO }, encoding: 'utf8' });
  assert.equal(noBot.status, 2);
  assert.match(noBot.stderr, /no bot is set up on this machine/);
});

test('run --as-bot: the account\'s environment plus the bot\'s, Claude Code trailers, no GH_TOKEN; host accounts only', { skip: win && 'the fake agents are shell scripts' }, async () => {
  const am = accountsMachine({ flow: 'callback' });
  const m = ready({ ctx: { ...am.ctx, fetch: github().fetch }, kept: am.kept, home: am.home });
  const exec = (args) => cli(m, args);
  await exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  await exec(['accounts', 'login', 'work']);
  const dir = join(am.root, 'proj');
  mkdirSync(dir);
  initRepo(dir);
  execFileSync(GIT, ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${REPO}.git`]);
  const before = am.calls().length;
  const r = await exec(['run', '--account', 'work', '--project', dir, '--as-bot', '--', 'claude', '-p', 'hi']);
  assert.equal(r.code, 0, r.text);
  const launch = am.calls().slice(before).find((x) => x.args.includes('hi'));
  const settings = JSON.parse(launch.args[1]);
  assert.deepEqual([launch.args[0], launch.args.slice(2)], ['--settings', ['-p', 'hi']]);
  assert.match(settings.attribution.commit, /^Agent-Host: [a-z0-9-]+\nAgent-Role: orchestrator$/);
  assert.equal(launch.env.GIT_AUTHOR_EMAIL, `99001+${SLUG}[bot]@users.noreply.github.com`);
  assert.equal(launch.env.BENCHKEEPER_BOT_REPO, REPO);
  assert.equal(launch.env.CLAUDE_CONFIG_DIR, join(am.home, '.local/share/benchkeeper/accounts/work'));
  for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(launch.env[k], undefined, k);
  assert.ok(!JSON.stringify(launch).includes(PEM_LINE) && !JSON.stringify(launch).includes(CLAUDE_TOKEN));
  // Without --as-bot nothing of the bot; --role alone, a bad role and a folder without a GitHub origin are refused.
  const plain = am.calls().length;
  await exec(['run', '--account', 'work', '--project', dir, '--', 'claude', '-p', 'plain']);
  const p = am.calls().slice(plain).find((x) => x.args.includes('plain'));
  assert.deepEqual([p.args, p.env.GIT_AUTHOR_EMAIL, p.env.BENCHKEEPER_BOT_EMAIL], [['-p', 'plain'], undefined, undefined]);
  assert.equal((await exec(['run', '--role', 'worker', '--', 'claude'])).code, 2);
  assert.equal((await exec(['run', '--account', 'work', '--project', dir, '--as-bot', '--role', 'boss', '--', 'claude'])).code, 2);
  assert.match((await exec(['run', '--account', 'work', '--project', am.home, '--as-bot', '--', 'claude'])).text, /has no GitHub origin/);
  // A Codex account gets the variables without the Claude Code flag; a dev container account is refused.
  await exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  await exec(['accounts', 'login', 'dev']);
  const cx = am.calls().length;
  await exec(['run', '--account', 'dev', '--project', dir, '--as-bot', '--role', 'worker', '--', 'codex', 'go']);
  const c = am.calls().slice(cx).find((x) => x.args.includes('go'));
  assert.deepEqual([c.args, c.env.BENCHKEEPER_AGENT_ROLE], [['go'], 'worker']);
  await exec(['accounts', 'add', 'box', '--agent', 'claude', '--container', '--mount', '/home/node/.claude-box', '--yes']);
  assert.match((await exec(['run', '--account', 'box', '--project', dir, '--as-bot', '--', 'claude'])).text, /--as-bot needs a host account/);
});

test('guard hook in a bot session: denies another identity, lets a commit as the bot pass', () => {
  const email = `99001+${SLUG}[bot]@users.noreply.github.com`;
  const bot = { BENCHKEEPER_BOT_EMAIL: email, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email };
  const denied = ['git commit --author "Me <me@example.com>" -m x', 'git commit --author=me -m x', 'git -c user.email=me@example.com commit -m x', 'git -c credential.helper= push',
    'git --config-env=user.name=NAME commit -m x', 'git config user.email me@example.com', 'git config --global user.name Me', 'git config set user.email me@example.com', 'git config --unset user.email',
    'GIT_AUTHOR_EMAIL=me@example.com git commit -m x', 'env GIT_COMMITTER_NAME=me git commit -m x', 'export GIT_AUTHOR_EMAIL=me@example.com', 'unset GIT_CONFIG_COUNT', 'bash -c "git -c user.name=x commit"'];
  for (const c of denied) assert.ok(denyReason(c, 0, bot)?.bot, c);
  const fine = ['git commit -m "fix: x"', 'git push origin feat', 'git config user.email', 'git config get user.email', 'git config --get user.name', 'git config core.editor vim', 'git -c core.pager=cat log', 'export PATH=/x', 'git status'];
  for (const c of fine) assert.equal(denyReason(c, 0, bot), null, c);
  // The session's own author must be the bot for a commit or push to pass.
  assert.match(denyReason('git commit -m x', 0, { ...bot, GIT_AUTHOR_EMAIL: 'me@example.com' }).bot, /author or committer is not the bot/);
  // The rules without exceptions stay, and without a bot session none of the above is read.
  assert.equal(denyReason('git push -f', 0, bot), 'git push with -f');
  for (const c of denied.filter((x) => !x.includes('-c ') && !x.startsWith('bash'))) assert.equal(denyReason(c), null, c);
  const line = decide(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit --author=me -m x' } }), bot);
  assert.match(line, /^BenchKeeper guard: git commit --author is denied in a bot session, which commits and pushes as the bot \(99001\+benchkeeper-agent-box\[bot\]@users\.noreply\.github\.com\)/);
  // The script reads its environment: run as Claude Code runs it.
  const hook = spawnSync(process.execPath, [new URL('../src/guard-hook.mjs', import.meta.url).pathname], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git config user.name me' } }), encoding: 'utf8', env: { PATH: process.env.PATH, ...bot } });
  assert.deepEqual([hook.status, hook.stderr.split('\n').length], [2, 2]);
});

test('bot status, remove and doctor: nothing set up, a key that is gone, and a removal that names the App to delete', async () => {
  const m = machine();
  assert.match((await cli(m, ['bot', 'status'])).text, /no bot is set up/);
  assert.match((await cli(m, ['bot', 'remove'])).text, /no bot is set up/);
  assert.deepEqual(botChecks(m.ctx), []);
  ready(m);
  m.kept.set(TOKEN_ENTRY, 'cached');
  mkdirSync(join(m.ctx.config, 'bot', 'bin'), { recursive: true });
  const check = await cli(m, ['bot', 'status', '--check']);
  assert.match(check.text, /token: minted, expires \S+ \(not shown\)/);
  assert.ok(!check.text.includes(MINTED(1)));
  m.kept.delete(KEY_ENTRY);
  assert.match(botChecks(m.ctx)[0].message, /private key is not in the credential store/);
  assert.match((await cli(m, ['bot', 'status'])).text, /key: missing/);
  m.ctx.credentials = { ...m.ctx.credentials, has: () => { throw new Error('the keyring is locked'); } };
  assert.match(botChecks(m.ctx)[0].message, /credential store cannot be read: the keyring is locked/);
  m.ctx.credentials = { ...m.ctx.credentials, has: (n) => m.kept.has(n) };
  m.kept.set(KEY_ENTRY, encodeKey(PEM));
  assert.equal((await cli(m, ['bot', 'remove'], { lines: ['n'] })).code, 1);
  assert.equal((await cli(m, ['bot', 'remove'])).code, 2, 'no answer is no go-ahead');
  const r = await cli(m, ['bot', 'remove', '--yes']);
  assert.match(r.text, /deleted the private key, the cached token and bot\.json\ndelete the App on GitHub to revoke it for good: https:\/\/github\.com\/settings\/apps\/benchkeeper-agent-box\/advanced/);
  assert.equal(m.kept.size, 0);
  assert.deepEqual([existsSync(configFile(m.ctx)), existsSync(join(m.ctx.config, 'bot'))], [false, false]);
  // A file that is not a bot config: status and doctor say so, remove takes it out.
  writeFileSync(configFile(m.ctx), '{"version":1}');
  assert.equal((await cli(m, ['bot', 'status'])).code, 1);
  assert.match(botChecks(m.ctx)[0].message, /is not a bot config/);
  assert.match((await cli(m, ['bot', 'remove', '--yes'])).text, /^deleted the private key, the cached token and bot\.json\n$/);
  writeFileSync(configFile(m.ctx), 'not json');
  assert.throws(() => readConfig(m.ctx), /is not a bot config/);
});

test('bot shell: your shell with the bot variables and without a GitHub token, nothing written to start files', async () => {
  const m = ready(machine());
  let seen;
  m.ctx.run = (argv, o) => { seen = { argv, env: o.env, stdio: o.stdio }; return { code: 7 }; };
  Object.assign(m.ctx.env, { SHELL: '/bin/zsh', GH_TOKEN: 'dummy-user-gh', GITHUB_TOKEN: 'dummy-user-gh2', GIT_CONFIG_PARAMETERS: "'user.email=me'", KEEP: '1' });
  const r = await cli(m, ['bot', 'shell', '--repo', REPO, '--role', 'worker']);
  assert.equal(r.code, 7);
  assert.match(r.text, /bot shell: \/bin\/zsh as benchkeeper-agent-box\[bot\] for octo\/proj/);
  assert.deepEqual([seen.argv, seen.stdio, seen.env.KEEP, seen.env.GH_TOKEN, seen.env.GITHUB_TOKEN, seen.env.GIT_CONFIG_PARAMETERS, seen.env.BENCHKEEPER_AGENT_ROLE], [['/bin/zsh'], 'inherit', '1', undefined, undefined, undefined, 'worker']);
  assert.deepEqual(readdirSync(m.home).filter((f) => f.startsWith('.') && f !== '.config'), []);
  assert.equal((await cli(m, ['bot', 'shell', '--repo', REPO, '--role', 'boss'])).code, 2);
  assert.equal((await cli(m, ['bot', 'status', 'extra'])).code, 2);
});
