import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The action runs the pattern without flags over the subject of the title.
const pattern = new RegExp(readFileSync(new URL('../workflows/pr-title.yml', import.meta.url), 'utf8').match(/^ +subjectPattern: (.+)$/m)[1]);

test('title subject: plain text passes, em dash and emoji fail', () => {
  assert.ok(pattern.test('release-please with a weekly release'));
  assert.ok(!pattern.test('a — b'));
  assert.ok(!pattern.test('ship it \u{1F680}'));
  assert.ok(!pattern.test('done ✅'));
  assert.ok(!pattern.test('heart ❤️'));
});
