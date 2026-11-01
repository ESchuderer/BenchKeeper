import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
test('the first sentence ends where the earlier /^(.*?\.)(?:\s+(.*))?$/ ended it', () => {
  const FIRST = /^(.*?\.)(?:\s+(.*))?$/;
  for (const d of ['Does a. Use when b.', 'Does a.b. Use when c.', 'Does a.  Use when b.', 'v1.2 does a. When b.', 'Does a. When b. And c.']) {
    const [, purpose, rest] = FIRST.exec(d);
    const e = skillEntry(skill(['name: a', `description: "${d}"`, 'writes: "c"']));
    assert.deepEqual([e.purpose, e.when], [purpose, rest], d);
  }
  // No second sentence: the earlier match had no rest, and without a when field the skill fails.
  for (const d of ['Does a.', 'Does a. ']) {
    assert.ok(!FIRST.exec(d)[2], d);
    assert.throws(() => skillEntry(skill(['name: a', `description: "${d}"`, 'writes: "c"'])), /when/, d);
  }
  assert.throws(() => skillEntry(skill(['name: a', 'description: "No period"', 'writes: "c"'])), /a sentence that ends with a period/);
});
test('a skill without writes or when fails', () => {
  assert.throws(() => skillEntry(skill(['name: a', 'description: "Does a. Use when b."'])), /writes/);
  assert.throws(() => skillEntry(skill(['name: a', 'description: "Does a."', 'writes: "c"'])), /when/);
});
// Also started through a symlinked folder (the macOS temporary folder is one): the check must still run.
test('--check fails on a page that differs from its sources', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'skills-doc-')));
  const dir = join(tmp, 'repo');
  try {
    for (const p of ['.github/scripts', 'plugins/benchkeeper/skills', 'plugins/benchkeeper/library/library.json', 'docs/skills.md']) cpSync(join(root, p), join(dir, p), { recursive: true });
    symlinkSync(dir, join(tmp, 'link'), 'dir');
    const page = join(dir, 'docs/skills.md');
    writeFileSync(page, readFileSync(page, 'utf8').replace('| Skill |', '| Skills |'));
    for (const via of [dir, join(tmp, 'link')]) {
      const script = join(via, '.github/scripts/skills-doc.mjs');
      assert.throws(() => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }), (e) => e.status === 1 && /differs/.test(e.stdout), via);
    }
    writeFileSync(page, readFileSync(join(root, 'docs/skills.md'), 'utf8'));
    execFileSync(process.execPath, [join(tmp, 'link/.github/scripts/skills-doc.mjs'), '--check']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
