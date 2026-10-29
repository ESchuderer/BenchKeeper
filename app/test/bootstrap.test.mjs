import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { checkOrigin, cloneName, projectOrigins, stripLogin } from '../src/origin.mjs';
import { exportProfile, readProfile } from '../src/profile.mjs';
import { addProject, listProjects } from '../src/projects.mjs';
import { apply, context, runCommand } from '../src/runner.mjs';

const TMP = realpathSync(tmpdir());
const tmp = (p) => mkdtempSync(join(TMP, p));
const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false'];
const git = (dir, ...args) => execFileSync('git', [...GIT, '-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const URL = 'https://github.com/example/demo.git';

// A repository with one commit: the stand-in for the address in a profile. Tests never reach a network.
function fixture() {
  const dir = tmp('bk-boot-src-');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'demo\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

// A machine whose git runs for real and whose clone takes the fixture instead of the address: the plan's own arguments
// are recorded and checked, then the clone is made from the local repository.
function machine(source, { fail = false } = {}) {
  const calls = [];
  const stub = (argv) => (argv[0] === 'npm' ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' });
  const run = (argv, opts = {}) => {
    if (argv[0] !== 'git') return stub(argv);
    if (!argv.includes('clone')) return runCommand(argv, { ...opts, env: { ...(opts.env ?? process.env), GIT_CONFIG_GLOBAL: '/dev/null' } });
    calls.push({ argv, env: opts.env, cwd: opts.cwd });
    if (fail) return { code: 128, stdout: '', stderr: 'fatal: could not read from remote repository' };
    return runCommand(['git', 'clone', '-q', source, argv.at(-1)], { cwd: opts.cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  };
  return { ctx: context({ home: tmp('bk-boot-home-'), run }), calls };
}

const profile = (projects) => {
  const file = join(tmp('bk-boot-file-'), 'profile.json');
  writeFileSync(file, JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: [] }, projects }));
  return file;
};
const cli = async (argv, ctx, lines = ['']) => {
  let out = '', err = '';
  const w = (f) => new Writable({ write(c, _, done) { f(String(c)); done(); } });
  const code = await main(argv, { out: w((c) => { out += c; }), err: w((c) => { err += c; }), ctx, input: Readable.from(lines) });
  return { code, out, err };
};
const NO = 'n\n'.repeat(60);

test('addresses: https and ssh of a named host pass, everything else is refused with a reason', () => {
  for (const [url, host, scheme] of [[URL, 'github.com', 'https'], ['https://git.example.org:8443/a/b', 'git.example.org', 'https'], ['ssh://git@github.com/a/b.git', 'github.com', 'ssh'],
    ['ssh://git@host.example.com:2222/a/b', 'host.example.com', 'ssh'], ['git@github.com:a/b.git', 'github.com', 'ssh'], ['ssh://host.example.com/a/b', 'host.example.com', 'ssh']]) {
    assert.deepEqual(checkOrigin(url), { url, host, scheme }, url);
  }
  for (const [bad, why] of [
    ['', /empty/], [undefined, /empty/], ['x'.repeat(3000), /longer/], ['/home/u/repo', /only https/], ['../repo', /only https/], ['./repo', /only https/], ['C:\\repo', /only https|host/],
    ['file:///tmp/repo', /file: addresses/], ['git://github.com/a/b', /git: addresses/], ['http://github.com/a/b', /http: addresses/], ['ext::sh -c id', /spaces|only https/], ['ext::sh', /ext: addresses|only https/],
    ['fd::3', /only https|fd: addresses/], ['-uhttps://github.com/a/b', /dash/], ['--upload-pack=x', /dash/], ['https://github.com/a b', /spaces/], ['https://github.com/a\n/b', /control/],
    ['https://user:pw@github.com/a/b', /user name or password/], ['https://tok@github.com/a/b', /user name or password/], ['ssh://git:pw@github.com/a/b', /user name or password/],
    ['https://github.com/a/b?x=1', /query/], ['https://github.com/a/b#x', /query/], ['https://github.com/a%2Fb', /escapes/], ['https://github.com\\@evil.example/a', /spaces|escapes|control/],
    ['https://127.0.0.1/a/b', /not a named/], ['https://0x7f.1/a/b', /not a named/], ['https://localhost/a/b', /not a named/], ['https://[::1]/a/b', /not a named/], ['https://github.com/', /no repository path/],
    ['https://github.com', /no repository path/], ['https://github.com/a/../b', /no repository path/], ['git@github.com:', /only https|no repository/], ['git@github.com:-oProxyCommand=x', /no repository path/],
    ['-o@github.com:a/b', /dash/], ['a b@github.com:a/b', /spaces/], ['ssh://-oProxyCommand=x@github.com/a', /unusual|dash|user name/], ['git@127.0.0.1:a/b', /not a named/], ['a@b@github.com:x/y', /only https/],
  ]) assert.throws(() => checkOrigin(bad), why, String(bad));
});

test('a login is dropped from an address, a name for the folder never leaves it', () => {
  assert.equal(stripLogin('https://x-access-token:abc123@github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(stripLogin('ssh://git:pw@github.com/a/b.git'), 'ssh://git@github.com/a/b.git');
  assert.equal(stripLogin('git@github.com:a/b.git'), 'git@github.com:a/b.git');
  assert.equal(stripLogin('not a url'), 'not a url');
  assert.equal(cloneName('/old/machine/demo', URL), 'demo');
  assert.equal(cloneName('/old/machine/..', URL), 'demo');
  assert.equal(cloneName('/old/.hidden', 'https://github.com/a/.git'), null);
  assert.equal(cloneName('/x/a b', 'git@github.com:a/rep o'), null);
});

test('the clone name drops trailing slashes and colons as the earlier /[/:]+$/ did', () => {
  const before = (url) => basename(url.replace(/[/:]+$/, '')).replace(/\.git$/, '');
  for (const url of ['https://github.com/a/b.git', 'https://github.com/a/b/', 'git@github.com:a/b:/:/', 'host:', '/', '', 'a//b//', 'https://github.com/a/b.git/']) {
    assert.equal(cloneName('/x/.hidden', url), [before(url)].find((n) => /^[A-Za-z0-9_][\w.-]*$/.test(n)) ?? null, url);
  }
});

test('export holds origins only on request, without a login, and not for a local or odd address', () => {
  const { ctx } = machine(fixture());
  const a = tmp('bk-boot-a-'), b = tmp('bk-boot-b-'), c = tmp('bk-boot-c-'), d = tmp('bk-boot-d-');
  for (const [dir, remote] of [[a, 'https://x-access-token:abc123@github.com/example/a.git'], [b, '/some/local/repo'], [c, 'git@github.com:example/c.git'], [d, null]]) {
    git(dir, 'init', '-q');
    if (remote) git(dir, 'remote', 'add', 'origin', remote);
    addProject(ctx, dir);
  }
  const plain = readProfile(exportProfile(ctx, { agents: ['claude'] }));
  assert.ok(plain.projects.every((x) => !('origin' in x)));
  const found = projectOrigins(ctx, listProjects(ctx).map((x) => x.path));
  assert.deepEqual(found.map((f) => f.url ?? f.reason.replace(/ .*/, '')), ['https://github.com/example/a.git', 'only', 'git@github.com:example/c.git', 'no']);
  const text = exportProfile(ctx, { agents: ['claude'], origins: found });
  assert.deepEqual(readProfile(text).projects.map((x) => x.origin), ['https://github.com/example/a.git', undefined, 'git@github.com:example/c.git', undefined]);
  assert.ok(!text.includes('abc123') && !text.includes('x-access-token'));
});

test('profile export --origins lists the addresses before it writes the file; without the flag none is written', async () => {
  const { ctx } = machine(fixture());
  const dir = tmp('bk-boot-exp-');
  git(dir, 'init', '-q');
  git(dir, 'remote', 'add', 'origin', 'https://tok:abc123@github.com/example/demo.git');
  addProject(ctx, dir);
  const file = join(tmp('bk-boot-out-'), 'p.json');
  const r = await cli(['profile', 'export', file, '--agents', 'claude', '--origins'], ctx);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.indexOf(`origin ${dir}: https://github.com/example/demo.git`) >= 0 && r.out.indexOf('origin ') < r.out.indexOf('wrote '));
  assert.equal(readProfile(readFileSync(file, 'utf8')).projects[0].origin, URL);
  assert.ok(!readFileSync(file, 'utf8').includes('abc123'));
  await cli(['profile', 'export', file, '--agents', 'claude'], ctx);
  assert.ok(!('origin' in readProfile(readFileSync(file, 'utf8')).projects[0]));
  // On stdout the profile stays clean: the list goes to stderr.
  const s = await cli(['profile', 'export', '--agents', 'claude', '--origins'], ctx);
  assert.ok(JSON.parse(s.out).projects[0].origin && s.err.includes('origin '));
  const j = await cli(['profile', 'export', '--agents', 'claude', '--origins', '--json'], ctx);
  assert.equal(JSON.parse(j.out).profile.projects[0].origin, URL);
  const k = await cli(['profile', 'export', '--agents', 'claude', '--json'], ctx);
  assert.ok(!('origin' in JSON.parse(k.out).profile.projects[0]));
});

test('a profile origin must be text', () => {
  const base = { kind: 'benchkeeper-profile', schemaVersion: 1, global: { agents: ['claude'] } };
  assert.throws(() => readProfile(JSON.stringify({ ...base, projects: [{ path: '/a/b', origin: 7 }] })), /origin of \/a\/b is not text/);
  assert.equal(readProfile(JSON.stringify({ ...base, projects: [{ path: '/a/b', origin: URL }] })).projects[0].origin, URL);
});

test('import lists a missing project and clones it only after the question, with the hardened command', async () => {
  const { ctx, calls } = machine(fixture());
  const folder = tmp('bk-boot-into-'), gone = join(tmp('bk-boot-old-'), 'demo');
  const r = await cli(['profile', 'import', profile([{ path: gone, origin: URL }]), '--clone-into', folder], ctx, ['y\n', NO]);
  assert.equal(r.code, 0, r.out);
  const dest = join(folder, 'demo');
  assert.match(r.out, new RegExp(`missing ${gone}: ${URL} \\(host github.com\\)`));
  assert.match(r.out, new RegExp(`Clone ${URL} into ${dest}\\?`));
  assert.ok(existsSync(join(dest, 'README.md')) && existsSync(join(dest, '.git')));
  assert.deepEqual(listProjects(ctx).map((x) => x.path), [dest]);
  assert.equal(calls.length, 1);
  const { argv, env, cwd } = calls[0];
  assert.equal(cwd, folder);
  const i = argv.indexOf('clone');
  assert.deepEqual(argv.slice(i), ['clone', '--no-recurse-submodules', '--template=', '--', URL, dest]);
  for (const c of ['core.hooksPath=' + (process.platform === 'win32' ? '\\\\.\\nul' : '/dev/null'), 'core.fsmonitor=false', 'protocol.allow=never', 'protocol.https.allow=always', 'protocol.ssh.allow=always', 'transfer.fsckObjects=true']) assert.ok(argv.includes(c), c);
  assert.equal(env.GIT_ALLOW_PROTOCOL, 'https:ssh');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.match(env.GIT_SSH_COMMAND, /BatchMode=yes/);
  assert.ok(ctx.ledger.list().some((x) => x.scope === dest && x.entries[0].kind === 'clone' && x.entries[0].status === 'done'));
});

test('the folder is asked for when --clone-into is missing; an empty answer clones nothing', async () => {
  const { ctx, calls } = machine(fixture());
  const gone = join(tmp('bk-boot-old-'), 'demo'), file = profile([{ path: gone, origin: URL }]);
  const none = await cli(['profile', 'import', file], ctx, ['\n', NO]);
  assert.match(none.out, /Folder to clone the missing projects into/);
  assert.match(none.out, /nothing cloned/);
  assert.match(none.out, new RegExp(`skipped ${gone}: not on this machine`));
  const eof = await cli(['profile', 'import', file], ctx, []);
  assert.match(eof.out, /nothing cloned/);
  const folder = tmp('bk-boot-into-');
  await cli(['profile', 'import', file], ctx, [`${folder}\n`, 'y\n', NO]);
  assert.ok(existsSync(join(folder, 'demo', '.git')));
  assert.equal(calls.length, 1);
});

test('nothing is cloned under --yes, on a no, or into something that is not a folder', async () => {
  const { ctx, calls } = machine(fixture());
  const gone = join(tmp('bk-boot-old-'), 'demo'), file = profile([{ path: gone, origin: URL }]), folder = tmp('bk-boot-into-');
  const yes = await cli(['profile', 'import', file, '--yes', '--clone-into', folder], ctx, ['y\ny\n']);
  assert.match(yes.out, /nothing is cloned under --yes/);
  const no = await cli(['profile', 'import', file, '--clone-into', folder], ctx, ['n\n', NO]);
  assert.match(no.out, new RegExp(`not cloned: ${URL}`));
  const file2 = join(folder, 'plain-file');
  writeFileSync(file2, 'x');
  const bad = await cli(['profile', 'import', file, '--clone-into', file2], ctx, ['y\n', NO]);
  assert.match(bad.out, /is not a folder/);
  assert.equal(calls.length, 0);
  assert.ok(!existsSync(join(folder, 'demo')));
});

test('addresses outside the rules are refused, never cloned, and printed escaped and masked', async () => {
  const { ctx, calls } = machine(fixture());
  const old = tmp('bk-boot-old-'), folder = tmp('bk-boot-into-');
  const bad = ['file:///etc', '/home/someone/repo', 'http://github.com/a/b', 'ext::sh -c "id"', 'https://ghp_abcdefghijklmnop@github.com/a/b', '-oProxyCommand=x', 'https://github.com/a/b\u001b[31m'];
  const file = profile(bad.map((origin, i) => ({ path: join(old, `p${i}`), origin })));
  const r = await cli(['profile', 'import', file, '--clone-into', folder], ctx, ['y\n'.repeat(10), NO]);
  assert.equal(r.code, 0, r.out);
  assert.equal((r.out.match(/refused origin of/g) ?? []).length, bad.length);
  assert.equal(calls.length, 0);
  assert.ok(!r.out.includes('ghp_abcdefghijklmnop') && !r.out.includes('\u001b'));
  assert.match(r.out, /\\u001b/);
  assert.doesNotMatch(r.out, /Clone /);
  assert.deepEqual(listProjects(ctx), []);
});

test('a project that exists here is not cloned; a destination that exists or cannot be a project is refused before the question', async () => {
  const { ctx, calls } = machine(fixture());
  const here = tmp('bk-boot-here-'), old = tmp('bk-boot-old-'), folder = tmp('bk-boot-into-');
  mkdirSync(join(folder, 'taken'));
  mkdirSync(ctx.config, { recursive: true });
  const r = await cli(['profile', 'import', profile([{ path: here, origin: URL }, { path: join(old, 'taken'), origin: URL }]), '--clone-into', folder], ctx, ['y\ny\n', NO]);
  assert.ok(!r.out.includes(`missing ${here}`));
  assert.match(r.out, /skipped .*taken: exists already/);
  const inConfig = await cli(['profile', 'import', profile([{ path: join(old, 'p'), origin: URL }]), '--clone-into', ctx.config], ctx, ['y\n', NO]);
  assert.match(inConfig.out, /refused .*: it is the BenchKeeper config folder/);
  const nameless = await cli(['profile', 'import', profile([{ path: join(old, '.x'), origin: 'https://github.com/a/.git' }]), '--clone-into', folder], ctx, ['y\n', NO]);
  assert.match(nameless.out, /no usable folder name/);
  assert.equal(calls.length, 0);
});

test('a failed clone is reported, the project stays missing, and an ssh address gets the host key hint', async () => {
  const { ctx, calls } = machine(fixture(), { fail: true });
  const old = join(tmp('bk-boot-old-'), 'demo'), folder = tmp('bk-boot-into-');
  const r = await cli(['profile', 'import', profile([{ path: old, origin: 'git@github.com:example/demo.git' }]), '--clone-into', folder], ctx, ['y\n', NO]);
  assert.equal(r.code, 1);
  assert.match(r.out, /failed .*clone git@github.com:example\/demo.git.*could not read from remote/);
  assert.match(r.out, /an ssh clone cannot ask for a host key/);
  assert.match(r.out, new RegExp(`skipped ${old}: not on this machine`));
  assert.equal(calls.length, 1);
  assert.deepEqual(listProjects(ctx), []);
  assert.ok(!existsSync(join(folder, 'demo')));
});

test('the clone step stays inside its folder: outside the roots or over an existing folder it does not run', () => {
  const { ctx, calls } = machine(fixture());
  const folder = tmp('bk-boot-into-'), elsewhere = tmp('bk-boot-else-');
  const change = (dest) => ({ id: 'c', step: 'clone', title: 'clone', kind: 'clone', path: dest, cwd: folder, argv: ['git', 'clone', '--', URL, dest] });
  const scoped = { ...ctx, roots: [join(folder, 'demo')] };
  assert.match(apply([change(join(elsewhere, 'demo'))], scoped, { select: ['c'] }).entries[0].error, /is outside/);
  mkdirSync(join(folder, 'demo'));
  assert.match(apply([change(join(folder, 'demo'))], scoped, { select: ['c'] }).entries[0].error, /exists already/);
  assert.equal(calls.length, 0);
});

test('undo removes a clone nobody touched and refuses one with a changed file, a new commit or an extra file', async () => {
  const source = fixture(), { ctx } = machine(source);
  const clone = async (name) => {
    const folder = tmp('bk-boot-into-');
    const r = await cli(['profile', 'import', profile([{ path: join(tmp('bk-boot-old-'), name), origin: URL }]), '--clone-into', folder], ctx, ['y\n', NO]);
    return { dest: join(folder, name), id: /run (\S+): undo/.exec(r.out)[1] };
  };
  const clean = await clone('clean');
  const gone = await cli(['undo', clean.id], ctx);
  assert.equal(gone.code, 0, gone.out);
  assert.ok(!existsSync(clean.dest));
  // The removal is moved to the backup, so undoing the undo is not possible by path here, but nothing was deleted for good.
  const edited = await clone('edited');
  writeFileSync(join(edited.dest, 'README.md'), 'mine\n');
  const e = await cli(['undo', edited.id], ctx);
  assert.equal(e.code, 1);
  assert.match(e.out, /holds changes/);
  assert.equal(readFileSync(join(edited.dest, 'README.md'), 'utf8'), 'mine\n');
  const extra = await clone('extra');
  writeFileSync(join(extra.dest, 'notes.txt'), 'mine\n');
  assert.match((await cli(['undo', extra.id], ctx)).out, /holds changes/);
  const ignored = await clone('ignored');
  writeFileSync(join(ignored.dest, '.git', 'info', 'exclude'), 'secret.txt\n', { flag: 'a' });
  writeFileSync(join(ignored.dest, 'secret.txt'), 'x');
  assert.match((await cli(['undo', ignored.id], ctx)).out, /holds changes/);
  const committed = await clone('committed');
  git(committed.dest, 'commit', '-q', '--allow-empty', '-m', 'mine');
  assert.match((await cli(['undo', committed.id], ctx)).out, /branches, tags or commits that are not the clone's/);
  const branched = await clone('branched');
  git(branched.dest, 'branch', 'work');
  assert.match((await cli(['undo', branched.id], ctx)).out, /branches, tags or commits/);
  assert.ok(existsSync(join(committed.dest, '.git')) && existsSync(join(branched.dest, '.git')));
});

test('undo leaves a clone that cannot be checked alone, and a run whose folder is gone is not undone', async () => {
  const { ctx } = machine(fixture());
  const folder = tmp('bk-boot-into-');
  const r = await cli(['profile', 'import', profile([{ path: join(tmp('bk-boot-old-'), 'demo'), origin: URL }]), '--clone-into', folder], ctx, ['y\n', NO]);
  const id = /run (\S+): undo/.exec(r.out)[1], dest = join(folder, 'demo');
  // Not a repository any more: the check cannot run, so the folder stays.
  execFileSync('rm', ['-rf', join(dest, '.git')]);
  const broken = await cli(['undo', id], ctx);
  assert.equal(broken.code, 1);
  assert.match(broken.out, /cannot be checked/);
  assert.ok(existsSync(dest));
  execFileSync('rm', ['-rf', dest]);
  // The scope of the run is its folder: with the folder gone the run is not undone through it.
  const again = await cli(['undo', id], ctx);
  assert.equal(again.code, 1);
  assert.match(again.out, /not a folder here/);
});
