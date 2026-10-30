// Several logins per agent (Claude Code, Codex): a registry of accounts, a guided sign-in, a preflight and a launcher.
// An account is a folder of its own (CLAUDE_CONFIG_DIR, CODEX_HOME) on the host, or a named volume in a dev container.
// The registry holds names, folders and dates, never a credential. A token (opt-in, for unattended containers) lives in the
// OS credential store, goes to one launch only and never into a file, the ledger, a log or devcontainer.json.
// Switching accounts is the user's choice at a launch. The exceptions are opt-in (usage.mjs, settings in accounts.json): auto-pick
// (a new launch under the default account may start under another account of the same pool) and the confirmed handover to a new
// session of a pool member; never a running session.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { openPrivate, signInUrl } from './browser.mjs';
import { childEnv } from './childenv.mjs';
import { StoreError, credentialStore } from './credstore.mjs';
import { agent, notAvailable, registry, supports } from './agents.mjs';
import { diffLines } from './diff.mjs';
import { exists, inside, isDir, readText } from './fsx.mjs';
import { git } from './git.mjs';
import { lastLines, mask } from './redact.mjs';
import { apply, preview, runCommandAsync } from './runner.mjs';
import { CODEX_READER, HOOK_SOURCE, STATE_DIR, assess, codexReading, headroom, lowWindows, limitsFor, nearNotices, parseState, qualifies, readyAt, rotation, settingsOf, trackedSettings, usageFindings, validLimits, validSettings } from './usage.mjs';

export const AGENTS = registry.filter((a) => a.features.accounts).map((a) => a.id);
const VAR = { claude: 'CLAUDE_CONFIG_DIR', codex: 'CODEX_HOME' };
const TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';
const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
// A setup-token lasts a year: a warning from the 11th month on, an error once it has run out.
const WARN_DAYS = 335, EXPIRED_DAYS = 365;
const MOUNT = /^\/[\w./-]{1,200}$/;
// A volume name goes into a comma separated --mount value: no comma, no equals sign.
const VOLUME = /^[\w.-]{1,100}$/;
const DAY = 864e5;

const tail = (r, secret) => hide(lastLines(r.stderr || r.stdout || ''), secret) || `exit ${r.code}`;
// Text from a child that is shown or kept: control characters out, token shapes and the known token masked.
const ESC = String.fromCharCode(27), BEL = String.fromCharCode(7);
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}]*${BEL}`, 'g');
const clean = (t) => String(t).replace(ANSI, '').replace(/[^\P{Cc}\t\n]/gu, '');
// shortcut: a token of an unknown shape that sits in a run shorter than 32 characters is not recognised; a longer run is hidden.
const hide = (text, secret) => mask(clean(text), { keys: true }).replace(/[A-Za-z0-9_-]{32,}/g, '***').split(secret || '\0').join('***');

// ---- registry: accounts.json in the config folder

const registryFile = (ctx) => join(ctx.config, 'accounts.json');
const where = (ctx) => (ctx.env ?? process.env);
const home = (ctx) => ctx.home ?? homedir();

// Entries are checked on every read: the file is one other processes can write.
function parseDoc(text) {
  if (text == null) return { accounts: [] };
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error('the accounts file is not valid JSON'); }
  if (!Array.isArray(doc?.accounts)) throw new Error('the accounts file has no accounts list');
  if (!validSettings(doc.settings)) throw new Error('the accounts file has settings that are not valid');
  for (const a of doc.accounts) {
    const ok = a && NAME.test(a.name) && AGENTS.includes(a.agent) && (a.label == null || typeof a.label === 'string') && validLimits(a.limits) && (a.pool === undefined || NAME.test(a.pool))
      && (a.token == null || (typeof a.token.created === 'string' && !Number.isNaN(Date.parse(a.token.created)))) && (a.mode === 'host' ? typeof a.dir === 'string' && isAbsolute(a.dir) : a.mode === 'container' && VOLUME.test(a.volume ?? '') && MOUNT.test(a.mount ?? ''));
    if (!ok) throw new Error('the accounts file has an entry that is not an account');
  }
  return doc;
}
const parse = (text) => parseDoc(text).accounts;
export const listAccounts = (ctx) => parse(readText(registryFile(ctx)));
// The usage settings of BenchKeeper (thresholds, auto-pick) as the file holds them, else undefined; settingsOf fills the defaults.
export const registrySettings = (ctx) => parseDoc(readText(registryFile(ctx))).settings;
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
// and throws on a refusal, which the preview shows as the change's error; g does the same for the settings. The registry holds no credential.
function registryChange(title, ctx, f, g = (s) => s) {
  return { id: 'accounts', step: 'accounts', title, kind: 'write', path: registryFile(ctx), edit: (text) => {
    const doc = parseDoc(text), settings = g(doc.settings);
    const out = `${JSON.stringify({ schemaVersion: 1, ...(settings && Object.keys(settings).length ? { settings } : {}), accounts: f(doc.accounts) }, null, 2)}\n`;
    parseDoc(out);
    return out;
  } };
}
export const commit = (ctx, change, select) => apply(preview([change]), ctx, { scope: 'global', select });

const dataDir = (ctx, name) => join(home(ctx), '.local/share/benchkeeper/accounts', name);
// The entry `accounts add` plans; opts: { name, agent, container, label, dir, mount (container accounts) }.
export function newAccount(ctx, o) {
  if (!NAME.test(o.name ?? '')) throw new Error('the name is 1 to 32 characters: lower case letters, digits, - and _, starting with a letter or digit');
  if (!AGENTS.includes(o.agent)) throw new Error(`${registry.some((a) => a.id === o.agent) ? `${notAvailable('accounts', o.agent)}: ` : ''}the agent is one of ${AGENTS.join(', ')}`);
  const base = { name: o.name, agent: o.agent, ...(o.label ? { label: String(o.label).slice(0, 80) } : {}), token: null, added: new Date().toISOString() };
  if (o.container) {
    // No default: the folder must be one the container's user can write, which depends on the image.
    const mount = o.mount;
    if (!MOUNT.test(mount ?? '') || mount.split('/').includes('..')) throw new Error('--mount is the absolute path inside the container where the volume is mounted: a folder its user can write, below its home folder');
    return { ...base, mode: 'container', volume: `benchkeeper-${o.agent}-${o.name}`, mount };
  }
  // Outside the config folder: the agent's own login file sits there, and the config folder is what the ledger and backups hold.
  const dir = resolve(o.dir ?? dataDir(ctx, o.name));
  if (inside(dir, [ctx.config])) throw new Error('the account folder must lie outside the BenchKeeper config folder');
  // Sign-in makes the folder this user's alone and tracking writes settings.json into it: never a folder that holds something.
  if (o.dir !== undefined && isDir(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty: an account gets a new or empty folder`);
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

