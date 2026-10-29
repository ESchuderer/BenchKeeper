import assert from 'node:assert/strict';
import fs, { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { mock, test } from 'node:test';
import { copy, hashPath, inside, isDir, isLink, listDir, listFiles, move, readText, real, realish, writeAtomic } from '../src/fsx.mjs';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'bk-fsx-')));
const noLinks = { skip: process.platform === 'win32' };

test('readers fall back on a missing path', () => {
  const d = tmp();
  assert.equal(isLink(join(d, 'none')), false);
  assert.equal(isDir(join(d, 'none')), false);
  assert.equal(readText(join(d, 'none')), null);
  assert.deepEqual(listDir(join(d, 'none')), []);
  assert.equal(hashPath(join(d, 'none')), null);
});

test('listFiles: relative paths of a tree in name order', () => {
  const d = tmp();
  mkdirSync(join(d, 'b'));
  for (const f of ['c', 'a', 'D', join('b', 'z'), join('b', 'y')]) writeFileSync(join(d, f), f);
  assert.deepEqual(listFiles(d), ['a', join('b', 'y'), join('b', 'z'), 'c', 'D']);
});

test('hashPath: a folder hashes names and contents, a link its target', noLinks, () => {
  const d = tmp();
  mkdirSync(join(d, 'f'));
  writeFileSync(join(d, 'f', 'x'), 'one');
  const before = hashPath(join(d, 'f'));
  writeFileSync(join(d, 'f', 'x'), 'two');
  assert.notEqual(hashPath(join(d, 'f')), before);
  symlinkSync('x', join(d, 'f', 'l'));
  const linked = hashPath(join(d, 'f'));
  writeFileSync(join(d, 'f', 'x'), 'three');
  symlinkSync('y', join(d, 'f', 'm'));
  assert.notEqual(hashPath(join(d, 'f')), linked);
  symlinkSync('a', join(d, 'la'));
  symlinkSync('b', join(d, 'lb'));
  assert.notEqual(hashPath(join(d, 'la')), hashPath(join(d, 'lb')));
  assert.equal(hashPath(join(d, 'la')), hashPath(join(d, 'la')));
  // Names and contents are framed: one file holding a second one's name and content is another tree.
  for (const [n, files] of [['two', { x: '1', y: '2' }], ['one', { x: '1y\u00002' }], ['renamed', { x: '1', z: '2' }]]) {
    mkdirSync(join(d, n));
    for (const [f, t] of Object.entries(files)) writeFileSync(join(d, n, f), t);
  }
  assert.equal(new Set(['two', 'one', 'renamed'].map((n) => hashPath(join(d, n)))).size, 3);
  mkdirSync(join(d, 'lb2'));
  symlinkSync('b', join(d, 'lb2', 'la'));
  mkdirSync(join(d, 'la2'));
  symlinkSync('a', join(d, 'la2', 'la'));
  assert.notEqual(hashPath(join(d, 'la2')), hashPath(join(d, 'lb2')));
});

// Stubs a node:fs function for the module under test (it imports named bindings).
function stub(name, impl) {
  const m = mock.method(fs, name, impl);
  syncBuiltinESMExports();
  return () => { m.mock.restore(); syncBuiltinESMExports(); };
}

test('move: across devices it copies, checks and removes the source; another rename error is thrown', noLinks, () => {
  const d = tmp();
  const exdev = () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); };
  mkdirSync(join(d, 'src', 'sub'), { recursive: true });
  writeFileSync(join(d, 'src', 'sub', 'a'), 'a');
  symlinkSync('sub/a', join(d, 'src', 'l'));
  let restore = stub('renameSync', exdev);
  try { move(join(d, 'src'), join(d, 'to', 'dst')); } finally { restore(); }
  assert.deepEqual(readdirSync(d).sort(), ['to']);
  assert.equal(readFileSync(join(d, 'to', 'dst', 'sub', 'a'), 'utf8'), 'a');
  assert.equal(readlinkSync(join(d, 'to', 'dst', 'l')), 'sub/a');

  const cp = fs.cpSync;
  restore = stub('renameSync', exdev);
  const restoreCp = stub('cpSync', (from, to, o) => { cp(from, to, o); writeFileSync(join(to, 'extra'), ''); });
  try { assert.throws(() => move(join(d, 'to', 'dst'), join(d, 'bad')), /differs from the original/); } finally { restoreCp(); restore(); }
  assert.equal(readFileSync(join(d, 'to', 'dst', 'sub', 'a'), 'utf8'), 'a');
  assert.equal(isDir(join(d, 'bad')), false);

  restore = stub('renameSync', () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
  try { assert.throws(() => move(join(d, 'to', 'dst'), join(d, 'other')), /denied/); } finally { restore(); }
  assert.equal(isDir(join(d, 'to', 'dst')), true);
});

