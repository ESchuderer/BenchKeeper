import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { adviseSetup, parseAdvice } from '../src/advise.mjs';

const lib = { packs: [{ id: 'frontend', skills: ['a'] }], skills: [{ name: 'a' }, { name: 'b' }] };

test('Codex answers through its output file; it reads only the project, without web search or MCP servers', async () => {
  let argv, servers = [{ name: 'playwright' }];
  const ctx = { run: (a) => {
    if (a[1] === 'mcp') return { code: 0, stdout: JSON.stringify(servers), stderr: '' };
    argv = a;
    writeFileSync(a[a.indexOf('-o') + 1], '{"skills": [{"name": "b", "reason": "x"}]}');
    return { code: 0, stdout: '', stderr: '' };
  } };
  assert.deepEqual(await adviseSetup(ctx, { dir: '/p', agent: 'codex', lib }), { env: null, packs: [], skills: [{ name: 'b', reason: 'x' }] });
  const config = argv.flatMap((a, i) => (argv[i - 1] === '-c' ? [a] : []));
  assert.deepEqual(config.filter((c) => !c.startsWith('permissions.')), ['default_permissions="benchkeeper"', 'web_search="disabled"', 'mcp_servers.playwright.enabled=false']);
  assert.match(config.find((c) => c.startsWith('permissions.')), /^permissions\.benchkeeper\.filesystem=\{":minimal"="read", ":workspace_roots"="read"/);
  assert.ok(!argv.includes('--sandbox'));
  servers = [{ name: 'a.b' }];
  await assert.rejects(adviseSetup(ctx, { dir: '/p', agent: 'codex', lib }), /cannot be turned off/);
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
