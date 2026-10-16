import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';
import { loadConfig } from '../src/config.js';
import { parseArgs } from '../src/cli.js';

test('combined units', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2m30s'), 150_000);
  assert.equal(parseDuration('1s500ms'), 1500);
  assert.throws(() => parseDuration('1h30'), RangeError);
});

test('combined units in the job file and on the command line', () => {
  assert.equal(loadConfig('{"jobs":[{"name":"a","command":"true","retryDelay":"1m30s"}]}')[0].retryDelay, 90_000);
  assert.equal(parseArgs(['jobs.json', '--timeout', '1h30m']).timeout, 5_400_000);
});
