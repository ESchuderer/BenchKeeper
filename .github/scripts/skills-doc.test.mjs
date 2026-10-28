import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { skillEntry, sources, update } from './skills-doc.mjs';

const root = new URL('../../', import.meta.url).pathname;
const skill = (fields) => `---\n${fields.join('\n')}\n---\n\n# x\n`;

test('docs/skills.md matches its sources', () => {
  const page = readFileSync(join(root, 'docs/skills.md'), 'utf8');
  assert.equal(update(page, ...sources()), page);
});
test('every plugin skill and every pack plugin skill has its row', () => {
  const [skills, manifest] = sources();
  const page = readFileSync(join(root, 'docs/skills.md'), 'utf8');
  for (const s of skills) assert.match(page, new RegExp(`^\\| \\[${s.name}\\]`, 'm'));
  for (const s of manifest.packs.flatMap((p) => p.pluginSkills?.skills ?? [])) assert.match(page, new RegExp(`^\\| \`${s.name}\` \\|`, 'm'));
});
test('the when column comes from the field, else from the description after its first sentence', () => {
  const agent = skillEntry(skill(['name: a', 'description: "Does a. Use when b."', 'writes: "c"']));
  assert.deepEqual([agent.purpose, agent.when, agent.writes], ['Does a.', 'Use when b.', 'c']);
  assert.match(agent.start, /^the agent/);
  const user = skillEntry(skill(['name: u', 'description: "Does u."', 'disable-model-invocation: true', 'when: "On request."', 'writes: "x"']));
  assert.equal(user.when, 'On request.');
  assert.match(user.start, /^you: `\/benchkeeper:u`/);
});
test('a skill without writes or when fails', () => {
  assert.throws(() => skillEntry(skill(['name: a', 'description: "Does a. Use when b."'])), /writes/);
  assert.throws(() => skillEntry(skill(['name: a', 'description: "Does a."', 'writes: "c"'])), /when/);
});
test('--check fails on a page that differs from its sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'skills-doc-'));
  try {
    for (const p of ['.github/scripts', 'plugins/benchkeeper/skills', 'plugins/benchkeeper/library/library.json', 'docs/skills.md']) cpSync(join(root, p), join(dir, p), { recursive: true });
    const script = join(dir, '.github/scripts/skills-doc.mjs');
    execFileSync(process.execPath, [script, '--check']);
    const page = join(dir, 'docs/skills.md');
    writeFileSync(page, readFileSync(page, 'utf8').replace('| Skill |', '| Skills |'));
    assert.throws(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }), (e) => e.status === 1 && /differs/.test(e.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