// The registry entry as a page or a --json document shows it: no credential is in it. limits: the thresholds that apply to it.
export const accountDoc = (a, settings) => ({ name: a.name, agent: a.agent, mode: a.mode, label: a.label ?? null, default: !!a.default, pool: a.pool ?? null, limits: limitsFor(settings, a), ...(a.mode === 'host' ? { dir: a.dir } : { volume: a.volume, mount: a.mount }), token: { kept: !!a.token, created: a.token?.created ?? null } });

// Thresholds and pool: o is { minimum, warn, pool (null clears), reset (drops the account's thresholds) } for one account, or
// { minimum, warn, autoPick, whenNone, continueBelow, rotate } for the settings. A value left out stays as it is.
const mergeLimits = (old, o) => {
  const out = {};
  for (const k of ['minimum', 'warn']) { const v = { ...old?.[k], ...o[k] }; if (Object.keys(v).length) out[k] = v; }
  return out;
};
export const limitsChange = (ctx, name, o) => registryChange(`${o.reset ? 'reset' : 'set'} the usage thresholds${o.pool !== undefined ? ' and pool' : ''} of account ${name}`, ctx, (list) => {
  if (!list.some((x) => x.name === name)) throw new Error(`no account ${name}`);
  if (o.pool && !NAME.test(o.pool)) throw new Error('a pool name is 1 to 32 characters: lower case letters, digits, - and _');
  return list.map((x) => {
    if (x.name !== name) return x;
    const { limits, pool, ...rest } = x, next = o.reset ? {} : mergeLimits(limits, o), p = o.pool === undefined ? pool : o.pool;
    return { ...rest, ...(Object.keys(next).length ? { limits: next } : {}), ...(p ? { pool: p } : {}) };
  });
});
export const settingsChange = (ctx, o) => registryChange('set the usage settings of BenchKeeper', ctx, (list) => list, (old) => {
  const { autoPick, whenNone, continueBelow, rotate } = o;
  return { ...old, ...mergeLimits(old, o), ...(autoPick === undefined ? {} : { autoPick }), ...(whenNone === undefined ? {} : { whenNone }), ...(continueBelow === undefined ? {} : { continueBelow }), ...(rotate === undefined ? {} : { rotate: { ...old?.rotate, ...rotate } }) };
});

export const store = (ctx) => ctx.credentials ?? credentialStore(ctx.run, { env: where(ctx) });

// ---- environment and launch

// The environment of a command that runs as an account: the filtered environment of childEnv and, on the host, the one variable
// that names the account's folder. An inherited folder variable is dropped first, and so is any credential name (childEnv).
// token (Claude Code, host, explicit launch only) adds the token variable in its place.
export function accountEnv(ctx, a, { token } = {}) {
  // With a token, no inherited ANTHROPIC_ variable (an endpoint, a proxy key) comes along, even when BENCHKEEPER_PASS_ENV names it.
  const env = Object.fromEntries(Object.entries(where(ctx)).filter(([k]) => !Object.values(VAR).includes(k.toUpperCase()) && !(token && k.toUpperCase().startsWith('ANTHROPIC_'))));
  return childEnv({ ...(a.mode === 'host' ? { [VAR[a.agent]]: a.dir } : {}), ...(token && a.mode === 'host' ? { [TOKEN_VAR]: token } : {}) }, env);
}

