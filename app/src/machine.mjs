// The user's GitHub machine account for agent sessions (#817): a second account the user creates and owns (GitHub's terms,
// B.3, allow one free machine account per person), signed in with gh into a config folder of the app's own, so its token
// stays in gh's store and the app never reads it. Agent sessions commit, push and open pull requests as that account
// through environment variables only: author and committer, a credential helper and signing settings through
// GIT_CONFIG_COUNT pairs, and GH_CONFIG_DIR. Nothing is written to the user's git, gh or shell configuration; the user-level
// agent settings and a project's local settings get the variables only through a plan with a diff and an undo.
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { delimiter, join } from 'node:path';
import { childEnv } from './childenv.mjs';
import { readText, writeAtomic } from './fsx.mjs';
import { git } from './git.mjs';
import { mergeJson, removeToml, setToml } from './merge.mjs';
import { mask } from './redact.mjs';

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[\w.-]{1,100}$/;
// write:ssh_signing_key on top of gh's own minimum (repo, read:org, gist): no workflow scope, so a push that changes
// .github/workflows stays with the user, and no admin scope.
export const SCOPES = ['write:ssh_signing_key'];
const SIGNUP = 'https://github.com/signup';
const DEVICE = 'https://github.com/login/device';
// Every variable a machine setting may write into an agent settings file: removing the setting takes out these names only.
const PAIRS = 8;
export const VARS = ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GH_CONFIG_DIR', 'GIT_CONFIG_COUNT',
  ...Array.from({ length: PAIRS }, (_, i) => [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`]).flat(), 'BENCHKEEPER_MACHINE_EMAIL'];

class MachineError extends Error {
  // A usage error carries 400, which the CLI's lookups read as exit 2.
  constructor(message, { usage = false } = {}) { super(message); this.usage = usage; if (usage) this.status = 400; }
}
const usage = (m) => new MachineError(m, { usage: true });

// ---- files: the machine folder of the config folder

const machineDir = (ctx) => join(ctx.config, 'machine');
export const ghDir = (ctx) => join(machineDir(ctx), 'gh');
export const keyPath = (ctx) => join(machineDir(ctx), 'signing_key');
export const configFile = (ctx) => join(machineDir(ctx), 'machine.json');

// Both accounts by their numeric id, which a rename keeps; the logins are for display and refreshed from gh (machineStatus).
const account = (a) => !!a && Number.isSafeInteger(a.id) && a.id > 0 && LOGIN.test(a.login ?? '');
const valid = (c) => !!c && c.version === 1 && account(c.machine) && account(c.main) && typeof c.gh === 'string' && typeof c.signing === 'boolean';
// The config, null when there is none; a file that is not one throws. Other processes of the user can write it.
export function readConfig(ctx) {
  const text = readText(configFile(ctx));
  if (text == null) return null;
  let c;
  try { c = JSON.parse(text); } catch { c = null; }
  if (!valid(c)) throw new MachineError(`${configFile(ctx)} is not a machine account config: benchkeeper machine remove, then machine setup`);
  return c;
}
const writeConfig = (ctx, c) => writeAtomic(configFile(ctx), `${JSON.stringify(c, null, 2)}\n`, 0o600);
function ready(ctx) {
  const c = readConfig(ctx);
  if (!c) throw usage('no machine account is set up on this machine: benchkeeper machine setup');
  return c;
}

// The name and noreply address of the machine account (the <id>+<login> form of accounts made after July 2017). GitHub links a
// commit to the account by the id in it, so commits stay linked after a rename; the login is the current one.
export const identity = (c) => ({ name: c.machine.login, email: `${c.machine.id}+${c.machine.login}@users.noreply.github.com` });

// ---- gh, as the user and as the machine account

const executable = (p) => existsSync(p);
// The gh on the PATH, as an absolute path: the credential helper runs it from wherever git runs.
const findGh = (path) => String(path ?? '').split(delimiter).filter(Boolean).map((d) => join(d, 'gh')).find(executable) ?? null;
// A token in the environment wins over gh's stored login (gh help environment): the machine's gh gets none, and its own folder.
const TOKENS = /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/i;
// The user's gh: the environment as it is, except the machine's folder when the setup runs inside a machine session.
const userEnv = (ctx, env) => Object.fromEntries(Object.entries(env).filter(([k, v]) => !(k === 'GH_CONFIG_DIR' && v === ghDir(ctx))));
const machineGhEnv = (ctx, env) => ({ ...Object.fromEntries(Object.entries(env).filter(([k]) => !TOKENS.test(k))), GH_CONFIG_DIR: ghDir(ctx) });
const tail = (r) => mask(String(r.stderr || r.stdout || '').trim().split('\n').at(-1) || `exit ${r.code}`).slice(0, 300);
// gh api with JSON out; { ok, json, why }.
function api(ctx, gh, env, args) {
  const r = ctx.run([gh, 'api', ...args], { env, timeout: 60e3 });
  if (r.code !== 0) return { ok: false, why: tail(r) };
  try { return { ok: true, json: r.stdout.trim() ? JSON.parse(r.stdout) : null }; } catch { return { ok: false, why: 'gh answered something that is not JSON' }; }
}
// { login, id } of the account a gh signs in as, or null.
function whoami(ctx, gh, env) {
  const r = api(ctx, gh, env, ['user']);
  return r.ok && LOGIN.test(r.json?.login ?? '') && Number.isSafeInteger(r.json?.id) ? { login: r.json.login, id: r.json.id } : null;
}

// ---- setup

// The repositories to give the machine account access to: --repos, the repositories of --owner (listed with the user's gh,
// archived ones left out), else the folder's origin.
function reposOf(ctx, gh, env, { repos, owner, main, dir }) {
  const named = (repos ?? []).flatMap((r) => r.split(',')).map((r) => r.trim()).filter(Boolean);
  const bad = named.find((r) => !REPO.test(r));
  if (bad) throw usage(`--repos takes owner/name, not ${bad}`);
  if (owner !== undefined && !LOGIN.test(owner)) throw usage('--owner is a GitHub user or organization');
  let listed = [];
  if (owner !== undefined) {
    const paths = owner.toLowerCase() === main.toLowerCase() ? ['user/repos?affiliation=owner&per_page=100'] : [`orgs/${owner}/repos?type=all&per_page=100`, `users/${owner}/repos?per_page=100`];
    let found = null;
    for (const p of paths) {
      const r = ctx.run([gh, 'api', '--paginate', p, '--jq', '.[] | select(.archived | not) | .full_name'], { env, timeout: 120e3 });
      if (r.code === 0) { found = r; break; }
    }
    if (!found) throw new MachineError(`the repositories of ${owner} cannot be listed with your gh login`);
    listed = found.stdout.split('\n').map((l) => l.trim()).filter((l) => REPO.test(l));
  }
  if (!named.length && owner === undefined) {
    const r = git(ctx, dir, ['remote', 'get-url', 'origin'], { env, timeout: 10e3 });
    const m = r.code === 0 && String(r.stdout).trim().match(/^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (m && REPO.test(m[1])) named.push(m[1]);
  }
  return [...new Map([...named, ...listed].map((r) => [r.toLowerCase(), r])).values()];
}

// Write access for the machine account on each repository, with the user's gh (an outside collaborator on an organization's
// repository), then the invitations accepted with the machine's gh. Never admin or maintain. [{ repo, ok, why }].
function grant(ctx, c, repos, { user, machine }) {
  const out = repos.map((repo) => {
    const r = ctx.run([c.gh, 'api', '-X', 'PUT', `repos/${repo}/collaborators/${c.machine.login}`, '-f', 'permission=push'], { env: user, timeout: 60e3 });
    return r.code === 0 ? { repo, ok: true } : { repo, ok: false, why: tail(r) };
  });
  const inv = api(ctx, c.gh, machine, ['user/repository_invitations?per_page=100']);
  const wanted = new Map(out.filter((x) => x.ok).map((x) => [x.repo.toLowerCase(), x]));
  for (const i of inv.ok && Array.isArray(inv.json) ? inv.json : []) {
    const x = wanted.get(String(i?.repository?.full_name ?? '').toLowerCase());
    if (!x || !Number.isSafeInteger(i.id)) continue;
    const a = api(ctx, c.gh, machine, ['-X', 'PATCH', `user/repository_invitations/${i.id}`]);
    if (!a.ok) Object.assign(x, { ok: false, why: `the invitation was not accepted: ${a.why}` });
  }
  if (!inv.ok) for (const x of wanted.values()) Object.assign(x, { ok: false, why: `its invitations cannot be read: ${inv.why}` });
  return out;
}

// An ed25519 key of the machine folder (0600), uploaded as the account's signing key; returns the key's id on GitHub.
function signingKey(ctx, c, machine) {
  const key = keyPath(ctx);
  if (!existsSync(key)) {
    const r = ctx.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', `${c.machine.login} commit signing (BenchKeeper)`, '-f', key], { env: childEnv({}, ctx.env ?? process.env), timeout: 60e3 });
    if (r.code !== 0) throw new MachineError(`ssh-keygen did not create the signing key: ${tail(r)}`);
  }
  chmodSync(key, 0o600);
  const pub = (readText(`${key}.pub`) ?? '').trim().split(/\s+/).slice(0, 2).join(' ');
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+$/.test(pub)) throw new MachineError(`${key}.pub is not an ed25519 public key: delete both files and run machine setup again`);
  const have = api(ctx, c.gh, machine, ['user/ssh_signing_keys?per_page=100']);
  const known = have.ok && Array.isArray(have.json) ? have.json.find((k) => String(k?.key ?? '').trim() === pub) : null;
  if (known) return known.id;
  const r = api(ctx, c.gh, machine, ['-X', 'POST', 'user/ssh_signing_keys', '-f', `title=BenchKeeper ${hostname().split('.')[0]}`, '-f', `key=${pub}`]);
  if (!r.ok) throw new MachineError(`GitHub did not take the signing key: ${r.why}`);
  return r.json?.id ?? null;
}

// The setup. o: { repos, owner, signing, dir, yes }; io: { say(line), open(url), wait(question) -> line or null at the end of
// input, ask(question) -> boolean }. Creating the account is the user's: the terms want an account set up by a person.
export async function setupMachine(ctx, o, io) {
  const env = ctx.env ?? process.env;
  const gh = findGh(env.PATH);
  if (!gh) throw new MachineError('gh is not installed (https://cli.github.com): the machine account signs in with it');
  const user = userEnv(ctx, env), machine = machineGhEnv(ctx, env);
  const main = whoami(ctx, gh, user);
  if (!main) throw usage('sign in to GitHub with your own gh first (gh auth login): the setup reads your login and gives the machine account access with it');
  let who = whoami(ctx, gh, machine);
  if (!who) {
    io.say(`1. Create the machine account in a private window or another browser profile, so your own session stays out: ${SIGNUP}`);
    io.say(`   Suggested login: ${main.login}-agent. Use an address of your own for it, turn on two-factor authentication, and set a profile note such as:`);
    io.say(`   "Machine account of @${main.login}. Its commits and pull requests are made by AI coding agents, supervised by @${main.login}."`);
    io.open(SIGNUP);
    if ((await io.wait('2. Press Enter when the account exists and that window is signed in to it. ')) === null) throw usage('stopped before the sign-in: run benchkeeper machine setup again');
    mkdirSync(ghDir(ctx), { recursive: true, mode: 0o700 });
    io.say(`3. Enter the code gh shows below on ${DEVICE}, in the window signed in as the machine account.`);
    io.open(DEVICE);
    // stdin is no terminal, so gh asks nothing (pkg/cmd/auth/login: Interactive needs a prompt): it does not offer itself as
    // git's credential helper, which would write the user's global git config and add the workflow scope. It prints the
    // code and waits for the browser. GIT_CONFIG_GLOBAL points at a file of the machine folder all the same.
    const r = ctx.run([gh, 'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', SCOPES.join(',')], { env: { ...machine, GIT_CONFIG_GLOBAL: join(machineDir(ctx), 'gitconfig-unused') }, stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.code !== 0) throw new MachineError('gh did not sign in the machine account: run benchkeeper machine setup again');
    who = whoami(ctx, gh, machine);
    if (!who) throw new MachineError('gh signed in, but the account cannot be read: run benchkeeper machine setup again');
    // gh keeps one "active" keyring entry per host for every config folder; a gh of an older setup falls back to it.
    if (whoami(ctx, gh, user)?.id === who.id) io.say(`warning: your own gh now answers as ${who.login}: sign in again with gh auth login (as ${main.login})`);
  }
  if (who.id === main.id) {
    ctx.run([gh, 'auth', 'logout', '--hostname', 'github.com', '--user', who.login], { env: machine, timeout: 60e3 });
    throw new MachineError(`the account signed in is your own (${main.login}), not a machine account: it was signed out of BenchKeeper's gh folder; run machine setup again and sign in as the machine account`);
  }
  const prev = readConfig(ctx);
  let c = { version: 1, machine: who, main, gh, signing: o.signing !== false, created: prev?.created ?? new Date().toISOString() };
  writeConfig(ctx, c);
  io.say(`signed in as ${who.login} in ${ghDir(ctx)} (gh keeps the token; BenchKeeper never reads it)`);
  const repos = reposOf(ctx, gh, user, { ...o, main: main.login });
  let access = [];
  if (repos.length) {
    io.say(`write access for ${who.login} (never admin or maintain) on:\n${repos.map((r) => `  ${r}`).join('\n')}`);
    if (o.yes || (await io.ask(`Invite ${who.login} to ${repos.length} ${repos.length === 1 ? 'repository' : 'repositories'} and accept with it?`))) access = grant(ctx, c, repos, { user, machine });
  } else io.say('no repository named: give access later with machine setup --repos owner/name or --owner <user or organization>');
  if (c.signing) {
    c = { ...c, signingKey: signingKey(ctx, c, machine) };
    writeConfig(ctx, c);
  }
  return { ...identity(c), main: main.login, signing: c.signing, access };
}

