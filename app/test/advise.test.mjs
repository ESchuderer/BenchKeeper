import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { adviseSetup, parseAdvice } from '../src/advise.mjs';

const lib = { packs: [{ id: 'frontend', skills: ['a'] }], skills: [{ name: 'a' }, { name: 'b' }] };

test('Codex answers through its output file in a read-only sandbox', async () => {
  let argv;
  const ctx = { run: (a) => { argv = a; writeFileSync(a[a.indexOf('-o') + 1], '{"skills": [{"name": "b", "reason": "x"}]}'); return { code: 0, stdout: '', stderr: '' }; } };
  assert.deepEqual(await adviseSetup(ctx, { dir: '/p', agent: 'codex', lib }), { env: null, packs: [], skills: [{ name: 'b', reason: 'x' }] });
  assert.deepEqual(argv.slice(0, 4), ['codex', 'exec', '--sandbox', 'read-only']);
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
