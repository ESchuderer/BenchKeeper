import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const skill = readFileSync(new URL('../../plugins/benchkeeper/skills/reviewing-rules/SKILL.md', import.meta.url), 'utf8');
const dir = new URL('fixtures/reviewing-rules/', import.meta.url);
const read = (name) => readFileSync(new URL(name, dir), 'utf8');
const expected = JSON.parse(read('expected.json'));
const recorded = JSON.parse(read('recorded.json'));
const prompt = /^```text\n([\s\S]*?)\n```$/m.exec(skill)[1];
const KINDS = ['contradiction', 'vague', 'enforceable', 'restates'];

// The question live.sh sends: the prompt, then the file with numbered lines (nl -ba -w1 -s': ').
const question = (text) => `${prompt}\n${text.replace(/\n$/, '').split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`;
const found = (answer) => JSON.parse(answer.slice(answer.indexOf('{'))).findings.map((f) => `${f.kind}:${[...f.lines].sort((a, b) => a - b)}`).sort();

test('reviewing-rules: the recorded answer to the skill prompt finds each kind in its fixture and nothing in the clean file', () => {
  for (const kind of KINDS) assert.match(prompt, new RegExp(`^- ${kind}: `, 'm'));
  assert.match(prompt, /\nFILE$/);
  const names = readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  assert.deepEqual(names, Object.keys(expected).sort());
  // The stubbed agent answers only a question that carries this prompt and the fixture's numbered lines.
  const agent = (q) => Object.keys(recorded).find((n) => q === question(read(n)));
  for (const name of names) {
    const answer = recorded[agent(question(read(name)))];
    assert.deepEqual(found(answer), expected[name].map((f) => `${f.kind}:${f.lines}`).sort(), name);
  }
  assert.deepEqual(found(recorded['clean.md']), []);
  assert.deepEqual(new Set(Object.values(expected).flat().map((f) => f.kind)), new Set(KINDS));
});

test('reviewing-rules: reads one file, cannot edit, and names where the text goes', () => {
  assert.match(skill, /^disallowed-tools: "Edit Write NotebookEdit"$/m);
  assert.match(skill, /reads that one file and changes no file/);
  assert.match(skill, /goes only to this agent session/);
});
