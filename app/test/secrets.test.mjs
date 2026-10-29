import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix as posixPath, win32 } from 'node:path';
import { test } from 'node:test';
import { addCase } from '../src/cases.mjs';
import { childEnv } from '../src/childenv.mjs';
import { cooled } from '../src/cooldown.mjs';
import { diffLines } from '../src/diff.mjs';
import { Ledger, backupRel, runId } from '../src/ledger.mjs';
import { keyed, mask, redactArgv } from '../src/redact.mjs';
import { runEval } from '../src/eval.mjs';
import { apply, context, preview, runCommand, undo } from '../src/runner.mjs';
import { recordSession } from '../src/session.mjs';
import { SRT_VERSION } from '../src/sandbox.mjs';
import { PIN_DATES, SKILLS_CLI, SKILL_SOURCES, globalPlan, skillsCli, skillsSpec } from '../src/steps/global.mjs';

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
  assert.equal(mask('Authorization: token abc123def456'), 'Authorization: ***');
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl_-x';
  // Built from parts so the fixture does not read as a real key to secret scanners.
  const [begin, end] = ['BEGIN', 'END'].map((w) => `-----${w} EC PRIVATE KEY-----`);
  const pem = `${begin}\nb3BlbnNzaC1rZXk=\nAAAAkey=\n${end}`;
  for (const keys of [true, false]) {
    assert.equal(mask(`id ${jwt} end`, { keys }), 'id *** end');
    assert.equal(mask(`a\n${pem}\nb`, { keys }), `a\n${begin}\n***\n${end}\nb`);
  }
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
    GH_TOKEN: 'g', GITHUB_TOKEN: 'g', NPM_TOKEN: 'n', ANTHROPIC_API_KEY: 'a', SSH_AUTH_SOCK: '/s', GIT_ASKPASS: '/ask', GIT_SSH_COMMAND: 'ssh -i /k', GIT_SSH: '/ssh', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraheader', GIT_CONFIG_VALUE_0: 'Authorization: Basic x', GIT_CONFIG_PARAMETERS: "'http.extraheader=x'", GIT_TERMINAL_PROMPT: '0', GIT_PROXY_COMMAND: '/p', GIT_EXTERNAL_DIFF: '/d', GIT_EXEC_PATH: '/x', GIT_PAGER: '/pg', GIT_EDITOR: '/e', GIT_SEQUENCE_EDITOR: '/se', GIT_TEMPLATE_DIR: '/t', GIT_TRACE_CURL: '1', GIT_CURL_VERBOSE: '1', GIT_DIR: '/other/.git', AWS_SECRET_ACCESS_KEY: 's', DBUS_SESSION_BUS_ADDRESS: 'unix:x' };
  assert.deepEqual(Object.keys(childEnv({ DO_NOT_TRACK: '1' }, env)).sort(), ['CLAUDE_CONFIG_DIR', 'DO_NOT_TRACK', 'GIT_TERMINAL_PROMPT', 'HOME', 'HTTPS_PROXY', 'LC_ALL', 'NODE_EXTRA_CA_CERTS', 'PATH', 'npm_config_registry']);
  // The owner names what a tool may still see; the change's own env always passes.
  const { GIT_DIR, ...inRepo } = env;
  const passed = childEnv({ X: '1' }, { ...inRepo, BENCHKEEPER_PASS_ENV: 'gh_token, ssh_auth_sock, git_askpass, git_config_count, git_config_key_0, git_config_value_0' });
  assert.equal(passed.GH_TOKEN, 'g');
  assert.deepEqual([passed.GIT_ASKPASS, passed.GIT_CONFIG_COUNT, passed.GIT_CONFIG_KEY_0, passed.GIT_CONFIG_VALUE_0, passed.GIT_SSH_COMMAND], ['/ask', '1', 'http.extraheader', 'Authorization: Basic x', undefined]);
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

