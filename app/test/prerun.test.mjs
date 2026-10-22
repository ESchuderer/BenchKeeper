import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  // The user's own folder variables point at real folders: the rehearsal must not reach them.
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  for (const [k, d] of [['CODEX_HOME', 'codex'], ['CLAUDE_CONFIG_DIR', 'claude'], ['XDG_STATE_HOME', 'state']]) { process.env[k] = join(real, d); mkdirSync(join(real, d)); }
  const before = hashPath(real);
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

  const add = await rehearse(ctx, { kind: 'command', cwd: dir, argv: ['npx', '-y', SKILLS_SPEC, 'add', 'u', '-s', 'y', '--copy', '-y'], snapshot: [join(dir, '.claude/skills/y'), join(dir, 'skills-lock.json')] });
  assert.deepEqual(add.files.map((f) => f.path), [join(dir, '.claude/skills/y/SKILL.md'), join(dir, 'skills-lock.json')]);
  const rm = await rehearse(ctx, { kind: 'command', cwd: dir, argv: ['npx', '-y', SKILLS_SPEC, 'remove', 'gone', '-y'], snapshot: [join(dir, '.claude/skills/gone'), join(dir, 'skills-lock.json')] });
  assert.deepEqual(rm.files.map((f) => f.path), [join(dir, '.claude/skills/gone/SKILL.md')]);
  assert.match(rm.files[0].diff, /^-# gone$/m);

  assert.equal(hashPath(real), before);
  assert.deepEqual(await rehearse({ home, run: () => ({ code: 1, stdout: '', stderr: 'no network\n' }) }, global), { files: [], error: 'no network' });
});
