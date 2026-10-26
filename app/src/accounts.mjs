// Several logins per agent (Claude Code, Codex): a registry of accounts, a guided sign-in, a preflight and a launcher.
// An account is a folder of its own (CLAUDE_CONFIG_DIR, CODEX_HOME) on the host, or a named volume in a dev container.
// The registry holds names, folders and dates, never a credential. A token (opt-in, for unattended containers) lives in the
// OS credential store, goes to one launch only and never into a file, the ledger, a log or devcontainer.json.
// Switching accounts is the user's choice at a launch; nothing here picks or rotates one.
import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { openPrivate, signInUrl } from './browser.mjs';
import { childEnv } from './childenv.mjs';
import { StoreError, credentialStore } from './credstore.mjs';
import { exists, inside, readText } from './fsx.mjs';
import { mask } from './redact.mjs';
import { apply, preview, runCommandAsync } from './runner.mjs';

export const AGENTS = ['claude', 'codex'];
const VAR = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
// A setup-token lasts a year: a warning from the 11th month on, an error once it has run out.
const WARN_DAYS = 335, EXPIRED_DAYS = 365;
const MOUNT = /^\/[\w./-]{1,200}$/;
const DAY = 864e5;

const tail = (r, secret) => hide((r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' '), secret) || `exit ${r.code}`;
// Text from a child that is shown or kept: control characters out, token shapes and the known token masked.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
const clean = (t) => String(t).replace(ANSI, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
// shortcut: a token of an unknown shape that sits in a run shorter than 32 characters is not recognised; a longer run is hidden.
export const hide = (text, secret) => mask(clean(text), { keys: true }).replace(/[A-Za-z0-9_-]{32,}/g, '***').split(secret || '\0').join('***');

// ---- registry: accounts.json in the config folder

export const registryFile = (ctx) => join(ctx.config, 'accounts.json');
const where = (ctx) => (ctx.env ?? process.env);
const home = (ctx) => ctx.home ?? homedir();

// Entries are checked on every read: the file is one other processes can write.
function parse(text) {
  if (text == null) return [];
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('the accounts file is not valid JSON'); }
  if (!Array.isArray(doc?.accounts)) throw new Error('the accounts file has no accounts list');
  for (const a of doc.accounts) {
    const ok = a && NAME.test(a.name) && AGENTS.includes(a.agent) && (a.mode === 'host' ? typeof a.dir === 'string' && isAbsolute(a.dir) : a.mode === 'container' && typeof a.volume === 'string' && MOUNT.test(a.mount ?? ''));
    if (!ok) throw new Error('the accounts file has an entry that is not an account');
  }
  return doc.accounts;
}
export const listAccounts = (ctx) => parse(readText(registryFile(ctx)));
// The message of a registry that cannot be read, else null.
export function accountsProblem(ctx) {
  try { listAccounts(ctx); return null; } catch (e) { return e.message; }
}
export function findAccount(ctx, name) {
  const a = listAccounts(ctx).find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}: benchkeeper accounts list`);
  return a;
}
// The account a launch uses: the named one, else the agent's default.
export function pickAccount(ctx, { name, agent }) {
  if (name) return findAccount(ctx, name);
  const a = listAccounts(ctx).find((x) => x.agent === agent && x.default);
  if (!a) throw new Error(`no default ${agent} account: benchkeeper accounts add, or --account <name>`);
  return a;
}

// The registry as a change of the usual kind: a diff in the plan, a ledger entry, undo. f maps the list to the new list
// and throws on a refusal, which the preview shows as the change's error. The registry holds no credential.
export function registryChange(title, ctx, f) {
  return { id: 'accounts', step: 'accounts', title, kind: 'write', path: registryFile(ctx), edit: (text) => `${JSON.stringify({ schemaVersion: 1, accounts: f(parse(text)) }, null, 2)}\n` };
}
export const commit = (ctx, change, select) => apply(preview([change]), ctx, { scope: 'global', select });

// The entry `accounts add` plans; opts: { name, agent, container, label, dir, mount (container accounts) }.
export function newAccount(ctx, o) {
  if (!NAME.test(o.name ?? '')) throw new Error('the name is 1 to 32 characters: lower case letters, digits, - and _, starting with a letter or digit');
  if (!AGENTS.includes(o.agent)) throw new Error(`the agent is one of ${AGENTS.join(', ')}`);
  const base = { name: o.name, agent: o.agent, ...(o.label ? { label: String(o.label).slice(0, 80) } : {}), token: null, added: new Date().toISOString() };
  if (o.container) {
    // No default: the folder must be one the container's user can write, which depends on the image.
    const mount = o.mount;
    if (!MOUNT.test(mount ?? '') || mount.split('/').includes('..')) throw new Error('--mount is the absolute path inside the container where the volume is mounted: a folder its user can write, below its home folder');
    return { ...base, mode: 'container', volume: `benchkeeper-${o.agent}-${o.name}`, mount };
  }
  // Outside the config folder: the agent's own login file sits there, and the config folder is what the ledger and backups hold.
  const dir = resolve(o.dir ?? join(home(ctx), '.local/share/benchkeeper/accounts', o.name));
  if (inside(dir, [ctx.config])) throw new Error('the account folder must lie outside the BenchKeeper config folder');
  return { ...base, mode: 'host', dir };
}
export const addChange = (ctx, entry) => registryChange(`add ${entry.agent} account ${entry.name} (${entry.mode === 'host' ? 'host' : 'dev container'})`, ctx, (list) => {
  if (list.some((a) => a.name === entry.name)) throw new Error(`account ${entry.name} exists`);
  return [...list, { ...entry, ...(list.some((a) => a.agent === entry.agent && a.default) ? {} : { default: true }) }];
});
export const useChange = (ctx, name) => registryChange(`use ${name} as the default ${findAccount(ctx, name).agent} account`, ctx, (list) => {
  const a = list.find((x) => x.name === name);
  if (!a) throw new Error(`no account ${name}`);
  return list.map((x) => (x.agent !== a.agent ? x : x.name === name ? { ...x, default: true } : (({ default: _, ...rest }) => rest)(x)));
});
// Only the registry entry: the account's folder and its login stay where they are (they hold credentials, so no ledger backup takes them).
export const removeChange = (ctx, name, hasToken = false) => registryChange(`remove account ${name} from the registry${hasToken ? ' and delete its stored token (undo restores the entry, not the token)' : ''}`, ctx, (list) => {
  if (!list.some((x) => x.name === name)) throw new Error(`no account ${name}`);
  return list.filter((x) => x.name !== name);
});
export const tokenChange = (ctx, name, created) => registryChange(`${created ? 'record' : 'clear'} the token of account ${name}`, ctx, (list) => {
  if (!list.some((x) => x.name === name)) throw new Error(`no account ${name}`);
  return list.map((x) => (x.name === name ? { ...x, token: created ? { created } : null } : x));
});

export const store = (ctx) => ctx.credentials ?? credentialStore(ctx.run, { env: where(ctx) });

// ---- environment and launch

// The environment of a command that runs as an account: the filtered environment of childEnv and, on the host, the one variable
// that names the account's folder. An inherited folder variable is dropped first, and so is any credential name (childEnv).
// token (Claude Code, host, explicit launch only) adds the token variable in its place.
export function accountEnv(ctx, a, { token } = {}) {
  const env = Object.fromEntries(Object.entries(where(ctx)).filter(([k]) => !Object.values(VAR).includes(k.toUpperCase())));
  return childEnv({ ...(a.mode === 'host' ? { [VAR[a.agent]]: a.dir } : {}), ...(token && a.mode === 'host' ? { [TOKEN_VAR]: token } : {}) }, env);
}

// The host-side environment of a container command: no account folder variable, no credential.
const baseEnv = (ctx) => accountEnv(ctx, { mode: 'container' });
export const engineOf = (ctx) => ['podman', 'docker'].find((e) => ctx.run([e, '--version'], { env: where(ctx) }).code === 0);
const mounts = (ctx) => listAccounts(ctx).filter((a) => a.mode === 'container').flatMap((a) => ['--mount', `type=volume,source=${a.volume},target=${a.mount}`]);
// devcontainer exec runs cmd in the project's container; the account's folder variable (and the token, on request) are
// --remote-env values. shortcut: a value on a command line is visible to this user's other processes while it runs.
const execArgv = (engine, dir, a, cmd, { token } = {}) => ['devcontainer', 'exec', '--docker-path', engine, '--workspace-folder', dir, '--remote-env', `${VAR[a.agent]}=${a.mount}`,
  ...(token && a.agent === 'claude' ? ['--remote-env', `${TOKEN_VAR}=${token}`] : []), ...cmd];
const hasDevcontainer = (dir) => exists(join(dir, '.devcontainer')) || exists(join(dir, '.devcontainer.json'));

// Starts the project's container with every container account's volume (a mount applies when the container is created) and
// checks that this account's volume is mounted and writable in it. Returns the engine; throws with the command that fixes it.
export function ensureContainer(ctx, a, dir) {
  if (!hasDevcontainer(dir)) throw new Error(`${dir} has no dev container configuration (.devcontainer/)`);
  const engine = engineOf(ctx);
  if (!engine) throw new Error('no container engine (podman or docker)');
  const env = baseEnv(ctx);
  const up = ['devcontainer', 'up', '--docker-path', engine, '--workspace-folder', dir, ...mounts(ctx)];
  const r = ctx.run(up, { cwd: dir, env, timeout: 10 * 60e3 });
  if (r.code !== 0) throw new Error(`devcontainer up failed: ${tail(r)}`);
  // No shell: the mount point is in /proc/self/mountinfo, and the user can write there.
  const inContainer = (cmd) => ctx.run(execArgv(engine, dir, a, cmd), { cwd: dir, env, timeout: 60e3 }).code === 0;
  if (!inContainer(['grep', '-qF', ` ${a.mount} `, '/proc/self/mountinfo']) || !inContainer(['test', '-w', a.mount])) throw new Error(`the volume ${a.volume} is not mounted at ${a.mount} in this container, or not writable for its user. A mount applies when a container is created: recreate it with\n  ${[...up, '--remove-existing-container'].join(' ')}`);
  return engine;
}

// ---- status and preflight

const statusCmd = (agent) => (agent === 'claude' ? ['claude', 'auth', 'status', '--json'] : ['codex', 'login', 'status']);
const finding = (level, name, message, fix) => ({ level, check: 'accounts', message: `account ${name}: ${message}`, fix });

// Whether the account is signed in, how old its token is, and what to run when it is not. Reads only. loggedIn null: not checked.
// dir: the project whose dev container a container account is checked in.
export function accountStatus(ctx, a, { dir, now = Date.now(), token } = {}) {
  const out = { name: a.name, agent: a.agent, mode: a.mode, loggedIn: null, method: null, findings: [] };
  const age = a.token?.created ? Math.floor((now - Date.parse(a.token.created)) / DAY) : null;
  const relogin = `benchkeeper accounts login ${a.name}`;
  let r;
  if (a.mode === 'host') r = ctx.run(statusCmd(a.agent), { env: accountEnv(ctx, a, { token }), timeout: 30e3 });
  else if (dir && hasDevcontainer(dir) && engineOf(ctx)) r = ctx.run(execArgv(engineOf(ctx), dir, a, statusCmd(a.agent), { token }), { cwd: dir, env: baseEnv(ctx), timeout: 60e3 });
  if (!r) out.findings.push(finding('info', a.name, 'not checked: a container account is checked in a project with a running dev container', `benchkeeper accounts status ${a.name} --project <dir>`));
  else if (r.code === 127) out.findings.push(finding('warning', a.name, `${a.agent} is not installed`, `install ${a.agent === 'claude' ? 'Claude Code' : 'Codex'}`));
  else {
    // Claude Code prints JSON (exit 1 when not logged in); Codex prints a line and uses the exit code.
    let doc = null;
    try { doc = JSON.parse(r.stdout); } catch { /* not JSON */ }
    if (a.agent === 'claude' && typeof doc?.loggedIn === 'boolean') { out.loggedIn = doc.loggedIn; out.method = typeof doc.authMethod === 'string' ? clean(doc.authMethod).slice(0, 40) : null; }
    else if (a.agent === 'codex' && [0, 1].includes(r.code)) out.loggedIn = r.code === 0;
    if (out.loggedIn === false) out.findings.push(finding('warning', a.name, 'not signed in, or the login expired', relogin));
    else if (out.loggedIn === null) out.findings.push(finding('info', a.name, `login state not read: ${tail(r)}`, 'run the agent in this account once to see why'));
  }
  if (age !== null) {
    out.tokenAgeDays = age;
    if (age >= EXPIRED_DAYS) out.findings.push(finding('error', a.name, `the stored token is ${age} days old and has run out`, `${relogin} --token`));
    else if (age >= WARN_DAYS) out.findings.push(finding('warning', a.name, `the stored token is ${age} days old (a token lasts a year)`, `${relogin} --token`));
  }
  return out;
}

// Findings for doctor: one status per registered account; nothing when none is registered or the file cannot be read.
export function accountChecks(ctx, { dir, now } = {}) {
  let list;
  try { list = listAccounts(ctx); } catch (e) { return [{ level: 'error', check: 'accounts', message: e.message, fix: 'fix or delete accounts.json in the config folder' }]; }
  return list.flatMap((a) => accountStatus(ctx, a, { dir, now }).findings);
}

// ---- launch

// Runs an agent as the account in the foreground, after the preflight. Returns the exit code; a refusal throws.
export function runAs(ctx, a, args, { dir = process.cwd(), useToken = false, say = () => {} } = {}) {
  if (args[0] !== a.agent) throw new Error(`account ${a.name} is a ${a.agent} account: the command is ${a.agent}`);
  let token;
  if (useToken) {
    if (a.agent !== 'claude' || !a.token) throw new Error(`account ${a.name} keeps no token (benchkeeper accounts login ${a.name} --token)`);
    token = store(ctx).get(a.name);
    if (!token) throw new Error(`the token of ${a.name} is not in the credential store (benchkeeper accounts login ${a.name} --token)`);
  }
  if (a.mode === 'container') ensureContainer(ctx, a, dir);
  const s = accountStatus(ctx, a, { dir, token });
  // A failed check that is only "could not read" does not stop a launch; a login that is gone does.
  if (s.loggedIn === false && !useToken) throw new Error(`account ${a.name} is not signed in, or the login expired: benchkeeper accounts login ${a.name}`);
  for (const f of s.findings.filter((x) => x.level !== 'info')) say(`${f.level}: ${f.message} (${f.fix})`);
  const r = a.mode === 'host'
    ? ctx.run(args, { cwd: dir, env: accountEnv(ctx, a, { token }), stdio: 'inherit' })
    : ctx.run(execArgv(engineOf(ctx), dir, a, args, { token }), { cwd: dir, env: baseEnv(ctx), stdio: 'inherit' });
  return r.code;
}

// ---- guided sign-in

const URL_RE = /https:\/\/[^\s"'<>]+/;
const TOKEN_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const EMAIL = /^[^\s@-][^\s@]{0,200}@[^\s@]{1,200}$/;
const DONE = Symbol('done');

// io: { say(line), step(name, info), code() -> Promise<string|null> } (code: what the user pastes from the browser, null at the end of input).
// opts: { token, email, noBrowser, dir, open (url -> browser name or null) }. Returns { stored } (a token went to the credential store).
// Steps: start, url (info.url, info.browser), code (Claude Code only: a code may be pasted), verify, done.
export async function login(ctx, a, { io, token = false, email, noBrowser = false, dir = process.cwd(), open = ctx.openPrivate ?? openPrivate } = {}) {
  if (email !== undefined && !EMAIL.test(email)) throw new Error('--email needs an address');
  if (token && a.agent === 'codex') return loginCodexToken(ctx, a, { io, dir });
  const claude = a.agent === 'claude';
  const cmd = claude ? (token ? ['claude', 'setup-token'] : ['claude', 'auth', 'login', ...(email ? ['--email', email] : [])]) : ['codex', 'login', '--device-auth'];
  let argv = cmd, env;
  io.step('start', { account: a.name, agent: a.agent, mode: a.mode });
  if (a.mode === 'host') {
    // Created for this user alone: the agent writes its login file here.
    mkdirSync(a.dir, { recursive: true, mode: 0o700 });
    chmodSync(a.dir, 0o700);
    // A no-op browser opener: the agent's own window would be a normal one, where another account may be signed in. Whether
    // each agent reads BROWSER is unverified; the URL is taken from its output either way.
    env = { ...accountEnv(ctx, a), ...(process.platform === 'win32' ? {} : { BROWSER: 'true' }) };
  } else {
    argv = execArgv(ensureContainer(ctx, a, dir), dir, a, cmd);
    env = baseEnv(ctx);
  }
  let secret = null, url = null, buffer = '', child = null, sawUrl;
  const seen = new Promise((r) => { sawUrl = r; });
  const handle = (raw) => {
    const text = clean(raw);
    if (!text.trim()) return;
    const found = token ? text.match(TOKEN_RE) : null;
    if (found) { secret ??= found[0]; io.say('(a token was received and is not shown)'); return; }
    const link = !url && text.match(URL_RE)?.[0]?.replace(/[.,;)]+$/, '');
    if (link) {
      url = link;
      io.say(text);
      const safe = signInUrl(link);
      const used = safe && !noBrowser ? open(safe) : null;
      io.say(used ? `Opened a private window in ${used}: sign in to the account you want as ${a.name}.` : `Open this link in a private browser window${safe ? '' : ' (its host is not a known sign-in host, check it)'}: ${link}`);
      io.step('url', { url: link, browser: used });
      sawUrl();
      return;
    }
    io.say(token ? hide(text, secret) : hide(text));
  };
  const onOutput = (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop();
    lines.forEach(handle);
  };
  const exit = runCommandAsync(argv, { env, cwd: a.mode === 'container' ? dir : undefined, timeout: 10 * 60e3, onOutput, onStart: (stdin) => { child = stdin; } });
  // Claude Code asks for a pasted code when the browser cannot reach its localhost callback: lines go to its input until it ends.
  const finished = exit.then(() => DONE);
  const pump = async () => {
    if (!claude) return;
    await Promise.race([seen, finished]);
    for (;;) {
      if (url) io.step('code', {});
      const v = await Promise.race([io.code(), finished]);
      if (v === DONE || v === null || v === undefined) return;
      if (String(v).trim() && child?.writable) child.write(`${String(v).trim()}\n`);
    }
  };
  const [r] = await Promise.all([exit, pump()]);
  if (buffer) handle(buffer);
  if (r.code !== 0) throw new Error(`${cmd.slice(0, 2).join(' ')} ended with ${r.code === 124 ? 'a timeout' : `exit ${r.code}`}: ${tail(r, secret)}${url ? '' : `\nNo sign-in link was printed. Sign in by hand: ${a.mode === 'host' ? `${VAR[a.agent]}=${a.dir} ` : ''}${cmd.join(' ')}`}`);
  if (token) {
    if (!secret) throw new Error('claude setup-token printed no token: nothing was stored');
    store(ctx).set(a.name, secret);
    io.step('done', { stored: true });
    return { stored: true };
  }
  io.step('verify', {});
  const s = accountStatus(ctx, a, { dir });
  if (s.loggedIn === false) throw new Error(`the sign-in ended but ${a.name} is still not signed in: ${s.findings[0]?.fix ?? 'try again'}`);
  io.step('done', { loggedIn: s.loggedIn, method: s.method });
  return { stored: false };
}

// Codex has no token command: the access token comes from stdin (a pipe, never an argument) and goes to codex login
// --with-access-token on its stdin, into the account's own folder. It is not kept anywhere else.
function loginCodexToken(ctx, a, { io, dir }) {
  const token = io.secret?.();
  if (!token || !/^[\w.~+/=-]{20,8192}$/.test(token)) throw new Error('pipe the access token on stdin: printenv NAME | benchkeeper accounts login <name> --token');
  const cmd = ['codex', 'login', '--with-access-token'];
  let argv = cmd, env;
  if (a.mode === 'host') { mkdirSync(a.dir, { recursive: true, mode: 0o700 }); chmodSync(a.dir, 0o700); env = accountEnv(ctx, a); } else { argv = execArgv(ensureContainer(ctx, a, dir), dir, a, cmd); env = baseEnv(ctx); }
  io.step('start', { account: a.name, agent: a.agent, mode: a.mode });
  const r = ctx.run(argv, { cwd: dir, env, input: `${token}\n`, timeout: 60e3 });
  if (r.code !== 0) throw new Error(`codex login --with-access-token failed: ${tail(r, token)}`);
  io.step('done', { stored: false });
  return { stored: false };
}

export { StoreError };
