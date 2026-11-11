// Clean-install check: with an empty home in a temporary folder, project setup applied twice to two fixture projects changes nothing
// the second time; the coordinator's policy reader then prints the defaults and its precheck finds nothing to pick.
// Usage: node scripts/clean-install.mjs. Exit 0, or 1 with the failing step. The temporary folder stays, for a look at what setup wrote.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentDir } from '../src/content.mjs';

const FIXTURES = {
  typescript: {
    'package.json': '{ "name": "fixture", "private": true, "type": "module", "scripts": { "test": "node --test" } }\n',
    'tsconfig.json': '{ "compilerOptions": { "strict": true, "noEmit": true } }\n',
    'src/index.ts': 'export const answer: number = 42;\n',
  },
  python: {
    'pyproject.toml': '[project]\nname = "fixture"\nversion = "0.1.0"\n',
    'src/fixture/__init__.py': 'ANSWER = 42\n',
    'tests/test_fixture.py': 'from fixture import ANSWER\n\n\ndef test_answer():\n    assert ANSWER == 42\n',
  },
};

const root = realpathSync(mkdtempSync(join(tmpdir(), 'bk-clean-install-')));
const home = join(root, 'home');
const folders = { HOME: home, USERPROFILE: home, BENCHKEEPER_HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_STATE_HOME: join(home, '.local/state'), XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: join(root, 'tmp') };
// The folders of node and git alone: through the caller's PATH, setup would ask the caller's own claude and codex for their plugins, which answer from the real login.
const gitFolder = (process.env.PATH ?? '').split(delimiter).filter(isAbsolute).find((folder) => existsSync(join(folder, 'git')));
const PATH = [...new Set([dirname(process.execPath), gitFolder])].join(delimiter);
// Only these reach a child: none of the caller's variables can point the app, an agent or git at the real home.
const env = { PATH, ...folders, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const projects = Object.keys(FIXTURES).map((name) => ({ name, dir: join(root, 'projects', name), origin: join(root, 'origins', `${name}.git`) }));

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8' });
const git = (...args) => { const r = run('git', args); assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr || r.error}`); };
const node = (script, ...args) => run(process.execPath, [script, ...args]);
const skill = (script) => join(contentDir, 'skills/orchestrating-projects', script);
// One run of project setup, with its runs as the app's JSON reports them.
const apply = (dir) => {
  const r = node(fileURLToPath(new URL('../bin/benchkeeper.mjs', import.meta.url)), 'projects', 'apply', dir, '--agents', 'claude', '--share', '--yes', '--json');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).runs;
};

let step = 'the temporary folders';
try {
  assert.ok(gitFolder, 'git is in no folder of PATH');
  for (const path of [home, folders.TMPDIR]) mkdirSync(path, { recursive: true });

  for (const { name, dir, origin } of projects) {
    step = `the ${name} fixture`;
    for (const [path, text] of Object.entries(FIXTURES[name])) { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); }
    git('init', '-q', '--bare', '-b', 'main', origin);
    git('init', '-q', '-b', 'main', dir);
    git('-C', dir, 'add', '-A');
    git('-C', dir, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'fixture');
    git('-C', dir, 'remote', 'add', 'origin', origin);
    git('-C', dir, 'push', '-q', 'origin', 'main');
  }

  for (const { name, dir } of projects) {
    step = `the first setup of the ${name} project`;
    const first = apply(dir);
    assert.deepEqual(first.map((r) => r.status), ['done'], 'expected one finished run');
    step = `the second setup of the ${name} project`;
    assert.deepEqual(apply(dir), [], 'the second run changed something');

    step = `the policy of the ${name} project`;
    const policy = node(skill('policy.mjs'), dir);
    assert.equal(policy.status, 0, policy.stderr);
    const { startLabel, merge } = JSON.parse(policy.stdout);
    assert.deepEqual([startLabel, merge.allowed], [null, false], 'expected the defaults: no start label, no merge');

    step = `the precheck of the ${name} project`;
    const precheck = node(skill('precheck.mjs'), dir);
    assert.deepEqual([precheck.status, precheck.stdout], [1, ''], precheck.stderr);
  }
  console.log(`clean-install ok (${root})`);
} catch (e) {
  console.error(`clean-install failed at ${step}: ${e.message.split('\n')[0]}`);
  process.exitCode = 1;
}
