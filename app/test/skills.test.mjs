import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { focusOn, skillAction, skillFiles } from '../src/skills.mjs';

const lib = { skills: [{ name: 'lib-a' }, { name: 'lib-b' }] };
const rows = {
  skills: [
    { name: 'one', state: 'outdated', single: true, packs: [] },
    { name: 'two', state: 'current', single: false, packs: ['p1', 'p2'] },
    { name: 'three', state: 'outdated', single: false, packs: [] },
    { name: 'off', state: 'disabled', single: true, packs: [] },
  ],
  untracked: [{ name: 'lib-b', library: true }, { name: 'mine', library: false }],
};
const none = { enable: [], disable: [], update: [], reset: [], drop: [], pick: [] };

test('skillAction: each action answers its own list only', () => {
  assert.deepEqual(skillAction(rows, 'enable', ['off'], lib), { names: ['off'], answers: { ...none, enable: ['off'] } });
  assert.deepEqual(skillAction(rows, 'disable', ['two'], lib).answers, { ...none, disable: ['two'] });
  assert.deepEqual(skillAction(rows, 'update', ['two'], lib).answers, { ...none, update: ['two'] });
  assert.deepEqual(skillAction(rows, 'reset', ['one'], lib).answers, { ...none, reset: ['one'] });
  assert.deepEqual(skillAction(rows, 'remove', ['one'], lib).answers, { ...none, drop: ['one'] });
  assert.deepEqual(skillAction(rows, 'adopt', ['lib-b'], lib).answers, { ...none, pick: ['lib-b'] });
  assert.deepEqual(skillAction(rows, 'add', ['lib-a'], lib).answers, { ...none, pick: ['lib-a'] });
  assert.deepEqual(skillAction(rows, 'update', [], lib), { names: ['one', 'three'], answers: { update: ['one', 'three'] } });
});

test('skillAction: what each action refuses, with the command that helps', () => {
  assert.throws(() => skillAction(rows, 'adopt', ['mine'], lib), /^Error: mine is not an untracked library skill of this project$/);
  assert.throws(() => skillAction(rows, 'adopt', ['lib-a'], lib), /not an untracked library skill/);
  assert.throws(() => skillAction(rows, 'add', ['off'], lib), /^Error: off is already in this project: benchkeeper skills enable off$/);
  assert.throws(() => skillAction(rows, 'add', ['one'], lib), /^Error: one is already in this project$/);
  assert.throws(() => skillAction(rows, 'add', ['mine'], lib), /^Error: mine is already in this project$/);
  assert.throws(() => skillAction(rows, 'add', ['nope'], lib), /^Error: nope is not a library skill$/);
  assert.throws(() => skillAction(rows, 'enable', ['nope'], lib), /^Error: nope is not a skill of this project$/);
  assert.throws(() => skillAction(rows, 'remove', ['two'], lib), /^Error: two comes from the pack p1, p2: switch the pack off \(benchkeeper packs disable p1\) or turn the skill off \(benchkeeper skills disable two\)$/);
  assert.throws(() => skillAction(rows, 'remove', ['three'], lib), /^Error: three comes from the setup: switch the pack off \(benchkeeper packs disable <pack>\) or turn the skill off \(benchkeeper skills disable three\)$/);
});

test('focusOn: the named skills plus the shared files, nothing of other skills', () => {
  const steps = ['skill:a', 'on:a', 'off:a', 'remove:a', 'skill:b', 'state', 'exclude', 'agents-md', 'local-claude', 'local-codex', 'global', 'xskill:a', 'skill:a:x'];
  assert.deepEqual(focusOn(steps.map((step) => ({ step })), ['a']).map((c) => c.step), ['skill:a', 'on:a', 'off:a', 'remove:a', 'state', 'exclude', 'agents-md', 'local-claude', 'local-codex']);
});

test('skillFiles: SKILL.md of every agent folder, folders without one left out', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-skills-'));
  for (const [folder, name, text] of [['.claude/skills', 'a', 'A'], ['.agents/skills', 'a', 'A2'], ['.github/skills', 'b', 'B'], ['.gemini/skills', 'c', 'C'], ['.other/skills', 'd', 'D']]) {
    mkdirSync(join(dir, folder, name), { recursive: true });
    writeFileSync(join(dir, folder, name, 'SKILL.md'), text);
  }
  mkdirSync(join(dir, '.claude/skills/empty'));
  assert.deepEqual(skillFiles(dir).map((f) => [f.name, f.file.slice(dir.length + 1), f.text]), [
    ['a', '.claude/skills/a/SKILL.md', 'A'], ['a', '.agents/skills/a/SKILL.md', 'A2'], ['b', '.github/skills/b/SKILL.md', 'B'], ['c', '.gemini/skills/c/SKILL.md', 'C'],
  ]);
});
