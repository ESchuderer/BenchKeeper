import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HELP, helpFor, main } from '../src/cli.mjs';
import { addProject } from '../src/projects.mjs';
import { context } from '../src/runner.mjs';
import { writeRunSessions, writeSessions } from './fixtures/sessions.mjs';

function cli(answers = '') {
  const home = mkdtempSync(join(tmpdir(), 'bk-cli-'));
  const ctx = context({ home, run: (argv) => (argv[0] === 'npm' ? { code: 1, stdout: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0' }) });
  let text = '', errText = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const err = new Writable({ write(chunk, _, done) { errText += chunk; done(); } });
  const exec = (args) => main(args, { out, err, ctx, input: Readable.from([answers]) });
  return { home, exec, text: () => text, err: () => errText };
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

test('a changing command with no answer refuses before any change; every change declined records no run', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-cli-'));
  const dir = mkdtempSync(join(tmpdir(), 'bk-cli-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const ctx = context({ home, roots: [home, dir], run: (argv) => ({ code: ['npm', 'podman', 'docker'].includes(argv[0]) ? 1 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' }) });
  addProject(ctx, dir);
  const exec = async (args, answers = '') => {
    let text = '', err = '';
    const code = await main(args, { out: new Writable({ write(c, _, done) { text += c; done(); } }), err: new Writable({ write(c, _, done) { err += c; done(); } }), ctx, input: Readable.from([answers]) });
    return { code, text, err };
  };
  const files = () => [home, dir].flatMap((d) => readdirSync(d, { recursive: true })).sort();
  const refused = async (args, name) => {
    const before = files(), runs = ctx.ledger.list().length;
    const r = await exec(args);
    assert.deepEqual([r.code, r.err], [2, `${name} asks before it changes anything: add --yes\n`], r.text);
    assert.deepEqual(files(), before, `${name}: nothing written`);
    assert.equal(ctx.ledger.list().length, runs, `${name}: no run`);
  };
  await refused(['apply', '--agents', 'claude'], 'apply');
  await refused(['projects', 'apply', dir, '--agents', 'claude'], 'projects apply');
  await refused(['settings', 'set', 'model', 'opus'], 'settings set');
  // Every change declined: no run.
  let r = await exec(['projects', 'apply', dir, '--agents', 'claude'], 'n\n'.repeat(200));
  assert.equal(r.code, 0, r.err);
  assert.match(r.text, /\[y\/N\] nothing applied\n/);
  assert.doesNotMatch(r.text, /undo with/);
  assert.equal(ctx.ledger.list().length, 0);
  // Answers that end after the first one: the rest count as no.
  r = await exec(['projects', 'apply', dir, '--agents', 'claude'], 'y\n');
  assert.equal(r.code, 0, r.err);
  assert.equal(ctx.ledger.list().length, 1);
  assert.match(r.text, /undo with benchkeeper undo /);
  assert.equal(r.err, '');
  assert.equal((await exec(['projects', 'apply', dir, '--agents', 'claude', '--yes'])).code, 0);
  await refused(['packs', 'enable', 'testing', '--project', dir], 'packs enable');
  // --yes with nothing preselected (only the optional changes are left): no run either.
  assert.equal((await exec(['apply', '--agents', 'gemini', '--level', 'full', '--yes'])).code, 0);
  const runs = ctx.ledger.list().length;
  r = await exec(['apply', '--agents', 'gemini', '--level', 'full', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.text, /\nnothing applied\n$/);
  assert.equal(ctx.ledger.list().length, runs);
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
  // Nothing left to restore: a usage error for an unknown step or unit, exit 1 for a second undo, no run either way.
  assert.equal(await c.exec(['undo', id, '--step', 'typo']), 2);
  assert.match(c.text(), new RegExp(`run ${id} has no step typo; its steps: \\S`));
  assert.equal(await c.exec(['undo', id, '--unit', 'typo']), 2);
  assert.match(c.text(), /has no unit typo; its units: /);
  assert.equal(await c.exec(['undo', id]), 1);
  assert.match(c.text(), new RegExp(`nothing to undo in run ${id}: `));
  await c.exec(['history']);
  assert.equal(c.text().match(/undo +done/g).length, 1, 'the history lists one undo run');
});

test('a pack plugin BenchKeeper did not install: shown with its impact, never removed by --yes or --all, only by its own answer', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-cli-'));
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'ponytail@ponytail': [{ scope: 'user', version: '5.2.0' }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ ponytail: {} }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true } }));
  const calls = [];
  const ctx = context({ home, run: (argv) => { calls.push(argv.join(' ')); return argv[0] === 'npm' ? { code: 1, stdout: '' } : { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0' }; } });
  // A registered project with a setup that uses no pack.
  const dir = join(home, 'p');
  mkdirSync(join(dir, '.benchkeeper'), { recursive: true });
  writeFileSync(join(dir, '.benchkeeper/state.json'), JSON.stringify({ packs: [] }));
  addProject(ctx, dir);
  // Installed for selected projects; at the default scope (all projects) no removal is offered.
  writeFileSync(join(ctx.config, 'pack-scopes.json'), JSON.stringify({ scopes: { ponytail: 'projects' } }));
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args, answers = '') => main(args, { out, ctx, input: Readable.from([answers]) });
  assert.equal(await exec(['plan', '--agents', 'claude', '--level', 'full']), 0);
  assert.match(text, /\nponytail \(Claude Code plugin ponytail@ponytail\) is installed on this machine, but BenchKeeper did not set it up/);
  assert.match(text, /add ponytail to a project: benchkeeper projects apply <dir> --pack ponytail\n  removing runs claude plugin uninstall ponytail@ponytail, which deletes the plugin and its data from Claude Code; claude plugin install ponytail@ponytail brings it back/);
  await exec(['apply', '--agents', 'claude', '--level', 'full', '--yes', '--all']);
  await exec(['apply', '--agents', 'claude', '--level', 'full', '--all'], 'y\n');
  assert.ok(calls.includes('claude plugin install benchkeeper@benchkeeper') && !calls.includes('claude plugin uninstall ponytail@ponytail'));
  await exec(['apply', '--agents', 'claude', '--level', 'full'], 'n\n'.repeat(80));
  assert.match(text, /remove it\? \[y\/N\]/);
  // packs disable --global is the user's own request: it removes the plugin.
  await exec(['packs', 'disable', 'ponytail', '--global', '--agents', 'claude', '--yes']);
  assert.ok(calls.includes('claude plugin uninstall ponytail@ponytail'));
});

test('help per command; an unknown command is one line on stderr', async () => {
  const footer = HELP.slice(HELP.indexOf('\n--json ('));
  for (const args of [['--help'], ['help'], ['help', 'nosuch']]) {
    const c = cli();
    assert.equal(await c.exec(args), 0, args.join(' '));
    assert.equal(c.text(), `${HELP}\n`, args.join(' '));
  }
  for (const args of [['projects', '--help'], ['help', 'projects'], ['projects', 'plan', '--help'], ['help', 'skills', 'update']]) {
    const c = cli();
    assert.equal(await c.exec(args), 0, args.join(' '));
    const [noun, verb] = args.filter((a) => a !== 'help' && a !== '--help');
    const lines = c.text().slice(0, -footer.length - 2).split('\n');
    assert.ok(c.text().endsWith(`${footer}\n`), args.join(' '));
    assert.ok(lines.length > 1 && lines.every((l) => l.startsWith('   ') || l.startsWith(`  ${noun} `)), args.join(' '));
    if (verb) assert.ok(lines.filter((l) => !l.startsWith('   ')).every((l) => l.includes(verb)), args.join(' '));
  }
  assert.match(helpFor(['projects', 'plan']), /^ {2}projects plan\|apply .*\n {20}\[--agent-file path\]\n {20}\[--share\|--local\][^\n]*\n {36}project setup in dir/);
  assert.doesNotMatch(helpFor(['projects', 'plan']), /projects update|Usage:/);
  assert.match(helpFor(['packs', 'remove']), /^ {2}packs \[list\|show/);
  const c = cli();
  assert.equal(await c.exec(['nosuch']), 2);
  assert.deepEqual([c.text(), c.err()], ['', 'unknown command nosuch: see benchkeeper help\n']);
  const s = cli();
  assert.equal(await s.exec(['packs', 'nosuch']), 2);
  assert.deepEqual([s.text(), s.err()], ['', 'unknown command packs nosuch: see benchkeeper help packs\n']);
  for (const args of [['evals'], ['evals', 'nosuch'], ['skills', 'nosuch'], ['settings', 'nosuch'], ['rules', 'nosuch'], ['accounts', 'nosuch']]) {
    const e = cli();
    assert.equal(await e.exec(args), 2, args.join(' '));
    assert.deepEqual([e.text(), e.err().split('\n').length], ['', 2], args.join(' '));
  }
});

test('the help --json list names the commands the README marks with --json', () => {
  // `projects plan|list` in the help stands for `projects plan` and `projects list`.
  const help = HELP.slice(HELP.indexOf('--json (') + 8, HELP.indexOf(')', HELP.indexOf('--json ('))).split(/[,;]/).flatMap((item) => {
    const words = item.trim().split(/\s+/), last = words.pop();
    return last.split('|').map((w) => [...words, w].join(' '));
  });
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const table = readme.slice(readme.indexOf('| Command | --json |')).split('\n\n')[0].split('\n').slice(2);
  const marked = table.filter((row) => row.split(' | ')[1].startsWith('yes')).flatMap((row) => [...row.split(' | ')[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  assert.deepEqual(help.toSorted(), marked.toSorted());
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
  assert.equal(await c.exec(['sessions', 'list', '--run', 'nope']), 2);
  assert.match(c.text(), /no sessions of run nope/);
  assert.ok(!c.text().includes(MARK));
});

test('an old command name names its new command and the removed skill flags are refused', async () => {
  for (const [old, now] of [[['project', 'plan'], 'projects'], [['update-all'], 'projects update'], [['test'], 'verify'], [['board'], 'sessions board'], [['record'], 'sessions record'],
    [['eval'], 'evals plan'], [['case', 'add'], 'evals cases'], [['maintain', 'knowledge', 'show'], 'knowledge']]) {
    const c = cli();
    assert.equal(await c.exec(old), 2, old.join(' '));
    assert.deepEqual([c.text(), c.err()], ['', `${old[0]} is now ${now}: see benchkeeper help ${now.split(' ')[0]}\n`]);
  }
  const j = cli();
  assert.equal(await j.exec(['test', '--json']), 2);
  assert.equal(JSON.parse(j.text()).error, 'test is now verify: see benchkeeper help verify');
  await assert.rejects(cli().exec(['projects', 'apply', '--disable', 'x']), { message: 'unknown option --disable for projects apply, see benchkeeper --help' });
  await assert.rejects(cli().exec(['projects', 'apply', '--enable', 'x']), { message: 'unknown option --enable for projects apply, see benchkeeper --help' });
});

test('a name that does not exist and an unknown option exit 2 with and without --json; --version prints the version', async () => {
  for (const args of [['skills', 'show', 'nope'], ['automations', 'show', 'nope'], ['sessions', 'list', '--run', 'nope'], ['history', 'show', 'nope'], ['history', 'show', 'bad.id'], ['undo', 'nope'], ['undo', 'bad.id'], ['accounts', 'status', 'ghost'],
    ['automations', 'install', 'nope', '--yes'], ['automations', 'update', 'nope', '--yes'], ['automations', 'remove', 'nope', '--yes'], ['automations', 'diff', 'nope']]) {
    assert.equal(await cli().exec(args), 2, args.join(' '));
    const j = cli();
    assert.equal(await j.exec([...args, '--json']), 2, `${args.join(' ')} --json`);
    assert.ok(JSON.parse(j.text()).error, `${args.join(' ')} --json`);
  }
  await assert.rejects(cli().exec(['doctor', '--x']), { message: 'unknown option --x for doctor, see benchkeeper --help' });
  const j = cli();
  assert.equal(await j.exec(['skills', 'list', '--x', '--json']), 2);
  assert.equal(JSON.parse(j.text()).error, 'unknown option --x for skills list, see benchkeeper --help');
  const v = cli();
  assert.equal(await v.exec(['--version']), 0);
  assert.match(v.text(), /^\d+\.\d+\.\d+\S*\n$/);
  const p = cli();
  assert.equal(await p.exec(['projects', 'nope', '--json']), 2);
  assert.equal(JSON.parse(p.text()).error, 'unknown command projects nope: see benchkeeper help projects');
  assert.equal(await p.exec(['projects', 'nope']), 2);
});

test('a changing command that stops before a change exits with the same code with and without --json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-none-'));
  for (const [args, code] of [[['packs', 'enable', 'frontend', '--project', dir, '--yes'], 2], [['skills', 'update', 'tdd', '--project', dir, '--yes'], 2], [['packs', 'enable', 'frontend', '--global', '--yes'], 1]]) {
    const t = cli();
    assert.equal(await t.exec(args), code, `${args.join(' ')}: ${t.text()}`);
    const j = cli();
    assert.equal(await j.exec([...args, '--json']), code, `${args.join(' ')} --json`);
    assert.ok(JSON.parse(j.text()).error, `${args.join(' ')} --json`);
  }
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
  const exec = async (args) => {
    let text = '', err = '';
    const code = await main(args, { out: new Writable({ write(c, _, done) { text += c; done(); } }), err: new Writable({ write(c, _, done) { err += c; done(); } }), ctx, input: Readable.from(['']) });
    return { code, text, err };
  };
  let o = await exec(['sessions', 'record', '--project', dir, '--', 'sh', '-c', 'echo x > n']);
  assert.equal(o.code, 0, o.text);
  assert.match(o.text, /session exit 0, 1 files changed/);
  assert.equal(readFileSync(join(dir, 'n'), 'utf8'), 'x\n');
  // The agent's exit code is passed on, and the failed session is still recorded for undo.
  o = await exec(['sessions', 'record', '--project', dir, '--', 'sh', '-c', 'echo y > m; exit 3']);
  assert.equal(o.code, 3, o.text);
  assert.match(o.text, /session exit 3, 1 files changed/);
  assert.equal(await exec(['undo', o.text.match(/run (\S+):/)[1]]).then((u) => u.code), 0);
  assert.ok(!existsSync(join(dir, 'm')));
  o = await exec(['sessions', 'record', '--project', dir, '--', 'benchkeeper-no-such-agent']);
  assert.equal(o.code, 127, o.text);
  o = await exec(['sessions', 'record', '--project', dir]);
  assert.deepEqual([o.code, /sessions record needs the agent command after --/.test(o.text)], [2, true]);
  o = await exec(['sessions']);
  assert.deepEqual([o.code, o.err], [2, 'sessions needs board, list, cache or record\n']);
});

test('skills cli checks the signatures of the release a skill install runs and prints its command prefix', async () => {
  const old = new Date(Date.now() - 30 * 864e5).toISOString();
  const forced = process.env.BENCHKEEPER_SKILLS_CLI;
  delete process.env.BENCHKEEPER_SKILLS_CLI;
  try {
    for (const verified of [0, 1]) {
      const calls = [];
      const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-cli-')), run: (argv, opts) => {
        calls.push({ argv, opts });
        if (argv[0] === 'npm') return { code: 0, stdout: JSON.stringify({ time: { '9.1.0': old }, versions: ['9.1.0'] }) };
        return { code: verified, stdout: '', stderr: verified ? 'invalid signature\n' : '' };
      } });
      let text = '';
      const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
      assert.equal(await main(['skills', 'cli'], { out, ctx, input: Readable.from(['']) }), verified);
      const check = calls.find((c) => c.argv.at(-1) === 'skills@9.1.0');
      assert.ok(check && check.opts.env.npm_config_before && check.opts.env.npm_config_ignore_scripts === 'true');
      if (verified) assert.match(text, /invalid signature\nskills@npm:skills@9\.1\.0 failed the signature check/);
      else assert.equal(text, `DO_NOT_TRACK=1 npm_config_registry=https://registry.npmjs.org/ npm_config_ignore_scripts=true npm_config_before=${check.opts.env.npm_config_before} npx -y skills@npm:skills@9.1.0\n`);
    }
  } finally {
    if (forced !== undefined) process.env.BENCHKEEPER_SKILLS_CLI = forced;
  }
});

