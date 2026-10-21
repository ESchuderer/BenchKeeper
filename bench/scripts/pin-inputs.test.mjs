import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('run inputs accept an identical resume and preserve the first manifest on mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-inputs-'));
  try {
    const file = join(dir, 'inputs.sha256');
    const pin = (input) => spawnSync('sh', [new URL('pin-inputs.sh', import.meta.url).pathname, file], { input, encoding: 'utf8' });
    assert.equal(pin('prompt=a\nscorer=b\n').status, 0);
    assert.equal(pin('prompt=a\nscorer=b\n').status, 0);
    const changed = pin('prompt=a\nscorer=c\n');
    assert.equal(changed.status, 1);
    assert.match(changed.stderr, /run inputs changed/);
    assert.equal(readFileSync(file, 'utf8'), 'prompt=a\nscorer=b\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
