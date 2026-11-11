import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('clean install: with an empty home, project setup applied twice changes nothing the second time, and the policy reader and the precheck run in the projects', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/clean-install.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