// ---- the environment of machine sessions

// One quoted word for the shell git runs a helper with.
const sq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
// The variables that make git and gh act as the machine account:
// - author and committer;
// - GIT_CONFIG_COUNT pairs (git-config(1), ENVIRONMENT): an empty helper first resets the credential helpers of every config
//   file for https://github.com, then gh's helper with the machine folder; pushes to an ssh address of github.com go over
//   https (pushInsteadOf); with signing, ssh signing with the machine's key;
// - GH_CONFIG_DIR, so every gh call signs in as the machine account;
// - the machine's address, which the guard hook reads.
export function machineEnv(ctx, c = ready(ctx)) {
  const id = identity(c);
  const pairs = [['credential.https://github.com.helper', ''], ['credential.https://github.com.helper', `!GH_CONFIG_DIR=${sq(ghDir(ctx))} ${sq(c.gh)} auth git-credential`],
    ['url.https://github.com/.pushInsteadOf', 'git@github.com:'], ['url.https://github.com/.pushInsteadOf', 'ssh://git@github.com/'],
    ...(c.signing ? [['gpg.format', 'ssh'], ['user.signingkey', keyPath(ctx)], ['commit.gpgsign', 'true']] : [])];
  return {
    GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email, GH_CONFIG_DIR: ghDir(ctx),
    GIT_CONFIG_COUNT: String(pairs.length), ...Object.fromEntries(pairs.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])),
    BENCHKEEPER_MACHINE_EMAIL: id.email,
  };
}

