import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { adviseSetup, noTrace, parseAdvice } from '../src/advise.mjs';
import { agentEnv } from '../src/childenv.mjs';

const lib = { packs: [{ id: 'frontend', skills: ['a'] }], skills: [{ name: 'a' }, { name: 'b' }] };

test('Codex answers through its output file; it reads only the project, without web search or MCP servers', async () => {
  let argv, servers = [{ name: 'playwright' }];
  const ctx = { run: (a) => {
    if (a.includes('--help')) return { code: 0, stdout: '', stderr: '' };
    if (a[1] === 'mcp') return { code: 0, stdout: JSON.stringify(servers), stderr: '' };
    argv = a;
    writeFileSync(a[a.indexOf('-o') + 1], '{"skills": [{"name": "b", "reason": "x"}]}');
    return { code: 0, stdout: '', stderr: '' };
  } };
  assert.deepEqual(await adviseSetup(ctx, { dir: '/p', agent: 'codex', lib }), { env: null, packs: [], skills: [{ name: 'b', reason: 'x' }] });
  const config = argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : []));
  assert.deepEqual(config.filter((c) => !c.startsWith('permissions.')), ['sandbox_mode="read-only"', 'default_permissions="benchkeeper-advice"', 'web_search="disabled"', 'mcp_servers.playwright.enabled=false']);
  assert.match(config.find((c) => c.startsWith('permissions.')), /^permissions\.benchkeeper-advice\.filesystem=\{":minimal"="read", ":workspace_roots"="read"/);
  for (servers of [[{ name: 'a.b' }], [{}]]) await assert.rejects(adviseSetup(ctx, { dir: '/p', agent: 'codex', lib }), /cannot be turned off/);
  // No server list, no session: none of them could be turned off.
  await assert.rejects(adviseSetup({ run: (a) => (a[1] === 'mcp' ? { code: 1, stdout: '', stderr: 'unknown command' } : assert.fail('session started')) }, { dir: '/p', agent: 'codex', lib }), /codex mcp list --json failed \(1\): unknown command/);
  await assert.rejects(adviseSetup({ run: () => ({ code: 1, stdout: '', stderr: 'not logged in' }) }, { dir: '/p', agent: 'claude', lib }), /not logged in/);
  await assert.rejects(adviseSetup(ctx, { dir: '/p', agent: 'gemini', lib }), /agent must be/);
});

test('advice: no JSON fails; reasons are one line of at most 200 characters', () => {
  assert.throws(() => parseAdvice('no idea', lib), /no JSON/);
  const r = parseAdvice(JSON.stringify({ packs: [{ id: 'frontend', reason: `a\n${'x'.repeat(300)}` }] }), lib);
  assert.equal(r.packs[0].reason.length, 200);
  assert.ok(!r.packs[0].reason.includes('\n'));
  // Inherited keys and arrays are no environment.
  for (const id of ['constructor', '__proto__', ['container']]) assert.equal(parseAdvice(JSON.stringify({ env: { id } }), lib).env, null);
});

test('Codex may read its own folder: the npm package root or the folder of a standalone binary, never the one above', async () => {
  // Codex's folder is resolved through links (macOS: /var is /private/var).
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'bk-codex-')));
  const read = async (bin) => {
    mkdirSync(dirname(join(t, bin)), { recursive: true });
    writeFileSync(join(t, bin), '');
    const path = process.env.PATH;
    process.env.PATH = dirname(join(t, bin));
    let argv;
    try {
      await adviseSetup({ run: (a) => { if (a.includes('--help')) return { code: 1, stdout: '', stderr: '' }; if (a[1] === 'mcp') return { code: 0, stdout: '[]', stderr: '' }; argv = a; writeFileSync(a[a.indexOf('-o') + 1], '{}'); return { code: 0, stdout: '', stderr: '' }; } }, { dir: '/p', agent: 'codex', lib });
    } finally { process.env.PATH = path; }
    return argv.find((a) => a.startsWith('permissions.')).match(/"([^"]+)"="read"}$/)[1];
  };
  assert.equal(await read('home/bin/codex'), join(t, 'home/bin'));
  assert.equal(await read('lib/node_modules/@openai/codex/bin/codex'), join(t, 'lib/node_modules/@openai/codex'));
});

