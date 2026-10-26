import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
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
    const test_ = await shape(['test', '--agents', 'claude'], 1, 'test', ['ok', 'checks']);
    assert.ok(test_.checks.every((c) => typeof c.name === 'string' && Array.isArray(c.problems)));
    const plan = await shape(['plan', '--agents', 'claude'], 0, 'plan', ['agents', 'level', 'changes']);
    assert.ok(plan.changes.length > 0 && plan.changes.every((c) => c.id && c.title && !('diff' in c)));
    const project = await shape(['project', 'plan', dir, '--agents', 'claude'], 0, 'project plan', ['dir', 'changes', 'skills', 'warnings']);
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
  for (const [args, message] of [[['plan', '--agents', 'claude', '--level', 'nope'], /--level must be one of/], [['doctor', '--baseline', 'x'], /--baseline must be/], [['plan'], /no agent found/], [['project', 'apply'], /--json works with project plan/], [['apply'], /--json works with/], [['packs', 'save'], /--json works with/]]) {
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
    assert.equal(await main(['project', 'apply', dir, '--agents', 'claude', '--skill', 'frontend-design', '--yes'], { out: new Writable({ write(_c, _e, d) { d(); } }), err: new Writable({ write(_c, _e, d) { d(); } }), ctx }), 0);
    const skills = await shape(['skills', '--project', dir, '--agents', 'claude'], 'skills list', ['dir', 'hasSetup', 'skills', 'untracked', 'globalUntracked']);
    assert.ok(skills.hasSetup && skills.skills.some((s) => s.name === 'frontend-design' && s.state && s.single));

    const rules = await shape(['rules', 'list', '--project', dir], 'rules list', ['dir', 'agents']);
    assert.deepEqual(rules.agents.map((a) => a.id), ['claude', 'codex']);
    assert.ok(rules.agents[0].rows.some((r) => r.path === join(dir, 'CLAUDE.md') && r.tokens > 0 && !('text' in r)));
    assert.deepEqual((await shape(['rules', 'list', '--agent', 'codex'], 'rules list', ['dir', 'agents'])).agents.map((a) => a.id), ['codex']);

    const list = await shape(['settings', 'list', '--project', dir], 'settings list', ['agent', 'name', 'layers', 'settings', 'bundles', 'notes']);
    assert.equal(list.agent, 'claude');
    assert.ok(list.settings.length > 0 && list.layers.some((l) => l.error === 'the file does not parse'));
    const advanced = await shape(['settings', 'list', '--advanced'], 'settings list', ['agent', 'name', 'layers', 'settings', 'bundles', 'notes', 'advanced', 'outside', 'env']);
    assert.deepEqual(advanced.env.map((e) => [e.name, e.layer, 'value' in e]), [['DISABLE_TELEMETRY', 'user', false]]);
    const switchKey = await shape(['settings', 'get', 'env.DISABLE_TELEMETRY'], 'settings get', ['agent', 'setting']);
    assert.ok(switchKey.setting.sets.length === 1 && !('value' in switchKey.setting.sets[0]));
    await shape(['settings', 'list', '--agent', 'codex'], 'settings list', ['agent', 'name', 'layers', 'settings', 'bundles', 'notes', 'trust']);
    const get = await shape(['settings', 'get', list.settings[0].key], 'settings get', ['agent', 'setting']);
    assert.equal(get.setting.key, list.settings[0].key);

    const frameworks = await shape(['frameworks'], 'frameworks list', ['frameworks']);
    assert.ok(frameworks.frameworks.length > 0 && frameworks.frameworks.every((f) => f.id && f.title && Array.isArray(f.files)));
    assert.deepEqual((await shape(['frameworks', 'list'], 'frameworks list', ['frameworks'])).frameworks, frameworks.frameworks);

    const scan = await shape(['projects', 'scan', dir], 'projects scan', ['root', 'found']);
    assert.deepEqual([scan.root, scan.found], [dir, [{ path: dir, registered: true }]]);

    const board = await shape(['board'], 'board', ['sessions']);
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
    [['frameworks', 'list', 'extra'], 'frameworks list', /unexpected argument extra/],
    [['board', 'extra'], 'board', /unexpected argument extra/],
    [['frameworks', 'nope'], 'frameworks nope', /--json works with/],
    [['skills', 'update'], 'skills update', /--json works with/],
    [['settings', 'set', 'model', 'x'], 'settings set', /--json works with/],
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
  assert.match(await text(['frameworks']), /^\S+\s+\w+\s+\w+\s+/);
  assert.match(await text(['rules', 'list', '--agent', 'codex']), /^Codex/);
});
