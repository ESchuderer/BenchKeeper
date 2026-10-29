import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyed, mask, maskStream, redactArgv, shown } from '../src/redact.mjs';

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

test('maskStream: a block on one line, an END of another type, a BEGIN split across chunks, a PGP block', () => {
  const feed = (...chunks) => shown(chunks.reduce((s, c) => maskStream(s, c), { text: '', rest: '', end: null }));
  const [rsaB, rsaE, ecB, ecE, pgpB, pgpE] = ['RSA PRIVATE KEY', 'EC PRIVATE KEY', 'PGP PRIVATE KEY BLOCK'].flatMap((t) => ['BEGIN', 'END'].map((w) => `-----${w} ${t}-----`));
  assert.equal(feed(`k ${rsaB}abc${rsaE} ${ecB}def\n`, 'ghi\n'), `k ${rsaB}***${rsaE} ${ecB}***\n***\n`);
  assert.equal(feed(`${ecB}\nabc\n${rsaE}\n`), `${ecB}\n***\n***\n`);
  assert.equal(feed(ecB.slice(0, 18), `${ecB.slice(18)}\nab`, `c\n${ecE} x\nok`), `${ecB}\n***\n${ecE} x\nok`);
  assert.equal(feed(`${pgpB}\nabc\n${pgpE}\n`), `${pgpB}\n***\n${pgpE}\n`);
});

test('maskStream: an unfinished line longer than the kept tail keeps its key block masked after the BEGIN is cut off', () => {
  const run = (max, ...chunks) => chunks.reduce((s, c) => maskStream(s, c, max), { text: '', rest: '', end: null });
  const [b, e] = ['BEGIN', 'END'].map((w) => `-----${w} RSA PRIVATE KEY-----`);
  const s = run(64, `x ${b}`, 'A'.repeat(100), 'B'.repeat(100));
  assert.ok(!s.rest.includes('BEGIN') && s.end === e);
  assert.equal(shown(s), '***');
  assert.equal(shown(run(64, `x ${b}`, 'A'.repeat(100), `${e} ok\n`)), `***${e} ok\n`);
  // The BEGIN line sits across the cut: the cut moves behind it.
  const across = run(16, `${'y'.repeat(20)}${b}`, 'C'.repeat(10));
  assert.equal(across.end, e);
  assert.equal(shown(across), '***');
  // No key block: only the tail of the line stays.
  assert.equal(shown(run(8, 'abcdefghijkl')), 'efghijkl');
});

test('maskStream: a secret assignment split across a line break masks the first token of the next line', () => {
  const feed = (...chunks) => chunks.reduce((s, c) => maskStream(s, c), { text: '', rest: '', end: null });
  assert.equal(shown(feed('password =\n', 'abc rest\nok\n')), 'password =\n*** rest\nok\n');
  assert.equal(shown(feed('api_key: Bearer\n\n  abc')), 'api_key: ***\n\n  ***');
  assert.equal(feed('token =\r\n"a b", c\n').text, 'token =\r\n***, c\n');
  // A complete assignment leaves the next line alone, and a line that masks today masks the same way.
  assert.equal(shown(feed('secret=abc\nplain\n')), 'secret=***\nplain\n');
  assert.equal(shown(feed('x --token abc ghp_abcdefgh123\n')), 'x --token *** ***\n');
  const [b, e] = ['BEGIN', 'END'].map((w) => `-----${w} RSA PRIVATE KEY-----`);
  assert.equal(shown(feed(`key:\n${b}\nabc\n${e}\n`)), `key:\n${b}\n***\n${e}\n`);
});