test('advice keeps no session on disk where the installed CLI has the flag, read from its help and never from a prompt', async () => {
  const help = { claude: '  --no-session-persistence  Disable session persistence\n', codex: '      --ephemeral\n          Run without persisting session files\n' };
  const machine = (has) => {
    const calls = [];
    const ctx = { calls, run: (a, o) => {
      calls.push({ a, env: o?.env });
      if (a.includes('--help')) return { code: 0, stdout: has ? help[a[0]] : 'usage: nothing here\n', stderr: '' };
      if (a[1] === 'mcp') return { code: 0, stdout: '[]', stderr: '' };
      if (a.includes('-o')) writeFileSync(a[a.indexOf('-o') + 1], '{}');
      return { code: 0, stdout: JSON.stringify({ result: '{}' }), stderr: '' };
    } };
    return ctx;
  };
  for (const [agent, flag, probe] of [['claude', '--no-session-persistence', ['claude', '--help']], ['codex', '--ephemeral', ['codex', 'exec', '--help']]]) {
    const yes = machine(true);
    await adviseSetup(yes, { dir: '/p', agent, lib });
    assert.ok(yes.calls.at(-1).a.includes(flag), `${agent} with the flag`);
    assert.deepEqual(yes.calls.find((c) => c.a.includes('--help')).a, probe);
    // The probe is cached per context: a second session asks again for nothing.
    await adviseSetup(yes, { dir: '/p', agent, lib });
    assert.equal(yes.calls.filter((c) => c.a.includes('--help')).length, 1);
    const no = machine(false);
    await adviseSetup(no, { dir: '/p', agent, lib });
    assert.ok(!no.calls.at(-1).a.includes(flag), `${agent} without it`);
    assert.deepEqual(noTrace({ run: () => ({ code: 127, stdout: '', stderr: '' }) }, agent), []);
    // No headless prompt: every call before the session is the help or the server list.
    assert.ok(no.calls.slice(0, -1).every((c) => c.a.includes('--help') || c.a[1] === 'mcp'));
  }
});

test('an agent session gets its own login variables and nothing else that looks like a credential', async () => {
  const env = { PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'a', ANTHROPIC_BASE_URL: 'u', CLAUDE_CODE_OAUTH_TOKEN: 'o', OPENAI_API_KEY: 'p', CODEX_HOME: '/c', GEMINI_API_KEY: 'g', COPILOT_GITHUB_TOKEN: 'c',
    GH_TOKEN: 'x', GITHUB_TOKEN: 'x', NPM_TOKEN: 'x', SSH_AUTH_SOCK: '/s', AWS_SECRET_ACCESS_KEY: 'x', DATABASE_URL: 'x', GIT_DIR: '/g', npm_config__authToken: 'x', MY_SECRET: 'x' };
  assert.deepEqual(Object.keys(agentEnv(env)).sort(), ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_HOME', 'COPILOT_GITHUB_TOKEN', 'GEMINI_API_KEY', 'HOME', 'OPENAI_API_KEY', 'PATH']);
  assert.ok('GH_TOKEN' in agentEnv({ ...env, BENCHKEEPER_PASS_ENV: 'gh_token' }));
  // Both sessions pass it: advice through ctx.run, an eval case through the session runner.
  let seen;
  await adviseSetup({ run: (a, o) => { if (!a.includes('--help')) seen = o.env; return { code: 0, stdout: JSON.stringify({ result: '{}' }), stderr: '' }; } }, { dir: '/p', agent: 'claude', lib });
  assert.ok(seen && !('GH_TOKEN' in seen) && !('SSH_AUTH_SOCK' in seen));
});
