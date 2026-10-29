import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyed, mask, redactArgv } from '../src/redact.mjs';

test('mask: token shapes, Bearer values with any spacing, and no text', () => {
  assert.equal(mask('xoxb-abcdefgh12 xoxz-abcdefgh12', { keys: false }), '*** xoxz-abcdefgh12');
  assert.equal(mask('auth: Bearer   abcdef next', { keys: false }), 'auth: Bearer *** next');
  assert.equal(mask('auth: bearer abcdef', { keys: false }), 'auth: Bearer ***');
  assert.equal(mask(null), '');
  assert.equal(mask(undefined), '');
});

test('mask: every secret flag, in any case', () => {
  assert.equal(mask('run --Token abc --password def --name x'), 'run --Token *** --password *** --name x');
});

test('keyed: whole extensions and file names only', () => {
  for (const p of ['a/b.json', 'b.YAML', 'b.yml', 'config', 'x/config', 'x\\.npmrc', '.env.local']) assert.equal(keyed(p), true, p);
  for (const p of ['b.json.bak', 'configure.js', 'x/myconfig', undefined]) assert.equal(keyed(p), false, String(p));
});

test('redactArgv: a secret flag in any case masks the next value; as the last argument there is none', () => {
  assert.deepEqual(redactArgv(['--API-KEY', 'abc', '--name', 'x']), ['--API-KEY', '***', '--name', 'x']);
  assert.deepEqual(redactArgv(['run', '--token']), ['run', '--token']);
});
