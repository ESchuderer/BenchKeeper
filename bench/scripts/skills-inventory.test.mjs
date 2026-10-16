import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { available, inventory, table, usage } from './skills-inventory.mjs';

test('inventory: framework skills minus the plain arm, with phase, size and first sentence', () => {
  const fixtures = new URL('./fixtures/', import.meta.url).pathname;
  const files = { F: [{ dir: 'test-driven-development', name: 'test-driven-development', description: 'Drives tests first. More text.', bytes: 400 }] };
  const rows = inventory(files, fixtures);
  const tdd = rows.find((r) => r.framework === 'agent-skills' && r.skill === 'agent-skills:test-driven-development');
  assert.deepEqual(tdd, { framework: 'agent-skills', skill: 'agent-skills:test-driven-development', phase: 'test', tokens: 100, description: 'Drives tests first.' });
  assert.equal(rows.some((r) => r.skill === 'deep-research'), false, 'built-in skills of the plain arm are left out');
  assert.equal(rows.some((r) => r.framework.startsWith('BenchKeeper') && r.skill === 'agent-skills:test-driven-development'), false, 'the layer lists only what it adds');
});

test('usage counts each skill once per trial, with or without the plugin prefix', () => {
  const root = mkdtempSync(join(tmpdir(), 'usage-'));
  const trial = (arm, skills) => { mkdirSync(join(root, 'run', 'round-1', arm), { recursive: true }); writeFileSync(join(root, 'run', 'round-1', arm, 'trial.json'), JSON.stringify({ workflow: { skills } })); };
  writeFileSync(join(root, 'run.md'), '');
  writeFileSync(join(root, 'files.json'), '{}');
  mkdirSync(join(root, 'run'), { recursive: true });
  writeFileSync(join(root, 'run', 'manifest.txt'), 'brief=x model=y\n');
  trial('A', ['agent-skills:tdd', 'tdd']);
  trial('B', ['tdd', 'brainstorming']);
  const trials = usage(root);
  assert.deepEqual(trials.map((t) => [t.arm, [...t.skills]]), [['A', ['tdd']], ['B', ['tdd', 'brainstorming']]]);
  // Only arms that have the skill count: C has it and did not use it; D does not have it.
  const avail = { A: new Set(['tdd']), B: new Set(['tdd']), C: new Set(['tdd']), D: new Set() };
  assert.match(table([{ framework: 'x', skill: 'p:tdd', phase: 'test', tokens: 5, description: 'a|b' }], [...trials, { arm: 'C', skills: new Set() }, { arm: 'D', skills: new Set() }], avail),
    /\| x \| `p:tdd` \| test \| 5 \| 2 of 3 \| a\\\|b \|/);
  const real = available(new URL('./fixtures/', import.meta.url).pathname);
  assert.equal(real.F.has('test-driven-development'), true);
  assert.equal(real.T.has('test-driven-development'), true);
  assert.equal(real.A.has('test-driven-development'), false);
});