// The host-side environment of a container command: no account folder variable, no credential.
const baseEnv = (ctx) => accountEnv(ctx, { mode: 'container' });
// A command sequence is written once as a generator: each step yields [argv, options] and gets the result back. drive runs it
// with the blocking runner (the CLI), driveAsync with the async one (the server, which a slow container must not block).
const drive = (steps, run) => { let s = steps.next(); while (!s.done) s = steps.next(run(...s.value)); return s.value; };
const driveAsync = async (steps, run) => { let s = steps.next(); while (!s.done) s = steps.next(await run(...s.value)); return s.value; };
const asyncRun = (ctx) => ctx.runAsync ?? ctx.run;
function* engineSteps(ctx) {
  for (const e of ['podman', 'docker']) if ((yield [[e, '--version'], { env: where(ctx) }]).code === 0) return e;
}
const engineOf = (ctx) => drive(engineSteps(ctx), ctx.run);
const mounts = (ctx) => listAccounts(ctx).filter((a) => a.mode === 'container').flatMap((a) => ['--mount', `type=volume,source=${a.volume},target=${a.mount}`]);
// devcontainer exec runs cmd in the project's container; the account's folder variable is a --remote-env value.
const execArgv = (engine, dir, a, cmd) => ['devcontainer', 'exec', '--docker-path', engine, '--workspace-folder', dir, '--remote-env', `${VAR[a.agent]}=${a.mount}`, ...cmd];
// A token never goes on a command line (other processes of the user see it there), and not on the launch's stdin (devcontainer
// exec gives the agent a terminal only when its stdin is one): a file of mode 0600 in the account's volume, written through
// stdin, that the launch reads and removes before it starts the agent.
// The two scripts are the app's only shell, run inside the container, and take data only as "$1" and "$@" (security.test.mjs).
// One file name per launch, so two launches of one account do not remove each other's file.
const tokenFile = (a) => `${a.mount}/.benchkeeper-token-${randomUUID()}`;
const writeToken = ['sh', '-c', 'umask 077 && rm -f "$1" && cat > "$1"', 'sh'];
const withToken = ['sh', '-c', 'CLAUDE_CODE_OAUTH_TOKEN=$(cat "$1") && rm -f "$1" && export CLAUDE_CODE_OAUTH_TOKEN && shift && exec "$@"', 'sh'];
const hasDevcontainer = (dir) => exists(join(dir, '.devcontainer')) || exists(join(dir, '.devcontainer.json'));

// Starts the project's container with every container account's volume (a mount applies when the container is created) and
// checks that this account's volume is mounted and writable in it. Returns the engine; throws with the command that fixes it.
function* containerSteps(ctx, a, dir) {
  if (!hasDevcontainer(dir)) throw new Error(`${dir} has no dev container configuration (.devcontainer/)`);
  const engine = yield* engineSteps(ctx);
  if (!engine) throw new Error('no container engine (podman or docker)');
  const env = baseEnv(ctx);
  const up = ['devcontainer', 'up', '--docker-path', engine, '--workspace-folder', dir, ...mounts(ctx)];
  const r = yield [up, { cwd: dir, env, timeout: 10 * 60e3 }];
  if (r.code !== 0) throw new Error(`devcontainer up failed: ${tail(r)}`);
  // No shell: the mount point is in /proc/self/mountinfo, and the user can write there.
  const inContainer = (cmd) => [execArgv(engine, dir, a, cmd), { cwd: dir, env, timeout: 60e3 }];
  if ((yield inContainer(['grep', '-qF', ` ${a.mount} `, '/proc/self/mountinfo'])).code !== 0 || (yield inContainer(['test', '-w', a.mount])).code !== 0) throw new Error(`the volume ${a.volume} is not mounted at ${a.mount} in this container, or not writable for its user. A mount applies when a container is created: recreate it with\n  ${[...up, '--remove-existing-container'].join(' ')}`);
  return engine;
}
const ensureContainer = (ctx, a, dir) => drive(containerSteps(ctx, a, dir), ctx.run);
const ensureContainerAsync = (ctx, a, dir) => driveAsync(containerSteps(ctx, a, dir), asyncRun(ctx));

// ---- status and preflight

const statusCmd = (agent) => (agent === 'claude' ? ['claude', 'auth', 'status', '--json'] : ['codex', 'login', 'status']);
const finding = (level, name, message, fix) => ({ level, check: 'accounts', message: `account ${name}: ${message}`, fix });

