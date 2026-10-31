import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => readFileSync(new URL(`../../plugins/benchkeeper/skills/workflow/${name}`, import.meta.url), 'utf8');
const skill = read('SKILL.md');
const software = read('software.md');

test('workflow: a quick-tier software change needs only SKILL.md', () => {
  // Picking the tier needs every change type, so the whole table and Verify live in SKILL.md, and only there.
  for (const row of ['| Docs, typo | quick |', '| Bug | standard |', '| Feature, performance | full |', '| CI fix | quick |']) assert.ok(skill.includes(row), row);
  assert.match(skill, /^## Change types$/m);
  assert.match(skill, /^## Verify$/m);
  assert.doesNotMatch(software, /^## (Change types|Verify)$/m);
  // Every line that links the tier playbooks is about standard or full work.
  const linking = skill.split('\n').filter((l) => /\]\((software|full-tier)\.md/.test(l));
  assert.ok(linking.length > 0);
  for (const line of linking) assert.match(line, /Standard and full tier|^ *\| full \|/, line);
  // A risky change keeps the review before pushing in software.md, whatever tier the user picked.
  assert.match(skill, /Standard and full tier, and any risky change: also \[software\.md\]/);
});
