import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MergeError, getBlock, mergeJson, parseJson, removeTable, removeToml, setBlock, setToml } from '../src/merge.mjs';

test('parseJson: empty text is an empty object, an error names the file, the code and the offset', () => {
  assert.deepEqual(parseJson(''), {});
  assert.deepEqual(parseJson('  \n'), {});
  assert.deepEqual(parseJson(undefined), {});
  assert.deepEqual(parseJson('null'), {});
  assert.deepEqual(parseJson('{"a": [1,],}'), { a: [1] });
  assert.throws(() => parseJson('{"a": }', 'x.json'), (e) => e instanceof MergeError && e.message === 'x.json: ValueExpected at offset 6');
  assert.throws(() => parseJson('{'), /^Error: JSON: /);
});

test('mergeJson: empty text, a final newline, append ignores key order and refuses a non-list', () => {
  assert.equal(mergeJson('', [{ path: ['a'], value: 1 }]), '{\n  "a": 1\n}\n');
  assert.equal(mergeJson(undefined, []), '{}\n');
  assert.equal(mergeJson('{"a":1}', []), '{"a":1}\n');
  const src = '{"l": [{"b": 1, "a": 2}]}';
  assert.equal(mergeJson(src, [{ path: ['l'], append: [{ a: 2, b: 1 }] }]), `${src}\n`);
  assert.equal(mergeJson('{}', [{ path: ['l'], append: ['x'] }]), '{\n  "l": [\n    "x"\n  ]\n}\n');
  assert.throws(() => mergeJson('{"l": {"m": 1}}', [{ path: ['l', 'm'], append: ['x'] }], 'f.json'), /^Error: f\.json: l\.m is not a list$/);
  assert.throws(() => mergeJson('{"l": 1}', [{ path: ['l'], append: ['x'] }], 'f.json'), /f\.json: l is not a list/);
});

test('mergeJson: pull and prune leave other values, remove skips a missing key', () => {
  assert.equal(mergeJson('{"l": 1}', [{ path: ['l'], pull: ['a'] }]), '{"l": 1}\n');
  assert.equal(mergeJson('{"l": ["a"]}', [{ path: ['l'], pull: ['b'] }]), '{"l": ["a"]}\n');
  assert.equal(mergeJson('{"l": [{"y": 1, "x": 2}, "b"]}', [{ path: ['l'], pull: [{ x: 2, y: 1 }] }]), '{"l": [\n    "b"\n  ]}\n');
  assert.equal(mergeJson('{"l": ["a"], "k": 1}', [{ path: ['l'], pull: ['a'] }]), '{\n  "k": 1\n}\n');
  for (const src of ['{"o": {"x": 1}}', '{"o": 1}', '{"o": null}', '{"o": ["x"]}', '{}']) assert.equal(mergeJson(src, [{ path: ['o'], prune: true }]), `${src}\n`, src);
  assert.equal(mergeJson('{"o": [], "k": 1}', [{ path: ['o'], prune: true }]), '{\n  "k": 1\n}\n');
  assert.equal(mergeJson('{"k": 1}', [{ path: ['o', 'p'], remove: true }]), '{"k": 1}\n');
  assert.equal(mergeJson('{"k": null, "j": 1}', [{ path: ['k'], remove: true }]), '{\n  "j": 1\n}\n');
});

test('mergeJson: an add after or a removal next to a one-line object or list leaves that line as written', () => {
  const doc = '{\n  "env": {"A": "1"},\n  "x": {"keep": true}\n}\n';
  assert.equal(mergeJson(doc, [{ path: ['model'], value: 'opus' }]), '{\n  "env": {"A": "1"},\n  "x": {"keep": true},\n  "model": "opus"\n}\n');
  assert.equal(mergeJson('{\n  "x": [1, 2]\n}\n', [{ path: ['model'], value: { a: 1 } }]), '{\n  "x": [1, 2],\n  "model": {\n    "a": 1\n  }\n}\n');
  assert.equal(mergeJson('{\r\n  "x": [1, 2]\r\n}\r\n', [{ path: ['model'], value: 'opus' }]), '{\r\n  "x": [1, 2],\r\n  "model": "opus"\r\n}\r\n');
  // A removal before, between and after neighbours.
  assert.equal(mergeJson('{\n  "model": "a",\n  "x": {"a": 1}\n}\n', [{ path: ['model'], remove: true }]), '{\n  "x": {"a": 1}\n}\n');
  assert.equal(mergeJson('{\n  "x": {"a": 1},\n  "model": "a",\n  "y": [1, 2]\n}\n', [{ path: ['model'], remove: true }]), '{\n  "x": {"a": 1},\n  "y": [1, 2]\n}\n');
  assert.equal(mergeJson('{\n  "x": {"a": 1},\n  "model": "a"\n}\n', [{ path: ['model'], remove: true }]), '{\n  "x": {"a": 1}\n}\n');
  // Nested: a key added to an object keeps its sibling list on one line.
  assert.equal(mergeJson('{\n  "permissions": {\n    "allow": ["a", "b"]\n  }\n}\n', [{ path: ['permissions', 'deny'], value: ['x'] }]), '{\n  "permissions": {\n    "allow": ["a", "b"],\n    "deny": [\n      "x"\n    ]\n  }\n}\n');
});