// The account's usage files (written by usage-hook.mjs in the account's folder) as the status document: from the host folder,
// or from the volume through devcontainer exec. engine: the container engine, for a container account.
// A file that is not a regular one of at most 64 KiB (a pipe, a huge file) is read as missing: the account's processes can write here.
const small = (p) => { try { const s = statSync(p); return s.isFile() && s.size <= 65536 ? readText(p) : null; } catch { return null; } };
const stateFile = (a, f) => (a.mode === 'host' ? join(a.dir, STATE_DIR, f) : `${a.mount}/${STATE_DIR}/${f}`);
function* usageSteps(ctx, a, { dir, now, engine }) {
  const text = {};
  for (const f of ['usage.json', 'failures.jsonl']) {
    if (a.mode === 'host') text[f] = small(stateFile(a, f));
    else { const r = yield [execArgv(engine, dir, a, ['cat', stateFile(a, f)]), { cwd: dir, env: baseEnv(ctx), timeout: 60e3 }]; text[f] = r.code === 0 ? r.stdout : null; }
  }
  return assess(parseState(text['usage.json'], text['failures.jsonl']), limitsFor(registrySettings(ctx), a), now);
}
function* usageNowSteps(ctx, a, { dir, now }) {
  const engine = a.mode === 'container' && dir && hasDevcontainer(dir) ? yield* engineSteps(ctx) : null;
  return a.mode === 'host' || engine ? yield* usageSteps(ctx, a, { dir, now, engine }) : null;
}

// Whether the account is signed in, how old its token is, and what to run when it is not. Reads only. loggedIn null: not checked.
// dir: the project whose dev container a container account is checked in. usage false: the sign-in only (accounts list).
function* statusSteps(ctx, a, { dir, now = Date.now(), token, usage = true } = {}) {
  const out = /** @type {{ name: string, agent: string, mode: string, loggedIn: boolean | null, method: string | null, email: string | null, plan: string | null, tokenAgeDays?: number, usage: object | null, tracking?: boolean, notAvailable?: string, findings: object[] }} */ ({ name: a.name, agent: a.agent, mode: a.mode, loggedIn: null, method: null, email: null, plan: null, usage: null, findings: [] });
  const age = a.token?.created ? Math.floor((now - Date.parse(a.token.created)) / DAY) : null;
  const relogin = `benchkeeper accounts login ${a.name}`;
  let r, gone = false, engine = null;
  // A folder that is not there yet is not signed in; the agent would create it with the default mode.
  if (a.mode === 'host') { if (exists(a.dir)) r = yield [statusCmd(a.agent), { env: accountEnv(ctx, a, { token }), timeout: 30e3 }]; else gone = true; }
  // The token stays out of the container command line: the volume's own sign-in is what is checked.
  else {
    engine = dir && hasDevcontainer(dir) ? yield* engineSteps(ctx) : null;
    if (engine) r = yield [execArgv(engine, dir, a, statusCmd(a.agent)), { cwd: dir, env: baseEnv(ctx), timeout: 60e3 }];
  }
  if (gone) { out.loggedIn = false; out.findings.push(finding('warning', a.name, 'not signed in (its folder does not exist yet)', relogin)); }
  else if (!r) out.findings.push(finding('info', a.name, 'not checked: a container account is checked in a project with a running dev container', `benchkeeper accounts status ${a.name} --project <dir>`));
  // In a container the exit code of devcontainer exec may be its own, so only the host can say the agent is missing.
  else if (r.code === 127 && a.mode === 'host') out.findings.push(finding('warning', a.name, `${a.agent} is not installed`, `install ${a.agent === 'claude' ? 'Claude Code' : 'Codex'}`));
  else {
    // Claude Code prints JSON (exit 1 when not logged in); Codex prints a line and uses the exit code.
    let doc = null;
    try { doc = JSON.parse(r.stdout); } catch { /* not JSON */ }
    const field = (v, n) => (typeof v === 'string' && v ? clean(v).slice(0, n) : null);
    // email and subscriptionType are unverified: the CLI reference documents loggedIn, authMethod and configDirectory only.
    if (a.agent === 'claude' && typeof doc?.loggedIn === 'boolean') Object.assign(out, { loggedIn: doc.loggedIn, method: field(doc.authMethod, 40), email: field(doc.email, 200), plan: field(doc.subscriptionType, 40) });
    else if (a.agent === 'codex' && (r.code === 0 || (r.code === 1 && /not logged in/i.test(`${r.stdout}\n${r.stderr}`)))) out.loggedIn = r.code === 0;
    if (out.loggedIn === false) out.findings.push(finding('warning', a.name, 'not signed in, or the login expired', relogin));
    else if (out.loggedIn === null) out.findings.push(finding('info', a.name, `login state not read: ${tail(r)}`, 'run the agent in this account once to see why'));
  }
  if (age !== null) {
    out.tokenAgeDays = age;
    if (age >= EXPIRED_DAYS) out.findings.push(finding('error', a.name, `the stored token is ${age} days old and has run out`, `${relogin} --token`));
    else if (age >= WARN_DAYS) out.findings.push(finding('warning', a.name, `the stored token is ${age} days old (a token lasts a year)`, `${relogin} --token`));
  }
  if (!usage) return out;
  // Usage: the status line files of a Claude Code account, where its container was reached. Codex has no feed: its app-server
  // is asked once, for a signed-in host account.
  if (supports(a.agent, 'usage')) out.usage = a.mode === 'host' || engine ? yield* usageSteps(ctx, a, { dir, now, engine }) : null;
  else if (a.agent === 'codex' && !(a.mode === 'host' && out.loggedIn)) out.notAvailable = a.mode === 'host' ? 'not read: not signed in' : 'not read: Codex usage is read for host accounts only';
  else if (a.agent === 'codex') {
    const c = codexReading((yield [[process.execPath, '-e', CODEX_READER], { env: accountEnv(ctx, a), timeout: 30e3 }]).stdout, now);
    if (c.usage) out.usage = assess({ usage: c.usage, failures: [] }, limitsFor(registrySettings(ctx), a), now);
    else out.notAvailable = `not read: ${hide(c.reason)}`;
  } else out.notAvailable = notAvailable('usage', a.agent);
  // Tracking set up but no reading yet (no session since): the page says so instead of offering to track again.
  if (supports(a.agent, 'usage') && a.mode === 'host') out.tracking = exists(scriptOf(a));
  if (out.usage) out.findings.push(...usageFindings(a.name, out.usage, relogin));
  return out;
}
export const accountStatus = (ctx, a, o) => drive(statusSteps(ctx, a, o), ctx.run);
export const accountStatusAsync = (ctx, a, o) => driveAsync(statusSteps(ctx, a, o), asyncRun(ctx));