// The variables that give the user's own identity back in a project, over machine values set for the user (machine enable
// --global): the user's global git name and address, gh's default folder ($XDG_CONFIG_HOME/gh, else ~/.config/gh), no
// GIT_CONFIG pairs, and no machine address for the guard.
export function ownEnv(ctx) {
  const env = ctx.env ?? process.env;
  const get = (k) => String(git(ctx, ctx.home, ['config', '--global', '--get', k], { env, timeout: 10e3 }).stdout ?? '').trim();
  const name = get('user.name'), email = get('user.email');
  if (!name || !email) throw new MachineError('your git identity is not set globally (git config --global user.name and user.email): the project cannot be given it back');
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GH_CONFIG_DIR: join(env.XDG_CONFIG_HOME || join(ctx.home, '.config'), 'gh'), GIT_CONFIG_COUNT: '0', BENCHKEEPER_MACHINE_EMAIL: '' };
}

// A settings.json text with the machine variables replaced by vars (null: taken out); other env keys stay.
export const withVars = (text, vars, file) => mergeJson(text, [...VARS.map((k) => ({ path: ['env', k], remove: true })), ...Object.entries(vars ?? {}).map(([k, v]) => ({ path: ['env', k], value: v })), { path: ['env'], prune: true }], file);
// The same for Codex's config.toml: [shell_environment_policy.set] holds what Codex adds to the environment of its commands.
const CODEX_TABLE = 'shell_environment_policy.set';
export const withCodexVars = (text, vars) => Object.entries(vars ?? {}).reduce((t, [k, v]) => setToml(t, CODEX_TABLE, k, v), VARS.reduce((t, k) => removeToml(t, CODEX_TABLE, k), text ?? ''));

