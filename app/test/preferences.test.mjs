import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readPreferences, setPreference } from '../src/preferences.mjs';

const ctx = () => { const config = mkdtempSync(join(tmpdir(), 'bk-prefs-')); return { config }; };
const file = (c) => join(c.config, 'preferences.json');

test('a missing, damaged or non-object file reads as off', () => {
  const c = ctx();
  assert.equal(readPreferences(c).editors, false);
  for (const text of ['{', 'null', '[true]', '"on"']) {
    writeFileSync(file(c), text);
    assert.equal(readPreferences(c).editors, false, text);
  }
});

test('a write keeps unknown keys, adds the schema version and is private; a wrong key or value is refused', () => {
  const c = ctx();
  mkdirSync(c.config, { recursive: true });
  writeFileSync(file(c), '{"later": 1}');
  setPreference(c, 'editors', true);
  assert.deepEqual(JSON.parse(readFileSync(file(c), 'utf8')), { later: 1, schemaVersion: 1, editors: true });
  assert.equal(readPreferences(c).editors, true);
  if (process.platform !== 'win32') assert.equal(statSync(file(c)).mode & 0o777, 0o600);
  assert.throws(() => setPreference(c, 'editors', 'yes'), /editors must be true or false/);
  assert.throws(() => setPreference(c, 'theme', 'dark'), /key must be one of editors/);
});