// Findings for doctor: one status per registered account; nothing when none is registered or the file cannot be read.
export function accountChecks(ctx, { dir, now } = {}) {
  let list;
  try { list = listAccounts(ctx); } catch (e) { return [{ level: 'error', check: 'accounts', message: e.message, fix: 'fix or delete accounts.json in the config folder' }]; }
  return list.flatMap((a) => accountStatus(ctx, a, { dir, now }).findings);
}

// ---- launch

// A launch below the minimum headroom of an account waits for a yes: the findings printed before say why, the caller asks and calls runAs again with confirmed.
export class NeedsConfirm extends Error {
  constructor() { super('below the minimum headroom of the account (--yes starts anyway, --account <name> chooses another)'); }
}
const sleep = (ctx, ms) => (ctx.sleep ?? ((n) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n)))(ms);
const accountUsage = (ctx, a, o) => drive(usageNowSteps(ctx, a, o), ctx.run);

// The usage check of a launch, for an account with a window below its minimum. Returns null (go on: confirmed, or the settings
// say go on; the findings printed before show the windows), { account, confirmed? } (start under that account instead; confirmed after a wait), or throws NeedsConfirm or a stop.
// Auto-pick (settings, off by default) acts here and nowhere else: only for a new launch under the default account, only among
// the accounts of the chosen one's pool (accounts of one person), only to an account known to be at or above its minimum,
// and only for an agent with a usage feed (Claude Code): a Codex account is never switched for the user.
function launchGate(ctx, a, u, { dir, now, pick, confirmed, say }) {
  if (!lowWindows(u).length) return null;
  const settings = settingsOf(registrySettings(ctx));
  if (!(settings.autoPick && pick && a.pool && supports(a.agent, 'usage'))) {
    if (!confirmed && !settings.continueBelow) throw new NeedsConfirm();
    return null;
  }
  const others = listAccounts(ctx).filter((x) => x.agent === a.agent && x.name !== a.name && x.pool === a.pool).map((x) => ({ x, u: accountUsage(ctx, x, { dir, now }) }));
  const best = others.filter((c) => qualifies(c.u)).sort((p, q) => headroom(q.u) - headroom(p.u))[0];
  if (best) { say(`auto-pick: starting under account ${best.x.name} of pool ${a.pool} (${headroom(best.u)}% left) instead of ${a.name}`); return { account: best.x }; }
  const soon = [{ x: a, u }, ...others].filter((c) => lowWindows(c.u).length).sort((p, q) => readyAt(p.u) - readyAt(q.u))[0];
  if (settings.whenNone === 'wait' && soon) {
    say(`auto-pick: no account of pool ${a.pool} is at or above its minimum: waiting until ${new Date(readyAt(soon.u)).toISOString()} for account ${soon.x.name}`);
    sleep(ctx, Math.max(0, readyAt(soon.u) - now));
    say(`auto-pick: starting under account ${soon.x.name}`);
    return { account: soon.x, confirmed: true };
  }
  // --yes (or the setting) goes on under the chosen account, as it does without a pool.
  if (confirmed || settings.continueBelow) return null;
  throw new Error(`no account of pool ${a.pool} is at or above its minimum${soon ? `; the earliest reset is ${new Date(readyAt(soon.u)).toISOString()} (account ${soon.x.name})` : ' (no usage reading to wait for)'}`);
}

