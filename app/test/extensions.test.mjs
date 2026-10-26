// The Extensions view: MCP servers, hooks, subagents, commands and output styles from files, with owner and the runs-code
// mark; no environment value, header or token ever appears, in the view, the route or the command line.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { extensionsView } from '../src/extensions.mjs';
import { addProject } from '../src/projects.mjs';
import { apply, context, preview } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { globalPlan } from '../src/steps/global.mjs';

const TMP = realpathSync(tmpdir());
const at = (rel) => join('~', rel);
const DUMMY = ['DUMMY_ENV_SECRET', 'DUMMY_HEADER_SECRET', 'DUMMY_ARG_SECRET', 'DUMMY_URL_PW', 'DUMMY_QUERY_SECRET', 'DUMMY_HOOK_SECRET', 'DUMMY_HOOK_PW', 'DUMMY_TOML_ENV', 'DUMMY_TOML_HEADER', 'DUMMY_PATH_SECRET'];
const run = () => ({ code: 0, stdout: '1.0.0', stderr: '' });
const write = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, typeof text === 'string' ? text : JSON.stringify(text)); };
const output = () => { let text = ''; return { stream: new Writable({ write(c, _e, cb) { text += c; cb(); } }), get text() { return text; } }; };
const noSecrets = (value, what) => { const text = typeof value === 'string' ? value : JSON.stringify(value); for (const s of DUMMY) assert.ok(!text.includes(s), `${what} shows ${s}`); };

// One server, one hook and one subagent per agent, plus a command and an output style for Claude Code.
function fixture() {
  const ctx = context({ home: mkdtempSync(join(TMP, 'bk-ext-')), run });
  const h = ctx.home;
  write(join(h, '.claude.json'), { mcpServers: {
    files: { command: 'npx', args: ['-y', 'files-server', '--api-key', 'DUMMY_ARG_SECRET'], env: { TOKEN: 'DUMMY_ENV_SECRET' } },
    docs: { type: 'http', url: 'https://user:DUMMY_URL_PW@mcp.example.com/mcp/DUMMY_PATH_SECRET?token=DUMMY_QUERY_SECRET', headers: { Authorization: 'Bearer DUMMY_HEADER_SECRET' } },
  } });
  write(join(h, '.claude/settings.json'), { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'TOKEN=DUMMY_HOOK_SECRET ./check.sh --password DUMMY_HOOK_PW' }] }],
    Stop: [{ hooks: [{ type: 'http', url: 'https://hooks.example.com/stop/DUMMY_PATH_SECRET?key=DUMMY_QUERY_SECRET', headers: { Authorization: 'Bearer DUMMY_HEADER_SECRET' } }] }] } });
  write(join(h, '.claude/agents/reviewer.md'), '---\nname: reviewer\ndescription: "Reviews diffs"\n---\n\nRead the diff.\n');
  write(join(h, '.claude/commands/ship.md'), '---\ndescription: Ship it\n---\n\nStatus: !`git status`\n');
  write(join(h, '.claude/output-styles/terse.md'), '---\nname: terse\ndescription: Short answers\n---\n\nBe short.\n');
  write(join(h, '.codex/config.toml'), `[mcp_servers.search]\ncommand = "search-server"\nargs = ["--serve"]\nenv = { API_TOKEN = "DUMMY_TOML_ENV" }\n\n[mcp_servers.remote]\nurl = "https://mcp.example.com/codex"\nenabled = false\nhttp_headers = { Authorization = "Bearer DUMMY_TOML_HEADER" }\n\n[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "./audit.sh --token DUMMY_HOOK_SECRET"\n`);
  write(join(h, '.codex/agents/reviewer.toml'), 'name = "reviewer"\ndescription = "Reviews diffs"\ndeveloper_instructions = "Read."\n');
  return ctx;
}
const find = (view, id, kind, name) => view.agents.find((a) => a.id === id).rows.find((r) => r.kind === kind && r.name === name);

