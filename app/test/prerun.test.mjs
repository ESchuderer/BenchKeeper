import assert from 'node:assert/strict';
import { existsSync, mkdirSync, realpathSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { hashPath } from '../src/fsx.mjs';
import { rehearsable, rehearse } from '../src/prerun.mjs';
import { SKILLS_SPEC } from '../src/steps/global.mjs';
import { SANDBOX, viaSrt } from './fixtures/srt.mjs';

const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
// A skills CLI stand-in: it writes where the skills CLI 1.7.2 resolves its folders from the environment.
const cli = (argv, { cwd, env }) => {
  const name = argv.includes('-s') ? argv[argv.indexOf('-s') + 1] : argv[4];
  const lock = env.XDG_STATE_HOME ? join(env.XDG_STATE_HOME, 'skills/.skill-lock.json') : join(env.HOME, '.agents/.skill-lock.json');
  put(join(env.HOME, '.npm/_logs/debug.log'), 'npm log');
  if (argv.includes('-g')) {
    put(join(env.CLAUDE_CONFIG_DIR ?? join(env.HOME, '.claude'), 'skills', name, 'SKILL.md'), `# ${name}\n`);
    put(join(env.CODEX_HOME ?? join(env.HOME, '.codex'), 'skills', name, 'SKILL.md'), `# ${name}\n`);
    const old = existsSync(lock) ? JSON.parse(readFileSync(lock, 'utf8')) : {};
    put(lock, `${JSON.stringify({ ...old, [name]: 1 })}\n`);
  } else if (argv[3] === 'remove') rmSync(join(cwd, '.claude/skills', name), { recursive: true });
  else {
    put(join(cwd, '.claude/skills', name, 'SKILL.md'), `# ${name}\n`);
    put(join(cwd, 'skills-lock.json'), `${readFileSync(join(cwd, 'skills-lock.json'), 'utf8')}${name}\n`);
  }
  return { code: 0, stdout: '', stderr: '' };
};

test('prerun: a skills CLI command writes only in its scratch folder; the plan gets the diff against the real files', async (t) => {
  const real = mkdtempSync(join(tmpdir(), 'bk-prerun-real-'));
  const home = join(real, 'home'), dir = join(real, 'proj');
  put(join(home, '.agents/.skill-lock.json'), '{"old":1}\n');
  put(join(dir, 'skills-lock.json'), 'old\n');
  put(join(dir, '.claude/skills/gone/SKILL.md'), '# gone\n');
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const k of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME']) delete process.env[k];
  const homeBefore = hashPath(home), dirBefore = hashPath(dir);
  const ctx = { home, run: viaSrt(cli), sandbox: SANDBOX };

  const global = { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '-a', 'claude-code', '--copy', '-y'] };
  assert.ok(rehearsable(global));
  assert.ok(!rehearsable({ kind: 'command', argv: ['npm', 'i', '-g', 'x'] }));
  const g = await rehearse(ctx, global);
  assert.equal(g.error, null);
  assert.deepEqual(g.files.map((f) => f.path), [join(home, '.agents/.skill-lock.json'), join(home, '.claude/skills/x/SKILL.md'), join(home, '.codex/skills/x/SKILL.md')]);
  // The lock was seeded: the diff adds one entry instead of replacing the user's.
  assert.match(g.files[0].diff, /^-\{"old":1\}$/m);
  assert.match(g.files[0].diff, /^\+\{"old":1,"x":1\}$/m);
  // The user's own folder variables: the rehearsal stays in its scratch home, the diff names the folders they point to.
  for (const [k, d] of [['CODEX_HOME', 'codex'], ['CLAUDE_CONFIG_DIR', 'claude'], ['XDG_STATE_HOME', 'state']]) { process.env[k] = join(real, d); mkdirSync(join(real, d)); }
  put(join(real, 'state/skills/.skill-lock.json'), '{"mine":1}\n');
  const moved = hashPath(real);
  const m = await rehearse(ctx, global);
  assert.deepEqual(m.files.map((f) => f.path), [join(real, 'state/skills/.skill-lock.json'), join(real, 'claude/skills/x/SKILL.md'), join(real, 'codex/skills/x/SKILL.md')]);
  assert.match(m.files[0].diff, /^\+\{"mine":1,"x":1\}$/m);
  assert.equal(hashPath(real), moved);

  const add = await rehearse(ctx, { kind: 'command', cwd: dir, argv: ['npx', '-y', SKILLS_SPEC, 'add', 'u', '-s', 'y', '--copy', '-y'], snapshot: [join(dir, '.claude/skills/y'), join(dir, 'skills-lock.json')] });
  assert.deepEqual(add.files.map((f) => f.path), [join(dir, '.claude/skills/y/SKILL.md'), join(dir, 'skills-lock.json')]);
  const rm = await rehearse(ctx, { kind: 'command', cwd: dir, argv: ['npx', '-y', SKILLS_SPEC, 'remove', 'gone', '-y'], snapshot: [join(dir, '.claude/skills/gone'), join(dir, 'skills-lock.json')] });
  assert.deepEqual(rm.files.map((f) => f.path), [join(dir, '.claude/skills/gone/SKILL.md')]);
  assert.match(rm.files[0].diff, /^-# gone$/m);

  // A seeded link is copied as what it points to: the command cannot write through it.
  const linked = join(real, 'linked'), outside = join(real, 'outside-lock.json');
  put(outside, 'mine\n');
  mkdirSync(linked);
  symlinkSync(outside, join(linked, 'skills-lock.json'));
  const l = await rehearse(ctx, { kind: 'command', cwd: linked, argv: ['npx', '-y', SKILLS_SPEC, 'add', 'u', '-s', 'z', '--copy', '-y'], snapshot: [join(linked, '.claude/skills/z'), join(linked, 'skills-lock.json')] });
  assert.deepEqual(l.files.map((f) => f.path), [join(linked, '.claude/skills/z/SKILL.md'), join(linked, 'skills-lock.json')]);
  assert.equal(readFileSync(outside, 'utf8'), 'mine\n');
  assert.equal(hashPath(home), homeBefore);
  assert.equal(hashPath(dir), dirBefore);
  assert.deepEqual(await rehearse({ home, sandbox: SANDBOX, run: viaSrt(() => ({ code: 1, stdout: '', stderr: 'no network\n' })) }, global), { files: [], error: 'no network' });
});

test('prerun: no credentials reach the command, the home is the context home, and a link loop is refused unrun', async (t) => {
  const real = mkdtempSync(join(tmpdir(), 'bk-prerun-cred-'));
  const home = join(real, 'home'), dir = join(real, 'proj');
  put(join(home, '.npmrc'), '//registry.example/:_authToken=sekret\nregistry=https://mirror.example/\n_auth=abc\nkey=/k.pem\n//registry.example/:keyfile=/k2.pem\n');
  put(join(home, '.gitconfig'), '[credential]\n\thelper = store\n[http]\n\textraheader = Authorization: Basic abc\n[core]\n\tsshCommand = ssh -i /k\n');
  mkdirSync(dir, { recursive: true });
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const k of ['npm_config_userconfig', 'npm_config_cache', 'GIT_CONFIG_GLOBAL']) delete process.env[k];
  Object.assign(process.env, { GH_TOKEN: 'ghp_leak', NPM_TOKEN: 'leak', SSH_AUTH_SOCK: '/s' });
  let seen;
  const ctx = { home, sandbox: SANDBOX, run: viaSrt((argv, o) => { seen = { env: o.env, rc: readFileSync(o.env.npm_config_userconfig, 'utf8'), git: readFileSync(o.env.GIT_CONFIG_GLOBAL, 'utf8') }; return { code: 0, stdout: '', stderr: '' }; }) };
  const global = { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '--copy', '-y'], env: { DO_NOT_TRACK: '1' } };
  assert.equal((await rehearse(ctx, global)).error, null);
  // No GH_TOKEN for a command of the app. A machine account session reaches GitHub through gh's own login in the machine's
  // folder (GH_CONFIG_DIR), never through a token in the environment (machine.test.mjs).
  for (const k of ['GH_TOKEN', 'NPM_TOKEN', 'SSH_AUTH_SOCK']) assert.equal(seen.env[k], undefined, k);
  assert.equal(seen.env.DO_NOT_TRACK, '1');
  assert.equal(seen.rc, 'registry=https://mirror.example/\n', 'registry settings stay, tokens go');
  assert.equal(seen.env.npm_config_cache, join(dirname(seen.env.HOME), 'npm-cache'), 'the cache is below the scratch folder in a sandbox');
  // git reads an empty scratch config, not the user's (credential helper, extra headers, ssh command) and no system one.
  assert.equal(seen.git, '');
  assert.equal(seen.env.GIT_CONFIG_NOSYSTEM, '1');

  // A seeded folder that links back to itself is not copied: the preview fails before the command starts.
  mkdirSync(join(dir, '.claude'));
  symlinkSync('..', join(dir, '.claude/skills'));
  seen = null;
  const loop = await rehearse(ctx, { kind: 'command', cwd: dir, argv: ['npx', '-y', SKILLS_SPEC, 'add', 'u', '-s', 'y', '--copy', '-y'], snapshot: [] });
  assert.ok(loop.error);
  assert.equal(seen, null);
});

