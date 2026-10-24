import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
