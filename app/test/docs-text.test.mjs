// Documentation and skill text that names commands, tests and keys of this app, checked against the code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('the operating skill names every command whose effect undo does not reverse, and asks before each', () => {
  const skill = read('../../plugins/benchkeeper/skills/operating-benchkeeper/SKILL.md');
  const sentence = skill.slice(skill.indexOf('not undone by it'), skill.indexOf('before asking for approval'));
  const ask = skill.split('\n').find((l) => l.startsWith('3. Ask before'));
  for (const cmd of ['packs remove', 'accounts remove', 'presets remove', 'knowledge clear', 'sessions cache clear', 'automations remove', 'webhook remove', 'bot remove', 'containers reconcile', 'packs save', 'packs import', 'profile import']) {
    assert.ok(sentence.includes(`\`${cmd}`), `not-undone list misses ${cmd}`);
    assert.ok(ask.includes(`\`${cmd}`), `ask list misses ${cmd}`);
  }
});

test('every test the security model cites exists in that file under that title', () => {
  // A cited title is the test's title or a part of it; "..." stands for the words left out.
  const doc = read('../../docs/security.md');
  const dirs = ['./', '../../.github/scripts/', '../../plugins/benchkeeper/hooks/tier/'];
  const missing = [];
  for (const m of doc.matchAll(/`([\w.-]+\.test\.(?:mjs|tsx))`((?:\s*(?:,|and|or)?\s*"[^"\n]+")+)/g)) {
    const source = dirs.map((d) => { try { return read(d + m[1]); } catch { return null; } }).find(Boolean);
    if (!source) { missing.push(`${m[1]}: no such test file`); continue; }
    const titles = [...source.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((t) => t[2].replace(/\\(.)/g, '$1').replaceAll('"', ''));
    for (const [, cited] of m[2].matchAll(/"([^"\n]+)"/g)) {
      const parts = cited.split(/\s*(?:\.\.\.|…)\s*/).filter(Boolean);
      const found = titles.some((t) => { let at = 0; return parts.every((p) => { const i = t.indexOf(p, at); at = i + p.length; return i >= 0; }); });
      if (!found) missing.push(`${m[1]} "${cited}"`);
    }
  }
  assert.deepEqual(missing, []);
});

test('the setup guide, the app README and the operating skill describe own skills as the CLI has them', () => {
  const setup = read('../../docs/setup.md'), readme = read('../README.md');
  const skill = read('../../plugins/benchkeeper/skills/operating-benchkeeper/SKILL.md');
  assert.doesNotMatch(setup, /a unit of your own needs a change to BenchKeeper/);
  assert.match(setup, /`skills new/);
  const rows = readme.split('\n').filter((l) => l.startsWith('| `skills show'));
  assert.equal(rows.length, 2);
  for (const row of rows) assert.match(row, /your own|yours/, row);
  assert.doesNotMatch(skill, /a library skill's text/);
  assert.match(skill, /`skills new\\\|edit\\\|delete/);
});