// The changes of machine enable|disable --global: Claude Code's user settings and Codex's config, where the agent's folder exists.
export function globalChanges(ctx, on) {
  const vars = on ? machineEnv(ctx) : null;
  const files = [['claude', join(ctx.home, '.claude'), 'settings.json', (t) => withVars(t, vars, 'settings.json')], ['codex', join(ctx.home, '.codex'), 'config.toml', (t) => withCodexVars(t, vars)]];
  return files.filter(([, d]) => existsSync(d)).map(([agent, d, f, edit]) => ({ step: 'machine', title: `${agent === 'claude' ? 'Claude Code' : 'Codex'}: ${on ? 'agent sessions commit, push and use gh as the machine account' : 'the machine account variables taken out'} (${join(d, f)})`, kind: 'write', path: join(d, f), edit }));
}

// The trailers of a Claude Code commit, through its commit attribution setting for this one launch (--settings takes inline
// JSON and overrides the same keys of the settings files for the session): no hook in the repository, no settings file.
export const trailerArgs = (host, role) => ['--settings', JSON.stringify({ attribution: { commit: `Agent-Host: ${host}\nAgent-Role: ${role}` } })];
export const hostSlug = (h = hostname()) => String(h).split('.')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'host';

// The environment of `machine shell`: the user's own, without a GitHub token or -c settings of an outer git, plus the machine's.
export function shellEnv(ctx) {
  const env = ctx.env ?? process.env;
  // The -c pairs of an outer git go; GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM and GIT_CONFIG_NOSYSTEM (which config files git reads) stay.
  const own = Object.fromEntries(Object.entries(env).filter(([k]) => !TOKENS.test(k) && !/^(GIT_ASKPASS|SSH_ASKPASS|GIT_CONFIG_(COUNT|PARAMETERS|KEY_\d+|VALUE_\d+))$/i.test(k)));
  return { ...own, ...machineEnv(ctx) };
}

