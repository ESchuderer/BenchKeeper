import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { context } from '../src/runner.mjs';
import { writeSessions } from './fixtures/sessions.mjs';

function cli(answers = '') {
  const home = mkdtempSync(join(tmpdir(), 'bk-cli-'));
  const ctx = context({ home, run: (argv) => (argv[0] === 'npm' ? { code: 1, stdout: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0' }) });
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args) => main(args, { out, ctx, input: Readable.from([answers]) });
  return { home, exec, text: () => text };
}

test('plan writes nothing; apply asks per change and n skips', async () => {
  const c = cli('n\n'.repeat(50));
  assert.equal(await c.exec(['plan', '--agents', 'claude']), 0);
  assert.match(c.text(), /change Claude Code rules/);
  assert.equal(existsSync(join(c.home, '.claude')), false);
  await c.exec(['apply', '--agents', 'claude']);
  assert.match(c.text(), /apply\? \[y\/N\]/);
  assert.equal(existsSync(join(c.home, '.claude/rules/00-global.md')), false);
});

test('apply --yes, history, undo', async () => {
  const c = cli();
  assert.equal(await c.exec(['apply', '--agents', 'claude', '--yes']), 0);
  assert.ok(existsSync(join(c.home, '.claude/rules/00-global.md')));
  const id = c.text().match(/undo with benchkeeper undo (\S+)/)[1];
  await c.exec(['history']);
  assert.match(c.text(), new RegExp(`${id}  apply +done`));
  assert.equal(await c.exec(['undo', id]), 0);
  assert.equal(existsSync(join(c.home, '.claude/rules/00-global.md')), false);
});

test('help and unknown commands', async () => {
  const c = cli();
  assert.equal(await c.exec(['--help']), 0);
  assert.match(c.text(), /Usage: benchkeeper/);
  assert.equal(await c.exec(['nope']), 2);
});

test('board writes the sessions page for this user only', async () => {
  const c = cli();
  writeSessions(c.home);
  assert.equal(await c.exec(['board', '--no-open']), 0);
  const file = join(c.home, '.config/benchkeeper/board.html');
  assert.match(c.text(), /3 sessions: .*board\.html/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(readFileSync(file, 'utf8'), /"id":"c1"/);
});
