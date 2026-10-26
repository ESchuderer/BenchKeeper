import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { context } from '../src/runner.mjs';

// A fixture project with a setup state (which clear must leave alone) and a knowledge base; the home is a temporary one.
function fixture(answers = '') {
  const home = mkdtempSync(join(tmpdir(), 'bk-know-home-')), dir = mkdtempSync(join(tmpdir(), 'bk-know-proj-'));
  mkdirSync(join(dir, '.benchkeeper/knowledge'), { recursive: true });
  writeFileSync(join(dir, '.benchkeeper/state.json'), '{"kept":true}\n');
  writeFileSync(join(dir, 'README.md'), 'project file\n');
  const k = (name, entries) => writeFileSync(join(dir, '.benchkeeper/knowledge', name), JSON.stringify({ entries }));
  k('verdicts.json', [{ id: 'cleanup:src/a.mjs:unusedFn', verdict: 'kept', reason: 'public API', commit: 'abc123' }, { id: 'cleanup:src/b.mjs:dup', verdict: 'rejected', files: ['src/b.mjs'] }]);
  k('tests.json', [{ id: 'test/a.test.mjs', score: 81.4, hash: 'f00' }]);
  let text = '', errText = '';
  const sink = (set) => new Writable({ write(chunk, _, done) { set(String(chunk)); done(); } });
  const out = sink((c) => { text += c; }), err = sink((c) => { errText += c; });
  const exec = (args) => main(args, { out, err, ctx: context({ home }), input: Readable.from([answers]) });
  return { dir, exec, text: () => text, err: () => errText, json: () => JSON.parse(text) };
}

test('show prints the entries of each file', async () => {
  const f = fixture();
  assert.equal(await f.exec(['maintain', 'knowledge', 'show', f.dir]), 0);
  assert.match(f.text(), /tests\.json {2}1 entries\n {2}test\/a\.test\.mjs {2}score=81\.4 hash=f00/);
  assert.match(f.text(), /verdicts\.json {2}2 entries\n {2}cleanup:src\/a\.mjs:unusedFn {2}verdict=kept reason=public API commit=abc123/);
});

test('show --json prints the result document in the envelope', async () => {
  const f = fixture();
  assert.equal(await f.exec(['maintain', 'knowledge', 'show', f.dir, '--json']), 0);
  const doc = f.json();
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.command, 'maintain knowledge show');
  assert.equal(doc.dir, f.dir);
  assert.deepEqual(doc.files.map((x) => [x.name, x.entries.length]), [['tests.json', 1], ['verdicts.json', 2]]);
  assert.deepEqual(doc.ignored, []);
});

test('show without a knowledge base says so, and --json has empty lists', async () => {
  const f = fixture();
  const empty = mkdtempSync(join(tmpdir(), 'bk-know-empty-'));
  assert.equal(await f.exec(['maintain', 'knowledge', 'show', empty]), 0);
  assert.match(f.text(), /no knowledge stored for/);
  const g = fixture();
  assert.equal(await g.exec(['maintain', 'knowledge', 'show', empty, '--json']), 0);
  assert.deepEqual(g.json().files, []);
});

test('a tampered, oversized or linked file is ignored with a reason, the rest is shown', async () => {
  const f = fixture();
  const kb = join(f.dir, '.benchkeeper/knowledge');
  writeFileSync(join(kb, 'broken.json'), '{ not json');
  writeFileSync(join(kb, 'shape.json'), '{"entries":"x"}');
  writeFileSync(join(kb, 'big.json'), `{"entries":[],"pad":"${'x'.repeat(1024 * 1024)}"}`);
  writeFileSync(join(f.dir, 'secret.json'), '{"entries":[{"id":"outside"}]}');
  symlinkSync(join(f.dir, 'secret.json'), join(kb, 'link.json'));
  assert.equal(await f.exec(['maintain', 'knowledge', 'show', f.dir]), 0);
  for (const name of ['broken.json', 'shape.json', 'big.json', 'link.json']) assert.match(f.text(), new RegExp(`ignored ${name}: `));
  assert.doesNotMatch(f.text(), /outside/);
  assert.match(f.text(), /verdicts\.json {2}2 entries/);
});

