import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  const load = () => spawnSync(process.execPath, ['--input-type=module', '-e', "const { STATE } = await import('./playwright.config.mjs'); console.log(JSON.stringify([process.env.BK_UI_ROOT, STATE]));"], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 20000 });
  const runs = [load(), load()].map((r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); });
  try {
    assert.notEqual(runs[0][0], runs[1][0]);
    for (const [root, state] of runs) {
      assert.equal(statSync(root).mode & 0o777, 0o700);
      assert.equal(dirname(state), root);
    }
  } finally { for (const [root] of runs) if (root) rmSync(root, { recursive: true, force: true }); }
  const files = ['playwright.config.mjs', ...readdirSync('test/ui').filter((f) => f.endsWith('.mjs')).map((f) => join('test/ui', f))];
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /(?<!mkdtempSync\()join\(tmpdir\(\),/, f);
});
