import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';
import { loadConfig } from '../src/config.js';
import { parseArgs } from '../src/cli.js';

test('parseDuration', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('250ms'), 250);
  assert.throws(() => parseDuration('90'), RangeError);
});

test('loadConfig with defaults', () => {
  assert.deepEqual(loadConfig('{"jobs":[{"name":"a","command":"true"}]}'), [{ name: 'a', command: 'true', timeout: 30_000, retryDelay: 1000 }]);
  assert.throws(() => loadConfig('{"jobs":[{"name":"a","command":"true","timeout":"soon"}]}'), /jobs\[0\]\.timeout/);
});

test('parseArgs', () => {
  assert.deepEqual(parseArgs(['jobs.json', '--timeout', '5m', '--only', 'a']), { file: 'jobs.json', timeout: 300_000, only: 'a' });
  assert.throws(() => parseArgs(['jobs.json', '--timeout', 'x']), /--timeout/);
});