test('real: a link to a file is its target, a link to a folder stays the link', noLinks, () => {
  const d = tmp();
  writeFileSync(join(d, 'file'), '');
  mkdirSync(join(d, 'dir'));
  symlinkSync(join(d, 'file'), join(d, 'lf'));
  symlinkSync(join(d, 'dir'), join(d, 'ld'));
  symlinkSync(join(d, 'gone'), join(d, 'dangling'));
  assert.equal(real(join(d, 'lf')), join(d, 'file'));
  assert.equal(real(join(d, 'ld')), join(d, 'ld'));
  assert.equal(real(join(d, 'dangling')), join(d, 'dangling'));
});

test('writeAtomic: keeps the mode of the file it replaces and leaves no temporary file', noLinks, () => {
  const d = tmp();
  const p = join(d, 'sub', 'f');
  writeAtomic(p, 'one');
  chmodSync(p, 0o640);
  writeAtomic(p, 'two');
  assert.equal(readFileSync(p, 'utf8'), 'two');
  assert.equal(statSync(p).mode & 0o777, 0o640);
  writeAtomic(join(d, 'sub', 'g'), 'x', 0o600);
  assert.equal(statSync(join(d, 'sub', 'g')).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(join(d, 'sub')).sort(), ['f', 'g']);
});

test('copy: a new path, a dangling link, an existing folder, and no leftover on failure', noLinks, () => {
  const d = tmp();
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'a'), 'a');
  copy(join(d, 'src'), join(d, 'out', 'dst'));
  assert.equal(readFileSync(join(d, 'out', 'dst', 'a'), 'utf8'), 'a');
  writeFileSync(join(d, 'src', 'b'), 'b');
  copy(join(d, 'src'), join(d, 'out', 'dst'));
  assert.deepEqual(readdirSync(join(d, 'out', 'dst')).sort(), ['a', 'b']);
  symlinkSync('gone', join(d, 'dangling'));
  copy(join(d, 'dangling'), join(d, 'out', 'link'));
  assert.equal(readlinkSync(join(d, 'out', 'link')), 'gone');
  assert.throws(() => copy(join(d, 'missing'), join(d, 'out', 'none')));
  mkdirSync(join(d, 'linked'));
  symlinkSync('x', join(d, 'linked', 'l'));
  copy(join(d, 'linked'), join(d, 'out', 'linked'));
  assert.equal(readlinkSync(join(d, 'out', 'linked', 'l')), 'x');
  assert.deepEqual(readdirSync(join(d, 'out')).sort(), ['dst', 'link', 'linked']);
  // A failed copy onto an existing folder leaves that folder.
  assert.throws(() => copy(join(d, 'missing'), join(d, 'out', 'dst')));
  assert.deepEqual(readdirSync(join(d, 'out', 'dst')).sort(), ['a', 'b']);
});

test('realish: a dangling link stands for its target, a link loop throws', noLinks, () => {
  const d = tmp();
  symlinkSync(join(d, 'target'), join(d, 'dangling'));
  assert.equal(realish(join(d, 'dangling', 'x')), join(d, 'target', 'x'));
  assert.equal(realish(join(d, 'dangling'), false), join(d, 'dangling'));
  symlinkSync('loop', join(d, 'loop'));
  assert.throws(() => realish(join(d, 'loop')), /too many links/);
});

test('inside: a drive root holds every path, a sibling with the same prefix is outside', () => {
  const d = tmp();
  assert.equal(inside(join(d, 'a'), [parse(d).root]), true);
  assert.equal(inside(`${d}x`, [d]), false);
  assert.equal(inside(d, [d]), true);
  assert.equal(inside(join(d, 'a'), [join(d, 'b'), d]), true);
});

test('inside: a link as the last part follows it unless told not to', noLinks, () => {
  const d = tmp(), out = tmp();
  symlinkSync(out, join(d, 'l'));
  assert.equal(inside(join(d, 'l'), [d]), false);
  assert.equal(inside(join(d, 'l'), [d], false), true);
});