test('setBlock and getBlock: HTML and # markers, text around the block, removal', () => {
  assert.equal(setBlock('', 'r', 'x'), '<!-- benchkeeper:r start -->\nx\n<!-- benchkeeper:r end -->\n');
  assert.equal(setBlock('  \n', 'r', 'x  \n'), '<!-- benchkeeper:r start -->\nx\n<!-- benchkeeper:r end -->\n');
  assert.equal(setBlock('mine', 'r', null), 'mine');
  assert.equal(setBlock(undefined, 'r', null), '');
  const mid = 'top\n\n# benchkeeper:r start\nold\n# benchkeeper:r end\n\n\nbottom\n';
  assert.equal(setBlock(mid, 'r', 'new', '#'), 'top\n\n# benchkeeper:r start\nnew\n# benchkeeper:r end\n\n\nbottom\n');
  assert.equal(setBlock(mid, 'r', null, '#'), 'top\n\nbottom\n');
  assert.equal(setBlock('# benchkeeper:r start\nold\n# benchkeeper:r end\n\nbottom\n', 'r', null, '#'), 'bottom\n');
  assert.equal(setBlock('top  \n# benchkeeper:r start\nold\n# benchkeeper:r end', 'r', null, '#'), 'top\n');
  assert.equal(setBlock('# benchkeeper:r start\nold\n# benchkeeper:r end\n', 'r', null, '#'), '');
  assert.throws(() => setBlock('<!-- benchkeeper:r end -->\n<!-- benchkeeper:r start -->', 'r', 'x'), /^Error: unbalanced benchkeeper:r markers$/);
  assert.throws(() => setBlock('<!-- benchkeeper:r end -->', 'r', 'x'), MergeError);
  assert.equal(getBlock(mid, 'r', '#'), 'old');
  assert.equal(getBlock(mid, 'r'), null);
  assert.equal(getBlock(null, 'r'), null);
  assert.equal(getBlock('<!-- benchkeeper:r end --><!-- benchkeeper:r start -->', 'r'), null);
});

