import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { addProject } from '../src/projects.mjs';
import { context } from '../src/runner.mjs';
import { writeSessions } from './fixtures/sessions.mjs';

const SECRET = 'value-that-must-not-leak-9c2e';
const TMP = realpathSync(tmpdir());
const put = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

function setup() {
  const home = mkdtempSync(join(TMP, 'bk-json-'));
  const dir = mkdtempSync(join(TMP, 'bk-json-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  const run = (argv) => ({ code: ['npm', 'podman', 'docker'].includes(argv[0]) ? 1 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' });
  const ctx = context({ home, run, roots: [home, dir] });
  // A secret in an environment value of a settings file, in a rule file, in an allow rule and in the process environment.
  put(join(home, '.claude/settings.json'), JSON.stringify({ env: { DISABLE_TELEMETRY: SECRET }, permissions: { allow: ['Bash(python *)', `Bash(* --header "token: ${SECRET}")`] } }));
  put(join(dir, '.claude/rules/r.md'), `${SECRET}\n@gone.md\n`);
  put(join(dir, 'CLAUDE.md'), `${SECRET}\n`);
  addProject(ctx, dir);
  return { ctx, dir, home };
}

async function run(ctx, args) {
  let text = '', err = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  const errOut = new Writable({ write(c, _, done) { err += c; done(); } });
  const code = await main(args, { out, err: errOut, ctx });
  return { code, text, err, doc: JSON.parse(text) };
}

