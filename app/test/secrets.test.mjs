import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addCase } from '../src/cases.mjs';
import { childEnv } from '../src/childenv.mjs';
import { cooled } from '../src/cooldown.mjs';
import { diffLines } from '../src/diff.mjs';
import { Ledger, runId } from '../src/ledger.mjs';
import { mask, redactArgv } from '../src/redact.mjs';
import { runEval } from '../src/eval.mjs';
import { apply, context, preview, runCommand, undo } from '../src/runner.mjs';
import { recordSession } from '../src/session.mjs';
import { SKILL_SOURCES, globalPlan } from '../src/steps/global.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'bk-secrets-'));
const mode = (p) => statSync(p).mode & 0o777;
const TOKEN = 'sk-ant-api03-abcdefghijklmnop';

test('mask: values of secret keys and token shapes, nothing else', () => {
  assert.equal(mask('"ANTHROPIC_API_KEY": "abc123",'), '"ANTHROPIC_API_KEY": ***,');
  assert.equal(mask('GH_TOKEN=abc123 next'), 'GH_TOKEN=*** next');
  assert.equal(mask('--api-key abc123 --name x'), '--api-key *** --name x');
  assert.equal(mask('mcp_servers.x.env.TOKEN="abc"'), 'mcp_servers.x.env.TOKEN=***');
  assert.equal(mask(`curl -H "Authorization: Bearer ${TOKEN}"`), 'curl -H "Authorization: ***"');
  assert.equal(mask('git clone https://user:pw@github.com/o/r'), 'git clone https://***@github.com/o/r');
  assert.equal(mask('"effortLevel": "high"'), '"effortLevel": "high"');
  // Free text: only shapes. A rule that says "Keep secrets: read them from the environment" stays readable.
  assert.equal(mask('Keep secrets: read them from files', { keys: false }), 'Keep secrets: read them from files');
  assert.equal(mask(`paste ${TOKEN} here`, { keys: false }), 'paste *** here');
});

test('a diff of a settings file masks a token in its context lines', () => {
  const before = '{\n  "env": {\n    "GH_TOKEN": "ghp_0123456789abcdef",\n    "A": "1"\n  }\n}\n';
  const after = before.replace('"A": "1"', '"A": "1",\n    "B": "2"');
  const d = diffLines(before, after, '/h/.claude/settings.json');
  assert.match(d, /"B": "2"/);
  assert.doesNotMatch(d, /ghp_0123456789abcdef/);
  assert.match(d, /"GH_TOKEN": \*\*\*/);
  // A rules file keeps its words, a token shape is masked there too.
  const r = diffLines('a\npassword: be careful\n', `a\npassword: be careful\n${TOKEN}\n`, '/h/.claude/rules/x.md');
  assert.match(r, /password: be careful/);
  assert.doesNotMatch(r, /sk-ant/);
});

test('childEnv: tools keep their way to the network and their folders, credentials stay', () => {
  const env = { PATH: '/bin', HOME: '/h', LC_ALL: 'C', HTTPS_PROXY: 'http://p:1', NODE_EXTRA_CA_CERTS: '/ca', npm_config_registry: 'https://r/', 'npm_config_//r/:_authToken': 'x', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_OAUTH_TOKEN: 't',
    GH_TOKEN: 'g', GITHUB_TOKEN: 'g', NPM_TOKEN: 'n', ANTHROPIC_API_KEY: 'a', SSH_AUTH_SOCK: '/s', GIT_ASKPASS: '/ask', GIT_DIR: '/other/.git', AWS_SECRET_ACCESS_KEY: 's', DBUS_SESSION_BUS_ADDRESS: 'unix:x' };
  assert.deepEqual(Object.keys(childEnv({ DO_NOT_TRACK: '1' }, env)).sort(), ['CLAUDE_CONFIG_DIR', 'DO_NOT_TRACK', 'GIT_ASKPASS', 'HOME', 'HTTPS_PROXY', 'LC_ALL', 'NODE_EXTRA_CA_CERTS', 'PATH', 'npm_config_registry']);
  // The owner names what a tool may still see; the change's own env always passes.
  const passed = childEnv({ X: '1' }, { ...env, BENCHKEEPER_PASS_ENV: 'gh_token, ssh_auth_sock' });
  assert.equal(passed.GH_TOKEN, 'g');
  assert.equal(passed.SSH_AUTH_SOCK, '/s');
  assert.equal(passed.GITHUB_TOKEN, undefined);
  assert.equal(passed.X, '1');
});

