import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { hashPath } from '../src/fsx.mjs';
import { rehearsable, rehearse } from '../src/prerun.mjs';
import { SKILLS_SPEC } from '../src/steps/global.mjs';

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
  const ctx = { home, run: cli };

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
  assert.deepEqual(await rehearse({ home, run: () => ({ code: 1, stdout: '', stderr: 'no network\n' }) }, global), { files: [], error: 'no network' });
});

test('prerun: no credentials reach the command, the home is the context home, and a link loop is refused unrun', async (t) => {
  const real = mkdtempSync(join(tmpdir(), 'bk-prerun-cred-'));
  const home = join(real, 'home'), dir = join(real, 'proj');
  put(join(home, '.npmrc'), '//registry.example/:_authToken=sekret\nregistry=https://mirror.example/\n_auth=abc\nkey=/k.pem\n//registry.example/:keyfile=/k2.pem\n');
  mkdirSync(dir, { recursive: true });
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const k of ['npm_config_userconfig', 'npm_config_cache', 'GIT_CONFIG_GLOBAL']) delete process.env[k];
  Object.assign(process.env, { GH_TOKEN: 'ghp_leak', NPM_TOKEN: 'leak', SSH_AUTH_SOCK: '/s' });
  let seen;
  const ctx = { home, run: (argv, o) => { seen = { env: o.env, rc: readFileSync(o.env.npm_config_userconfig, 'utf8') }; return { code: 0, stdout: '', stderr: '' }; } };
  const global = { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '--copy', '-y'], env: { DO_NOT_TRACK: '1' } };
  assert.equal((await rehearse(ctx, global)).error, null);
  for (const k of ['GH_TOKEN', 'NPM_TOKEN', 'SSH_AUTH_SOCK']) assert.equal(seen.env[k], undefined, k);
  assert.equal(seen.env.DO_NOT_TRACK, '1');
  assert.equal(seen.rc, 'registry=https://mirror.example/\n', 'registry settings stay, tokens go');
  assert.equal(seen.env.npm_config_cache, join(home, '.npm'));

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
  const r = await rehearse(ctx, { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '--copy', '-y'], verify: ['verify', 'skills@1.7.2'] });
  assert.deepEqual(r.files, []);
  assert.match(r.error, /signature check failed: npm error signature mismatch/);
  assert.deepEqual(calls, ['verify']);
  // A passed check is not repeated for the next preview of the same package.
  const seen = [];
  const pass = { home, run: (argv) => { seen.push(argv[0]); return { code: 0, stdout: '', stderr: '' }; } };
  const c = { kind: 'command', argv: ['npx', '-y', SKILLS_SPEC, 'add', 'o/r', '-s', 'x', '-g', '--copy', '-y'], verify: ['verify-once', 'skills@9.9.9'] };
  await rehearse(pass, c);
  await rehearse(pass, c);
  assert.deepEqual(seen, ['verify-once', 'npx', 'npx']);
});
