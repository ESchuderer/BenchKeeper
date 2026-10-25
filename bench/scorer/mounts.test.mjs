import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appFolder, choose } from './mounts.mjs';

test('the argument selects an allowed path and nothing else', () => {
  assert.equal(choose('/o/../o/vnu.json', ['/o/vnu.json']), '/o/vnu.json');
  assert.throws(() => choose('/etc/passwd', ['/o/vnu.json']), /not one of/);
});

test('app folder: /app or a folder of the temp folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mounts-'));
  try {
    assert.equal(appFolder(dir), dir);
    assert.equal(appFolder('/app'), '/app');
    assert.throws(() => appFolder('/etc'), /not one of/);
    assert.throws(() => appFolder(join(dir, '..')), /not one of/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