test('cooled: published for 7 days, still installable, a plain release, a string time', () => {
  const now = Date.parse('2026-10-25');
  const time = { '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-01-02T00:00:00Z', '1.2.0': '2026-10-24T00:00:00Z', '1.3.0': 5, '1.4.0': { x: 1 }, '2.0.0-rc.1': '2026-01-01T00:00:00Z', created: '2026-01-01T00:00:00Z' };
  assert.deepEqual(cooled(time, ['1.0.0', '1.2.0', '1.3.0', '1.4.0', '2.0.0-rc.1'], now), ['1.0.0'], '1.1.0 was unpublished');
  assert.deepEqual(cooled(time, [], now), []);
  assert.deepEqual(cooled([time], ['1.0.0'], now), []);
  assert.deepEqual(cooled(null, undefined, now), []);
});

test('global skills come from a commit, run without lifecycle scripts, and undo restores them', () => {
  const home = tmp();
  const seen = [];
  const run = (argv, o) => {
    seen.push({ argv, env: o?.env });
    if (argv[0] === 'npx') { mkdirSync(join(home, '.claude/skills/find-skills'), { recursive: true }); writeFileSync(join(home, '.claude/skills/find-skills/SKILL.md'), '# x\n'); writeFileSync(join(home, '.agents/.skill-lock.json'), '{"find-skills":1}\n'); }
    return { code: argv[0] === 'orca' || argv[0] === 'devcontainer' ? 127 : 0, stdout: '', stderr: '' };
  };
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents/.skill-lock.json'), '{}\n');
  const ctx = context({ home, run });
  const plan = preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: null })).filter((c) => c.step.startsWith('tools:skill'));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].argv[4], SKILL_SOURCES['vercel-labs/skills']);
  assert.match(plan[0].argv[4], /\/tree\/[0-9a-f]{40}$/);
  const r = apply(plan, ctx, { select: plan.map((c) => c.id) });
  assert.equal(r.status, 'done');
  const npx = seen.find((x) => x.argv[0] === 'npx');
  assert.equal(npx.env.npm_config_ignore_scripts, 'true');
  assert.equal(npx.env.DO_NOT_TRACK, '1');
  assert.equal(undo(r.id, ctx).status, 'done');
  assert.equal(existsSync(join(home, '.claude/skills/find-skills')), false);
  assert.equal(statSync(join(home, '.agents/.skill-lock.json')).size, 3);
});

test('commands run with the filtered environment, and a failure keeps no token in the ledger', () => {
  const home = tmp();
  process.env.BK_TEST_TOKEN = 'leak';
  let env;
  const ctx = context({ home, run: (argv, o) => { env = o.env; return { code: 1, stdout: '', stderr: `fetch failed\nAuthorization: Bearer ${TOKEN}\n` }; } });
  const r = apply([{ id: 'c', step: 's', title: 't', kind: 'command', argv: ['npm', 'i', '-g', 'x'] }], ctx, { select: ['c'] });
  delete process.env.BK_TEST_TOKEN;
  assert.equal(env.BK_TEST_TOKEN, undefined);
  assert.ok(env.PATH);
  assert.equal(r.status, 'failed');
  assert.doesNotMatch(r.entries[0].error, /sk-ant/);
  assert.match(r.entries[0].error, /fetch failed/);
});

test('an undo command reports the last lines of its output, masked', () => {
  const home = tmp();
  let fail = false;
  const ctx = context({ home, run: () => (fail ? { code: 1, stdout: '', stderr: `${'noise\n'.repeat(50)}GH_TOKEN=abc123\n` } : { code: 0, stdout: '', stderr: '' }) });
  const r = apply([{ id: 'c', step: 's', title: 't', kind: 'command', argv: ['a'], undoArgv: ['b'] }], ctx, { select: ['c'] });
  fail = true;
  const u = undo(r.id, ctx);
  assert.equal(u.status, 'failed');
  assert.ok(u.entries[0].error.length < 100);
  assert.doesNotMatch(u.entries[0].error, /abc123/);
});