test('setToml: tables, quoted keys, comments that stay, values of every kind', () => {
  assert.equal(setToml(undefined, '', 'a', 1), 'a = 1\n');
  assert.equal(setToml('a = 1 # why\n', '', 'a', 2), 'a = 2 # why\n');
  assert.equal(setToml('a = "x # y"  # why\n', '', 'a', 'z'), 'a = "z"  # why\n');
  assert.equal(setToml("a = 'x' # why\n", '', 'a', 'z'), 'a = "z" # why\n');
  assert.equal(setToml('a = [1, 2] # why\n', '', 'a', [3]), 'a = [3] # why\n');
  assert.equal(setToml('a = 1\n', '', 'a', 2), 'a = 2\n');
  assert.throws(() => setToml('"a.b" = 1\n', '', 'a.b', 2), /root\.a\.b: this form needs manual editing/);
  assert.equal(setToml('  k = 1\n', '', 'k', true), 'k = true\n');
  assert.equal(setToml('x = 1\n\n[t]\ny = 2\n', '', 'z', 3), 'x = 1\nz = 3\n\n[t]\ny = 2\n');
  assert.equal(setToml('x = 1\n\n# about t\n[t]\ny = 2\n', '', 'z', 3), 'x = 1\nz = 3\n\n# about t\n[t]\ny = 2\n');
  assert.equal(setToml('[t]\ny = 2\n\n[u]\nw = 1\n', 't', 'z', 'v'), '[t]\ny = 2\nz = "v"\n\n[u]\nw = 1\n');
  assert.equal(setToml('[t]\ny = 2', 't', 'z', 1), '[t]\ny = 2\nz = 1\n');
  assert.equal(setToml('[t]\ny = 2\n', 'u', 'z', 1), '[t]\ny = 2\n\n[u]\nz = 1\n');
  assert.equal(setToml('[t]\ny = 2', 'u', 'z', 1), '[t]\ny = 2\n\n[u]\nz = 1\n');
  assert.equal(setToml('[a.b]\nx = 1\n', 'a.b', 'x', 2), '[a.b]\nx = 2\n');
  assert.equal(setToml('[a]\nx = 1\n', 'a.b', 'x', 1), '[a]\nx = 1\n\n[a.b]\nx = 1\n');
  assert.equal(setToml('[t]\nx = 1\n', 't', 'x', 1), '[t]\nx = 1\n');
  assert.throws(() => setToml('a = 1\nb.c = 2\n', '', 'b', 1), (e) => e instanceof MergeError && e.message === 'root.b: this form needs manual editing');
  assert.throws(() => setToml('[t]\nx.y = 1\n', 't', 'x', 1), /^Error: t\.x: this form needs manual editing$/);
  assert.throws(() => setToml('a = [\n', '', 'a', 1), /^Error: invalid TOML: /);
  assert.throws(() => setToml('a = 1\r\n', '', 'a', 2), /^Error: CRLF line endings: edit by hand$/);
});

test('removeToml: root and table keys, quoted keys, what needs manual editing', () => {
  assert.equal(removeToml(undefined, '', 'a'), '');
  assert.equal(removeToml('a = 1', '', 'a'), '');
  assert.equal(removeToml('a = 1\nb = 2', '', 'a'), 'b = 2\n');
  assert.equal(removeToml('"a" = 1\nb = 2\n', '', 'a'), 'b = 2\n');
  assert.equal(removeToml('x = 0\n[t]\na = 1\n[u]\na = 2\n', 'u', 'a'), 'x = 0\n[t]\na = 1\n[u]\n');
  assert.equal(removeToml('a = 0\n[t]\na = 1\n', '', 'a'), '[t]\na = 1\n');
  assert.equal(removeToml('[t]\na = 1\n', 't', 'b'), '[t]\na = 1\n');
  assert.equal(removeToml('[t.u]\na = 1\n', 't.u', 'a'), '[t.u]\n');
  assert.throws(() => removeToml('t = { a = 1 }\n', 't', 'a'), /^Error: t\.a: this form needs manual editing$/);
  assert.throws(() => removeToml('t.a = 1\n', '', 't'), /^Error: root\.t: this form needs manual editing$/);
  assert.throws(() => removeToml('a = 1\r\n', '', 'a'), /^Error: CRLF line endings: edit by hand$/);
  assert.throws(() => removeToml('a = ', '', 'a'), /^Error: invalid TOML: /);
});

test('removeTable: nested and quoted headers, an implied parent goes, a kept header stays', () => {
  assert.equal(removeTable(undefined, ['a']), '');
  assert.equal(removeTable('[a]\nx = 1\n', ['b']), '[a]\nx = 1\n');
  assert.equal(removeTable('[a]\nx = 1', ['a']), '');
  assert.equal(removeTable('[p]\n[p.q]\nx = 1\n', ['p', 'q']), '[p]\n');
  assert.equal(removeTable('[p.q]\nx = 1\n[r]\ny = 2\n', ['p', 'q']), '[r]\ny = 2\n');
  assert.equal(removeTable('[p.q]\nx = 1\n[p.s]\ny = 2\n', ['p', 'q']), '[p.s]\ny = 2\n');
  assert.equal(removeTable('[[l]]\nx = 1\n[l2]\ny = 2\n', ['l2']), '[[l]]\nx = 1\n');
  assert.throws(() => removeTable('p = { q = { x = 1 } }\n', ['p', 'q']), /^Error: p\.q: this form needs manual editing$/);
  assert.throws(() => removeTable('[p]\nq.x = 1\n', ['p', 'q']), /^Error: p\.q: this form needs manual editing$/);
  assert.throws(() => removeTable('[p]\r\n', ['p']), /^Error: CRLF line endings: edit by hand$/);
  assert.throws(() => removeTable('[p', ['p']), /^Error: invalid TOML: /);
});