test('the skills CLI minimum and the srt pin have their publish date recorded, and are not younger than 7 days', () => {
  assert.deepEqual(Object.keys(PIN_DATES), [`skills@${SKILLS_CLI}`, `@anthropic-ai/sandbox-runtime@${SRT_VERSION}`], 'a pin changed without its date');
  for (const [pin, date] of Object.entries(PIN_DATES)) assert.ok(Date.parse(date) < Date.now() - 7 * 864e5, `${pin} was published ${date}`);
});

test('the skills CLI is the newest release at least 7 days old, never below the minimum, and an exact override wins', () => {
  const old = new Date(Date.now() - 30 * 864e5).toISOString(), fresh = new Date(Date.now() - 864e5).toISOString();
  const registry = (time) => context({ home: tmp(), run: () => ({ code: 0, stdout: JSON.stringify({ time, versions: Object.keys(time) }), stderr: '' }) });
  const forced = process.env.BENCHKEEPER_SKILLS_CLI;
  delete process.env.BENCHKEEPER_SKILLS_CLI;
  try {
    assert.equal(skillsCli(registry({ '1.7.2': old, '1.8.0': old, '1.9.0': fresh })), '1.8.0', 'a release under 7 days old is held back');
    assert.equal(skillsSpec(registry({ '1.8.0': old })), 'skills@npm:skills@1.8.0');
    assert.equal(skillsCli(registry({ '1.6.0': old })), SKILLS_CLI, 'an older answer never undercuts the minimum');
    assert.equal(skillsCli(context({ home: tmp(), run: () => ({ code: 1, stdout: '', stderr: 'offline' }) })), SKILLS_CLI, 'no registry: the minimum');
    process.env.BENCHKEEPER_SKILLS_CLI = '1.7.9';
    assert.equal(skillsCli(registry({ '1.8.0': old })), '1.7.9');
  } finally { process.env.BENCHKEEPER_SKILLS_CLI = forced; }
});

test('the host tool and the skills CLI resolve their dependencies at releases at least 7 days old, the check and the install alike', () => {
  const seen = [];
  const ctx = context({ home: tmp(), run: (argv, o) => { seen.push({ argv, env: o?.env }); return { code: argv[0] === 'orca' || argv[0] === 'npm' || argv[0] === 'npx' || argv[1]?.endsWith('verify.mjs') ? 0 : 127, stdout: '', stderr: '' }; } });
  const tools = globalPlan({ ctx, agents: ['claude'], devcontainerCli: '1.0.0' }).filter((c) => c.step.startsWith('tools:'));
  assert.equal(tools.length, 4);
  for (const c of tools) assert.ok(Math.abs(Date.parse(c.env?.npm_config_before) - (Date.now() - 7 * 864e5)) < 60e3, `${c.step}: ${c.env?.npm_config_before}`);
  assert.equal(apply(tools, ctx, { select: tools.map((c) => c.id) }).status, 'done');
  for (const verify of seen.filter((x) => x.argv[1]?.endsWith('verify.mjs'))) {
    const install = seen.find((x) => (verify.argv[2].startsWith('skills') ? x.argv[0] === 'npx' : x.argv[0] === 'npm' && x.argv[1] === 'i'));
    assert.equal(verify.env.npm_config_before, install.env.npm_config_before, verify.argv[2]);
  }
});

test('global skills come from the default branch, run without lifecycle scripts, and undo restores them', () => {
  const home = tmp();
  const seen = [];
  const run = (argv, o) => {
    seen.push({ argv, env: o?.env });
    if (argv[0] === 'npx') { mkdirSync(join(home, '.claude/skills/find-skills'), { recursive: true }); writeFileSync(join(home, '.claude/skills/find-skills/SKILL.md'), '# x\n'); writeFileSync(join(home, '.agents/.skill-lock.json'), '{"find-skills":1}\n'); }
    return { code: /orca/.test(argv[0]) || argv[0] === 'devcontainer' ? 127 : 0, stdout: '', stderr: '' };
  };
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents/.skill-lock.json'), '{}\n');
  const ctx = context({ home, run });
  const plan = preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: null })).filter((c) => c.step.startsWith('tools:skill'));
  assert.equal(plan.length, 1);
  assert.equal(plan[0].argv[4], SKILL_SOURCES['vercel-labs/skills']);
  assert.ok(!plan[0].argv[4].includes('/tree/'), 'a global skill source follows the default branch');
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