test('ui: a busy port ends with one line and exit 1, a bad --port with exit 2', async () => {
  const busy = createServer();
  await new Promise((ok) => busy.listen(0, '127.0.0.1', ok));
  const { port } = busy.address();
  const c = cli();
  try {
    assert.equal(await c.exec(['ui', '--no-open', '--port', String(port)]), 1);
    assert.match(c.text(), new RegExp(`^port ${port} is in use: stop the other server or pick another port\n$`));
  } finally { busy.close(); }
  for (const bad of ['abc', '65536', '-1', '1.5']) assert.equal(await c.exec(['ui', '--no-open', `--port=${bad}`]), 2);
  assert.match(c.text(), /--port must be a whole number from 0 to 65535\n$/);
});

test('BENCHKEEPER_DEBUG=1 prints the stack of a failing command; without it only the message', () => {
  const bin = fileURLToPath(new URL('../bin/benchkeeper.mjs', import.meta.url));
  const run = (env) => spawnSync(process.execPath, [bin, 'doctor', '--zzz'], { encoding: 'utf8', env: { ...process.env, BENCHKEEPER_HOME: mkdtempSync(join(tmpdir(), 'bk-cli-')), BENCHKEEPER_DEBUG: '', ...env } });
  const plain = run({});
  assert.deepEqual([plain.status, plain.stderr], [2, 'unknown option --zzz for doctor, see benchkeeper --help\n']);
  const debug = run({ BENCHKEEPER_DEBUG: '1' });
  assert.equal(debug.status, 2);
  assert.match(debug.stderr, /^Error: unknown option --zzz for doctor, see benchkeeper --help\n\s+at .*cli\.mjs:\d+/);
});