test('stored text cannot carry terminal control characters or token shapes to the output', async () => {
  const f = fixture();
  writeFileSync(join(f.dir, '.benchkeeper/knowledge/open.json'), JSON.stringify({ entries: [{ id: 'q1', note: '\u001b[31mred ghp_abcdefghijklmnop' }] }));
  await f.exec(['maintain', 'knowledge', 'show', f.dir]);
  assert.doesNotMatch(f.text(), /\u001b/);
  assert.doesNotMatch(f.text(), /ghp_abcdefghijklmnop/);
});

test('clear asks, a no keeps everything, a yes removes the knowledge folder and nothing else', async () => {
  const f = fixture('n\n');
  assert.equal(await f.exec(['maintain', 'knowledge', 'clear', f.dir]), 1);
  assert.match(f.text(), /Remove .*knowledge \(3 entries in 2 files\)\? \[y\/N\]/);
  assert.ok(existsSync(join(f.dir, '.benchkeeper/knowledge/verdicts.json')));
  const g = fixture('y\n');
  assert.equal(await g.exec(['maintain', 'knowledge', 'clear', g.dir]), 0);
  assert.equal(existsSync(join(g.dir, '.benchkeeper/knowledge')), false);
  assert.equal(readFileSync(join(g.dir, '.benchkeeper/state.json'), 'utf8'), '{"kept":true}\n');
  assert.equal(readFileSync(join(g.dir, 'README.md'), 'utf8'), 'project file\n');
});

test('clear --yes skips the question; ignored files go too; a second clear finds nothing', async () => {
  const f = fixture();
  writeFileSync(join(f.dir, '.benchkeeper/knowledge/broken.json'), 'x');
  assert.equal(await f.exec(['maintain', 'knowledge', 'clear', f.dir, '--yes']), 0);
  assert.doesNotMatch(f.text(), /\[y\/N\]/);
  assert.equal(existsSync(join(f.dir, '.benchkeeper/knowledge')), false);
  assert.ok(existsSync(join(f.dir, '.benchkeeper/state.json')));
  assert.equal(await f.exec(['maintain', 'knowledge', 'clear', f.dir, '--yes']), 0);
  assert.match(f.text(), /no knowledge stored for/);
});

test('a linked knowledge folder is shown as ignored and clear removes the link, not its target', async () => {
  const f = fixture();
  const target = mkdtempSync(join(tmpdir(), 'bk-know-target-'));
  writeFileSync(join(target, 'verdicts.json'), '{"entries":[]}');
  const kb = join(f.dir, '.benchkeeper/knowledge');
  rmSync(kb, { recursive: true });
  symlinkSync(target, kb);
  await f.exec(['maintain', 'knowledge', 'show', f.dir]);
  assert.match(f.text(), /ignored \.: not a folder/);
  await f.exec(['maintain', 'knowledge', 'clear', f.dir, '--yes']);
  assert.equal(existsSync(kb), false);
  assert.ok(existsSync(join(target, 'verdicts.json')));
});

test('usage errors: unknown subcommand, a surplus argument with --json', async () => {
  const f = fixture();
  assert.equal(await f.exec(['maintain', 'knowledge', 'list']), 2);
  assert.match(f.text(), /maintain needs knowledge show or knowledge clear/);
  const g = fixture();
  assert.equal(await g.exec(['maintain', 'knowledge', 'clear', g.dir, '--json']), 2);
  assert.equal(g.json().command, 'maintain knowledge clear');
  assert.match(g.json().error, /works with knowledge show/);
  const h = fixture();
  assert.equal(await h.exec(['maintain', 'knowledge', 'show', h.dir, 'extra', '--json']), 2);
  assert.match(h.json().error, /unexpected argument extra/);
});
