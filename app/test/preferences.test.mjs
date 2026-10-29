import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { dismissNote, dismissedNotes, readPreferences, setPreference } from '../src/preferences.mjs';

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
  assert.deepEqual(JSON.parse(readFileSync(file(c), 'utf8')), { later: 1, editors: true, dismissed: [], schemaVersion: 1 });
  assert.equal(readPreferences(c).editors, true);
  if (process.platform !== 'win32') assert.equal(statSync(file(c)).mode & 0o777, 0o600);
  assert.throws(() => setPreference(c, 'editors', 'yes'), /editors must be true or false/);
  assert.throws(() => setPreference(c, 'theme', 'dark'), /key must be one of editors/);
});

test('dismissed notes: added once, removed again, a damaged list reads as empty', () => {
  const c = ctx();
  dismissNote(c, 'sandbox-off');
  dismissNote(c, 'sandbox-off');
  dismissNote(c, 'env-scrub-off');
  assert.deepEqual([...dismissedNotes(c)], ['sandbox-off', 'env-scrub-off']);
  dismissNote(c, 'sandbox-off', false);
  assert.deepEqual(JSON.parse(readFileSync(file(c), 'utf8')).dismissed, ['env-scrub-off']);
  writeFileSync(file(c), '{"dismissed": "sandbox-off"}');
  assert.deepEqual([...dismissedNotes(c)], []);
  writeFileSync(file(c), '{"dismissed": ["a", 1]}');
  assert.deepEqual([...dismissedNotes(c)], ['a']);
  assert.throws(() => dismissNote(c, ''), /id must be a note id/);
  assert.throws(() => setPreference(c, 'dismissed', [1]), /dismissed must be a list of strings/);
});
