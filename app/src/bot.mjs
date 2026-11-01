// The GitHub App bot of agent sessions (#817): one App per machine, registered from a manifest in the browser, whose private
// key lives only in the OS credential store. A bot session (run --as-bot, bot shell; opt-in only) commits as the App's bot user
// and reaches GitHub with an installation token limited to one repository, the permissions below and at most 1 hour, minted on
// demand by a git credential helper and a gh wrapper. Sessions that are not bot sessions get no GitHub token, as before.
// Minting and session wiring only: no push, pull request or other GitHub logic lives here.
import { createPrivateKey, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { accessSync, constants, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './accounts.mjs';
import { TOKEN } from './credstore.mjs';
import { readText, writeAtomic } from './fsx.mjs';
import { git } from './git.mjs';
import { mask } from './redact.mjs';

// A dot is not allowed in an account name, so these entries never meet an account's token.
export const KEY_ENTRY = 'app.bot.key';
export const TOKEN_ENTRY = 'app.bot.token';
export const DEFAULT_PREFIX = 'benchkeeper-agent';
// What a bot session may do, and the ceiling the App is registered with. No administration (settings, rulesets) and no
// workflows: a change under .github/workflows stays with the user.
export const PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', checks: 'read', statuses: 'read', actions: 'read', metadata: 'read' };
const API = 'https://api.github.com';
// GitHub refuses an App name over 34 characters (registering a GitHub App, step "GitHub App name").
const NAME_MAX = 34;
const PREFIX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[\w.-]{1,100}$/;
const ORG = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
// An installation token is one run of printable characters; GitHub's newer stateless format is longer than 40 (ghs_<app id>_<JWT>).
const MINTED = /^[!-~]{20,4096}$/;
// A cached token is refreshed this long before it expires, so a push that starts with it still finishes in time.
const MARGIN = 5 * 60e3;
// The app's own entry: the gh wrapper and the credential helper call it, so they run this version of the code.
const ENTRY = fileURLToPath(new URL('../bin/benchkeeper.mjs', import.meta.url));

class BotError extends Error {
  // A usage error carries 400, which the CLI's lookups read as exit 2.
  constructor(message, { usage = false } = {}) { super(message); this.usage = usage; if (usage) this.status = 400; }
}
const usage = (m) => new BotError(m, { usage: true });

// ---- config: bot.json in the config folder, never a secret

export const configFile = (ctx) => join(ctx.config, 'bot.json');
const positive = (n) => Number.isSafeInteger(n) && n > 0;
// Checked on every read: other processes of the user can write the file.
function valid(c) {
  return !!c && c.version === 1 && PREFIX.test(c.prefix ?? '') && typeof c.host === 'string' && REPO.test(c.repo ?? '') && positive(c.appId) && SLUG.test(c.slug ?? '')
    && typeof c.clientId === 'string' && typeof c.owner === 'string' && (c.org == null || ORG.test(c.org))
    && (c.installation == null || (positive(c.installation.id) && typeof c.installation.account === 'string'))
    && (c.user == null || (positive(c.user.id) && c.user.login === `${c.slug}[bot]`));
}
// The config, null when there is none; a file that is not one throws.
export function readConfig(ctx) {
  const text = readText(configFile(ctx));
  if (text == null) return null;
  let c;
  try { c = JSON.parse(text); } catch { c = null; }
  if (!valid(c)) throw new BotError(`${configFile(ctx)} is not a bot config: benchkeeper bot remove, then bot setup`);
  return c;
}
const writeConfig = (ctx, c) => writeAtomic(configFile(ctx), `${JSON.stringify(c, null, 2)}\n`, 0o600);
// A config that setup finished: installed and with its bot user.
function ready(ctx) {
  const c = readConfig(ctx);
  if (!c) throw usage('no bot is set up on this machine: benchkeeper bot setup');
  if (!c.installation || !c.user) throw usage('the bot setup did not finish: benchkeeper bot setup --resume');
  return c;
}

// The name and noreply address GitHub shows as the bot, the form of dependabot[bot] and github-actions[bot] commits.
export const identity = (c) => ({ name: c.user.login, email: `${c.user.id}+${c.user.login}@users.noreply.github.com` });

// The first label of the host name in lowercase letters, digits and dashes.
export const hostSlug = (h) => String(h).split('.')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'host';
// <prefix>-<host slug>, cut to GitHub's limit; the prefix leaves at least 8 characters for the host.
export function appName(prefix, host) {
  if (!PREFIX.test(prefix) || prefix.length > NAME_MAX - 9) throw usage(`--prefix is lowercase letters, digits and single dashes, at most ${NAME_MAX - 9} characters`);
  return `${prefix}-${hostSlug(host).slice(0, NAME_MAX - prefix.length - 1).replace(/-+$/, '')}`;
}

// owner/name of a GitHub remote URL (https, scp-like ssh, ssh://), else null.
export function repoOf(url) {
  const m = String(url ?? '').trim().match(/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com(?::22)?\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return m && REPO.test(m[1]) ? m[1] : null;
}
// --repo, else the origin of the folder.
export function pickRepo(ctx, { repo, dir }) {
  if (repo !== undefined) {
    if (!REPO.test(repo)) throw usage('--repo is owner/name of a GitHub repository');
    return repo;
  }
  const r = git(ctx, dir, ['remote', 'get-url', 'origin'], { env: ctx.env ?? process.env, timeout: 10e3 });
  const found = r.code === 0 ? repoOf(r.stdout) : null;
  if (!found) throw usage(`${dir} has no GitHub origin: name the repository with --repo owner/name`);
  return found;
}

// ---- the private key: PKCS#8 DER in base64, the shape the credential store takes (a PEM has spaces and line breaks)

export function encodeKey(pem) {
  let der;
  try { der = createPrivateKey(pem).export({ type: 'pkcs8', format: 'der' }).toString('base64'); } catch { throw new BotError('GitHub sent no private key that can be read: nothing was stored'); }
  // shortcut: a key of more than about 4096 bits does not fit the store's shape; GitHub creates 2048-bit keys.
  if (!TOKEN.test(der)) throw new BotError('the private key is too large for the credential store: nothing was stored');
  return der;
}
const decodeKey = (b64) => createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs8' });
function loadKey(ctx) {
  const v = store(ctx).get(KEY_ENTRY);
  if (!v) throw new BotError('the bot\'s private key is not in the credential store: benchkeeper bot remove, then bot setup');
  return decodeKey(v);
}

// ---- GitHub: a JWT for the App, REST calls

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// RS256, issued 60 seconds in the past against clock drift, valid 9 minutes (GitHub takes at most 10). iss: the client ID, which GitHub recommends.
export function appJwt(iss, key, now = Date.now()) {
  const t = Math.floor(now / 1000);
  const body = `${b64u({ alg: 'RS256', typ: 'JWT' })}.${b64u({ iat: t - 60, exp: t + 540, iss: String(iss) })}`;
  return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
}

// One request; what names the call in an error, never the path (the manifest code is in one) or a credential.
async function call(ctx, method, path, { what, auth, body, missing } = {}) {
  let r;
  try {
    r = await (ctx.fetch ?? fetch)(`${API}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(30e3),
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'benchkeeper', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) { throw new BotError(`GitHub did not answer (${what}): ${e.cause?.code ?? e.name}`); }
  if (r.status === 404 && missing) { await r.body?.cancel(); return missing; }
  let json = null;
  try { json = await r.json(); } catch { /* no JSON: the status alone */ }
  if (!r.ok) throw new BotError(`GitHub answered ${r.status} (${what})${typeof json?.message === 'string' ? `: ${mask(json.message).slice(0, 200)}` : ''}`);
  return json;
}

const jwtFor = (ctx, c, now) => appJwt(c.clientId || c.appId, loadKey(ctx), now);
// { id, account } of the App's installation that covers repo, or null while there is none.
async function installationOf(ctx, c, repo, now = Date.now()) {
  const j = await call(ctx, 'GET', `/repos/${repo}/installation`, { what: `installation on ${repo}`, auth: jwtFor(ctx, c, now), missing: 'none' });
  if (j === 'none') return null;
  if (!positive(j?.id)) throw new BotError(`GitHub sent no installation id for ${repo}`);
  return { id: j.id, account: String(j.account?.login ?? repo.split('/')[0]) };
}
const installUrl = (c) => `https://github.com/apps/${c.slug}/installations/new`;

// ---- tokens

// The cache: one entry in the credential store, next to the key. Each git push and gh call is a process of its own, so a
// cache in memory would never be hit; a file would be a plaintext copy. The entry holds one repository's token until 5
// minutes before it expires.
function cached(ctx, repo, now) {
  try {
    const v = store(ctx).get(TOKEN_ENTRY);
    const c = v ? JSON.parse(Buffer.from(v, 'base64url').toString()) : null;
    return c?.repo === repo && MINTED.test(c.token ?? '') && Date.parse(c.expires) - MARGIN > now ? { token: c.token, expires: c.expires } : null;
  } catch { return null; }
}
function keep(ctx, repo, t) {
  const v = Buffer.from(JSON.stringify({ repo, ...t })).toString('base64url');
  // A token too long for the store is minted again next time.
  try { if (TOKEN.test(v)) store(ctx).set(TOKEN_ENTRY, v); } catch { /* no cache, no harm */ }
}

// { token, expires } for repo: from the cache, else a new installation token for that repository alone with PERMISSIONS.
export async function mintToken(ctx, repo, { now = Date.now(), fresh = false } = {}) {
  const c = ready(ctx);
  if (!REPO.test(repo)) throw usage('the repository is owner/name');
  const hit = !fresh && cached(ctx, repo, now);
  if (hit) return hit;
  const inst = await installationOf(ctx, c, repo, now);
  if (!inst) throw new BotError(`the App ${c.slug} is not installed on ${repo}: ${installUrl(c)}`);
  const j = await call(ctx, 'POST', `/app/installations/${inst.id}/access_tokens`, { what: `token for ${repo}`, auth: jwtFor(ctx, c, now), body: { repositories: [repo.split('/')[1]], permissions: PERMISSIONS } });
  if (!MINTED.test(j?.token ?? '') || Number.isNaN(Date.parse(j?.expires_at))) throw new BotError('GitHub sent no installation token');
  const t = { token: j.token, expires: j.expires_at };
  keep(ctx, repo, t);
  return t;
}

// The git credential helper's answer to `get` (git-credential(1), "input/output format"): the token for https://github.com
// only, as the user x-access-token; anything else is left to git (an empty answer).
export async function credentialAnswer(ctx, input, { repo, dir, now } = {}) {
  const attrs = Object.fromEntries(String(input).split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  if (attrs.protocol !== 'https' || attrs.host !== 'github.com') return '';
  const target = repo || repoOf(`https://github.com/${attrs.path ?? ''}`) || pickRepo(ctx, { dir });
  const { token } = await mintToken(ctx, target, { now });
  return `username=x-access-token\npassword=${token}\n`;
}

// ---- bot sessions

export const wrapperDir = (ctx) => join(ctx.config, 'bot', 'bin');
const ghConfigDir = (ctx) => join(ctx.config, 'bot', 'gh');
// The gh wrapper: a fresh token in GH_TOKEN for this one gh call, then the real gh, found when the session started. A node
// script, not a shell one: the app writes no shell code.
const ghWrapper = (node) => `${/\s/.test(node) ? '#!/usr/bin/env node' : `#!${node}`}
// Written by BenchKeeper for its bot sessions (benchkeeper bot): runs the real gh with a fresh installation token of the bot
// in GH_TOKEN for this one call. The token lives at most 1 hour and reaches only the session's repository.
import { spawnSync } from 'node:child_process';
const real = process.env.BENCHKEEPER_BOT_GH;
if (!real) { process.stderr.write('gh is not installed (BenchKeeper bot session)\\n'); process.exit(127); }
const t = spawnSync(process.execPath, [${JSON.stringify(ENTRY)}, 'bot', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
if (t.status !== 0 || !t.stdout.trim()) process.exit(t.status || 1);
const r = spawnSync(real, process.argv.slice(2), { stdio: 'inherit', env: { ...process.env, GH_TOKEN: t.stdout.trim() } });
if (r.signal) process.kill(process.pid, r.signal);
process.exit(r.status ?? 1);
`;
const executable = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };
// The real gh on the PATH, the wrapper's folder left out; null when there is none.
export const realGh = (path, skip) => String(path ?? '').split(delimiter).filter((d) => d && d !== skip).map((d) => join(d, 'gh')).find(executable) ?? null;
// One quoted word for the shell git runs a helper with.
const sq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;

// The variables of a bot session, on top of the session's own environment (env: its PATH is extended).
// - author and committer: the bot user, so no git config is written;
// - the credential helper for https://github.com through GIT_CONFIG_COUNT pairs (git-config(1), ENVIRONMENT): an empty value
//   first resets the helpers of every other config file, so the user's login is never offered; pushes to an ssh address of
//   github.com go over https (pushInsteadOf), where that helper answers;
// - the gh wrapper first on the PATH, and an empty gh config folder, so the real gh started by its path has no login either;
// - the trailers' values and the bot's address, which the guard hook reads.
export function sessionEnv(ctx, { repo, role, env = process.env, node = process.execPath, host = hostname() }) {
  const c = ready(ctx), id = identity(c), bin = wrapperDir(ctx);
  if (!['orchestrator', 'worker'].includes(role)) throw usage('--role is orchestrator or worker');
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  mkdirSync(ghConfigDir(ctx), { recursive: true, mode: 0o700 });
  const text = ghWrapper(node), file = join(bin, 'gh');
  if (readText(file) !== text) writeAtomic(file, text, 0o700);
  const pairs = [['credential.https://github.com.helper', ''], ['credential.https://github.com.helper', `!${sq(node)} ${sq(ENTRY)} bot git-credential`],
    ['url.https://github.com/.pushInsteadOf', 'git@github.com:'], ['url.https://github.com/.pushInsteadOf', 'ssh://git@github.com/']];
  return {
    GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email,
    GIT_CONFIG_COUNT: String(pairs.length), ...Object.fromEntries(pairs.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])),
    PATH: [bin, env.PATH].filter(Boolean).join(delimiter), GH_CONFIG_DIR: ghConfigDir(ctx), BENCHKEEPER_BOT_GH: realGh(env.PATH, bin) ?? '',
    BENCHKEEPER_BOT_EMAIL: id.email, BENCHKEEPER_BOT_REPO: repo, BENCHKEEPER_AGENT_HOST: hostSlug(host), BENCHKEEPER_AGENT_ROLE: role,
  };
}

// The trailers of a Claude Code commit, through its commit attribution setting for this one launch (--settings takes inline
// JSON and overrides the same keys of the settings files for the session): no hook in the repository, no settings file.
export const trailerArgs = (env) => ['--settings', JSON.stringify({ attribution: { commit: `Agent-Host: ${env.BENCHKEEPER_AGENT_HOST}\nAgent-Role: ${env.BENCHKEEPER_AGENT_ROLE}` } })];

// The environment of `bot shell`: the user's own, without a GitHub token or -c settings of an outer git, plus the session's.
export function shellEnv(ctx, o) {
  const env = o.env ?? process.env;
  const own = Object.fromEntries(Object.entries(env).filter(([k]) => !/^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GIT_ASKPASS|SSH_ASKPASS|GIT_CONFIG_\w+)$/i.test(k)));
  return { ...own, ...sessionEnv(ctx, { ...o, env }) };
}

// ---- setup: the manifest flow (registering a GitHub App from a manifest), then the installation

export const manifest = ({ name, repo, base }) => ({
  name, url: `https://github.com/${repo}`, description: 'Commits, pushes and pull requests of BenchKeeper agent sessions on one machine.',
  redirect_url: `${base}/created`, setup_url: `${base}/installed`, public: false, default_events: [], default_permissions: PERMISSIONS,
  request_oauth_on_install: false, setup_on_update: false,
});
const html = (s) => String(s).replace(/[&"'<>]/g, (ch) => `&#${ch.charCodeAt(0)};`);
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${html(title)}</title><body style="font-family:sans-serif;max-width:40em;margin:3em auto">${body}</body>\n`;
// The local page the browser opens: it posts the manifest to GitHub's new-App form at once.
const startPage = ({ action, json, name }) => page('BenchKeeper bot setup', `<p>Creating the GitHub App <b>${html(name)}</b> for this machine. Sign in to GitHub if it asks, then confirm with Create GitHub App.</p>`
  + `<form id="f" method="post" action="${html(action)}"><input type="hidden" name="manifest" value="${html(json)}"><button>Continue to GitHub</button></form><script>document.getElementById('f').submit()</script>`);

const waiter = () => { let ok, fail; const p = new Promise((a, b) => { ok = a; fail = b; }); return { p, ok, fail }; };
const within = (p, ms, why) => { let t; return Promise.race([p, new Promise((_, fail) => { t = setTimeout(() => fail(new BotError(why)), ms); })]).finally(() => clearTimeout(t)); };
const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// The App from the manifest code: the key goes to the credential store at once, the config gets ids and names only. The
// client secret and the webhook secret of the answer are dropped here: never stored, never shown.
async function convert(ctx, code, fields) {
  if (!/^[\w-]{1,200}$/.test(code ?? '')) throw new BotError('GitHub sent no valid code');
  const app = await call(ctx, 'POST', `/app-manifests/${code}/conversions`, { what: 'creating the App from the manifest' });
  if (!positive(app?.id) || !SLUG.test(app?.slug ?? '') || typeof app?.client_id !== 'string') throw new BotError('GitHub sent no App id, slug or client id');
  store(ctx).set(KEY_ENTRY, encodeKey(app.pem));
  const c = { version: 1, ...fields, appId: app.id, slug: app.slug, name: String(app.name ?? app.slug), clientId: app.client_id, owner: String(app.owner?.login ?? ''), created: new Date().toISOString() };
  writeConfig(ctx, c);
  return c;
}

// The setup. o: { repo, prefix, org, resume, host, open (url -> truthy when a browser was started), say (line),
// createTimeout, installTimeout, interval }. Returns the summary: no secret in it.
export async function setupBot(ctx, o) {
  const { repo, prefix = DEFAULT_PREFIX, org, resume = false, host = hostname(), open, say, createTimeout = 15 * 60e3, installTimeout = 10 * 60e3, interval = 5e3 } = o;
  if (org !== undefined && !ORG.test(org)) throw usage('--org is the name of a GitHub organization');
  const name = appName(prefix, host);
  // A store that cannot be used refuses before anything is created.
  const s = store(ctx), hasKey = s.has(KEY_ENTRY);
  let c = readConfig(ctx);
  if (resume && !(c && hasKey)) throw usage('nothing to resume: benchkeeper bot setup');
  if (!resume && (c || hasKey)) throw usage(c?.user && c.installation ? `the bot ${c.slug} is set up already (bot status); bot remove first` : 'a bot setup started already: benchkeeper bot setup --resume, or bot remove first');
  const state = randomBytes(16).toString('hex');
  const created = waiter();
  let nudge = waiter(), used = false;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x'), send = (code, body, head = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close', ...head }); res.end(body); };
    // Only this address: a page of another site cannot reach the server under a name of its own (DNS rebinding).
    if (`http://${req.headers.host}` !== base) return send(421, page('Wrong host', '<p>Wrong host.</p>'));
    if (url.pathname === '/start' && same(url.searchParams.get('state'), state)) {
      const action = `https://github.com/${org ? `organizations/${org}/` : ''}settings/apps/new?state=${state}`;
      return send(200, startPage({ action, json: JSON.stringify(manifest({ name, repo, base })), name }));
    }
    if (url.pathname === '/created' && !resume) {
      if (!same(url.searchParams.get('state'), state)) return send(400, page('Not this setup', '<p>This answer does not belong to the running setup.</p>'));
      if (used) return send(410, page('Done', '<p>The App was created already.</p>'));
      used = true;
      return convert(ctx, url.searchParams.get('code'), { prefix, host, repo, ...(org ? { org } : {}) }).then((app) => {
        send(302, '', { location: `${installUrl(app)}?state=${state}` });
        created.ok(app);
      }, (e) => { send(500, page('Setup failed', `<p>${html(e.message)}</p><p>The terminal says how to go on.</p>`)); created.fail(e); });
    }
    // The installation id of this redirect can be spoofed (GitHub, "About the setup URL"): it only starts the check, which asks GitHub.
    if (url.pathname === '/installed') { nudge.ok(); nudge = waiter(); return send(200, page('Installed', '<p>Installed. You can close this tab: the terminal finishes the setup.</p>')); }
    return send(404, page('Not found', '<p>Not found.</p>'));
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const show = (what, url) => say(open(url) ? `${what}: opened in the browser (else open ${url})` : `${what}: open ${url}`);
  try {
    if (!resume) {
      show(`create the GitHub App ${name}`, `${base}/start?state=${state}`);
      c = await within(created.p, createTimeout, `no App was created within ${createTimeout / 60e3} minutes: run benchkeeper bot setup again`);
      say(`created the App ${c.slug} (id ${c.appId}); its key is in the credential store (${s.name})`);
    } else show(`install the App ${c.slug} on ${c.repo}`, installUrl(c));
    say(`install it on ${c.repo} in the browser (Only select repositories, then ${c.repo}); waiting`);
    const end = Date.now() + installTimeout;
    let inst;
    while (!(inst = await installationOf(ctx, c, c.repo))) {
      if (Date.now() >= end) throw new BotError(`the App ${c.slug} is not installed on ${c.repo} yet: install it at ${installUrl(c)}, then run benchkeeper bot setup --resume`);
      await within(nudge.p, interval, 'poll').catch(() => {});
    }
    const u = await call(ctx, 'GET', `/users/${encodeURIComponent(`${c.slug}[bot]`)}`, { what: 'the bot user' });
    if (!positive(u?.id) || u.login !== `${c.slug}[bot]`) throw new BotError(`GitHub sent no bot user ${c.slug}[bot]`);
    c = { ...c, installation: inst, user: { id: u.id, login: u.login } };
    writeConfig(ctx, c);
    const t = await mintToken(ctx, c.repo, { fresh: true });
    return { app: c.name, slug: c.slug, appId: c.appId, owner: c.owner, repo: c.repo, installation: inst.id, ...identity(c), store: s.name, expires: t.expires };
  } finally {
    // An answer still being written (the redirect to the install page) finishes; idle connections go now.
    server.closeIdleConnections();
    server.close();
  }
}

// ---- status and remove

// { config, key, store, note }: the config as kept (ids and names only), whether the key is in the store. Without a config the
// store is not asked, unless probe (remove looks for a key that a setup left without one).
export function botStatus(ctx, { probe = false } = {}) {
  const config = readConfig(ctx);
  if (!config && !probe) return { config, key: false, store: null, note: null };
  try {
    const s = store(ctx);
    return { config, key: s.has(KEY_ENTRY), store: s.name, note: null };
  } catch (e) { return { config, key: false, store: null, note: e.message }; }
}

// Where the App is deleted on GitHub: the owner's App settings, Advanced.
export const deleteUrl = (c) => `https://github.com/${c.org ? `organizations/${c.org}/` : ''}settings/apps/${c.slug}/advanced`;

// Deletes the key, the cached token, the config and the wrappers. The App stays on GitHub: the caller prints deleteUrl.
export function removeBot(ctx) {
  let c = null;
  try { c = readConfig(ctx); } catch { /* a broken file goes too */ }
  const s = store(ctx);
  for (const e of [KEY_ENTRY, TOKEN_ENTRY]) if (s.has(e)) s.delete(e);
  rmSync(configFile(ctx), { force: true });
  rmSync(join(ctx.config, 'bot'), { recursive: true, force: true });
  return c;
}

// Doctor findings: nothing without a bot; a config that does not read, or a key that is gone, is a warning.
export function botChecks(ctx) {
  const issue = (message, fix) => ({ level: 'warning', check: 'bot', message, fix });
  let st;
  try { st = botStatus(ctx); } catch (e) { return [issue(e.message, 'benchkeeper bot remove, then bot setup')]; }
  if (!st.config) return [];
  if (st.note) return [issue(`the bot ${st.config.slug} is set up, but the credential store cannot be read: ${st.note}`, 'fix the credential store, or benchkeeper bot remove')];
  if (!st.key) return [issue(`the bot ${st.config.slug} is set up, but its private key is not in the credential store`, `benchkeeper bot remove, delete the App (${deleteUrl(st.config)}), then bot setup`)];
  if (!st.config.installation || !st.config.user) return [issue(`the bot setup of ${st.config.slug} did not finish`, 'benchkeeper bot setup --resume')];
  return [];
}