test('Claude Code: servers, hooks, subagents, commands and styles with owner and the runs-code mark', () => {
  const view = extensionsView(fixture());
  const files = find(view, 'claude', 'mcp', 'files');
  assert.deepEqual([files.scope, files.owner, files.transport, files.runsCode, files.state, files.removal, files.shown], ['user', 'yours', 'stdio', true, 'on', true, at('.claude.json')]);
  assert.equal(files.detail, 'npx -y files-server --api-key ***');
  const docs = find(view, 'claude', 'mcp', 'docs');
  assert.deepEqual([docs.transport, docs.runsCode, docs.detail], ['http', false, 'https://mcp.example.com']);
  const bash = find(view, 'claude', 'hook', 'PreToolUse');
  assert.deepEqual([bash.matcher, bash.runsCode, bash.owner, bash.removal, bash.shown], ['Bash', true, 'yours', true, at('.claude/settings.json')]);
  assert.equal(bash.detail, 'TOKEN=*** ./check.sh --password ***');
  const stop = find(view, 'claude', 'hook', 'Stop');
  assert.deepEqual([stop.transport, stop.runsCode, stop.detail], ['http', false, 'POST https://hooks.example.com']);
  assert.deepEqual([find(view, 'claude', 'subagent', 'reviewer').owner, find(view, 'claude', 'subagent', 'reviewer').runsCode], ['yours', false]);
  assert.equal(find(view, 'claude', 'command', 'ship').runsCode, true);
  assert.equal(find(view, 'claude', 'style', 'terse').runsCode, false);
  noSecrets(view, 'the view');
});

test('Codex: servers, hooks and subagents from config.toml and the agents folder', () => {
  const view = extensionsView(fixture());
  const search = find(view, 'codex', 'mcp', 'search');
  assert.deepEqual([search.transport, search.runsCode, search.state, search.detail, search.owner], ['stdio', true, 'on', 'search-server --serve', 'yours']);
  const remote = find(view, 'codex', 'mcp', 'remote');
  assert.deepEqual([remote.transport, remote.runsCode, remote.state], ['http', false, 'off']);
  const hook = find(view, 'codex', 'hook', 'PreToolUse');
  assert.deepEqual([hook.runsCode, hook.detail], [true, './audit.sh --token ***']);
  assert.equal(find(view, 'codex', 'subagent', 'reviewer').shown, at('.codex/agents/reviewer.toml'));
  noSecrets(view, 'the view');
});