// ---- status, doctor and remove

// { config, signedIn: { id, login } or null, renamed: [old, new] or null, key } for status, doctor and a session start; gh is
// asked only when a config exists. A login that changed for the same id is written back: the address follows it.
export function machineStatus(ctx) {
  const c = readConfig(ctx);
  if (!c) return { config: null, signedIn: null, renamed: null, key: false };
  const env = ctx.env ?? process.env, who = whoami(ctx, c.gh, machineGhEnv(ctx, env));
  let config = c, renamed = null;
  if (who?.id === c.machine.id && who.login !== c.machine.login) {
    renamed = [c.machine.login, who.login];
    config = { ...c, machine: who };
  }
  const main = whoami(ctx, c.gh, userEnv(ctx, env));
  if (main?.id === c.main.id && main.login !== c.main.login) config = { ...config, main };
  if (config !== c) writeConfig(ctx, config);
  return { config, signedIn: who, renamed, key: existsSync(keyPath(ctx)) };
}

export function machineChecks(ctx) {
  const issue = (level, message, fix) => ({ level, check: 'machine', message, fix });
  let s;
  try { s = machineStatus(ctx); } catch (e) { return [issue('warning', e.message, 'benchkeeper machine remove, then machine setup')]; }
  const c = s.config;
  if (!c) return [];
  const out = [];
  if (!s.signedIn) out.push(issue('warning', `the machine account ${c.machine.login} is not signed in in ${ghDir(ctx)}`, 'benchkeeper machine setup'));
  else if (s.signedIn.id === c.main.id) out.push(issue('error', `BenchKeeper's gh folder is signed in as your own account ${c.main.login}, not the machine account`, 'benchkeeper machine remove, then machine setup'));
  else if (s.signedIn.id !== c.machine.id) out.push(issue('warning', `BenchKeeper's gh folder is signed in as ${s.signedIn.login}, not the machine account ${c.machine.login} of the config`, 'benchkeeper machine remove, then machine setup'));
  if (s.renamed) out.push(issue('info', `the machine account was renamed from ${s.renamed[0]} to ${s.renamed[1]}: new sessions use the new login; earlier commits stay linked by its id`, 'benchkeeper machine enable --global again, and projects apply for a project with --machine on, to write the new address into the agent settings'));
  if (c.signing && !s.key) out.push(issue('warning', `signing is on, but the machine account's key ${keyPath(ctx)} is missing`, 'benchkeeper machine setup (creates and uploads a new key)'));
  const env = ctx.env ?? process.env;
  if (env.BENCHKEEPER_MACHINE_EMAIL && Object.keys(env).some((k) => TOKENS.test(k))) out.push(issue('warning', 'a GitHub token variable is set in this environment: gh uses it instead of the machine account', 'unset GH_TOKEN and GITHUB_TOKEN where they are exported'));
  out.push(issue('info', `two-factor authentication of ${c.machine.login} cannot be checked from here`, `check it at https://github.com/settings/security signed in as ${c.machine.login}`));
  return out;
}