test('a new agent settings file is private; an existing one keeps its mode', () => {
  const home = tmp();
  const ctx = context({ home });
  const s = join(home, '.claude/settings.json'), c = join(home, '.codex/config.toml'), rules = join(home, '.claude/rules/00-global.md'), old = join(home, '.gemini/settings.json');
  mkdirSync(join(home, '.gemini'));
  writeFileSync(old, '{}');
  chmodSync(old, 0o644);
  const changes = [s, c, rules, old].map((path, i) => ({ id: `w${i}`, step: 's', title: path, kind: 'write', path, after: path === old ? '{"a":1}' : 'x\n' }));
  assert.equal(apply(changes, ctx, { select: changes.map((x) => x.id) }).status, 'done');
  assert.equal(mode(s), 0o600);
  assert.equal(mode(c), 0o600);
  assert.equal(mode(old), 0o644);
  assert.notEqual(mode(rules), 0o600);
});

test('a recorded session keeps its argv with secrets masked', () => {
  const dir = tmp();
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'a@b.c'], ['config', 'user.name', 'n'], ['commit', '-q', '--allow-empty', '-m', 'init']]) assert.equal(spawnSync('git', ['-C', dir, ...a]).status, 0);
  const ctx = context({ home: tmp() });
  assert.deepEqual(redactArgv(['codex', '-c', 'mcp_servers.x.env.TOKEN="abc"', '--api-key', 'k123', '--model', 'm', `x=${TOKEN}`]), ['codex', '-c', 'mcp_servers.x.env.TOKEN=***', '--api-key', '***', '--model', 'm', 'x=***']);
  const run = recordSession(ctx, dir, ['sh', '-c', 'exit 0', 'x', '--api-key', 'k123']);
  const e = ctx.ledger.get(run.id).entries[0];
  assert.deepEqual(e.argv, ['sh', '-c', 'exit 0', 'x', '--api-key', '***']);
  assert.doesNotMatch(JSON.stringify(e), /k123/);
});

test('a case copied from a transcript carries no pasted token', () => {
  const home = tmp();
  const ctx = context({ home });
  const t = join(home, 't.jsonl');
  writeFileSync(t, `${JSON.stringify({ type: 'user', message: { content: `deploy with ${TOKEN} please` } })}\n`);
  const { case: c } = addCase(ctx, { target: 'skill:x', expected: 'it triggers', transcript: t });
  assert.equal(c.query, 'deploy with *** please');
});

test('backups of runs older than the retention period go; newer and setup.sh ones stay', () => {
  const config = tmp();
  const l = new Ledger(config, '/h');
  const mk = (name) => { mkdirSync(join(l.backups, name, '0'), { recursive: true }); writeFileSync(join(l.backups, name, '0/f'), 'old token'); };
  const now = Date.parse('2026-10-25T00:00:00Z');
  const old = runId(new Date('2026-06-01T00:00:00Z')), recent = runId(new Date('2026-10-20T00:00:00Z'));
  for (const n of [old, recent, '2026-01-01-000000']) mk(n);
  assert.deepEqual(l.prune(90, now), [old]);
  assert.equal(existsSync(join(l.backups, old)), false);
  assert.ok(existsSync(join(l.backups, recent)) && existsSync(join(l.backups, '2026-01-01-000000')));
  assert.deepEqual(l.prune(0, now), [], '0 keeps every backup');
});

test('eval outputs and results are private, also in folders an earlier version made', async () => {
  const home = tmp();
  const ctx = context({ home, run: (argv, o) => (argv[0] === 'git' ? runCommand(argv, o) : { code: 0, stdout: '{"type":"system"}\n', stderr: '' }) });
  const evals = join(home, '.config/benchkeeper/evals');
  mkdirSync(join(evals, 'outputs'), { recursive: true });
  chmodSync(evals, 0o755);
  chmodSync(join(evals, 'outputs'), 0o755);
  const plan = [{ target: 'rule:global', agent: 'claude', hash: 'h', cases: [{ id: 'a', query: 'q', should: true, expected: 'e' }] }];
  const [res] = await runEval(ctx, plan);
  const file = res.details[0].review;
  assert.equal(mode(file), 0o600);
  for (const d of [evals, join(evals, 'outputs'), join(file, '..')]) assert.equal(mode(d), 0o700, d);
  assert.equal(mode(join(evals, 'results.jsonl')), 0o600);
});