test('prerun: a failed signature check stops the rehearsal before the command runs', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-prerun-verify-'));
  const calls = [];
  const ctx = { home, run: (argv) => { calls.push(argv[0]); return argv[0] === 'verify' ? { code: 1, stdout: '', stderr: 'npm error signature mismatch' } : { code: 0, stdout: '', stderr: '' }; } };
  const r = await rehearse(ctx, { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '--copy', '-y'], verify: ['verify', 'skills@1.7.2'] }, { unconfined: true });
  assert.deepEqual(r.files, []);
  assert.match(r.error, /signature check failed: npm error signature mismatch/);
  assert.deepEqual(calls, ['verify']);
  // A passed check is not repeated for the next preview of the same package.
  const seen = [];
  const pass = { home, run: (argv) => { seen.push(argv[0]); return { code: 0, stdout: '', stderr: '' }; } };
  const c = { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '--copy', '-y'], verify: ['verify-once', 'skills@9.9.9'] };
  await rehearse(pass, c, { unconfined: true });
  await rehearse(pass, c, { unconfined: true });
  assert.deepEqual(seen, ['verify-once', 'npx', 'npx']);
});

const GLOBAL = { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'a b', '$(id)', '--', "it's", '', '-g', '--copy', '-y'], env: { DO_NOT_TRACK: '1' } };
const quiet = { code: 0, stdout: '', stderr: '' };
const tmpHome = (name) => mkdtempSync(join(tmpdir(), `bk-prerun-${name}-`));

