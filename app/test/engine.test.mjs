import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffLines } from '../src/diff.mjs';
import { MergeError, getBlock, mergeJson, setBlock, setToml } from '../src/merge.mjs';
import { apply, context, itemState, legacyBackups, preview, restoreLegacy, undo } from '../src/runner.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'bk-home-'));
const write = (c, path, after, extra = {}) => ({ id: `w-${path}`, step: 's', title: path, kind: 'write', path: join(c.home, path), after, ...extra });

test('JSON merge keeps user keys, comments and list entries', () => {
  const src = '{\n  // mine\n  "model": "opus",\n  "permissions": { "ask": ["Bash(mine *)"] }\n}\n';
  const out = mergeJson(src, [{ path: ['advisorModel'], value: 'opus' }, { path: ['permissions', 'ask'], append: ['Bash(mine *)', 'Bash(git clean *)'] }]);
  assert.match(out, /\/\/ mine/);
  assert.match(out, /"model": "opus"/);
  assert.deepEqual(JSON.parse(out.replace(/\/\/.*\n/, '')).permissions.ask, ['Bash(mine *)', 'Bash(git clean *)']);
  assert.equal(mergeJson(out, [{ path: ['permissions', 'ask'], append: ['Bash(git clean *)'] }]), out);
  assert.throws(() => mergeJson('{ broken', [{ path: ['a'], value: 1 }]), MergeError);
});

test('marked block: append, replace, remove, text outside kept', () => {
  const a = setBlock('# Mine\n\nkeep this\n', 'rules', 'one');
  assert.equal(a, '# Mine\n\nkeep this\n\n<!-- benchkeeper:rules start -->\none\n<!-- benchkeeper:rules end -->\n');
  const b = setBlock(a, 'rules', 'two');
  assert.equal(getBlock(b, 'rules'), 'two');
  assert.equal(setBlock(b, 'rules', null), '# Mine\n\nkeep this\n');
  assert.equal(setBlock(null, 'x', 'y', '#'), '# benchkeeper:x start\ny\n# benchkeeper:x end\n');
  assert.throws(() => setBlock('<!-- benchkeeper:rules start -->', 'rules', 'x'), MergeError);
});

test('TOML: root key above tables, existing table updated, profiles untouched', () => {
  assert.equal(setToml('[analytics]\nenabled = true\n', '', 'model_reasoning_effort', 'high'), 'model_reasoning_effort = "high"\n[analytics]\nenabled = true\n');
  assert.equal(setToml('[analytics]\nenabled = true\n', 'analytics', 'enabled', false), '[analytics]\nenabled = false\n');
  assert.equal(setToml('', 'feedback', 'enabled', false), '[feedback]\nenabled = false\n');
  const prof = '[profiles.fast]\nmodel_reasoning_effort = "low"\n';
  assert.equal(setToml(prof, '', 'model_reasoning_effort', 'high'), `model_reasoning_effort = "high"\n${prof}`);
  assert.equal(setToml('a = 1\n', '', 'a', 1), 'a = 1\n');
});

test('TOML: forms a line edit cannot handle are refused, file unchanged', () => {
  assert.throws(() => setToml('analytics = { enabled = true }\n', 'analytics', 'enabled', false), MergeError);
  assert.throws(() => setToml('x = 1\r\n', '', 'x', 2), MergeError);
  assert.throws(() => setToml('[[analytics]]\nenabled = true\n', 'analytics', 'enabled', false), MergeError);
  assert.throws(() => setToml('not toml [', '', 'x', 1), MergeError);
});

test('diff shows changed lines with context', () => {
  const d = diffLines('a\nb\nc\n', 'a\nB\nc\n', 'f');
  assert.match(d, /^--- f\n\+\+\+ f\n@@\n a\n-b\n\+B\n c/);
  assert.equal(diffLines('x', 'x'), '');
  assert.match(diffLines(null, 'new'), /--- \/dev\/null/);
});