// Runs an agent as the account in the foreground, after the preflight. Returns the exit code; a refusal throws.
// pick: the account was not named, so auto-pick may replace it. confirmed: the user said go on below the minimum.
// used: called with the account the agent starts under.
export function runAs(ctx, a, args, { dir = process.cwd(), useToken = false, say = () => {}, pick = false, confirmed = false, now = Date.now(), used = () => {} } = {}) {
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
  for (const f of s.usage ? nearNotices(a.name, s.usage) : []) say(`notice: ${f.message} (${f.fix})`);
  const gate = s.usage ? launchGate(ctx, a, s.usage, { dir, now, pick, confirmed, say }) : null;
  if (gate) return runAs(ctx, gate.account, args, { dir, useToken, say, now, pick: false, confirmed: !!gate.confirmed, used });
  used(a);
  // The folder is for this user alone, also when the agent creates its first files there.
  if (a.mode === 'host') mkdirSync(a.dir, { recursive: true, mode: 0o700 });
  if (a.mode === 'host') return ctx.run(args, { cwd: dir, env: accountEnv(ctx, a, { token }), stdio: 'inherit' }).code;
  const engine = engineOf(ctx), opts = { cwd: dir, env: baseEnv(ctx), timeout: 60e3 };
  if (!token) return ctx.run(execArgv(engine, dir, a, args), { cwd: dir, env: baseEnv(ctx), stdio: 'inherit' }).code;
  const file = tokenFile(a);
  const w = ctx.run(execArgv(engine, dir, a, [...writeToken, file]), { ...opts, input: token });
  if (w.code !== 0) throw new Error(`could not hand the token to the container: ${tail(w, token)}`);
  try {
    return ctx.run(execArgv(engine, dir, a, [...withToken, file, ...args]), { cwd: dir, env: baseEnv(ctx), stdio: 'inherit' }).code;
  } finally {
    // The launch removes the file as it reads it; this covers a launch that never got that far.
    ctx.run(execArgv(engine, dir, a, ['rm', '-f', file]), opts);
  }
}

// ---- rotation by handover (opt-in per agent, settings.rotate): a fresh session on another account of the pool continues the work

// The decision for account a (usage.mjs rotation), with the setting. Off reads nothing.
export function rotationFor(ctx, a, { dir, now = Date.now() } = {}) {
  const setting = settingsOf(registrySettings(ctx)).rotate[a.agent];
  if (setting === 'off') return { action: 'none', setting };
  const usage = (x) => accountStatus(ctx, x, { dir, now }).usage;
  const pool = a.pool ? listAccounts(ctx).filter((x) => x.agent === a.agent && x.name !== a.name && x.pool === a.pool).map((x) => ({ account: x, usage: usage(x) })) : [];
  return { ...rotation(usage(a), pool, setting, now), setting };
}

// Shown when rotation is turned on and before each handover. The sources are the providers' own pages; this is not legal advice.
export const ROTATE_WARNING = {
  claude: 'warning: rotating accounts to extend usage may go against Anthropic\'s terms: the usage limits of Pro and Max assume ordinary, individual usage (https://code.claude.com/docs/en/legal-and-compliance), and the consumer terms prohibit bypassing its protective measures (https://www.anthropic.com/legal/consumer-terms, section 3). The risk is yours; this is not legal advice.',
  codex: 'warning: OpenAI\'s Terms of Use forbid circumventing rate limits (https://openai.com/policies/terms-of-use/), and its Sign in with ChatGPT Terms forbid rotating accounts to bypass usage limits (https://openai.com/policies/sign-in-with-chatgpt-terms/). The risk is yours; this is not legal advice.',
};
// A login variable in the environment takes precedence over the account's folder in the agent. childEnv drops these names,
// so one reaches a session only when BENCHKEEPER_PASS_ENV names it.
const LOGIN_VARS = { claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'], codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'] };
export const loginVars = (ctx, agent) => LOGIN_VARS[agent].filter((k) => where(ctx)[k]);