// Pages for what the app cannot do: the signing key and the account are deleted on GitHub, signed in as the machine account.
export const PAGES = { keys: 'https://github.com/settings/keys', account: 'https://github.com/settings/admin' };

// Signs the machine account out of the app's gh folder and deletes the folder with the key and config, only once gh no longer
// answers as an account there: a folder deleted with the login still in the keyring would leave a token nobody signs out.
// The caller takes the variables out of the agent settings after it (a plan of its own).
export function removeMachine(ctx) {
  let c = null;
  try { c = readConfig(ctx); } catch { /* a broken file goes too */ }
  const env = ctx.env ?? process.env, gh = c?.gh ?? findGh(env.PATH), machine = machineGhEnv(ctx, env);
  if (gh && existsSync(ghDir(ctx))) {
    ctx.run([gh, 'auth', 'logout', '--hostname', 'github.com', ...(c ? ['--user', c.machine.login] : [])], { env: machine, timeout: 60e3 });
    if (whoami(ctx, gh, machine)) throw new MachineError(`gh did not sign the machine account out of ${ghDir(ctx)}; nothing was deleted: run GH_CONFIG_DIR=${ghDir(ctx)} gh auth logout --hostname github.com, then benchkeeper machine remove again`);
  }
  rmSync(machineDir(ctx), { recursive: true, force: true });
  return c;
}
