import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { context } from '../src/runner.mjs';
import { writeRunSessions, writeSessions } from './fixtures/sessions.mjs';

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
  assert.equal(await c.exec(['sessions', 'board', '--no-open']), 0);
  const file = join(c.home, '.config/benchkeeper/board.html');
  assert.match(c.text(), /3 sessions: .*board\.html/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.match(readFileSync(file, 'utf8'), /"id":"c1"/);
});

test('sessions list: cost and tokens per run, with --run per task; no worker text or title', async () => {
  const MARK = 'PLANTED-WORKER-TEXT-4711';
  const c = cli();
  writeRunSessions(c.home, '/work/app', MARK, { title: MARK });
  assert.equal(await c.exec(['sessions', 'list']), 0);
  assert.equal(await c.exec(['sessions', 'list', '--run', 'r-9']), 0);
  assert.equal(c.text(), [
    'run r-9: 3 sessions, $2.25, 345 tokens',
    'run r-9: 3 sessions, $2.25, 345 tokens',
    '  task task_b: 1 session, $0.25, 115 tokens',
    '  task task_a: 2 sessions, $2.00, 230 tokens',
    '',
  ].join('\n'));
  assert.equal(await c.exec(['sessions', 'list', '--run', 'nope']), 1);
  assert.match(c.text(), /no sessions of run nope/);
  assert.ok(!c.text().includes(MARK));
});

test('the old command names are unknown and the removed skill flags are refused', async () => {
  for (const old of [['project', 'plan'], ['update-all'], ['test'], ['board'], ['record'], ['eval'], ['case', 'add'], ['maintain', 'knowledge', 'show']]) {
    const c = cli();
    assert.equal(await c.exec(old), 2, old.join(' '));
    assert.match(c.text(), /unknown command/, old.join(' '));
  }
  await assert.rejects(cli().exec(['projects', 'apply', '--disable', 'x']), /Unknown option '--disable'/);
  await assert.rejects(cli().exec(['projects', 'apply', '--enable', 'x']), /Unknown option '--enable'/);
});

test('sessions record runs the command after -- and records its files; sessions without a subcommand is a usage error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-rec-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  // The default runner: the recording needs real git and a real process.
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-rec-home-')) });
  const exec = async (args) => { let text = ''; const code = await main(args, { out: new Writable({ write(c, _, done) { text += c; done(); } }), ctx, input: Readable.from(['']) }); return { code, text }; };
  let o = await exec(['sessions', 'record', '--project', dir, '--', 'sh', '-c', 'echo x > n']);
  assert.equal(o.code, 0, o.text);
  assert.match(o.text, /session exit 0, 1 files changed/);
  assert.equal(readFileSync(join(dir, 'n'), 'utf8'), 'x\n');
  o = await exec(['sessions', 'record', '--project', dir]);
  assert.deepEqual([o.code, /sessions record needs the agent command after --/.test(o.text)], [2, true]);
  o = await exec(['sessions']);
  assert.deepEqual([o.code, /sessions needs board, list or record/.test(o.text)], [2, true]);
});
