import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { diffLines } from '../src/diff.mjs';
import { MergeError, getBlock, mergeJson, setBlock, setToml } from '../src/merge.mjs';
import { apply, context, itemState, legacyBackups, preview, restoreLegacy, runCommandAsync, undo } from '../src/runner.mjs';

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

test('JSON merge pulls list entries and prunes what is left empty', () => {
  const pull = (t) => mergeJson(t, [{ path: ['s', 'on'], remove: true }, { path: ['s', 'x'], pull: ['a', 'b'] }, { path: ['s'], prune: true }]);
  assert.deepEqual(JSON.parse(pull('{ "s": { "on": true, "x": ["mine", "a", "b"] } }')), { s: { x: ['mine'] } });
  assert.deepEqual(JSON.parse(pull('{ "k": 1, "s": { "on": true, "x": ["a", "b"] } }')), { k: 1 });
  assert.equal(pull('{ "k": 1 }\n'), '{ "k": 1 }\n');
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
  assert.match(d, /^--- f\n\+\+\+ f\n@@ -1,4 \+1,4 @@\n a\n-b\n\+B\n c/);
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

test('undo refuses a file changed after the change, and a missing backup; a whole run goes newest first', () => {
  const c = context({ home: home() });
  writeFileSync(join(c.home, 'f'), '0');
  const edit = (id, step, v) => ({ id, step, title: id, kind: 'write', path: join(c.home, 'f'), edit: (t) => `${t}${v}` });
  const run = apply([edit('a', 'one', '1'), edit('b', 'two', '2')], c);
  assert.equal(readFileSync(join(c.home, 'f'), 'utf8'), '012');
  // Step one alone would put back '0' and lose step two's edit.
  const one = undo(run.id, c, { step: 'one' });
  assert.equal(one.status, 'failed');
  assert.match(one.entries[0].error, /changed after this change/);
  assert.equal(readFileSync(join(c.home, 'f'), 'utf8'), '012');
  assert.equal(undo(run.id, c).status, 'done');
  assert.equal(readFileSync(join(c.home, 'f'), 'utf8'), '0');
  const again = apply([edit('a', 'one', '1')], c);
  writeFileSync(join(c.home, 'f'), 'mine');
  assert.equal(undo(again.id, c).status, 'failed', 'a user edit after the apply stays');
  assert.equal(readFileSync(join(c.home, 'f'), 'utf8'), 'mine');
  const third = apply([edit('a', 'one', '!')], c);
  rmSync(c.ledger.get(third.id).entries[0].backup);
  assert.match(undo(third.id, c).entries[0].error, /backup .* is missing/);
  assert.equal(readFileSync(join(c.home, 'f'), 'utf8'), 'mine!');
});

test('an async command keeps its last 64 kB and is stopped after its deadline', async () => {
  const big = await runCommandAsync(['node', '-e', 'process.stdout.write("x".repeat(200000))']);
  assert.deepEqual([big.code, big.stdout.length], [0, 65536]);
  const slow = await runCommandAsync(['node', '-e', 'setTimeout(() => {}, 5000)'], { timeout: 100 });
  assert.equal(slow.code, 124);
  assert.match(slow.stderr, /stopped after/);
  const whole = await runCommandAsync(['node', '-e', 'process.stdout.write("x".repeat(200000))'], { keep: 1e6 });
  assert.equal(whole.stdout.length, 200000);
  // SIGTERM ignored: SIGKILL after the grace period.
  const stubborn = await runCommandAsync(['node', '-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 5000)'], { timeout: 100, grace: 100 });
  assert.equal(stubborn.code, 124);
  const ac = new AbortController();
  const cancelled = runCommandAsync(['node', '-e', 'setTimeout(() => {}, 5000)'], { signal: ac.signal });
  ac.abort();
  assert.deepEqual([(await cancelled).code, /cancelled/.test((await cancelled).stderr)], [130, true]);
  // A cancel reaches the helpers a command started, not only the command.
  const dir = home(), helper = join(dir, 'helper.js'), mark = join(dir, 'helper-ran');
  writeFileSync(helper, "setTimeout(() => require('fs').writeFileSync(process.argv[2], 'x'), 800);");
  const tree = new AbortController();
  const parent = runCommandAsync(['node', '-e', "require('child_process').spawn('node', process.argv.slice(1), { stdio: 'ignore' }); setTimeout(() => {}, 5000)", helper, mark], { signal: tree.signal });
  setTimeout(() => tree.abort(), 200);
  assert.equal((await parent).code, 130);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(existsSync(mark), false);
  // A cancel during a timeout's grace period stays a timeout.
  const late = new AbortController();
  const timedOut = runCommandAsync(['node', '-e', 'process.on("SIGTERM", () => {}); setTimeout(() => {}, 5000)'], { timeout: 100, grace: 300, signal: late.signal });
  setTimeout(() => late.abort(), 200);
  assert.equal((await timedOut).code, 124);
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
  const c = context({ home: home(), run: (argv) => { calls.push(argv.join(' ')); return { code: argv.includes('bad') ? 1 : 0, stdout: '', stderr: 'boom' }; } });
  const run = apply([
    { id: '1', step: 'p', title: 'bad', kind: 'command', argv: ['claude', 'plugin', 'install', 'bad'] },
    { id: '2', step: 'p', title: 'after', kind: 'command', argv: ['claude', 'plugin', 'install', 'after'] },
    { id: '3', step: 'q', title: 'ok', kind: 'command', argv: ['claude', 'plugin', 'install', 'ok'], undoArgv: ['claude', 'plugin', 'uninstall', 'ok'] },
    { id: '4', step: 'q', title: 'no undo', kind: 'command', argv: ['claude', 'plugin', 'install', 'add'] },
  ], c);
  assert.deepEqual(run.entries.map((e) => e.status), ['failed', 'skipped', 'done', 'done']);
  const u = undo(run.id, c);
  assert.deepEqual(u.entries.map((e) => e.status), ['manual', 'done']);
  assert.ok(calls.includes('claude plugin uninstall ok'));
});

test('a cancel finishes the unit it lands in, then skips the rest', () => {
  const c = context({ home: home(), run: () => ({ code: 0, stdout: '', stderr: '' }) });
  let n = 0;
  const run = apply([
    { id: '1', step: 'm', title: 'marketplace', kind: 'command', argv: ['x', 'm'], unit: 'u' },
    { id: '2', step: 'p', title: 'plugin', kind: 'command', argv: ['x', 'p'], unit: 'u' },
    { id: '3', step: 'q', title: 'other', kind: 'command', argv: ['x', 'q'] },
  ], c, { stop: () => n++ > 0 });
  assert.deepEqual(run.entries.map((e) => e.status), ['done', 'done', 'skipped']);
  assert.equal(run.status, 'cancelled');
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

test('a linked settings file stays a link and keeps its mode; an empty JSON file merges', () => {
  const c = context({ home: home() });
  mkdirSync(join(c.home, 'dotfiles'));
  const target = join(c.home, 'dotfiles/settings.json');
  writeFileSync(target, '{"a":1}\n');
  chmodSync(target, 0o600);
  symlinkSync(target, join(c.home, 'settings.json'));
  writeFileSync(join(c.home, 'empty.json'), '');
  const run = apply(preview([
    write(c, 'settings.json', null, { edit: (t) => t.replace('1', '2'), after: undefined }),
    write(c, 'empty.json', null, { id: 'e', edit: (t) => mergeJson(t, [{ path: ['b'], value: 1 }]), after: undefined }),
  ]), c);
  assert.equal(run.status, 'done', JSON.stringify(run.entries));
  assert.ok(lstatSync(join(c.home, 'settings.json')).isSymbolicLink());
  assert.equal(readFileSync(target, 'utf8'), '{"a":2}\n');
  assert.equal(statSync(target).mode & 0o777, 0o600);
  assert.equal(itemState(join(c.home, 'settings.json'), '{"a":2}\n', c), 'current');
  assert.equal(JSON.parse(readFileSync(join(c.home, 'empty.json'), 'utf8')).b, 1);
  undo(run.id, c);
  assert.equal(readFileSync(target, 'utf8'), '{"a":1}\n');
});

test('a change that fails after its backup is undone from the backup', () => {
  const c = context({ home: home() });
  writeFileSync(join(c.home, 'f.txt'), 'original\n');
  // Copying from a missing source fails after the original was moved aside.
  const run = apply(preview([write(c, 'f.txt', null, { from: join(c.home, 'missing'), after: undefined })]).map((x) => ({ ...x, selected: true })), c);
  assert.equal(run.entries[0].status, 'failed');
  assert.equal(existsSync(join(c.home, 'f.txt')), false);
  assert.equal(undo(run.id, c).status, 'done');
  assert.equal(readFileSync(join(c.home, 'f.txt'), 'utf8'), 'original\n');
});

test('changes of one unit go together: a partial choice is refused before anything changes', () => {
  const c = context({ home: home() });
  const changes = [write(c, 'a.txt', 'a\n', { id: 'a', unit: 'u' }), write(c, 'b.txt', 'b\n', { id: 'b', unit: 'u' })];
  assert.throws(() => apply(changes, c, { select: ['a'] }), /go together/);
  assert.equal(existsSync(join(c.home, 'a.txt')), false);
  assert.equal(apply(changes, c, { select: ['a', 'b'] }).status, 'done');
  const broken = preview([write(c, 'x.json', null, { id: 'x', unit: 'v', edit: () => { throw new Error('bad'); } }), write(c, 'y.txt', 'y\n', { id: 'y', unit: 'v' })]);
  assert.deepEqual(broken.map((x) => x.selected), [false, false]);
});

test('the ledger list is kept until a save, here or by another process', () => {
  const c = context({ home: home() });
  apply([write(c, 'a.txt', 'a\n')], c);
  const first = c.ledger.list();
  assert.equal(c.ledger.list(), first);
  // Another process: a separate ledger object on the same folder.
  apply([write(c, 'b.txt', 'b\n')], context({ home: c.home }));
  assert.equal(c.ledger.list().length, 2);
});
