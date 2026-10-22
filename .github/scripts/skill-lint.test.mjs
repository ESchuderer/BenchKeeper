import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { lintSkill, ownSkills } from './skill-lint.mjs';

function skill(name, { fm = `name: ${name}\ndescription: "Does a thing. Use when asked."`, body = '', yaml = 'interface:\n  display_name: "X"\n' } = {}) {
  const dir = join(mkdtempSync(join(tmpdir(), 'lint-')), name);
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\n${fm}\n---\n\n${body}\n`);
  if (yaml !== null) writeFileSync(join(dir, 'agents/openai.yaml'), yaml);
  return dir;
}

test('a valid skill passes', () => {
  const dir = skill('good-one', { body: '[ref](ref.md#x)' });
  writeFileSync(join(dir, 'ref.md'), 'x');
  assert.deepEqual(lintSkill(dir), []);
});
test('a missing link target fails', () => assert.match(lintSkill(skill('a', { body: 'see [ref](missing.md)' })).join(), /missing\.md not found/));
test('links inside code fences and URLs are ignored', () => assert.deepEqual(lintSkill(skill('a', { body: '```\n[x](nope.md)\n```\n[y](https://example.com) [z](#top)' })), []));
test('name must equal the folder', () => assert.match(lintSkill(skill('a', { fm: 'name: b\ndescription: "x"' })).join(), /differs from the folder/));
test('name charset', () => assert.match(lintSkill(skill('A_b', { fm: 'name: A_b\ndescription: "x"' })).join(), /lowercase/));
test('unquoted description fails', () => assert.match(lintSkill(skill('a', { fm: 'name: a\ndescription: x: y' })).join(), /double quotes/));
test('long description fails', () => assert.match(lintSkill(skill('a', { fm: `name: a\ndescription: "${'x'.repeat(1025)}"` })).join(), /1024/));
test('more than 500 lines fails', () => assert.match(lintSkill(skill('a', { body: 'x\n'.repeat(500) })).join(), /500 lines/));
test('missing openai.yaml fails', () => assert.match(lintSkill(skill('a', { yaml: null })).join(), /openai\.yaml missing/));
test('user-invoked skill needs implicit invocation off', () => {
  const fm = 'name: a\ndescription: "x"\ndisable-model-invocation: true';
  assert.match(lintSkill(skill('a', { fm })).join(), /allow_implicit_invocation/);
  assert.deepEqual(lintSkill(skill('a', { fm, yaml: 'policy:\n  allow_implicit_invocation: false\n' })), []);
});
test('broken front matter fails', () => assert.match(lintSkill(skill('a', { fm: 'just text' })).join(), /front matter/));
test('own skills pass', () => assert.deepEqual(ownSkills().flatMap(lintSkill), []));
