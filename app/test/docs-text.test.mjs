// Documentation and skill text that names commands, tests and keys of this app, checked against the code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the operating skill names every command whose effect undo does not reverse, and asks before each', () => {
  const skill = read('../../plugins/benchkeeper/skills/operating-benchkeeper/SKILL.md');
  const sentence = skill.slice(skill.indexOf('not undone by it'), skill.indexOf('before asking for approval'));
  const ask = skill.split('\n').find((l) => l.startsWith('3. Ask before'));
  for (const cmd of ['packs remove', 'accounts remove', 'presets remove', 'knowledge clear', 'sessions cache clear', 'automations remove', 'webhook remove', 'containers reconcile']) {
    assert.ok(sentence.includes(`\`${cmd}`), `not-undone list misses ${cmd}`);
    assert.ok(ask.includes(`\`${cmd}`), `ask list misses ${cmd}`);
  }
});
