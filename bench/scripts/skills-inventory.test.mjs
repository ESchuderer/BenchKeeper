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

test('usage keeps names as recorded; counts use full names on Claude Code and the framework\'s own arms', () => {
  const root = mkdtempSync(join(tmpdir(), 'usage-'));
  const trial = (arm, skills) => { mkdirSync(join(root, 'run', 'round-1', arm), { recursive: true }); writeFileSync(join(root, 'run', 'round-1', arm, 'trial.json'), JSON.stringify({ workflow: { skills } })); };
  writeFileSync(join(root, 'run.md'), '');
  writeFileSync(join(root, 'files.json'), '{}');
  mkdirSync(join(root, 'run'), { recursive: true });
  writeFileSync(join(root, 'run', 'manifest.txt'), 'brief=x model=y\n');
  trial('A', ['agent-skills:tdd', 'tdd']);
  trial('B', ['tdd', 'brainstorming']);
  const trials = usage(root);
  assert.deepEqual(trials.map((t) => [t.arm, [...t.skills]]), [['A', ['agent-skills:tdd', 'tdd']], ['B', ['tdd', 'brainstorming']]]);
  // Claude Code arms by full name, the framework's own arms only: F and I are agent-skills arms, G is Superpowers.
  const avail = { F: new Set(['agent-skills:tdd']), I: new Set(['agent-skills:tdd']), G: new Set(['superpowers:tdd']), T: new Set(['tdd']), R: new Set(['tdd']) };
  const ts = [{ arm: 'F', skills: new Set(['agent-skills:tdd']) }, { arm: 'I', skills: new Set() }, { arm: 'G', skills: new Set(['superpowers:tdd']) },
    { arm: 'T', skills: new Set(['tdd']) }, { arm: 'R', skills: new Set(['tdd']) }];
  // agent-skills: F fired, I did not, T (OpenCode, short name) fired; G and R are Superpowers arms and do not count.
  assert.match(table([{ framework: 'agent-skills', skill: 'agent-skills:tdd', phase: 'test', tokens: 5, description: 'a|b' }], ts, avail),
    /\| agent-skills \| `agent-skills:tdd` \| test \| 5 \| 2 of 3 \| a\\\|b \|/);
  const real = available(new URL('./fixtures/', import.meta.url).pathname);
  assert.equal(real.F.has('agent-skills:test-driven-development'), true);
  assert.equal(real.T.has('test-driven-development'), true);
  assert.equal(real.A.has('test-driven-development'), false);
});