test('a project lists its own files and the approval state of .mcp.json servers; a plugin of BenchKeeper is owned by it', () => {
  const ctx = fixture();
  const dir = mkdtempSync(join(TMP, 'bk-ext-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  write(join(dir, '.mcp.json'), { mcpServers: { approved: { command: 'a' }, rejected: { command: 'b' }, waiting: { command: 'c', env: { TOKEN: 'DUMMY_ENV_SECRET' } } } });
  write(join(dir, '.claude/settings.json'), { enabledMcpjsonServers: ['approved'], disabledMcpjsonServers: ['rejected'] });
  write(join(dir, '.claude/agents/local.md'), '---\nname: local\n---\n');
  const root = join(ctx.home, '.claude/plugins/cache/bk');
  write(join(root, 'hooks/hooks.json'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } });
  write(join(root, '.mcp.json'), { mcpServers: { pw: { command: 'playwright-mcp' } } });
  write(join(ctx.home, '.claude/plugins/installed_plugins.json'), { plugins: { 'benchkeeper@benchkeeper': [{ scope: 'user', installPath: root }] } });
  write(join(ctx.home, '.claude/settings.json'), { enabledPlugins: { 'benchkeeper@benchkeeper': true } });
  const view = extensionsView(ctx, { agents: ['claude'], dir });
  assert.deepEqual(['approved', 'rejected', 'waiting'].map((n) => find(view, 'claude', 'mcp', n).state), ['on', 'off', 'asks first']);
  assert.equal(find(view, 'claude', 'mcp', 'waiting').owner, 'project');
  assert.equal(find(view, 'claude', 'subagent', 'local').owner, 'project');
  const hook = find(view, 'claude', 'hook', 'SessionStart');
  assert.deepEqual([hook.owner, hook.plugin, hook.runsCode, hook.removal], ['BenchKeeper', 'benchkeeper@benchkeeper', true, false]);
  assert.equal(find(view, 'claude', 'mcp', 'pw').owner, 'BenchKeeper');
  assert.deepEqual(extensionsView(ctx, { agents: ['claude'] }).agents[0].rows.filter((r) => r.owner === 'project'), []);
  noSecrets(view, 'the view');
});

test('a file that does not parse is named without its text', () => {
  const ctx = fixture();
  write(join(ctx.home, '.claude.json'), '{"mcpServers": DUMMY_ENV_SECRET');
  write(join(ctx.home, '.codex/hooks.json'), 'DUMMY_HEADER_SECRET');
  const view = extensionsView(ctx);
  assert.deepEqual(view.agents.map((a) => a.problems.map((p) => p.shown)), [[at('.claude.json')], [at('.codex/hooks.json')]]);
  noSecrets(view, 'the view');
});

test('the route and the command line list the same rows and show no secret', async () => {
  const ctx = fixture();
  const dir = mkdtempSync(join(TMP, 'bk-ext-proj-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  addProject(ctx, dir);
  const routes = api(ctx);
  const listed = routes['GET /api/extensions'](new URLSearchParams());
  assert.ok(listed.agents.some((a) => a.rows.some((r) => r.kind === 'mcp' && r.name === 'files')));
  assert.equal(routes['GET /api/extensions'](new URLSearchParams({ dir })).dir, dir);
  assert.throws(() => routes['GET /api/extensions'](new URLSearchParams({ dir: join(ctx.home, 'unregistered') })), /register the project first/);
  noSecrets(listed, 'the route');
  const cli = async (...args) => { const o = output(); const code = await main(args, { out: o.stream, err: o.stream, ctx }); return { code, text: o.text }; };
  const text = await cli('extensions', 'list');
  assert.equal(text.code, 0);
  assert.match(text.text, /mcp\s+user\s+yours\s+runs code\s+files\s+npx -y files-server --api-key \*\*\*/);
  noSecrets(text.text, 'the listing');
  const json = await cli('extensions', 'list', '--json', '--agent', 'codex');
  assert.equal(JSON.parse(json.text).command, 'extensions list');
  assert.deepEqual(JSON.parse(json.text).agents.map((a) => a.id), ['codex']);
  noSecrets(json.text, 'the JSON');
  assert.equal((await cli('extensions', 'frob')).code, 2);
  assert.equal((await cli('extensions', 'list', '--agent', 'gemini')).code, 2);
});

test('after BenchKeeper wrote settings and config, the entries of the user in them stay yours and removable', () => {
  const ctx = fixture();
  apply(preview(globalPlan({ ctx, agents: ['claude', 'codex'], devcontainerCli: '1.0.0' })), ctx);
  const view = extensionsView(ctx);
  const hook = find(view, 'claude', 'hook', 'PreToolUse');
  assert.deepEqual([hook.owner, hook.removal], ['yours', true]);
  const search = find(view, 'codex', 'mcp', 'search');
  assert.deepEqual([search.owner, search.removal], ['yours', true]);
  assert.deepEqual([find(view, 'codex', 'hook', 'PreToolUse').owner, find(view, 'codex', 'hook', 'PreToolUse').removal], ['yours', false], 'Doctor removes Codex hooks of hooks.json only');
});

test('the global view ignores the project of the process folder', () => {
  const ctx = fixture();
  const claude = JSON.parse(readFileSync(join(ctx.home, '.claude.json'), 'utf8'));
  write(join(ctx.home, '.claude.json'), { ...claude, projects: { [realpathSync(process.cwd())]: { disabledMcpServers: ['files'] } } });
  assert.equal(find(extensionsView(ctx), 'claude', 'mcp', 'files').state, 'on');
});

test('a hook entry that is not an object is skipped, and control characters stay out of the terminal listing', async () => {
  const ctx = fixture();
  write(join(ctx.home, '.claude/settings.json'), { hooks: { Stop: [{ hooks: [null, 7, { type: 'command', command: 'echo \u001b]0;x\u0007 done' }] }] } });
  const view = extensionsView(ctx, { agents: ['claude'] });
  assert.deepEqual(view.agents[0].rows.filter((r) => r.kind === 'hook').map((r) => r.name), ['Stop']);
  const o = output();
  assert.equal(await main(['extensions', 'list', '--agent', 'claude'], { out: o.stream, err: o.stream, ctx }), 0);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(o.text));
  assert.match(o.text, /echo \?\]0;x\? done/);
});

test('the route lists both agents without asking which are installed', () => {
  const ctx = fixture();
  assert.deepEqual(api(ctx)['GET /api/extensions'](new URLSearchParams()).agents.map((a) => a.id), ['claude', 'codex']);
});
