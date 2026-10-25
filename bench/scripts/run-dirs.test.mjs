import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDir } from './run-dirs.mjs';

test('a run folder is one of bench/runs, bench/results or the temp folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-dirs-'));
  try {
    assert.equal(runDir(dir), dir);
    assert.equal(runDir(join(dir, '..', dir.split('/').pop())), dir);
    assert.throws(() => runDir('/etc'), /not a folder of/);
    assert.throws(() => runDir(join(dir, 'sub')), /not a folder of/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