test('prerun: srt gets the argv unchanged, settings that confine writes and the network, a scratch cache and temp folder', async (t) => {
  const home = tmpHome('srt');
  put(join(home, '.ssh/id_test'), 'dummy');
  put(join(home, '.npmrc'), '@acme:registry=https://npm.acme.example/\n');
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  delete process.env.npm_config_userconfig;
  process.env.npm_config_registry = 'https://mirror.example/npm/';
  const seen = [], calls = [], checks = [];
  let ran;
  const run = viaSrt((argv, o) => {
    calls.push(argv);
    // What the command finds when srt starts it: the .claude folder srt would otherwise cover, and a temp folder.
    ran = { argv, env: o.env, claude: existsSync(join(o.env.HOME, '.claude/skills')), tmp: existsSync(o.env.CLAUDE_CODE_TMPDIR) };
    return quiet;
  }, seen, checks);
  const r = await rehearse({ home, run, sandbox: SANDBOX }, { ...GLOBAL, verify: ['verify', 'skills@1.7.2'] });
  assert.equal(r.error, null);
  assert.equal(r.sandbox, 'srt');
  assert.deepEqual(ran.argv, GLOBAL.argv, 'srt passes the argv on as it is');
  assert.equal(seen.length, 2, 'a start check, then the command');
  const { argv, env, settings } = seen[1], i = argv.indexOf('--settings');
  assert.deepEqual(argv.slice(0, i + 1), ['npx', '-y', '--package=@anthropic-ai/sandbox-runtime@npm:@anthropic-ai/sandbox-runtime@0.0.81', 'srt', '--settings']);
  assert.equal(argv[i + 2], '--');
  assert.deepEqual(argv.slice(i + 3), GLOBAL.argv);
  const scratch = dirname(argv[i + 1]);
  assert.deepEqual(settings, {
    network: { allowedDomains: ['registry.npmjs.org', 'github.com', 'npm.acme.example', 'mirror.example'], deniedDomains: [] },
    filesystem: { denyRead: [join(home, '.ssh'), join(home, '.npmrc')], allowRead: [], allowWrite: [scratch], denyWrite: [] },
  });
  assert.equal(env.CLAUDE_CODE_TMPDIR, join(scratch, 'tmp'));
  assert.equal(env.npm_config_cache, join(scratch, 'npm-cache'));
  assert.deepEqual([ran.claude, ran.tmp], [true, true]);
  // The skills CLI is checked, then srt (both outside the sandbox), before the command.
  assert.deepEqual(calls[0], ['verify', 'skills@1.7.2']);
  assert.deepEqual(checks, ['@anthropic-ai/sandbox-runtime@0.0.81']);
  assert.ok(!existsSync(scratch));
});

