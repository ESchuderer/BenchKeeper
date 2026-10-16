import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FRAMEWORKS, variant } from './arm-rules.mjs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const rules = read('bench/arms/bk-rules.md');
const agentSkills = JSON.parse(read('bench/arms/agent-skills-names.json'));
// Skills and agents each arm's image lists (recorded init events), plus names that are not skills.
const listed = (arm) => {
  const init = read(`bench/scripts/fixtures/init-${arm}.jsonl`).trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.subtype === 'init');
  return new Set([...init.skills, ...init.agents].map((n) => n.replace(/^[a-z-]+:/, '')));
};
const ARM = { superpowers: 'D', ecc: 'E', mattpocock: 'Y' };
const NOT_SKILLS = new Set(['full']);

for (const fw of FRAMEWORKS) {
  const out = variant(rules, read(`bench/arms/${fw}.md`));
  test(`${fw}: no agent-skills name or mention is left (names the framework has too are fine)`, () => {
    const have = listed(ARM[fw]);
    assert.deepEqual(agentSkills.filter((n) => out.includes(`\`${n}\``) && !have.has(n)), []);
    assert.ok(!out.includes('agent-skills'));
  });
  test(`${fw}: every named skill or agent exists in arm ${ARM[fw]}`, () => {
    const names = new Set([...out.matchAll(/`([a-z][a-z0-9-]+)`/g)].map((m) => m[1]).filter((n) => !NOT_SKILLS.has(n) && !rules.includes(`\`${n}\``) || /^(superpowers|ecc)$/.test(n)));
    const have = listed(ARM[fw]);
    assert.deepEqual([...names].filter((n) => !have.has(n)), []);
  });
  test(`${fw}: other sections unchanged`, () => {
    for (const h of ['Ask, do not assume', 'Scope', 'Safety', 'Context economy']) {
      const section = rules.split(/^(?=## )/m).find((s) => s.startsWith(`## ${h}\n`));
      assert.ok(out.includes(section.trimEnd()), h);
    }
  });
}

test('fails when a replaced section or line is missing', () => {
  assert.throws(() => variant('## Scope\n- x\n', '<!-- section: SDLC -->\n## SDLC\n- y\n'), /sections not found/);
  assert.throws(() => variant('## Scope\n- x\n', '<!-- replace: nope ==> y -->'), /text not found/);
});

// Layer v3 (arm AD): pinned copies of the current rules and the workflow skill for Matt Pocock's skills.
test('bk-v3: no agent-skills or OpenSpec name, every named skill exists in arm AD', () => {
  const text = read('bench/arms/bk-v3/global.md') + read('bench/arms/bk-v3/skills/following-dev-workflow/SKILL.md');
  const have = listed('AD');
  assert.deepEqual(agentSkills.filter((n) => text.includes(`\`${n}\``) && !have.has(n)), []);
  assert.ok(!/agent-skills|openspec/i.test(text));
  const skills = ['tdd', 'code-review', 'diagnosing-bugs', 'grilling', 'domain-modeling', 'codebase-design', 'pr', 'prototype', 'research', 'following-dev-workflow'];
  assert.deepEqual(skills.filter((n) => text.includes(`\`${n}\``) && !have.has(n)), []);
});
