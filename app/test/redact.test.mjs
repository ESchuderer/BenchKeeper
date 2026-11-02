import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyed, lastLines, mask, maskStream, redactArgv, shown } from '../src/redact.mjs';

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

test('mask: a passphrase is masked like a password', () => {
  assert.equal(mask('GPG_PASSPHRASE=hunter2 run --passphrase abc --name x'), 'GPG_PASSPHRASE=*** run --passphrase *** --name x');
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

test('maskStream: a secret value cut by the kept tail stays masked until it ends', () => {
  const run = (max, ...chunks) => chunks.reduce((s, c) => maskStream(s, c, max), { text: '', rest: '', end: null });
  assert.equal(shown(run(65536, 'password =\n', 'v'.repeat(70000))), 'password =\n***');
  assert.equal(shown(run(16, 'password =\n', 'v'.repeat(20), 'w'.repeat(20), ' ok\n')).slice(-7), '*** ok\n');
  assert.equal(shown(run(16, `x secret=${'v'.repeat(20)}`, 'w'.repeat(4))), '***');
  // The value ends before the cut: the text after it shows.
  assert.equal(shown(run(16, 'password =\n', `abc ${'z'.repeat(30)}`)), `password =\n${'z'.repeat(16)}`);
  assert.equal(shown(run(16, `x token=abc ${'z'.repeat(30)}`)), 'z'.repeat(16));
  assert.equal(shown(run(16, 'password =\n', '"a"', 'z'.repeat(16))), `password =\n${'z'.repeat(16)}`);
});

test('maskStream: a pending key and its Bearer value in any case; a key block indented on the next line; a value before a BEGIN on the same line', () => {
  const feed = (...chunks) => chunks.reduce((s, c) => maskStream(s, c), { text: '', rest: '', end: null });
  assert.equal(shown(feed('PASSWORD =\n', 'abc rest\n')), 'PASSWORD =\n*** rest\n');
  assert.equal(shown(feed('password =\n', 'bearer abc rest\n')), 'password =\n*** rest\n');
  const [b, e] = ['BEGIN', 'END'].map((w) => `-----${w} RSA PRIVATE KEY-----`);
  assert.equal(shown(feed(`key:\n  ${b}\nabc\n${e}\n`)), `key:\n  ${b}\n***\n${e}\n`);
  // A value before a BEGIN on the same line is still the value.
  assert.equal(shown(feed('password =\n', `abc ${b}\nxyz\n${e}\n`)), `password =\n*** ${b}\n***\n${e}\n`);
});

test('maskStream: the kept tail is cut at max for whole lines and for the unfinished line', () => {
  const run = (max, ...chunks) => chunks.reduce((s, c) => maskStream(s, c, max), { text: '', rest: '', end: null });
  assert.equal(run(8, 'abc\n', 'defghijkl\n').text, 'fghijkl\n');
  // A line shorter than max stays whole.
  assert.equal(shown(run(16, 'abcdefghij')), 'abcdefghij');
  // A key value behind a quoted key, cut by the kept tail, stays masked.
  assert.equal(shown(run(16, `x "secret": ${'v'.repeat(20)}`, 'w'.repeat(4))), '***');
});

test('maskStream: a BEGIN line before the cut stays in the head, one at the cut stays in the tail', () => {
  const run = (max, ...chunks) => chunks.reduce((s, c) => maskStream(s, c, max), { text: '', rest: '', end: null });
  const [b, e] = ['BEGIN', 'END'].map((w) => `-----${w} RSA PRIVATE KEY-----`);
  const head = run(64, `x ${b}`, 'A'.repeat(100));
  assert.equal(head.rest, 'A'.repeat(64));
  assert.equal(head.end, e);
  const tail = run(b.length, `${'y'.repeat(20)}${b}`);
  assert.equal(tail.rest, b);
  assert.equal(tail.end, null);
  assert.equal(shown(tail), b);
});

test('lastLines: the last n lines joined by a space, masked', () => {
  assert.equal(lastLines('a\nb\nc\nd\n'), 'b c d');
  assert.equal(lastLines('a\npassword=x\n', 1), 'password=***');
  // Fewer lines than n: the first line is shown as it came.
  assert.equal(lastLines('only line'), 'only line');
});