test('prerun: a signature check failure of srt stops the preview before the sandbox or the command run', async () => {
  const home = tmpHome('srtsig');
  const calls = [];
  const run = (argv) => { calls.push(argv[0]); return argv[2]?.startsWith('@anthropic-ai/sandbox-runtime@') ? { code: 1, stdout: '', stderr: 'npm error audit signatures failed' } : quiet; };
  const r = await rehearse({ home, run, sandbox: SANDBOX }, GLOBAL);
  assert.match(r.error, /^signature check failed: npm error audit signatures failed/);
  assert.equal(r.unavailable, undefined, 'no way around a bad signature');
  assert.deepEqual(calls, [process.execPath]);
});

test('prerun: a sandbox that does not start is "unavailable", never a run without it; a failing command after a start is a plain failure', async () => {
  const home = tmpHome('down');
  const ran = [];
  const down = (argv) => { ran.push(argv); if (argv[1]?.endsWith('verify.mjs')) return quiet; return { code: 1, stdout: '', stderr: "bwrap: Can't mount proc on /newroot/proc: Operation not permitted" }; };
  const ctx = { home, run: down, sandbox: SANDBOX };
  const r = await rehearse(ctx, GLOBAL);
  assert.equal(r.unavailable, true);
  assert.deepEqual(r.files, []);
  assert.match(r.error, /^the sandbox \(srt\) did not start: bwrap: Can't mount proc.*unmask=\/proc\/\*/);
  assert.ok(ran.every((a) => a.includes('srt') || a[1]?.endsWith('verify.mjs')), 'only the check and the start were tried');
  assert.ok(!ran.some((a) => a.includes('$(id)')), 'the command never ran');
  // The failure is kept for a minute: no second start, and still no run.
  const before = ran.length;
  assert.equal((await rehearse(ctx, GLOBAL)).unavailable, true);
  assert.equal(ran.length, before);

  const up = tmpHome('up');
  let commands = 0;
  const fails = viaSrt(() => { commands++; return { code: 2, stdout: '', stderr: 'skill not found\n' }; });
  const f = await rehearse({ home: up, run: fails, sandbox: SANDBOX }, GLOBAL);
  assert.deepEqual(f, { files: [], error: 'skill not found' });
  assert.equal(commands, 1, 'not run again without the sandbox');
});

test('prerun: a sandbox start error names the bwrap line, also when npm notices follow it', async () => {
  const stderr = [
    "bwrap: Can't bind mount /oldroot/dev/null on /newroot/tmp/t/.gitconfig: Unable to remount destination with correct flags: Permission denied",
    'npm notice', 'npm notice New major version of npm available! 10.9.9 -> 12.2.1',
    'npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.1', 'npm notice To update run: npm install -g npm@12.2.1', 'npm notice',
  ].join('\n');
  const run = (argv) => (argv[1]?.endsWith('verify.mjs') ? quiet : { code: 1, stdout: '', stderr });
  const r = await rehearse({ home: tmpHome('notice'), run, sandbox: SANDBOX }, GLOBAL);
  assert.equal(r.unavailable, true);
  assert.match(r.error, /^the sandbox \(srt\) did not start: bwrap: Can't bind mount .*Permission denied$/);
});

test('prerun: a sandbox start error without a bwrap or srt line keeps the last lines without npm notices', async () => {
  const stderr = [
    'npm error code E404', 'npm error 404 Not Found - GET https://registry.npmjs.org/@anthropic-ai%2fsandbox-runtime',
    'npm notice', 'npm notice New major version of npm available! 10.9.9 -> 12.2.1', 'npm warn exec The following package was not found', 'npm notice',
  ].join('\n');
  const run = (argv) => (argv[1]?.endsWith('verify.mjs') ? quiet : { code: 1, stdout: '', stderr });
  const r = await rehearse({ home: tmpHome('npm-error'), run, sandbox: SANDBOX }, GLOBAL);
  assert.equal(r.unavailable, true);
  assert.match(r.error, /^the sandbox \(srt\) did not start: npm error code E404 npm error 404 Not Found/);
  assert.doesNotMatch(r.error, /notice|warn/);
});

test('prerun: where no sandbox exists there is no preview; only the caller asking for one without it runs the command', async () => {
  const home = tmpHome('none');
  const calls = [];
  const run = (argv, o) => { calls.push({ argv, env: o.env }); return quiet; };
  const ctx = { home, run, sandbox: { platform: 'win32' } };
  const r = await rehearse(ctx, GLOBAL);
  assert.deepEqual(r, { files: [], unavailable: true, error: 'Windows has no sandbox the app can use (unsupported)' });
  assert.deepEqual(calls, []);
  // The same for a Linux without bubblewrap: the message names what to install.
  const bare = await rehearse({ ...ctx, sandbox: { platform: 'linux', has: () => false, node: '22.22.0' } }, GLOBAL);
  assert.match(bare.error, /^bwrap is missing: install bubblewrap, socat and ripgrep/);
  assert.deepEqual(calls, []);
  const anyway = await rehearse(ctx, GLOBAL, { unconfined: true });
  assert.equal(anyway.error, null);
  assert.equal(anyway.sandbox, 'none');
  assert.deepEqual(calls.map((c) => c.argv), [GLOBAL.argv], 'the plain command, once');
  assert.equal(calls[0].env.npm_config_cache, process.env.npm_config_cache ?? join(home, '.npm'), 'without a sandbox the cache is the user\'s');
});

test('prerun: where srt cannot run, bubblewrap or sandbox-exec confine the writes and the result says the network was open', async () => {
  const home = tmpHome('fallback');
  const ran = [];
  const run = (argv, o) => { ran.push({ argv, env: o.env, real: existsSync(o.env.HOME) ? realpathSync(dirname(o.env.HOME)) : null }); return quiet; };
  const bwrap = await rehearse({ home, run, sandbox: { platform: 'linux', has: (b) => b !== 'socat', node: '22.22.0' } }, GLOBAL);
  assert.equal(bwrap.sandbox, 'bwrap');
  assert.match(bwrap.note, /^socat missing, so the network is not limited/);
  const cmd = ran.at(-1), b = cmd.argv.indexOf('--bind');
  assert.deepEqual(cmd.argv.slice(0, 4), ['bwrap', '--ro-bind', '/', '/']);
  assert.equal(cmd.argv[b + 1], cmd.argv[b + 2], 'the scratch folder is the one writable path');
  assert.deepEqual(cmd.argv.slice(cmd.argv.indexOf('--', b) + 1), GLOBAL.argv);
  assert.equal(cmd.env.TMPDIR, join(cmd.argv[b + 1], 'tmp'));
  assert.equal(cmd.env.npm_config_cache, join(dirname(cmd.env.HOME), 'npm-cache'));

  const mac = await rehearse({ home: tmpHome('mac'), run, sandbox: { platform: 'darwin', has: (x) => x !== 'rg', node: '22.22.0' } }, GLOBAL);
  assert.equal(mac.sandbox, 'sandbox-exec');
  assert.match(mac.note, /^rg missing/);
  const m = ran.at(-1);
  assert.deepEqual([m.argv[0], m.argv[1]], ['sandbox-exec', '-p']);
  assert.match(m.argv[2], /^\(version 1\)\(allow default\)\(deny file-write\*\)\(allow file-write\* \(subpath "/);
  assert.ok(m.argv[2].includes(JSON.stringify(m.real)));
  assert.deepEqual(m.argv.slice(3), GLOBAL.argv);
});

test('prerun: a stop during the start check is a cancel, not "unavailable", and the next preview checks again', async () => {
  const home = tmpHome('cancel');
  const ctl = new AbortController();
  let starts = 0;
  const run = viaSrt(() => quiet);
  const stopping = (argv, o) => {
    if (argv[0] === 'npx' && argv.includes('true')) { starts++; ctl.abort(); return { code: 130, stdout: '', stderr: 'cancelled' }; }
    return run(argv, o);
  };
  const ctx = { home, run: stopping, sandbox: SANDBOX };
  assert.deepEqual(await rehearse(ctx, GLOBAL, { signal: ctl.signal }), { files: [], error: 'cancelled' });
  const again = await rehearse({ ...ctx, run }, GLOBAL);
  assert.equal(again.error, null, 'the cancelled check was not kept as a failure');
  assert.equal(starts, 1);
  // A timeout is no verdict on the sandbox either.
  const slow = { home: tmpHome('slow'), sandbox: SANDBOX, run: (argv) => (argv[1]?.endsWith('verify.mjs') ? quiet : { code: 124, stdout: '', stderr: 'stopped after 1 minutes' }) };
  assert.equal((await rehearse(slow, GLOBAL)).unavailable, true);
  assert.equal((await rehearse({ ...slow, run: viaSrt(() => quiet) }, GLOBAL)).error, null);
});