const HANDOFF = '.benchkeeper/handoff.md';
const HANDOVER = '.benchkeeper/handover.md';
const FIELDS = ['Outcome', 'What changed', 'Checks and results', 'Open risks', 'Next step'];
// The fields of the handoff block a dispatched worker writes (its worker spec), each up to the next field.
function handoffFields(text) {
  const out = {};
  let key = null;
  for (const line of String(text ?? '').split('\n')) {
    const f = FIELDS.find((k) => line.trim().startsWith(`${k}:`));
    if (f) { key = f; out[f] = line.trim().slice(f.length + 1).trim(); } else if (key && line.trim()) out[key] += ` ${line.trim()}`;
  }
  return out;
}
// The handover for the session on the next account: built from the worktree's git state and the last handoff block, never from
// a transcript. File names only for uncommitted changes; token shapes are masked.
export function handover(ctx, dir, { from, to }) {
  const g = (args) => { const r = git(ctx, dir, args, { env: where(ctx), timeout: 15e3 }); return r.code === 0 ? r.stdout : ''; };
  const root = g(['rev-parse', '--show-toplevel']).trim() || dir, branch = g(['rev-parse', '--abbrev-ref', 'HEAD']).trim() || 'unknown';
  const changed = g(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => f !== HANDOVER);
  const h = handoffFields(readText(join(root, HANDOFF)));
  const commits = g(['log', '-5', '--format=%s']).split('\n').filter(Boolean);
  const text = [`# Handover from account ${from.name} to ${to.name}`, '',
    'The usage of the previous account reached its minimum headroom. Continue the work below in this worktree; do not start over.', '',
    `## Task and goal\n\n${h.Outcome ? `Last reported outcome: ${h.Outcome}. ` : ''}Continue the work on branch ${branch}: the sections below say what is done and what is open.`, '',
    `## Done\n\n${h['What changed'] ?? (commits.length ? commits.map((c) => `- ${c}`).join('\n') : 'nothing committed yet')}`, '',
    `## Open\n\n${h['Open risks'] ?? 'not recorded'}`, '',
    `## Worktree and branch\n\n${root}, branch ${branch}`, '',
    `## Uncommitted changes\n\n${changed.length ? changed.map((f) => `- ${f}`).join('\n') : 'none'}`, '',
    `## Next step\n\n${h['Next step'] ?? 'Read git status and the last commits, then continue with the open part of the task.'}`, ''].join('\n');
  return { path: join(root, HANDOVER), text: hide(text) };
}
export function writeHandover(h) {
  mkdirSync(join(h.path, '..'), { recursive: true });
  writeFileSync(h.path, h.text);
}

// ---- usage tracking: the status line script and the StopFailure hook in the account's folder (Claude Code)

const scriptOf = (a) => stateFile(a, 'usage.mjs');
const settingsFile = (a) => (a.mode === 'host' ? join(a.dir, 'settings.json') : `${a.mount}/settings.json`);
// A host account's change as a plan of the usual kind (diff, ledger run, undo; the folder may lie outside the home folder, so it
// is added to the roots by the caller). One unit: when the settings cannot take the status line, the script is not written either.
const requireUsage = (a) => { if (!supports(a.agent, 'usage')) throw new Error(`${notAvailable('usage', a.agent)}: ${agent(a.agent).name} has no status line to track (accounts status reads Codex usage from its app-server)`); };
export const trackChanges = (a, { remove = false } = {}) => {
  requireUsage(a);
  return [
    { id: 'usage-script', step: 'accounts', unit: 'usage', title: `${remove ? 'remove' : 'write'} the usage script of account ${a.name}`, kind: 'write', path: scriptOf(a), after: remove ? null : HOOK_SOURCE },
    { id: 'usage-settings', step: 'accounts', unit: 'usage', title: `${remove ? 'take the status line and hook out of' : 'add the status line and the StopFailure hook to'} the settings.json of account ${a.name}`, kind: 'write', path: settingsFile(a), edit: (t) => trackedSettings(t, scriptOf(a), { remove }) },
  ];
};
// A container account's change: the volume is not a host path, so it is read and written through devcontainer exec.
function* trackContainerSteps(ctx, a, dir, { remove }) {
  requireUsage(a);
  const engine = yield* containerSteps(ctx, a, dir);
  // Missing is what cat says about a missing file: a failed exec or a timeout is not an empty settings.json to overwrite.
  const read = function* (path) {
    const r = yield [execArgv(engine, dir, a, ['cat', path]), { cwd: dir, env: baseEnv(ctx), timeout: 60e3 }];
    if (r.code !== 0 && !/no such file or directory/i.test(r.stderr ?? '')) throw new Error(`could not read ${path} in the container: ${tail(r)}`);
    return r;
  };
  const r = yield* read(settingsFile(a));
  const before = r.code === 0 ? r.stdout : null;
  const after = trackedSettings(before, scriptOf(a), { remove });
  const had = yield* read(scriptOf(a));
  const script = { path: scriptOf(a), after: remove ? null : HOOK_SOURCE, diff: `${remove ? 'remove' : 'write'} ${scriptOf(a)}` };
  const settings = { path: settingsFile(a), after, diff: diffLines(before, after, settingsFile(a)) };
  // The script goes first when it is added (only if it differs) and last when it is removed (only if it is there): the settings never name a script that is missing.
  const wanted = remove ? [settings, ...(had.code === 0 ? [script] : [])] : [...(had.stdout === HOOK_SOURCE ? [] : [script]), settings];
  return { engine, files: wanted.filter((f) => f.diff) };
}
export const trackContainer = (ctx, a, dir, o) => drive(trackContainerSteps(ctx, a, dir, o), ctx.run);
// Writes what trackContainer returned. No undo run: `accounts track --off` is the way back.
export function writeContainer(ctx, a, dir, { engine, files }) {
  for (const f of files) {
    const steps = f.after === null ? [['rm', '-f', f.path]] : [['mkdir', '-p', f.path.slice(0, f.path.lastIndexOf('/'))], ['tee', f.path]];
    for (const cmd of steps) {
      const r = ctx.run(execArgv(engine, dir, a, cmd), { cwd: dir, env: baseEnv(ctx), ...(cmd[0] === 'tee' ? { input: f.after } : {}), timeout: 60e3 });
      if (r.code !== 0) throw new Error(`could not write ${f.path} in the container: ${tail(r)}`);
    }
  }
}

