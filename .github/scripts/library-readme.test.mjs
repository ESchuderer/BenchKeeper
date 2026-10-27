import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { render, update } from './library-readme.mjs';

const lib = new URL('../../plugins/benchkeeper/library/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('library.json', lib), 'utf8'));

test('README matches library.json', () => {
  const readme = readFileSync(new URL('README.md', lib), 'utf8');
  assert.equal(update(readme, manifest), readme);
});
test('entries are complete', () => {
  const sections = new Set(manifest.sections.map((s) => s.id));
  for (const s of manifest.skills) {
    assert.ok(sections.has(s.section), `${s.name}: section ${s.section}`);
    assert.ok(['both', 'codex'].includes(s.agents), `${s.name}: agents`);
    if (s.source === 'own') assert.ok(existsSync(new URL(`${s.name}/SKILL.md`, lib)), `${s.name}: folder`);
    else assert.equal(s.ref, undefined, `${s.name}: community skills follow the default branch`);
  }
  assert.equal(new Set(manifest.skills.map((s) => s.name)).size, manifest.skills.length, 'skill names unique');
});
test('packs name only catalog skills', () => {
  const names = new Set(manifest.skills.map((s) => s.name));
  for (const p of manifest.packs) for (const n of p.skills ?? []) assert.ok(names.has(n), `${p.id}: ${n}`);
});
test('skills sharing a row are grouped', () => {
  const md = render({ sections: [{ id: 'x', title: 'X' }], packs: [], skills: [
    { name: 'a', section: 'x', source: 'o/r', agents: 'both', pickWhen: 'p' },
    { name: 'b', section: 'x', source: 'o/r', agents: 'both', pickWhen: 'p' },
    { name: 'c', section: 'x', source: 'o/r', agents: 'codex', pickWhen: 'p' },
  ] });
  assert.match(md, /\| `a`, `b` \| `o\/r` \| both \| p \|/);
  assert.match(md, /\| `c` \| `o\/r` \| Codex only \| p \|/);
});
test('pack prompts name both agents', () => {
  const md = render({ sections: [], skills: [], packs: [{ id: 'p', pickWhen: 'w', prompts: [{ claude: '/a:b', codex: '$a:b' }] }] });
  assert.match(md, /\| `p` \| then `\/a:b` \(Codex `\$a:b`\) \| w \|/);
});
