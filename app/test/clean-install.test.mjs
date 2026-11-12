import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sh } from './helpers.mjs';

test('clean install: with an empty home, project setup applied twice changes nothing the second time, the policy reader and the precheck run in the projects, and no agent program of the caller\'s PATH runs', sh, () => {
  // The caller's own claude and codex would answer from the real home's login and plugins.
  const bin = mkdtempSync(join(tmpdir(), 'bk-clean-install-bin-'));
  const log = join(bin, 'calls.log');
  for (const name of ['claude', 'codex']) writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/clean-install.mjs', import.meta.url))], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(log), 'a program of the caller\'s PATH ran');
});