// ---- guided sign-in

// Without the punctuation of a sentence at its end.
const trimEnd = (u) => { let n = u?.length ?? 0; while (n > 0 && '.,;)'.includes(u[n - 1])) n--; return u?.slice(0, n); };
const URL_RE = /https:\/\/[^\s"'<>]+/;
const TOKEN_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
const EMAIL = /^[^\s@-][^\s@]{0,200}@[^\s@]{1,200}$/;
const DONE = Symbol('done');

// io: { say(line), step(name, info), code() -> Promise<string|null> } (code: what the user pastes from the browser, null at the end of input).
// opts: { token, email, noBrowser, dir, open (url -> browser name or null), signal (stops the agent) }. Returns { stored } (a token went to the credential store).
// Steps: start, url (info.url, info.browser), code (Claude Code only: a code may be pasted), verify, done.
export async function login(ctx, a, { io, token = false, email, noBrowser = false, dir = process.cwd(), open = ctx.openPrivate ?? openPrivate, signal } = {}) {
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
    argv = execArgv(await ensureContainerAsync(ctx, a, dir), dir, a, cmd);
    env = baseEnv(ctx);
  }
  let secret = null, url = null, buffer = '', child = null, sawUrl;
  const seen = new Promise((r) => { sawUrl = r; });
  const handle = (raw) => {
    const text = clean(raw);
    if (!text.trim()) return;
    const found = token ? text.match(TOKEN_RE) : null;
    if (found) { secret ??= found[0]; io.say('(a token was received and is not shown)'); return; }
    const link = !url && trimEnd(text.match(URL_RE)?.[0]);
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
  const exit = runCommandAsync(argv, { env, cwd: a.mode === 'container' ? dir : undefined, timeout: 10 * 60e3, signal, onOutput, onStart: (stdin) => { child = stdin; } });
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
  const s = await accountStatusAsync(ctx, a, { dir });
  if (s.loggedIn === false) throw new Error(`the sign-in ended but ${a.name} is still not signed in: ${s.findings[0]?.fix ?? 'try again'}`);
  io.step('done', { loggedIn: s.loggedIn, method: s.method });
  return { stored: false, status: s };
}

// The first of base, base-2, base-3 ... that taken does not hold.
const free = (base, taken) => { let n = 1; while (taken(n === 1 ? base : `${base}-${n}`)) n++; return n === 1 ? base : `${base}-${n}`; };
// The local part of an address as a name: 29 characters at most, so a number on a clash still fits. The end is trimmed
// in a loop: /[-_]+$/ takes quadratic time on a long run of dashes.
const slug = (email) => {
  let s = String(email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 29).replace(/^[-_]+/, '');
  while (/[-_]$/.test(s)) s = s.slice(0, -1);
  return s;
};
// Add by sign-in: the agent signs in first, in a new folder below the data folder, and only a signed-in account is registered,
// under a name from its identity (Claude Code's address; Codex prints none, so its name is the agent's with a number).
// The folder keeps its first name: the agent may tie its stored login to the folder path. opts: those of login.
export async function addBySignIn(ctx, agentId, opts) {
  const names = new Set(listAccounts(ctx).map((x) => x.name));
  const a = newAccount(ctx, { name: free(agentId, (n) => names.has(n) || exists(dataDir(ctx, n))), agent: agentId });
  const { status } = await login(ctx, a, opts);
  const taken = new Set(listAccounts(ctx).map((x) => x.name));
  const name = free(slug(status.email) || agentId, (n) => taken.has(n));
  const run = commit(ctx, addChange(ctx, { ...a, name }));
  if (run.status !== 'done') throw new Error(`signed in, but the account was not added: ${run.entries.find((e) => e.error)?.error ?? run.status}. Add it by hand: benchkeeper accounts add ${name} --agent ${agentId} --dir ${a.dir}`);
  return name;
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
