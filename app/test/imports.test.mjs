import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// A small app folder, file by file, and the result of the import check on it.
function check(files) {
  const root = mkdtempSync(join(tmpdir(), 'bk-imports-'));
  for (const [f, text] of Object.entries(files)) { mkdirSync(dirname(join(root, f)), { recursive: true }); writeFileSync(join(root, f), text); }
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/imports.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, APP_ROOT: root } });
  return { code: r.status, out: r.stdout + r.stderr };
}

const CLEAN = {
  'src/fsx.mjs': 'export const x = 1;\n',
  'src/states.mjs': 'export const RANK = 1;\n',
  'src/agents.mjs': "import { x } from './fsx.mjs';\nexport const a = x;\n",
  'src/orca/index.mjs': "import { x } from '../fsx.mjs';\nexport const name = 'Orca' + x;\n",
  'src/projects.mjs': "import { name } from './orca/index.mjs';\nimport { a } from './agents.mjs';\nexport default [name, a];\n",
  'src/server.mjs': "import p from './projects.mjs';\nexport default p;\n",
  'src/cli.mjs': "import s from './server.mjs';\nexport default s;\n",
  'ui/shell.jsx': "export { RANK } from '../src/states.mjs';\n",
};

test('imports: a tree that follows the folder rules passes', () => {
  const r = check(CLEAN);
  assert.equal(r.code, 0, r.out);
});

test('imports: an import across a forbidden boundary, a cycle and the IDE name outside its module each fail', () => {
  const rules = {
    'core-imports': { 'src/fsx.mjs': "import c from './cli.mjs';\nexport default c;\n" },
    'engine-imports': { 'src/projects.mjs': "import s from './server.mjs';\nexport default s;\n" },
    'orca-imports': { 'src/orca/index.mjs': "import p from '../projects.mjs';\nexport default p;\n" },
    'ui-imports': { 'ui/shell.jsx': "export { default } from '../src/projects.mjs';\n" },
    'no-circular': { 'src/projects.mjs': "import b from './board.mjs';\nexport default b;\n", 'src/board.mjs': "import p from './projects.mjs';\nexport default p;\n" },
    'orca-name-outside-module': { 'src/board.mjs': "export const hook = 'ORCA_ROOT';\n" },
  };
  const names = {
    'a URL': "export const u = 'https://github.com/stablyai/orca';\n",
    'a template': "export const t = `${'x'.length} stablyai/orca`;\n",
    'a CommonJS file': "module.exports = 'Orca';\n",
  };
  const ok = check({ ...CLEAN, 'src/board.mjs': "export const t = `non-${name.orca} ${1}`;\n" });
  assert.equal(ok.code, 0, ok.out);
  for (const [what, text] of Object.entries(names)) {
    const r = check({ ...CLEAN, [what === 'a CommonJS file' ? 'src/board.cjs' : 'src/board.mjs']: text });
    assert.equal(r.code, 1, what);
    assert.ok(r.out.includes('error orca-name-outside-module:'), `${what}: ${r.out}`);
  }
  for (const [rule, change] of Object.entries(rules)) {
    const r = check({ ...CLEAN, ...change });
    assert.equal(r.code, 1, rule);
    assert.ok(r.out.includes(`error ${rule}:`), `${rule}: ${r.out}`);
  }
});

test('imports: an app folder that does not exist fails instead of passing unchecked', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/imports.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, APP_ROOT: join(tmpdir(), 'bk-imports-missing') } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
});
