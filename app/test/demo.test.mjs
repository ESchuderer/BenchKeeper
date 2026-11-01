import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

// The site's screenshots come from the fixture home only: the demo server refuses to start with another HOME.
test('the demo server refuses a HOME outside its fixture root', () => {
  const root = mkdtempSync(join(tmpdir(), 'bk-demo-test-'));
  try {
    const r = spawnSync(process.execPath, ['test/ui/serve.mjs'], { env: { PATH: process.env.PATH, HOME: tmpdir(), BK_DEMO_ROOT: root }, encoding: 'utf8', timeout: 20000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /demo mode needs HOME=/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// UI test fixtures at fixed names below the temp folder could be made in advance by another user (CodeQL's
// js/insecure-temporary-file): playwright.config.mjs makes one private folder per run and the fixtures live below it.
test('the UI tests keep their fixtures in one private folder per run, not at fixed names below the temp folder', async () => {
  // PATH and the temp folder settings only: BK_UI_ROOT stays unset unless a case sets it.
  const temp = Object.fromEntries(['PATH', 'TMPDIR', 'TMP', 'TEMP'].filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
  const load = (env = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', "import { statSync } from 'node:fs'; const { STATE } = await import('./playwright.config.mjs'); const root = process.env.BK_UI_ROOT; console.log(JSON.stringify([root, STATE, root && statSync(root).mode & 0o777]));"], { env: { ...temp, ...env }, encoding: 'utf8', timeout: 20000 });
  const runs = [load(), load()].map((r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); });
  try {
    assert.notEqual(runs[0][0], runs[1][0]);
    for (const [root, state, mode] of runs) {
      // Windows reports made-up permission bits.
      if (process.platform !== 'win32') assert.equal(mode, 0o700);
      assert.equal(dirname(state), root);
      // The process that made the folder removes it when it ends.
      assert.equal(existsSync(root), false);
    }
  } finally { for (const [root] of runs) if (root) rmSync(root, { recursive: true, force: true }); }
  // A folder the caller passes in (the workers and the web server get the runner's) stays.
  const given = mkdtempSync(join(tmpdir(), 'bk-ui-given-'));
  try {
    const r = load({ BK_UI_ROOT: given });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).slice(0, 2), [given, join(given, 'state.json')]);
    assert.equal(existsSync(given), true);
  } finally { rmSync(given, { recursive: true, force: true }); }
  const files = ['playwright.config.mjs', ...readdirSync('test/ui').filter((f) => f.endsWith('.mjs')).map((f) => join('test/ui', f))];
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /(?<!mkdtempSync\()join\(tmpdir\(\),/, f);
});