// POSIX modes: Windows has none to check.
const posix = { skip: process.platform === 'win32' };
test('a new agent settings file is private; an existing one keeps its mode', posix, () => {
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

test('a backup outside HOME holds no drive colon; Windows compares HOME case-insensitively', () => {
  assert.equal(backupRel('C:\\Users\\me', 'D:\\code\\proj\\AGENTS.md', win32), '_root\\D\\code\\proj\\AGENTS.md');
  assert.equal(backupRel('C:\\Users\\me', '\\\\server\\share\\proj\\AGENTS.md', win32), '_root\\UNC\\server\\share\\proj\\AGENTS.md');
  assert.equal(backupRel('C:\\Users\\me', 'c:\\users\\me\\.claude\\settings.json', win32), '.claude\\settings.json');
  assert.equal(backupRel('/h', '/srv/proj/AGENTS.md', posixPath), '_root/srv/proj/AGENTS.md');
  assert.equal(backupRel('/h', '/H/x', posixPath), '_root/H/x', 'POSIX paths stay case-sensitive');
});

test('eval outputs and results are private, also in folders an earlier version made', posix, async () => {
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

test('an eval session starts with the agent login variables only, not the user tokens', async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { GH_TOKEN: 'ghp_x', NPM_TOKEN: 'npm_x', SSH_AUTH_SOCK: '/s', ANTHROPIC_API_KEY: 'k' });
  const envs = [];
  const ctx = context({ home: tmp(), run: (argv, o) => { if (argv[0] === 'git') return runCommand(argv, o); envs.push(o?.env); return { code: 0, stdout: '{"type":"system"}\n', stderr: '' }; } });
  await runEval(ctx, [{ target: 'skill:x', agent: 'claude', hash: 'h', cases: [{ id: 'a', query: 'q', should: true }] }]);
  const env = envs.find((e) => e);
  assert.equal(env.ANTHROPIC_API_KEY, 'k');
  for (const name of ['GH_TOKEN', 'NPM_TOKEN', 'SSH_AUTH_SOCK']) assert.ok(!(name in env), name);
});

test('an eval session leaves no transcript, loads no MCP server, and its probes get the filtered environment', async (t) => {
  const saved = { ...process.env };
  t.after(() => { process.env = saved; });
  Object.assign(process.env, { GH_TOKEN: 'ghp_x', NPM_TOKEN: 'npm_x' });
  const help = { claude: '  --no-session-persistence  Disable session persistence\n', codex: '      --ephemeral\n          Run without persisting session files\n' };
  for (const agent of ['claude', 'codex']) {
    const calls = [];
    const ctx = context({ home: tmp(), run: (argv, o) => { calls.push({ argv, env: o?.env }); return argv[0] === 'git' ? runCommand(argv, o) : { code: 0, stdout: argv.includes('--help') ? help[agent] : '{"type":"system"}\n', stderr: '' }; } });
    await runEval(ctx, [{ target: 'skill:x', agent, hash: 'h', cases: [{ id: 'a', query: 'q', should: true }] }]);
    const session = calls.find((c) => c.argv[0] === agent && c.argv.includes('q')).argv;
    assert.ok(session.includes(agent === 'claude' ? '--no-session-persistence' : '--ephemeral'), agent);
    assert.equal(session.includes('--strict-mcp-config'), agent === 'claude');
    // The query is an argument value, never an option: after -p for Claude, last for Codex.
    assert.equal(agent === 'claude' ? session[1] === '-p' && session[2] === 'q' : session.at(-1) === 'q', true, agent);
    for (const c of calls.filter((x) => x.env)) for (const name of ['GH_TOKEN', 'NPM_TOKEN']) assert.ok(!(name in c.env), `${agent} ${c.argv.slice(0, 2).join(' ')} ${name}`);
    assert.ok(calls.find((c) => c.argv[0] === 'git').argv.includes('--template='), 'the scratch repository takes no git template');
    assert.ok(calls.filter((c) => c.argv[0] === 'git' || c.argv.includes('--version')).every((c) => c.env), 'git init and the version probe pass an environment');
  }
});

test('an eval session that exits non-zero is no missed trigger and stores no result', async () => {
  const home = tmp();
  const ctx = context({ home, run: (argv, o) => (argv[0] === 'git' ? runCommand(argv, o) : argv.includes('q') ? { code: 1, stdout: '', stderr: `error: unknown option, ${TOKEN}` } : { code: 0, stdout: '', stderr: '' }) });
  await assert.rejects(runEval(ctx, [{ target: 'skill:x', agent: 'claude', hash: 'h', cases: [{ id: 'a', query: 'q', should: true }] }]), (e) => /claude exited with 1 on case a of skill:x: error: unknown option, \*\*\*$/.test(e.message));
  assert.equal(existsSync(join(home, '.config/benchkeeper/evals/results.jsonl')), false);
});

test('a rule target whose second case fails keeps no output of its first case', async () => {
  const home = tmp();
  let n = 0;
  const ctx = context({ home, run: (argv, o) => (argv[0] === 'git' ? runCommand(argv, o) : argv.includes('q') ? { code: n++ ? 1 : 0, stdout: '{"type":"system"}\n', stderr: 'x' } : { code: 0, stdout: '', stderr: '' }) });
  const cases = ['a', 'b'].map((id) => ({ id, query: 'q', should: true, expected: 'e' }));
  await assert.rejects(runEval(ctx, [{ target: 'rule:global', agent: 'claude', hash: 'h', cases }]), /exited with 1 on case b/);
  const outputs = join(home, '.config/benchkeeper/evals/outputs');
  assert.deepEqual(existsSync(outputs) ? readdirSync(outputs) : [], []);
});

test('the tail of a failed session is masked before it is cut', async () => {
  const ctx = context({ home: tmp(), run: (argv, o) => (argv[0] === 'git' ? runCommand(argv, o) : argv.includes('q') ? { code: 1, stdout: '', stderr: `${TOKEN} ${'x'.repeat(185)}` } : { code: 0, stdout: '', stderr: '' }) });
  await assert.rejects(runEval(ctx, [{ target: 'skill:x', agent: 'claude', hash: 'h', cases: [{ id: 'a', query: 'q', should: true }] }]), (e) => !e.message.includes('cdefghijkl') && e.message.includes('***'));
});

test('mask stays linear on a long dotted token and leaves ordinary words alone', () => {
  const long = `${'a.'.repeat(20000)}x`;
  const t = Date.now();
  mask(long);
  assert.ok(Date.now() - t < 1000);
  assert.equal(mask('"theme": "dark"'), '"theme": "dark"');
});

test('mask: a quoted value with spaces goes whole; .env files with a suffix are keyed; a described case is masked', () => {
  assert.equal(mask('--password "correct horse" next'), '--password *** next');
  assert.equal(mask("--token 'a b' x"), '--token *** x');
  assert.ok(keyed('/p/.env.local') && keyed('/p/.env') && keyed('/h/.npmrc') && !keyed('/h/rules.md'));
  const ctx = context({ home: tmp() });
  const { path } = addCase(ctx, { target: 'skill:x', expected: 'e', description: `use ${TOKEN}` });
  assert.doesNotMatch(readFileSync(path, 'utf8'), /sk-ant/);
});