test('--json: every listed command prints one document with schemaVersion and the documented keys', async () => {
  const { ctx, dir } = setup();
  const before = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = SECRET;
  try {
    const shape = async (args, code, command, keys) => {
      const r = await run(ctx, [...args, '--json']);
      assert.equal(r.code, code, args.join(' '));
      assert.equal(r.doc.schemaVersion, 1);
      assert.equal(r.doc.command, command);
      assert.deepEqual(Object.keys(r.doc).slice(2), keys, args.join(' '));
      assert.ok(!r.text.includes(SECRET) && !r.err.includes(SECRET), `${args.join(' ')} leaks a secret`);
      return r.doc;
    };
    const doctor = await shape(['doctor', dir, '--agents', 'claude'], 1, 'doctor', ['level', 'adds', 'findings', 'summary']);
    assert.ok(doctor.summary.error >= 1 && doctor.summary.warning >= 1);
    assert.deepEqual(doctor.findings.find((f) => f.check === 'instructions'), { level: 'error', check: 'instructions', message: '.claude/rules/r.md:2 imports gone.md, which does not exist', fix: doctor.findings.find((f) => f.check === 'instructions').fix, file: '.claude/rules/r.md', line: 2 });
    assert.ok(doctor.findings.some((f) => f.check === 'allow-rules' && f.rule === 'Bash(python *)'));
    const test_ = await shape(['verify', '--agents', 'claude'], 1, 'verify', ['ok', 'checks']);
    assert.ok(test_.checks.every((c) => typeof c.name === 'string' && Array.isArray(c.problems)));
    const plan = await shape(['plan', '--agents', 'claude'], 0, 'plan', ['agents', 'level', 'changes']);
    assert.ok(plan.changes.length > 0 && plan.changes.every((c) => c.id && c.title && !('diff' in c)));
    const project = await shape(['projects', 'plan', dir, '--agents', 'claude'], 0, 'projects plan', ['dir', 'changes', 'skills', 'warnings']);
    assert.ok(project.changes.length > 0);
    await shape(['history'], 0, 'history', ['runs', 'backups']);
    assert.deepEqual((await shape(['projects', 'list'], 0, 'projects list', ['projects'])).projects.map((p) => p.path), [dir]);
    const packs = await shape(['packs', 'list'], 0, 'packs list', ['packs']);
    assert.ok(packs.packs.length > 0 && packs.packs.every((p) => p.id && Array.isArray(p.skills) && Array.isArray(p.plugins)));
  } finally {
    if (before === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = before;
  }
});

test('--json: a clean doctor exits 0; usage failures exit 2 with an error document and the message on stderr', async () => {
  // No agent installed: warnings may remain, an error does not.
  const home = mkdtempSync(join(TMP, 'bk-json-bare-'));
  const ctx = context({ home, run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const ok = await run(ctx, ['doctor', mkdtempSync(join(TMP, 'bk-json-clean-')), '--json']);
  assert.equal(ok.code, 0);
  assert.equal(ok.doc.summary.error, 0);
  assert.deepEqual((await run(ctx, ['history', '--json'])).doc.runs, []);
  const bad = await run(ctx, ['--agents', 'claude', 'doctor', '--nope', '--json']);
  assert.equal(bad.code, 2);
  assert.equal(bad.doc.command, 'doctor');
  put(join(home, '.config/benchkeeper/projects.json'), '{ not json');
  const registry = await run(ctx, ['projects', 'list', '--json']);
  assert.equal(registry.code, 2);
  assert.equal(registry.doc.command, 'projects list');
  assert.match(registry.doc.error, /registered projects file is not valid JSON/);
  put(join(home, '.config/benchkeeper/projects.json'), 'null');
  assert.match((await run(ctx, ['projects', 'list', '--json'])).doc.error, /has no projects list/);
  // doctor and plan read the registry too: a broken one is a read failure, not an empty result.
  for (const args of [['doctor', mkdtempSync(join(TMP, 'bk-json-broken-'))], ['plan', '--agents', 'claude']]) {
    const r = await run(ctx, [...args, '--json']);
    assert.equal(r.code, 2, args[0]);
    assert.equal(r.doc.command, args[0]);
    assert.match(r.doc.error, /has no projects list/);
  }
  assert.match(bad.doc.error, /nope/);
  for (const [args, message] of [[['plan', '--agents', 'claude', '--level', 'nope'], /--level must be one of/], [['doctor', '--baseline', 'x'], /--baseline must be/], [['plan'], /no agent found/], [['packs', 'save'], /--json works with/]]) {
    const r = await run(ctx, [...args, '--json']);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.doc.error, message);
    assert.match(r.err, message);
  }
});

test('--json: the read-only list commands print their documented keys and no value of the files they read', async () => {
  const { ctx, dir, home } = setup();
  writeSessions(home);
  put(join(dir, '.claude/settings.json'), `{ "model": "${SECRET}", oops`);
  // An env object nested in another setting (an MCP server) is a value of the environment too.
  put(join(home, '.claude/settings.json'), JSON.stringify({ env: { DISABLE_TELEMETRY: SECRET }, mcpServers: { s: { command: 'x', env: { PLAIN: SECRET } } } }));
  const before = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = SECRET;
  try {
    const shape = async (args, command, keys) => {
      const r = await run(ctx, [...args, '--json']);
      assert.equal(r.code, 0, args.join(' '));
      assert.equal(r.doc.schemaVersion, 1);
      assert.equal(r.doc.command, command);
      assert.deepEqual(Object.keys(r.doc).slice(2), keys, args.join(' '));
      assert.ok(!r.text.includes(SECRET) && !r.err.includes(SECRET), `${args.join(' ')} leaks a secret`);
      return r.doc;
    };
    // Nothing is written by a list command, so no run enters the ledger.
    const none = await shape(['skills', 'list', '--project', dir, '--agents', 'claude'], 'skills list', ['dir', 'hasSetup', 'skills', 'untracked', 'globalUntracked']);
    assert.deepEqual([none.dir, none.hasSetup, none.skills], [dir, false, []]);
    assert.equal(await main(['projects', 'apply', dir, '--agents', 'claude', '--skill', 'frontend-design', '--yes'], { out: new Writable({ write(_c, _e, d) { d(); } }), err: new Writable({ write(_c, _e, d) { d(); } }), ctx }), 0);
    const skills = await shape(['skills', '--project', dir, '--agents', 'claude'], 'skills list', ['dir', 'hasSetup', 'skills', 'untracked', 'globalUntracked']);
    assert.ok(skills.hasSetup && skills.skills.some((s) => s.name === 'frontend-design' && s.state && s.single));

    const rules = await shape(['rules', 'list', '--project', dir], 'rules list', ['dir', 'agents', 'limit', 'findings']);
    assert.deepEqual(rules.agents.map((a) => a.id), ['claude', 'codex']);
    assert.ok(rules.agents[0].rows.some((r) => r.path === join(dir, 'CLAUDE.md') && r.tokens > 0 && !('text' in r)));
    assert.deepEqual((await shape(['rules', 'list', '--agent', 'codex'], 'rules list', ['dir', 'agents', 'limit', 'findings'])).agents.map((a) => a.id), ['codex']);

    const list = await shape(['settings', 'list', '--project', dir], 'settings list', ['agent', 'name', 'layers', 'settings', 'bundles', 'notes', 'dismissed']);
    assert.equal(list.agent, 'claude');
    assert.ok(list.settings.length > 0 && list.layers.some((l) => l.error === 'the file does not parse'));
    const advanced = await shape(['settings', 'list', '--advanced'], 'settings list', ['agent', 'name', 'layers', 'settings', 'bundles', 'notes', 'dismissed', 'advanced', 'outside', 'env']);
    assert.deepEqual(advanced.env.map((e) => [e.name, e.layer, 'value' in e]), [['DISABLE_TELEMETRY', 'user', false]]);
    const switchKey = await shape(['settings', 'get', 'env.DISABLE_TELEMETRY'], 'settings get', ['agent', 'setting']);
    assert.ok(switchKey.setting.sets.length === 1 && !('value' in switchKey.setting.sets[0]));
    await shape(['settings', 'list', '--agent', 'codex'], 'settings list', ['agent', 'name', 'layers', 'settings', 'bundles', 'notes', 'dismissed', 'trust']);
    const get = await shape(['settings', 'get', list.settings[0].key], 'settings get', ['agent', 'setting']);
    assert.equal(get.setting.key, list.settings[0].key);

    const sources = await shape(['skills', 'sources'], 'skills sources', ['sources']);
    assert.ok(sources.sources.length > 0 && sources.sources.every((f) => f.id && f.title && f.files.length > 0));
    assert.deepEqual((await shape(['skills', 'sources', 'list'], 'skills sources', ['sources'])).sources, sources.sources);

    const scan = await shape(['projects', 'scan', dir], 'projects scan', ['root', 'found']);
    assert.deepEqual([scan.root, scan.found], [dir, [{ path: dir, registered: true }]]);

    const board = await shape(['sessions', 'board'], 'sessions board', ['sessions']);
    assert.ok(board.sessions.length > 0 && board.sessions.every((s) => s.agent && s.start && !('title' in s)));
    assert.ok(!JSON.stringify(board).includes('onerror'));

    const profile = await shape(['profile', 'export', '--agents', 'claude'], 'profile export', ['profile']);
    assert.deepEqual([profile.profile.kind, profile.profile.schemaVersion, profile.profile.projects.map((p) => p.path)], ['benchkeeper-profile', 1, [dir]]);
  } finally {
    if (before === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = before;
  }
});

test('--json: an invalid argument to a list command exits 2 with an error document, and the text output stays as it was', async () => {
  const { ctx, dir } = setup();
  for (const [args, command, message] of [
    [['rules', 'list', '--agent', 'nope'], 'rules list', /agent must be one of claude, codex/],
    [['settings', 'list', '--agent', 'nope'], 'settings list', /agent must be one of/],
    [['settings', 'get'], 'settings get', /needs a key/],
    [['settings', 'get', 'no.such.key'], 'settings get', /is not a key of/],
    [['projects', 'scan', ctx.config], 'projects scan', /scan the folder your projects are in/],
    [['profile', 'export', join(dir, 'p.json')], 'profile export', /take `.profile` before profile import/],
    [['settings', 'get', 'model', 'extra'], 'settings get', /unexpected argument extra/],
    [['settings', 'list', 'extra'], 'settings list', /unexpected argument extra/],
    [['projects', 'scan', dir, 'extra'], 'projects scan', /unexpected argument extra/],
    [['skills', 'list', 'extra'], 'skills list', /unexpected argument extra/],
    [['rules', 'list', 'extra'], 'rules list', /unexpected argument extra/],
    [['skills', 'sources', 'list', 'extra'], 'skills sources', /unexpected argument extra/],
    [['sessions', 'board', 'extra'], 'sessions board', /unexpected argument extra/],
    [['projects', 'list', 'extra'], 'projects list', /unexpected argument extra/],
    [['packs', 'list', 'extra'], 'packs list', /unexpected argument extra/],
    [['skills', 'reset'], 'skills reset', /--json works with/],
    [['profile', 'import', 'p.json'], 'profile import', /--json works with/],
  ]) {
    const r = await run(ctx, [...args, '--json']);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.doc.command, command);
    assert.deepEqual(Object.keys(r.doc).slice(2), ['error']);
    assert.match(r.doc.error, message);
    assert.match(r.err, message);
  }
  // A broken registry is a read failure for the commands that read it.
  put(join(ctx.home, '.config/benchkeeper/projects.json'), '{ not json');
  for (const args of [['projects', 'scan', dir], ['profile', 'export']]) assert.equal((await run(ctx, [...args, '--json'])).code, 2, args.join(' '));
  // Without --json the commands print what they printed.
  const text = async (args) => { let t = ''; await main(args, { out: new Writable({ write(c, _, d) { t += c; d(); } }), err: new Writable({ write(_c, _e, d) { d(); } }), ctx }); return t; };
  assert.match(await text(['skills', 'sources']), /^agency-agents\s+agents\s+/);
  assert.match(await text(['rules', 'list', '--agent', 'codex']), /^Codex/);
});

test('--json: the changing commands print their runs and entries, refuse a question without --yes and leak no value', async () => {
  const { ctx, dir } = setup();
  const before = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = SECRET;
  try {
    const doc = async (args, code, command, keys) => {
      const r = await run(ctx, [...args, '--json']);
      assert.equal(r.code, code, `${args.join(' ')}: ${r.err}`);
      assert.deepEqual([r.doc.schemaVersion, r.doc.command], [1, command]);
      assert.deepEqual(Object.keys(r.doc).slice(2), keys, args.join(' '));
      assert.ok(!r.text.includes(SECRET), `${args.join(' ')} leaks a secret`);
      return r.doc;
    };
    const rule = join(dir, 'CLAUDE.md');
    const asking = [
      [['apply', '--agents', 'claude'], 'apply'],
      [['projects', 'apply', dir, '--agents', 'claude'], 'projects apply'],
      [['settings', 'set', 'model', 'opus'], 'settings set'],
      [['rules', 'disable', rule, '--agent', 'claude', '--project', dir], 'rules disable'],
    ];
    // Without --yes a command that would ask exits 2 with the error and leaves the ledger as it was.
    for (const [args, command] of asking) {
      const runs = ctx.ledger.list().length;
      assert.match((await doc(args, 2, command, ['error'])).error, /add --yes/);
      assert.equal(ctx.ledger.list().length, runs, command);
    }
    const done = async (args, command) => {
      const d = await doc([...args, '--yes'], 0, command, ['runs']);
      assert.ok(d.runs.length === 1 && d.runs[0].id && d.runs[0].status === 'done', command);
      assert.ok(d.runs[0].entries.length > 0 && d.runs[0].entries.every((e) => e.title && e.status && !('diff' in e)), command);
      return d.runs[0];
    };
    await done(['apply', '--agents', 'claude'], 'apply');
    await done(['projects', 'apply', dir, '--agents', 'claude', '--skill', 'frontend-design'], 'projects apply');
    const set = await done(['settings', 'set', 'model', 'opus'], 'settings set');
    await done(['rules', 'disable', rule, '--agent', 'claude', '--project', dir], 'rules disable');
    await done(['rules', 'enable', rule, '--agent', 'claude', '--project', dir], 'rules enable');
    assert.match((await doc(['packs', 'enable', 'testing', '--project', dir], 2, 'packs enable', ['error'])).error, /add --yes/);
    await done(['packs', 'enable', 'testing', '--project', dir], 'packs enable');
    await done(['packs', 'disable', 'testing', '--project', dir], 'packs disable');
    assert.match((await doc(['skills', 'update', 'frontend-design', '--project', dir], 2, 'skills update', ['error'])).error, /add --yes/);
    assert.ok(Array.isArray((await doc(['skills', 'update', 'frontend-design', '--project', dir, '--yes'], 0, 'skills update', ['runs'])).runs));
    const undo = await doc(['undo', set.id], 0, 'undo', ['runs']);
    assert.ok(undo.runs[0].kind === 'undo' && undo.runs[0].entries.every((e) => e.status === 'done'));

    const other = mkdtempSync(join(TMP, 'bk-json-other-')), moved = mkdtempSync(join(TMP, 'bk-json-moved-'));
    assert.deepEqual((await doc(['projects', 'add', other], 0, 'projects add', ['runs', 'projects'])).projects, [{ path: other, status: 'added' }]);
    assert.deepEqual((await doc(['projects', 'rename', other, 'Other'], 0, 'projects rename', ['runs', 'projects'])).projects, [{ path: other, status: 'renamed' }]);
    assert.deepEqual((await doc(['projects', 'relocate', other, moved], 0, 'projects relocate', ['runs', 'projects'])).projects, [{ path: moved, from: other, status: 'relocated' }]);
    assert.deepEqual((await doc(['projects', 'remove', moved], 0, 'projects remove', ['runs', 'projects'])).projects, [{ path: moved, status: 'removed' }]);
    // Usage and read failures: exit 2, the message as the error, nothing else.
    for (const [args, command, message] of [
      [['undo'], 'undo', /needs a name/],
      [['projects', 'relocate', dir], 'projects relocate', /needs the old and the new directory/],
      [['projects', 'rename', join(TMP, 'bk-json-never-added'), 'x'], 'projects rename', /is not a registered project/],
      [['projects', 'remove', join(TMP, 'bk-json-never-added')], 'projects remove', /bk-json-never-added is not a registered project/],
      [['settings', 'set'], 'settings set', /needs a key/],
      [['settings', 'set', 'no.such.key', 'x', '--yes'], 'settings set', /is not a key of/],
      [['packs', 'enable', 'nope', '--project', dir, '--yes'], 'packs enable', /unknown pack nope/],
      [['undo', 'nosuchrun'], 'undo', /nosuchrun/],
    ]) assert.match((await doc(args, 2, command, ['error'])).error, message);
  } finally {
    if (before === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = before;
  }
});

test('--json: the read commands of the web UI print their documented keys, refuse a cache change without --yes and leak no value', async () => {
  const { ctx, dir, home } = setup();
  writeSessions(home);
  put(join(ctx.config, 'evals/results.jsonl'), `${JSON.stringify({ time: '2026-10-20T10:00:00.000Z', target: 'skill:x', agent: 'claude', agentVersion: '1.0.0', missRate: 0.5, falseTriggerRate: 0, details: [{ expected: SECRET }] })}\nnot json\n`);
  const before = process.env.DO_NOT_TRACK;
  process.env.DO_NOT_TRACK = SECRET;
  const text = async (args) => { let t = ''; const code = await main(args, { out: new Writable({ write(c, _, d) { t += c; d(); } }), err: new Writable({ write(_c, _e, d) { d(); } }), input: Readable.from([]), ctx }); return { code, t }; };
  try {
    const shape = async (args, code, command, keys) => {
      const r = await run(ctx, [...args, '--json']);
      assert.equal(r.code, code, `${args.join(' ')}: ${r.err}`);
      assert.deepEqual([r.doc.schemaVersion, r.doc.command], [1, command]);
      assert.deepEqual(Object.keys(r.doc).slice(2), keys, args.join(' '));
      assert.ok(!r.text.includes(SECRET) && !r.err.includes(SECRET), `${args.join(' ')} leaks a secret`);
      return r.doc;
    };
    // A shared setup edits CLAUDE.md, whose first line is the secret: the text diff shows it, the document must not.
    const applied = await shape(['projects', 'apply', dir, '--agents', 'claude', '--pack', 'testing', '--share', '--yes'], 0, 'projects apply', ['runs']);
    const id = applied.runs[0].id;
    assert.match((await text(['history', 'show', id])).t, new RegExp(SECRET));
    const shown = await shape(['history', 'show', id], 0, 'history show', ['run']);
    assert.ok(shown.run.id === id && shown.run.entries.some((e) => e.path === join(dir, 'CLAUDE.md')) && shown.run.entries.every((e) => !('diff' in e)));

    const status = await shape(['projects', 'status'], 0, 'projects status', ['version', 'level', 'adds', 'agents', 'projects']);
    assert.deepEqual(status.projects.map((p) => [p.path, p.share]), [[dir, true]]);
    assert.ok(status.agents.some((a) => a.id === 'claude' && a.installed) && status.projects[0].changes.every((c) => !('diff' in c)));
    const one = await shape(['projects', 'status', home], 0, 'projects status', ['version', 'level', 'adds', 'agents', 'projects']);
    assert.deepEqual(one.projects.map((p) => [p.path, p.setupVersion]), [[home, null]]);

    const library = await shape(['skills', 'list', '--library'], 0, 'skills list', ['skills']);
    assert.ok(library.skills.length > 0 && library.skills.every((s) => s.name && Number.isInteger(s.projects)));
    const pack = await shape(['packs', 'show', 'testing'], 0, 'packs show', ['pack']);
    assert.deepEqual([pack.pack.id, pack.pack.usedBy], ['testing', [dir]]);

    assert.deepEqual((await shape(['evals', 'results'], 0, 'evals results', ['results'])).results.map((r) => [r.target, 'details' in r]), [['skill:x', false]]);
    const items = await shape(['inventory', '--agents', 'claude'], 0, 'inventory', ['items']);
    assert.ok(items.items.length > 0 && items.items.every((i) => i.step && i.title && i.state));
    const board = await shape(['dashboard', '--agents', 'claude'], 0, 'dashboard', ['global', 'projects', 'coverage', 'catalog']);
    assert.deepEqual(board.projects.map((p) => [p.path, p.setup]), [[dir, true]]);

    assert.ok(Array.isArray((await shape(['sessions', 'list'], 0, 'sessions list', ['runs'])).runs));
    const cache = await shape(['sessions', 'cache', 'show'], 0, 'sessions cache show', ['keepDays', 'sessions']);
    assert.ok(cache.keepDays === null && cache.sessions > 0);
    // Without --yes a change exits 2 and the cache file stays as it was.
    const file = join(home, '.cache/benchkeeper/sessions.json'), bytes = readFileSync(file, 'utf8');
    assert.match((await shape(['sessions', 'cache', 'set', '--keep-days', '30'], 2, 'sessions cache set', ['error'])).error, /add --yes/);
    assert.match((await shape(['sessions', 'cache', 'clear'], 2, 'sessions cache clear', ['error'])).error, /add --yes/);
    assert.equal(readFileSync(file, 'utf8'), bytes);
    assert.deepEqual(await shape(['sessions', 'cache', 'set', '--keep-days', '30', '--yes'], 0, 'sessions cache set', ['keepDays', 'sessions']), { schemaVersion: 1, command: 'sessions cache set', keepDays: 30, sessions: cache.sessions });
    assert.equal((await shape(['sessions', 'cache', 'set', '--keep-days', 'none', '--yes'], 0, 'sessions cache set', ['keepDays', 'sessions'])).keepDays, null);
    assert.deepEqual((await text(['sessions', 'cache', 'set', '--keep-days', '7'])), { code: 1, t: 'keep session summaries 7 days instead of for good: the next scan drops those older than 7 days\nChange the retention? [y/N] ' });
    assert.equal((await text(['sessions', 'cache', 'set', '--keep-days', '7', '--yes'])).t.split('\n').at(-2), `${cache.sessions} session summaries, kept 7 days`);
    assert.deepEqual((await shape(['sessions', 'cache', 'clear', '--yes'], 0, 'sessions cache clear', ['keepDays', 'sessions'])), { schemaVersion: 1, command: 'sessions cache clear', keepDays: 7, sessions: 0 });

    for (const [args, command, message] of [
      [['history', 'show'], 'history show', /needs a run/],
      [['history', 'show', 'nosuchrun'], 'history show', /no run nosuchrun/],
      [['packs', 'show', 'nope'], 'packs show', /unknown pack nope/],
      [['projects', 'status', join(TMP, 'bk-json-never')], 'projects status', /is not a folder/],
      [['sessions', 'list', '--run', 'nope'], 'sessions list', /no sessions of run nope/],
      [['sessions', 'cache', 'set'], 'sessions cache set', /--keep-days N\|none/],
      [['sessions', 'cache', 'set', '--keep-days', '0', '--yes'], 'sessions cache set', /--keep-days N\|none/],
      [['sessions', 'cache', 'set', '--keep-days', '3651', '--yes'], 'sessions cache set', /--keep-days N\|none/],
      [['sessions', 'cache', 'clear', '--keep-days', '3'], 'sessions cache clear', /belongs to sessions cache set/],
      [['sessions', 'cache', 'nope'], 'sessions cache nope', /needs show, set or clear/],
      [['inventory', 'extra'], 'inventory', /unexpected argument extra/],
      [['evals', 'results', 'extra'], 'evals results', /unexpected argument extra/],
    ]) assert.match((await shape(args, 2, command, ['error'])).error, message);

    // The text output of each read.
    assert.match((await text(['projects', 'status'])).t, new RegExp(`^benchkeeper \\S+, level \\w+\\n[^]*${dir}  setup `));
    assert.match((await text(['skills', 'list', '--library'])).t, /^\S+\s+\d+ projects?\s+\S+/);
    assert.match((await text(['packs', 'show', 'testing'])).t, new RegExp(`^testing  library  .*\\nskills: .*\\nused by: ${dir}\\n$`));
    assert.equal((await text(['evals', 'results'])).t, '2026-10-20 10:00  skill:x  claude 1.0.0  miss 50%  false trigger 0%\n');
    assert.match((await text(['inventory', '--agents', 'claude'])).t, /^\w+\s+\w+\s+\S/);
    assert.match((await text(['dashboard', '--agents', 'claude'])).t, new RegExp(`^machine  .*\\n${dir}  .*packs `));
    // sessions list --run above scanned again: the summaries are back.
    assert.equal((await text(['sessions', 'cache', 'show'])).t, `${cache.sessions} session summaries, kept 7 days\n`);
    for (const args of [['history', 'show'], ['sessions', 'cache'], ['inventory', 'x'], ['evals', 'results', 'x'], ['packs', 'show'], ['projects', 'status', join(TMP, 'bk-json-never')]]) assert.equal((await text(args)).code, 2, args.join(' '));
    assert.equal((await text(['history', 'show', 'nosuchrun'])).code, 1);
    assert.equal((await text(['packs', 'show', 'nope'])).code, 1);
  } finally {
    if (before === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = before;
  }
});

test('rules show, skills show, packs warnings and projects advise print the text or one document, change nothing and leak no value', async () => {
  const { ctx, dir, home } = setup();
  const rule = join(home, '.claude/CLAUDE.md');
  put(rule, 'global rule\n');
  // The advice session: claude -p answers with the result the agent would give.
  const stub = ctx.run;
  ctx.run = (argv, opts) => (argv[1] === '-p' ? { code: 0, stdout: JSON.stringify({ result: '{"env": {"id": "container", "reason": "has .devcontainer/"}, "packs": [{"id": "testing", "reason": "has tests"}], "skills": []}' }), stderr: '' } : stub(argv, opts));
  const env = { DO_NOT_TRACK: process.env.DO_NOT_TRACK, CI: process.env.CI };
  process.env.DO_NOT_TRACK = SECRET;
  delete process.env.CI;
  const text = async (args) => { let t = '', e = ''; const code = await main(args, { out: new Writable({ write(c, _, d) { t += c; d(); } }), err: new Writable({ write(c, _, d) { e += c; d(); } }), ctx }); assert.ok(!t.includes(SECRET) && !e.includes(SECRET), `${args.join(' ')} leaks a secret`); return { code, t }; };
  try {
    const ledger = ctx.ledger.list().length;
    const shape = async (args, code, command, keys) => {
      const r = await run(ctx, [...args, '--json']);
      assert.equal(r.code, code, `${args.join(' ')}: ${r.err}`);
      assert.deepEqual([r.doc.schemaVersion, r.doc.command], [1, command]);
      assert.deepEqual(Object.keys(r.doc).slice(2), keys, args.join(' '));
      assert.ok(!r.text.includes(SECRET) && !r.err.includes(SECRET), `${args.join(' ')} leaks a secret`);
      return r.doc;
    };
    assert.deepEqual(await shape(['rules', 'show', rule], 0, 'rules show', ['path', 'text', 'truncated']), { schemaVersion: 1, command: 'rules show', path: rule, text: 'global rule\n', truncated: false });
    assert.deepEqual(await text(['rules', 'show', rule]), { code: 0, t: 'global rule\n' });
    const own = await shape(['skills', 'show', 'designing-technical-uis'], 0, 'skills show', ['name', 'source', 'text']);
    assert.match(own.text, /^---\nname: designing-technical-uis/);
    assert.equal((await text(['skills', 'show', 'designing-technical-uis'])).t, own.text);
    const other = (await shape(['skills', 'list', '--library'], 0, 'skills list', ['skills'])).skills.find((s) => s.source !== 'own');
    assert.equal((await shape(['skills', 'show', other.name], 0, 'skills show', ['name', 'source', 'text'])).text, null);
    assert.deepEqual(await text(['skills', 'show', other.name]), { code: 0, t: `${other.name} comes from ${other.source}: its text is not in the app\n` });
    assert.deepEqual(await shape(['packs', 'warnings', 'testing'], 0, 'packs warnings', ['pack', 'warnings']), { schemaVersion: 1, command: 'packs warnings', pack: 'testing', warnings: [] });
    assert.deepEqual(await text(['packs', 'warnings', 'testing']), { code: 0, t: 'no overlapping skill descriptions in testing\n' });
    const advice = { dir, agent: 'claude', env: { id: 'container', reason: 'has .devcontainer/' }, packs: [{ id: 'testing', reason: 'has tests' }], skills: [] };
    assert.deepEqual(await shape(['projects', 'advise', dir], 0, 'projects advise', ['dir', 'agent', 'env', 'packs', 'skills']), { schemaVersion: 1, command: 'projects advise', ...advice });
    assert.deepEqual(await text(['projects', 'advise', dir, '--agent', 'claude']), { code: 0, t: 'env    container: has .devcontainer/\npack   testing: has tests\n' });
    assert.equal(ctx.ledger.list().length, ledger, 'a read made a run');

    for (const [args, command, message, code] of [
      [['rules', 'show'], 'rules show', /needs a file/, 2],
      [['rules', 'show', join(home, 'nope.md')], 'rules show', /is not an instruction file/, 1],
      [['rules', 'show', rule, '--agent', 'gemini'], 'rules show', /agent must be one of/, 2],
      [['skills', 'show'], 'skills show', /needs a skill name/, 2],
      [['skills', 'show', 'nope'], 'skills show', /unknown skill nope/, 1],
      [['packs', 'warnings'], 'packs warnings', /needs a pack/, 2],
      [['packs', 'warnings', 'nope'], 'packs warnings', /unknown pack nope/, 1],
      [['packs', 'warnings', 'testing', 'extra'], 'packs warnings', /unexpected argument extra/, 2],
      [['projects', 'advise', home], 'projects advise', /is not a registered project/, 1],
      [['projects', 'advise', dir, '--agent', 'gemini'], 'projects advise', /--agent must be an installed one of claude, codex/, 2],
    ]) {
      assert.match((await shape(args, 2, command, ['error'])).error, message);
      assert.equal((await text(args)).code, code, args.join(' '));
    }
    ctx.run = (argv, opts) => (argv[1] === '-p' ? { code: 1, stdout: '', stderr: 'not logged in' } : stub(argv, opts));
    assert.equal((await text(['projects', 'advise', dir])).code, 1);
    process.env.CI = 'true';
    assert.match((await shape(['projects', 'advise', dir], 2, 'projects advise', ['error'])).error, /does not run in CI/);
  } finally {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('--project names the folder of projects plan, doctor and verify; a different positional, a foreign flag or an extra argument exits 2 before anything runs', async () => {
  const { ctx, dir } = setup();
  const plan = await run(ctx, ['projects', 'plan', '--project', dir, '--agents', 'claude', '--json']);
  assert.equal(plan.code, 0);
  assert.equal(plan.doc.dir, dir);
  assert.equal((await run(ctx, ['projects', 'plan', dir, '--project', dir, '--agents', 'claude', '--json'])).doc.dir, dir);
  assert.deepEqual((await run(ctx, ['doctor', '--project', dir, '--agents', 'claude', '--json'])).doc, (await run(ctx, ['doctor', dir, '--agents', 'claude', '--json'])).doc);
  for (const [args, message] of [
    [['projects', 'apply', TMP, '--project', dir, '--yes'], `--project ${dir} and ${TMP} name different folders: give one`],
    [['doctor', TMP, '--project', dir], `--project ${dir} and ${TMP} name different folders: give one`],
    [['verify', dir, 'extra'], 'unexpected argument extra'],
    [['doctor', 'a', 'b', 'c'], 'unexpected argument b'],
    [['history', '--yes'], '--yes does not belong to history'],
    [['plan', '--project', dir], '--project does not belong to plan'],
  ]) {
    const r = await run(ctx, [...args, '--json']);
    assert.equal(r.code, 2, args.join(' '));
    assert.equal(r.doc.error, message);
    assert.equal(r.err, `${message}\n`);
  }
  assert.equal(ctx.ledger.list().length, 0);
});