test('preview drops no-op changes and marks removals destructive and unselected', () => {
  const c = context({ home: home() });
  writeFileSync(join(c.home, 'same'), 'x');
  writeFileSync(join(c.home, 'old'), 'x');
  const p = preview([write(c, 'same', 'x'), write(c, 'new', 'y'), { id: 'r', step: 's', title: 'rm', kind: 'remove', path: join(c.home, 'old') }]);
  assert.deepEqual(p.map((x) => [x.id.replace(/.*\//, ''), x.selected]), [['w-new', true], ['r', false]]);
});

test('apply backs up, records, and undo restores; undo of the undo reapplies', () => {
  const c = context({ home: home(), appVersion: '6.0.0' });
  writeFileSync(join(c.home, 'settings.json'), 'old');
  const run = apply([write(c, 'settings.json', 'new'), write(c, 'dir/created.md', 'hi')], c);
  assert.equal(run.status, 'done');
  assert.equal(readFileSync(join(c.home, 'settings.json'), 'utf8'), 'new');
  assert.equal(readFileSync(run.entries[0].backup, 'utf8'), 'old');
  assert.equal(c.ledger.get(run.id).appVersion, '6.0.0');
  const u = undo(run.id, c);
  assert.equal(u.status, 'done');
  assert.equal(readFileSync(join(c.home, 'settings.json'), 'utf8'), 'old');
  assert.equal(existsSync(join(c.home, 'dir/created.md')), false);
  assert.ok(c.ledger.get(run.id).entries.every((e) => e.undone === u.id));
  undo(u.id, c);
  assert.equal(readFileSync(join(c.home, 'settings.json'), 'utf8'), 'new');
});

test('undo of one step leaves the others', () => {
  const c = context({ home: home() });
  const run = apply([write(c, 'a', '1', { step: 'one' }), write(c, 'b', '2', { step: 'two' })], c);
  undo(run.id, c, { step: 'one' });
  assert.equal(existsSync(join(c.home, 'a')), false);
  assert.equal(existsSync(join(c.home, 'b')), true);
});

test('remove moves to the backup, undo moves back', () => {
  const c = context({ home: home() });
  mkdirSync(join(c.home, 'skills/x'), { recursive: true });
  writeFileSync(join(c.home, 'skills/x/SKILL.md'), 'x');
  const run = apply([{ id: 'r', step: 's', title: 'remove x', kind: 'remove', path: join(c.home, 'skills/x'), selected: true }], c);
  assert.equal(existsSync(join(c.home, 'skills/x')), false);
  undo(run.id, c);
  assert.equal(readFileSync(join(c.home, 'skills/x/SKILL.md'), 'utf8'), 'x');
});

test('a failed backup stops the step before any write', { skip: process.getuid?.() === 0 }, () => {
  const c = context({ home: home() });
  writeFileSync(join(c.home, 'keep'), 'mine');
  mkdirSync(join(c.config, 'backup'), { recursive: true });
  chmodSync(join(c.config, 'backup'), 0o500);
  const run = apply([write(c, 'keep', 'theirs'), write(c, 'later', 'x')], c);
  chmodSync(join(c.config, 'backup'), 0o700);
  assert.equal(run.entries[0].status, 'failed');
  assert.equal(run.entries[1].status, 'skipped');
  assert.equal(readFileSync(join(c.home, 'keep'), 'utf8'), 'mine');
  assert.equal(existsSync(join(c.home, 'later')), false);
});

test('writes outside the roots are refused, also through a link', () => {
  const c = context({ home: home() });
  const outside = mkdtempSync(join(tmpdir(), 'bk-out-'));
  symlinkSync(outside, join(c.home, 'escape'));
  const run = apply([{ id: 'a', step: 'a', title: 'a', kind: 'write', path: join(outside, 'x'), after: 'x' }, { id: 'b', step: 'b', title: 'b', kind: 'write', path: join(c.home, 'escape/y'), after: 'y' }], c);
  assert.deepEqual(run.entries.map((e) => e.status), ['failed', 'failed']);
  assert.equal(existsSync(join(outside, 'y')), false);
});

test('failed commands skip the rest of their step; command undo runs its undo argv', () => {
  const calls = [];
  const c = context({ home: home(), run: (argv) => { calls.push(argv.join(' ')); return { code: argv[1] === 'bad' ? 1 : 0, stdout: '', stderr: 'boom' }; } });
  const run = apply([
    { id: '1', step: 'p', title: 'bad', kind: 'command', argv: ['x', 'bad'] },
    { id: '2', step: 'p', title: 'after', kind: 'command', argv: ['x', 'after'] },
    { id: '3', step: 'q', title: 'ok', kind: 'command', argv: ['x', 'install'], undoArgv: ['x', 'uninstall'] },
    { id: '4', step: 'q', title: 'no undo', kind: 'command', argv: ['x', 'add'] },
  ], c);
  assert.deepEqual(run.entries.map((e) => e.status), ['failed', 'skipped', 'done', 'done']);
  const u = undo(run.id, c);
  assert.deepEqual(u.entries.map((e) => e.status), ['manual', 'done']);
  assert.ok(calls.includes('x uninstall'));
});

test('item states', () => {
  const c = context({ home: home() });
  const p = join(c.home, 'rules.md');
  assert.equal(itemState(p, 'v1', c), 'absent');
  writeFileSync(p, 'mine');
  assert.equal(itemState(p, 'v1', c), 'foreign');
  apply([write(c, 'rules.md', 'v1')], c);
  assert.equal(itemState(p, 'v1', c), 'current');
  assert.equal(itemState(p, 'v2', c), 'outdated');
  writeFileSync(p, 'edited');
  assert.equal(itemState(p, 'v2', c), 'modified');
  writeFileSync(p, 'v1');
  rmSync(p);
  assert.equal(itemState(p, 'v1', c), 'removed');
});

test('an interrupted run stays listed without a status, its done entries undoable', () => {
  const c = context({ home: home() });
  const run = apply([write(c, 'a', '1')], c);
  const saved = c.ledger.get(run.id);
  delete saved.status;
  c.ledger.save(saved);
  assert.equal(c.ledger.list()[0].status, undefined);
  undo(run.id, c);
  assert.equal(existsSync(join(c.home, 'a')), false);
});

test('setup.sh backups are listed and restored, the current file kept in the run backup', () => {
  const c = context({ home: home() });
  const legacy = join(c.config, 'backup/2026-10-20-120000/.codex');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'AGENTS.md'), 'my codex rules');
  mkdirSync(join(c.home, '.codex'), { recursive: true });
  writeFileSync(join(c.home, '.codex/AGENTS.md'), 'benchkeeper rules');
  symlinkSync('/nowhere/skill', join(legacy, 'old-link'));
  assert.deepEqual(legacyBackups(c), ['2026-10-20-120000']);
  const run = restoreLegacy('2026-10-20-120000', c);
  assert.equal(run.status, 'done');
  assert.equal(readFileSync(join(c.home, '.codex/AGENTS.md'), 'utf8'), 'my codex rules');
  assert.equal(readFileSync(run.entries.find((e) => e.path.endsWith('AGENTS.md')).backup, 'utf8'), 'benchkeeper rules');
  assert.throws(() => restoreLegacy('../x', c));
});
