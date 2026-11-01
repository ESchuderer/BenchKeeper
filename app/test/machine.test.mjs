// The user's GitHub machine account (machine.mjs): setup against a fake gh (a stand-in for every gh call, keyed by the
// GH_CONFIG_DIR it gets), the session variables with real git in temporary homes, the project and global settings, the
// guard. No real gh login, account, token, keychain or git config.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { initRepo } from './helpers.mjs';
import { machine as accountsMachine, win } from './fixtures/accounts.mjs';
import { SCOPES, VARS, configFile, ghDir, identity, keyPath, machineChecks, machineEnv, ownEnv, readConfig, withCodexVars, withVars } from '../src/machine.mjs';
import { main } from '../src/cli.mjs';
import { decide, denyReason } from '../src/guard-hook.mjs';
import { apply, context, preview, runCommand, undo } from '../src/runner.mjs';
import { projectPlan, readState } from '../src/steps/project.mjs';

const GIT = ['/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git'].find((p) => existsSync(p));
const MAIN = { id: 1001, login: 'octo' }, AGENT = { id: 2002, login: 'octo-agent' };
const EMAIL = '2002+octo-agent@users.noreply.github.com';
const sh = { skip: win && 'sh helpers and ssh-keygen' };

// A home with a gh on its PATH (the file only has to exist: every gh call goes to the fake below) and a git identity.
function machine({ signedIn = false, as = AGENT, failing = [], owned = [] } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bk-machine-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const gitconfig = join(home, '.gitconfig');
  writeFileSync(gitconfig, '[user]\n\tname = Octo Cat\n\temail = octo@example.com\n[credential]\n\thelper = osxkeychain\n');
  const gh = { signedIn, as, main: MAIN, calls: [], invitations: [], keys: [], failing, owned, nextId: 50 };
  const ctx = context({ home });
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: gitconfig, GIT_CONFIG_NOSYSTEM: '1', GH_TOKEN: 'dummy-user-token' };
  const json = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: '' });
  ctx.env = env;
  ctx.run = (argv, o = {}) => {
    if (!argv[0].endsWith('/gh')) return runCommand(argv, o);
    const mine = o.env?.GH_CONFIG_DIR === ghDir(ctx), args = argv.slice(1);
    gh.calls.push({ args, machine: mine, env: o.env, stdio: o.stdio });
    const who = mine ? (gh.signedIn ? gh.as : null) : gh.main;
    // gh's hosts.yml in the folder names the login while it is signed in.
    const hosts = join(ghDir(ctx), 'hosts.yml');
    if (args[0] === 'auth' && args[1] === 'login') { gh.signedIn = true; writeFileSync(hosts, `github.com:\n    user: ${gh.as.login}\n`); return { code: 0, stdout: '', stderr: '' }; }
    if (args[0] === 'auth' && args[1] === 'logout') {
      if (gh.stuck || !gh.signedIn) return { code: 1, stdout: '', stderr: gh.stuck ? 'keyring locked' : 'not logged in to github.com' };
      gh.signedIn = false;
      rmSync(hosts, { force: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args.join(' ') === 'api user') return who ? json(who) : { code: 1, stdout: '', stderr: 'gh auth login' };
    if (args[1] === '--paginate') return args[2].startsWith('orgs/acme') || args[2].startsWith('user/repos') ? { code: 0, stdout: `${gh.owned.join('\n')}\n`, stderr: '' } : { code: 1, stdout: '', stderr: 'HTTP 404' };
    if (args[1] === '-X' && args[2] === 'PUT') {
      const repo = args[3].split('/').slice(1, 3).join('/');
      if (gh.failing.includes(repo)) return { code: 1, stdout: '', stderr: 'gh: Must have admin rights to Repository. (HTTP 403)' };
      gh.invitations.push({ id: (gh.nextId += 1), repository: { full_name: repo } });
      return json({ id: gh.nextId });
    }
    if (args[1] === 'user/repository_invitations?per_page=100') return json(gh.invitations);
    if (args[2] === 'PATCH') { gh.invitations = gh.invitations.filter((i) => `user/repository_invitations/${i.id}` !== args[3]); return { code: 0, stdout: '', stderr: '' }; }
    if (args[1] === 'user/ssh_signing_keys?per_page=100') return json(gh.keys);
    if (args[2] === 'POST' && args[3] === 'user/ssh_signing_keys') { const k = { id: 77, key: args[7].slice(4) }; gh.keys.push(k); return json(k); }
    return { code: 1, stdout: '', stderr: `fake gh: ${args.join(' ')}` };
  };
  return { ctx, gh, home, bin, env, gitconfig };
}

async function cli(m, args, { lines = [] } = {}) {
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  const opened = [];
  m.ctx.openUrl = (u) => { opened.push(u); return 'file'; };
  const code = await main(args, { out, err: out, ctx: m.ctx, input: Readable.from(lines.map((l) => `${l}\n`)) });
  return { code, text, opened };
}

// A machine whose setup finished, as setup leaves it.
function ready(m = machine({ signedIn: true }), signing = false) {
  mkdirSync(ghDir(m.ctx), { recursive: true });
  writeFileSync(join(ghDir(m.ctx), 'hosts.yml'), `github.com:\n    user: ${AGENT.login}\n`);
  writeFileSync(configFile(m.ctx), JSON.stringify({ version: 1, machine: AGENT, main: MAIN, gh: join(m.bin, 'gh'), signing }));
  return m;
}

test('machine setup: you create the account, gh signs it in into the app\'s own folder, access and a signing key follow', sh, async () => {
  const m = machine({ failing: ['acme/tool'] });
  const r = await cli(m, ['machine', 'setup', '--repos', 'octo/proj,acme/tool'], { lines: ['', 'y'] });
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /Suggested login: octo-agent\./);
  assert.match(r.text, /Machine account of @octo\. Its commits and pull requests are made by AI coding agents, supervised by @octo\./);
  assert.match(r.text, /private window or another browser profile/);
  assert.deepEqual(r.opened, ['https://github.com/signup', 'https://github.com/login/device']);
  // The sign-in: the machine folder, no question from gh (stdin is no terminal), no token of the user, the one extra scope.
  const login = m.gh.calls.find((c) => c.args[1] === 'login');
  assert.deepEqual(login.args, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--scopes', 'write:ssh_signing_key']);
  assert.deepEqual(SCOPES, ['write:ssh_signing_key']);
  assert.deepEqual([login.machine, login.stdio[0], login.env.GH_TOKEN, login.env.GIT_CONFIG_GLOBAL.startsWith(join(m.ctx.config, 'machine'))], [true, 'ignore', undefined, true]);
  // Write access with the user's gh, never admin; the invitation accepted with the machine's; a refused repository named with the fix.
  const puts = m.gh.calls.filter((c) => c.args[2] === 'PUT');
  assert.deepEqual(puts.map((c) => [c.args.slice(3).join(' '), c.machine]), [['repos/octo/proj/collaborators/octo-agent -f permission=push', false], ['repos/acme/tool/collaborators/octo-agent -f permission=push', false]]);
  assert.ok(m.gh.calls.some((c) => c.args[2] === 'PATCH' && c.machine));
  assert.deepEqual(m.gh.invitations, []);
  assert.match(r.text, /write access: octo\/proj\nno access to acme\/tool: gh: Must have admin rights .* an owner adds octo-agent with the Write role, or the agent works through a fork/);
  // The config keeps both accounts by id; the key is the machine folder's, private, and uploaded as a signing key.
  assert.deepEqual([readConfig(m.ctx).machine, readConfig(m.ctx).main, readConfig(m.ctx).signing], [AGENT, MAIN, true]);
  assert.equal(statSync(keyPath(m.ctx)).mode & 0o777, 0o600);
  assert.equal(m.gh.keys.length, 1);
  assert.match(m.gh.keys[0].key, /^ssh-ed25519 /);
  assert.match(r.text, /machine account ready: octo-agent <2002\+octo-agent@users\.noreply\.github\.com>, commits signed with its ssh key/);
  assert.ok(!r.text.includes('dummy-user-token'));
  assert.equal(readFileSync(m.gitconfig, 'utf8'), '[user]\n\tname = Octo Cat\n\temail = octo@example.com\n[credential]\n\thelper = osxkeychain\n', 'the user\'s git config is untouched');
  // Again: no new sign-in, the key is known, the repositories of an organization after a question.
  m.gh.owned = ['acme/a', 'acme/b'];
  const again = await cli(m, ['machine', 'setup', '--owner', 'acme', '--no-browser'], { lines: ['n'] });
  assert.equal(again.code, 0, again.text);
  assert.equal(m.gh.calls.filter((c) => c.args[1] === 'login').length, 1);
  assert.equal(m.gh.keys.length, 1);
  assert.match(again.text, /write access for octo-agent \(never admin or maintain\) on:\n {2}acme\/a\n {2}acme\/b/);
  assert.equal(m.gh.calls.filter((c) => c.args[2] === 'PUT').length, 2, 'no answer, no invitation');
  const all = await cli(m, ['machine', 'setup', '--owner', 'acme', '--no-signing', '--yes']);
  assert.equal(all.code, 0, all.text);
  assert.equal(readConfig(m.ctx).signing, false);
  // Without --repos or --owner: the folder's GitHub origin, or none with the way to name them later.
  const dir = mkdtempSync(join(tmpdir(), 'bk-machine-origin-'));
  initRepo(dir);
  spawnSync(GIT, ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:octo/other.git']);
  assert.equal((await cli(m, ['machine', 'setup', '--project', dir, '--yes', '--no-signing'])).code, 0);
  assert.equal(m.gh.calls.at(-3).args[3], 'repos/octo/other/collaborators/octo-agent');
  assert.match((await cli(m, ['machine', 'setup', '--project', m.home, '--no-signing'])).text, /no repository named: give access later/);
});

test('machine setup refuses: no gh, your own gh signed out, your own account signed in as the machine, no answer', async () => {
  const none = machine();
  none.ctx.env.PATH = '/nonexistent';
  assert.match((await cli(none, ['machine', 'setup'])).text, /gh is not installed/);
  const out = machine();
  out.gh.main = null;
  const o = await cli(out, ['machine', 'setup']);
  assert.deepEqual([o.code, /sign in to GitHub with your own gh first/.test(o.text)], [2, true]);
  const self = machine({ as: MAIN });
  const s = await cli(self, ['machine', 'setup', '--repos', 'octo/proj'], { lines: [''] });
  assert.equal(s.code, 1);
  assert.match(s.text, /the account signed in is your own \(octo\), not a machine account/);
  assert.equal(self.gh.signedIn, false, 'signed out again');
  assert.equal(existsSync(configFile(self.ctx)), false);
  const quiet = machine();
  assert.equal((await cli(quiet, ['machine', 'setup'])).code, 2, 'the end of the input stops before the sign-in');
  assert.equal(quiet.gh.calls.some((c) => c.args[1] === 'login'), false);
  assert.match((await cli(machine({ signedIn: true }), ['machine', 'setup', '--repos', 'not-a-repo'])).text, /--repos takes owner\/name/);
  assert.match((await cli(machine({ signedIn: true }), ['machine', 'setup', '--owner', 'nobody'])).text, /cannot be listed/);
  assert.match((await cli(machine({ signedIn: true }), ['machine', 'setup', '--owner=-x'])).text, /--owner is a GitHub user/);
});

test('machine session variables: author, committer, gh\'s helper alone, signing, the machine\'s gh folder; nothing written to git, gh or shell config', { skip: win && 'ssh-keygen and sh helpers' }, () => {
  const m = ready(undefined, true);
  // Stands in for gh as git's helper: git runs "<gh> auth git-credential get" with the machine folder set.
  writeFileSync(join(m.bin, 'gh'), '#!/bin/sh\n[ "$GH_CONFIG_DIR" = "$EXPECT" ] && printf "username=x-access-token\\npassword=machine-token\\n"\n');
  assert.equal(runCommand(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', keyPath(m.ctx)]).code, 0);
  const env = machineEnv(m.ctx);
  assert.deepEqual([env.GIT_AUTHOR_NAME, env.GIT_COMMITTER_EMAIL, env.GH_CONFIG_DIR, env.BENCHKEEPER_MACHINE_EMAIL], ['octo-agent', EMAIL, ghDir(m.ctx), EMAIL]);
  assert.ok(Object.keys(env).every((k) => VARS.includes(k)), 'every variable is one removal takes out');
  assert.equal(env.GH_TOKEN, undefined);
  const dir = mkdtempSync(join(tmpdir(), 'bk-machine-repo-'));
  const g = (args, input) => spawnSync(GIT, ['-C', dir, ...args], { env: { ...m.env, GH_TOKEN: undefined, ...env, EXPECT: ghDir(m.ctx), GIT_TERMINAL_PROMPT: '0' }, input, encoding: 'utf8' });
  g(['init', '-q']);
  const fill = g(['credential', 'fill'], 'protocol=https\nhost=github.com\n\n');
  assert.equal(fill.stdout, 'protocol=https\nhost=github.com\nusername=x-access-token\npassword=machine-token\n', fill.stderr);
  writeFileSync(join(dir, 'a'), 'a');
  g(['add', 'a']);
  const c = g(['commit', '-qm', 'x']);
  assert.equal(c.status, 0, c.stderr);
  const commit = g(['cat-file', 'commit', 'HEAD']).stdout;
  assert.match(commit, /^author octo-agent <2002\+octo-agent@users\.noreply\.github\.com>/m);
  assert.match(commit, /^committer octo-agent </m);
  assert.match(commit, /^gpgsig -----BEGIN SSH SIGNATURE-----/m);
  g(['remote', 'add', 'origin', 'git@github.com:octo/proj.git']);
  assert.equal(g(['remote', 'get-url', '--push', 'origin']).stdout.trim(), 'https://github.com/octo/proj.git');
  assert.equal(readFileSync(m.gitconfig, 'utf8').includes('octo-agent'), false);
  assert.equal(existsSync(join(m.home, '.config/gh')), false);
});

test('a project set to off gets your own identity and gh back over the global machine variables', { skip: win && 'sh helpers' }, () => {
  const m = ready();
  const user = machineEnv(m.ctx), own = ownEnv(m.ctx);
  assert.deepEqual(own, { GIT_AUTHOR_NAME: 'Octo Cat', GIT_AUTHOR_EMAIL: 'octo@example.com', GIT_COMMITTER_NAME: 'Octo Cat', GIT_COMMITTER_EMAIL: 'octo@example.com', GH_CONFIG_DIR: join(m.home, '.config/gh'), GIT_CONFIG_COUNT: '0', BENCHKEEPER_MACHINE_EMAIL: '' });
  // Claude Code applies the local value of a variable over the user one (settings precedence): the session sees this.
  const session = { ...m.env, ...user, ...own };
  const dir = mkdtempSync(join(tmpdir(), 'bk-machine-off-'));
  const g = (args) => spawnSync(GIT, ['-C', dir, ...args], { env: session, encoding: 'utf8' });
  g(['init', '-q']);
  assert.match(g(['var', 'GIT_AUTHOR_IDENT']).stdout, /^Octo Cat <octo@example\.com>/);
  assert.equal(g(['config', '--get-all', 'credential.helper']).stdout, 'osxkeychain\n', 'the helpers of the user\'s config');
  assert.equal(g(['config', '--get-all', 'credential.https://github.com.helper']).stdout, '');
  assert.equal(denyReason('git config user.email me@example.com', 0, session), null, 'the guard is off');
  m.ctx.env.XDG_CONFIG_HOME = join(m.home, 'xdg');
  assert.equal(ownEnv(m.ctx).GH_CONFIG_DIR, join(m.home, 'xdg/gh'));
  writeFileSync(m.gitconfig, '');
  assert.throws(() => ownEnv(m.ctx), /your git identity is not set globally/);
});

test('settings files: the machine variables in and out, other keys kept; Codex shell_environment_policy.set', () => {
  const m = ready();
  const env = machineEnv(m.ctx);
  const text = withVars('{\n  "env": { "KEEP": "1" },\n  "model": "x"\n}\n', env, 'settings.json');
  assert.deepEqual(JSON.parse(text).env, { KEEP: '1', ...env });
  assert.deepEqual(JSON.parse(withVars(text, null)), { env: { KEEP: '1' }, model: 'x' });
  assert.deepEqual(JSON.parse(withVars(withVars('{}', env), null)), {});
  const toml = withCodexVars('model = "o"\n', env);
  assert.match(toml, /\[shell_environment_policy\.set\]\nGIT_AUTHOR_NAME = "octo-agent"/);
  assert.equal(withCodexVars(toml, null).trim().split('\n')[0], 'model = "o"');
  assert.doesNotMatch(withCodexVars(toml, null), /GIT_AUTHOR/);
});

test('machine enable and disable --global: a plan with a diff for Claude Code and Codex, undo restores the files', async () => {
  const m = ready();
  assert.equal((await cli(m, ['machine', 'enable'])).code, 2);
  assert.match((await cli(m, ['machine', 'enable', '--global', '--yes'])).text, /neither ~\/\.claude nor ~\/\.codex exists/);
  mkdirSync(join(m.home, '.claude'));
  mkdirSync(join(m.home, '.codex'));
  writeFileSync(join(m.home, '.claude/settings.json'), '{ "env": { "KEEP": "1" } }\n');
  assert.equal((await cli(m, ['machine', 'enable', '--global'], { lines: ['n', 'n'] })).code, 1, 'declined');
  assert.equal(readFileSync(join(m.home, '.claude/settings.json'), 'utf8'), '{ "env": { "KEEP": "1" } }\n');
  const on = await cli(m, ['machine', 'enable', '--global', '--yes']);
  assert.equal(on.code, 0, on.text);
  assert.equal(JSON.parse(readFileSync(join(m.home, '.claude/settings.json'), 'utf8')).env.GIT_AUTHOR_EMAIL, EMAIL);
  assert.match(readFileSync(join(m.home, '.codex/config.toml'), 'utf8'), /GH_CONFIG_DIR = /);
  assert.match((await cli(m, ['machine', 'enable', '--global', '--yes'])).text, /already have the machine account/);
  const run = on.text.match(/undo with benchkeeper undo (\S+)/)[1];
  assert.equal(undo(run, m.ctx).status, 'done');
  assert.equal(readFileSync(join(m.home, '.claude/settings.json'), 'utf8'), '{ "env": { "KEEP": "1" } }\n');
  await cli(m, ['machine', 'enable', '--global', '--yes']);
  assert.equal((await cli(m, ['machine', 'disable', '--global', '--yes'])).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(m.home, '.claude/settings.json'), 'utf8')), { env: { KEEP: '1' } });
  assert.match((await cli(m, ['machine', 'disable', '--global', '--yes'])).text, /have no machine account variables/);
});

test('projects apply --machine on|off|none: the local settings only, kept in the state, undo restores', () => {
  const m = ready();
  const dir = mkdtempSync(join(tmpdir(), 'bk-machine-proj-'));
  initRepo(dir);
  const ctx = { ...m.ctx, roots: [m.home, dir] };
  const go = (answers) => { const p = projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', guards: false, ...answers }, plugins: { claude: [], codex: [] } }); return apply(preview(p.changes), ctx, { scope: dir, select: p.changes.filter((c) => c.kind !== 'command').map((c) => c.id) }); };
  const local = () => JSON.parse(readFileSync(join(dir, '.claude/settings.local.json'), 'utf8')).env;
  go({ machine: 'on' });
  assert.equal(local().GIT_AUTHOR_EMAIL, EMAIL);
  assert.equal(readState(dir).machine, 'on');
  assert.match(readFileSync(join(dir, '.git/info/exclude'), 'utf8'), /\.claude\/settings\.local\.json/);
  go({ machine: 'off' });
  assert.deepEqual([local().GIT_AUTHOR_EMAIL, local().GIT_CONFIG_COUNT, local().BENCHKEEPER_MACHINE_EMAIL], ['octo@example.com', '0', '']);
  const gone = go({ machine: 'none' });
  assert.equal(local()?.GIT_AUTHOR_EMAIL, undefined);
  assert.equal(readState(dir).machine, undefined);
  // Undo of that run gives the project its off setting back.
  assert.equal(undo(gone.id, ctx).status, 'done');
  assert.deepEqual([local().GIT_AUTHOR_EMAIL, readState(dir).machine], ['octo@example.com', 'off']);
  assert.throws(() => projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host-agent', machine: 'maybe' }, plugins: { claude: [], codex: [] } }), /machine must be on, off or none/);
  // Without a machine account the change cannot be made and says why.
  const bare = { ...context({ home: mkdtempSync(join(tmpdir(), 'bk-machine-bare-')) }), roots: [dir] };
  const p = projectPlan({ ctx: bare, dir, answers: { agents: ['claude'], env: 'host-agent', machine: 'on' }, plugins: { claude: [], codex: [] } });
  assert.match(preview(p.changes).find((c) => c.step === 'machine').error, /no machine account is set up/);
});

test('run --as-machine: the account\'s environment plus the machine\'s, Claude Code trailers, no GH_TOKEN; host accounts only', { skip: win && 'the fake agents are shell scripts' }, async () => {
  const am = accountsMachine({ flow: 'callback' });
  const m = ready({ ctx: am.ctx, bin: join(am.root, 'bin'), home: am.home, env: am.env });
  writeFileSync(join(am.root, 'bin', 'gh'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(am.root, 'bin', 'gh'), 0o755);
  const exec = (args) => cli(m, args);
  await exec(['accounts', 'add', 'work', '--agent', 'claude', '--yes']);
  await exec(['accounts', 'login', 'work']);
  const before = am.calls().length;
  const r = await exec(['run', '--account', 'work', '--as-machine', '--', 'claude', '-p', 'hi']);
  assert.equal(r.code, 0, r.text);
  const launch = am.calls().slice(before).find((x) => x.args.includes('hi'));
  assert.deepEqual([launch.args[0], launch.args.slice(2)], ['--settings', ['-p', 'hi']]);
  assert.match(JSON.parse(launch.args[1]).attribution.commit, /^Agent-Host: [a-z0-9-]+\nAgent-Role: orchestrator$/);
  assert.deepEqual([launch.env.GIT_AUTHOR_EMAIL, launch.env.GH_CONFIG_DIR, launch.env.GH_TOKEN, launch.env.CLAUDE_CONFIG_DIR], [EMAIL, ghDir(m.ctx), undefined, join(am.home, '.local/share/benchkeeper/accounts/work')]);
  const plain = am.calls().length;
  await exec(['run', '--account', 'work', '--', 'claude', '-p', 'plain']);
  const p = am.calls().slice(plain).find((x) => x.args.includes('plain'));
  assert.deepEqual([p.args, p.env.GIT_AUTHOR_EMAIL, p.env.BENCHKEEPER_MACHINE_EMAIL], [['-p', 'plain'], undefined, undefined]);
  assert.equal((await exec(['run', '--role', 'worker', '--', 'claude'])).code, 2);
  assert.equal((await exec(['run', '--account', 'work', '--as-machine', '--role', 'boss', '--', 'claude'])).code, 2);
  await exec(['accounts', 'add', 'dev', '--agent', 'codex', '--yes']);
  await exec(['accounts', 'login', 'dev']);
  const cx = am.calls().length;
  await exec(['run', '--account', 'dev', '--as-machine', '--role', 'worker', '--', 'codex', 'go']);
  assert.deepEqual(am.calls().slice(cx).find((x) => x.args.includes('go')).args, ['go']);
  await exec(['accounts', 'add', 'box', '--agent', 'claude', '--container', '--mount', '/home/node/.claude-box', '--yes']);
  assert.match((await exec(['run', '--account', 'box', '--as-machine', '--', 'claude'])).text, /--as-machine needs a host account/);
  const none = accountsMachine({ flow: 'callback' });
  await cli({ ctx: none.ctx }, ['accounts', 'add', 'w', '--agent', 'claude', '--yes']);
  assert.equal((await cli({ ctx: none.ctx }, ['run', '--as-machine', '--', 'claude'])).code, 2);
});

test('guard hook in a machine account session: denies another identity and an approving review, lets a commit as the machine pass', () => {
  const env = { BENCHKEEPER_MACHINE_EMAIL: EMAIL, GIT_AUTHOR_EMAIL: EMAIL, GIT_COMMITTER_EMAIL: EMAIL };
  const denied = ['git commit --author "Me <me@example.com>" -m x', 'git commit --author=me -m x', 'git -c user.email=me@example.com commit -m x', 'git -c credential.helper= push',
    'git --config-env=user.name=NAME commit -m x', 'git config user.email me@example.com', 'git config --global user.name Me', 'git config set user.email me@example.com', 'git config --unset user.email',
    'GIT_AUTHOR_EMAIL=me@example.com git commit -m x', 'env GIT_COMMITTER_NAME=me git commit -m x', 'export GIT_AUTHOR_EMAIL=me@example.com', 'unset GIT_CONFIG_COUNT', 'GH_CONFIG_DIR=~/.config/gh gh pr create',
    'bash -c "git -c user.name=x commit"', 'gh pr review 12 --approve', 'gh pr review -a', 'gh api repos/o/r/pulls/12/reviews -f event=APPROVE', 'gh api -X POST repos/o/r/pulls/12/reviews --field=event=approve', 'gh api repos/o/r/pulls/12/reviews --input review.json',
    'gh pr -R octo/proj review 12 --approve', 'gh pr --repo octo/proj review 12 -a', 'gh pr review 12 -R=octo/proj --approve', 'gh pr review 12 --repo=octo/proj -b ok -a', 'gh pr review 12 --approve=true',
    'gh api -f event=APPROVE -X POST repos/o/r/pulls/12/reviews', 'gh api --raw-field event=APPROVE repos/o/r/pulls/12/reviews', 'gh api -X POST -F event=approve repos/o/r/pulls/12/reviews/', 'gh api repos/o/r/pulls/12/reviews -F event=@review-event.txt'];
  for (const c of denied) assert.ok(denyReason(c, 0, env)?.machine, c);
  const fine = ['git commit -m "fix: x"', 'git push origin feat', 'git config user.email', 'git config get user.email', 'git config --get user.name', 'git config core.editor vim', 'git -c core.pager=cat log', 'export PATH=/x', 'git status',
    'gh pr review 12 --comment -b "looks fine"', 'gh api repos/o/r/pulls/12/reviews -f event=COMMENT', 'gh pr create --fill', 'gh api repos/o/r/pulls/12', 'gh pr -R octo/proj review 12 --comment -b approve-later', 'gh pr review 12 -b approve', 'gh pr --repo octo/proj view 12'];
  for (const c of fine) assert.equal(denyReason(c, 0, env), null, c);
  assert.match(denyReason('git commit -m x', 0, { ...env, GIT_AUTHOR_EMAIL: 'me@example.com' }).machine, /not the machine account/);
  // A long flag-like word is checked in linear time (no backtracking pattern over it).
  const started = process.hrtime.bigint();
  assert.equal(denyReason(`gh pr review 12 -${'b'.repeat(200000)}!`, 0, env), null);
  assert.ok(process.hrtime.bigint() - started < 2_000_000_000n, 'a long word takes no noticeable time');
  assert.equal(denyReason('git push -f', 0, env), 'git push with -f');
  for (const c of denied.filter((x) => !x.includes('-c ') && !x.startsWith('bash'))) assert.equal(denyReason(c), null, c);
  assert.match(decide(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh pr review 3 --approve' } }), env), /^BenchKeeper guard: gh pr review --approve is denied in a machine account session \(2002\+octo-agent@users\.noreply\.github\.com\)/);
  const hook = spawnSync(process.execPath, [new URL('../src/guard-hook.mjs', import.meta.url).pathname], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git config user.name me' } }), encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  assert.deepEqual([hook.status, hook.stderr.split('\n').length], [2, 2]);
});

test('machine status, doctor and remove: ids decide, a renamed login is information, remove signs out and names the pages', async () => {
  const m = machine({ signedIn: true });
  assert.match((await cli(m, ['machine', 'status'])).text, /no machine account is set up/);
  assert.match((await cli(m, ['machine', 'remove'])).text, /no machine account is set up/);
  assert.deepEqual(machineChecks(m.ctx), []);
  ready(m, true);
  // Both accounts renamed on GitHub: the ids match, the logins are written back, the address follows.
  m.gh.as = { id: 2002, login: 'cat-agent' };
  m.gh.main = { id: 1001, login: 'cat' };
  const found = machineChecks(m.ctx);
  assert.deepEqual(found.map((f) => f.level), ['info', 'warning', 'info']);
  assert.match(found[0].message, /renamed from octo-agent to cat-agent/);
  assert.match(found[1].message, /the machine account's key .* is missing/);
  assert.deepEqual([readConfig(m.ctx).machine.login, readConfig(m.ctx).main.login, identity(readConfig(m.ctx)).email], ['cat-agent', 'cat', '2002+cat-agent@users.noreply.github.com']);
  const s = await cli(m, ['machine', 'status']);
  assert.match(s.text, /machine account: cat-agent \(id 2002\)\nyour account: cat \(id 1001\)\nsigned in: cat-agent\ncommits as: cat-agent <2002\+cat-agent@users\.noreply\.github\.com>\nsigning: on, but the key is missing/);
  m.gh.as = MAIN;
  m.gh.main = MAIN;
  assert.equal(machineChecks(m.ctx)[0].level, 'error');
  m.gh.as = { id: 3003, login: 'other' };
  assert.match(machineChecks(m.ctx)[0].message, /signed in as other, not the machine account/);
  m.gh.signedIn = false;
  assert.match(machineChecks(m.ctx)[0].message, /is not signed in/);
  m.ctx.env.BENCHKEEPER_MACHINE_EMAIL = EMAIL;
  assert.ok(machineChecks(m.ctx).some((f) => /a GitHub token variable is set/.test(f.message)));
  writeFileSync(join(m.ctx.config, 'machine', 'machine.json'), '{"version":1}');
  assert.match(machineChecks(m.ctx)[0].message, /is not a machine account config/);
  ready(m, true);
  m.gh.signedIn = true;
  mkdirSync(join(m.home, '.claude'));
  assert.equal((await cli(m, ['machine', 'enable', '--global', '--yes'])).code, 0);
  assert.equal((await cli(m, ['machine', 'remove'], { lines: ['n'] })).code, 1);
  // gh keeps the login: nothing is deleted, the settings stay, no success is claimed.
  m.gh.stuck = true;
  const stuck = await cli(m, ['machine', 'remove', '--yes']);
  assert.equal(stuck.code, 1);
  assert.match(stuck.text, /gh did not sign the machine account out of .*; nothing was deleted: run GH_CONFIG_DIR=/);
  assert.doesNotMatch(stuck.text, /signed out and deleted/);
  assert.deepEqual([existsSync(configFile(m.ctx)), JSON.parse(readFileSync(join(m.home, '.claude/settings.json'), 'utf8')).env.GIT_AUTHOR_EMAIL], [true, EMAIL]);
  // gh answers no account although hosts.yml still names the login (a lookup that failed): still nothing is deleted.
  m.gh.signedIn = false;
  assert.equal((await cli(m, ['machine', 'remove', '--yes'])).code, 1, 'hosts.yml still names the login');
  assert.ok(existsSync(configFile(m.ctx)));
  m.gh.signedIn = true;
  m.gh.stuck = false;
  assert.equal((await cli(m, ['machine', 'remove'])).code, 2, 'no answer is no go-ahead');
  const r = await cli(m, ['machine', 'remove', '--yes']);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /delete its signing key at https:\/\/github\.com\/settings\/keys, or the account at https:\/\/github\.com\/settings\/admin/);
  assert.equal(m.gh.signedIn, false);
  assert.deepEqual([existsSync(join(m.ctx.config, 'machine')), JSON.parse(readFileSync(join(m.home, '.claude/settings.json'), 'utf8')).env], [false, undefined]);
  // Settings that cannot be edited: the account is signed out all the same, and the command that cleans up is named.
  ready(m);
  m.gh.signedIn = true;
  writeFileSync(join(m.home, '.claude/settings.json'), '{ not json');
  const broken = await cli(m, ['machine', 'remove', '--yes']);
  assert.equal(broken.code, 1);
  assert.match(broken.text, /signed out and deleted the machine folder[\s\S]*the agent settings still have machine account variables: benchkeeper machine disable --global/);
  assert.equal((await cli(m, ['machine', 'nope'])).code, 2);
  assert.equal((await cli(m, ['machine', 'status', 'extra'])).code, 2);
});

test('machine shell: your shell with the machine variables and without a GitHub token', async () => {
  const m = ready();
  let seen;
  const run = m.ctx.run;
  m.ctx.run = (argv, o) => (argv[0] === '/bin/zsh' ? ((seen = { argv, env: o.env, stdio: o.stdio }), { code: 7 }) : run(argv, o));
  Object.assign(m.ctx.env, { SHELL: '/bin/zsh', GITHUB_TOKEN: 'dummy-2', GIT_CONFIG_PARAMETERS: "'user.email=me'", GIT_CONFIG_KEY_9: 'user.email', GIT_CONFIG_SYSTEM: '/etc/x', KEEP: '1' });
  const r = await cli(m, ['machine', 'shell']);
  assert.equal(r.code, 7);
  assert.match(r.text, /machine shell: \/bin\/zsh as octo-agent/);
  assert.deepEqual([seen.argv, seen.stdio, seen.env.KEEP, seen.env.GH_TOKEN, seen.env.GITHUB_TOKEN, seen.env.GIT_CONFIG_PARAMETERS, seen.env.GH_CONFIG_DIR], [['/bin/zsh'], 'inherit', '1', undefined, undefined, undefined, ghDir(m.ctx)]);
  // The -c pairs of an outer git go; which config files git reads stays as the user set it.
  assert.deepEqual([seen.env.GIT_CONFIG_KEY_9, seen.env.GIT_CONFIG_GLOBAL, seen.env.GIT_CONFIG_NOSYSTEM, seen.env.GIT_CONFIG_SYSTEM], [undefined, m.gitconfig, '1', '/etc/x']);
});
