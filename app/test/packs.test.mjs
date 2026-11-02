import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { library } from '../src/content.mjs';
import { copied, exportPack, globalSkillPacks, importPack, invalidPacks, libraryWith, overlap, ownPacks, ownSkillFiles, packScopes, removePack, savePack, scopeFile, scopeText, scopeWrite, storedScopes, userSkillDir, userSkillRemove, userSkills, userSkillWrite, warnings } from '../src/packs.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { projectPlan, readState } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());

const ctxAt = () => { const h = mkdtempSync(join(TMP, 'bk-home-')); return context({ home: h }); };

test('own packs: save, export, import under a new id, remove', () => {
  const ctx = ctxAt();
  savePack(ctx, { id: 'ui', title: 'UI', skills: ['accessibility', 'designing-technical-uis'] });
  assert.deepEqual(libraryWith(ctx).packs.at(-1), { kind: 'benchkeeper-pack', schemaVersion: 1, id: 'ui', title: 'UI', skills: ['accessibility', 'designing-technical-uis'], own: true });
  const file = exportPack(ctx, 'ui');
  assert.equal(importPack(ctx, file, 'ui2').id, 'ui2');
  assert.equal(importPack(ctx, exportPack(ctx, 'frontend'), 'my-frontend').skills.length, 3);
  removePack(ctx, 'ui');
  assert.deepEqual(ownPacks(ctx).map((p) => p.id).sort(), ['my-frontend', 'ui2']);
});

test('a pack saved over an own pack of the same id leaves the old file in the backup', () => {
  const ctx = ctxAt();
  savePack(ctx, { id: 'ui', title: 'Old', skills: ['accessibility'] });
  savePack(ctx, { id: 'ui', title: 'New', skills: ['designing-technical-uis'] });
  assert.equal(ownPacks(ctx).find((p) => p.id === 'ui').title, 'New');
  const kept = readdirSync(join(ctx.config, 'backup', 'packs'));
  assert.equal(kept.length, 1);
  assert.match(kept[0], /^ui-\d+-[0-9a-f]{8}\.json$/);
  assert.equal(JSON.parse(readFileSync(join(ctx.config, 'backup', 'packs', kept[0]), 'utf8')).title, 'Old');
});

test('pack files name library skills only and keep their schema', () => {
  const ctx = ctxAt();
  const pack = (x) => JSON.stringify({ kind: 'benchkeeper-pack', schemaVersion: 1, id: 'p', skills: ['accessibility'], ...x });
  assert.throws(() => importPack(ctx, pack({ skills: ['evil'] })), /not in the library: evil/);
  assert.throws(() => importPack(ctx, pack({ id: 'frontend' })), /library pack/);
  assert.throws(() => importPack(ctx, pack({ id: '../x' })), /pack id/);
  assert.throws(() => importPack(ctx, pack({ schemaVersion: 2 })), /schemaVersion 2/);
  assert.throws(() => importPack(ctx, pack({ title: { a: 1 } })), /pack title/);
  assert.throws(() => importPack(ctx, pack({ title: 'x'.repeat(10_000) })), /pack title/);
  assert.throws(() => importPack(ctx, pack({ title: 'a\nb' })), /pack title/);
  assert.equal(importPack(ctx, pack({ title: '' }), 'q').title, 'q');
  removePack(ctx, 'q');
  assert.throws(() => importPack(ctx, '{"id":"p"}'), /not a BenchKeeper pack/);
  assert.throws(() => importPack(ctx, 'nope'), /pack file/);
  assert.throws(() => exportPack(ctx, 'matt-pocock'), /plugin/);
  assert.deepEqual(ownPacks(ctx), []);
});

test('pack files that are not packs are listed as invalid with the reason, and can be removed', () => {
  const ctx = ctxAt();
  assert.deepEqual(invalidPacks(ctx), []);
  savePack(ctx, { id: 'ok', title: 'Ok', skills: ['accessibility', 'accessibility'] });
  assert.deepEqual(ownPacks(ctx)[0].skills, ['accessibility']);
  const dir = join(ctx.config, 'packs');
  writeFileSync(join(dir, 'broken.json'), '{');
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'Bad' }));
  writeFileSync(join(dir, 'noid.json'), '{}');
  writeFileSync(join(dir, 'other.json'), JSON.stringify({ id: 'name' }));
  writeFileSync(join(dir, 'notes.txt'), '{');
  const byFile = Object.fromEntries(invalidPacks(ctx).map((x) => [x.file, x.reason]));
  assert.deepEqual(byFile, { 'bad.json': 'the id is not a plain id', 'broken.json': 'not valid JSON', 'noid.json': 'the id is not a plain id', 'other.json': 'the file name is not name.json' });
  assert.deepEqual(ownPacks(ctx).map((p) => p.id), ['ok']);
  removePack(ctx, 'broken');
  removePack(ctx, 'bad.json');
  assert.deepEqual(invalidPacks(ctx).map((x) => x.file).sort(), ['noid.json', 'other.json']);
  assert.throws(() => removePack(ctx, 'name'), /^Error: no own pack name$/);
  assert.throws(() => removePack(ctx, 'ok', { usedBy: ['/a', '/b'] }), /^Error: pack ok is in use by \/a, \/b: switch it off there first \(benchkeeper packs disable ok --project <dir>\)$/);
  assert.equal(readdirSync(join(ctx.config, 'backup', 'packs')).filter((f) => /^(broken|bad)-\d+\.json$/.test(f)).length, 2);
  assert.throws(() => exportPack(ctx, 'nope'), /^Error: unknown pack nope$/);
  assert.throws(() => savePack(ctx, { id: 'e', title: 'E', skills: [] }), /^Error: a pack needs skills$/);
  assert.throws(() => savePack(ctx, { id: 'e', title: 'E', skills: ['x', 'y'] }), /^Error: not in the library: x, y$/);
  assert.throws(() => savePack(ctx, { id: 'frontend', skills: ['accessibility'] }), /^Error: frontend is a library pack$/);
  assert.throws(() => savePack(ctx, { id: '-a', skills: ['accessibility'] }), /^Error: pack id: lowercase letters, digits and dashes$/);
  assert.throws(() => savePack(ctx, { id: 'a', title: ' ', skills: ['accessibility'] }), /^Error: pack title: one line of at most 80 characters$/);
  assert.throws(() => savePack(ctx, { id: 'a', title: 'a\rb', skills: ['accessibility'] }), /pack title/);
  assert.equal(savePack(ctx, { id: 'a'.repeat(64), title: 'x'.repeat(80), skills: ['accessibility'] }).title.length, 80);
  assert.throws(() => savePack(ctx, { id: 'a'.repeat(65), skills: ['accessibility'] }), /pack id/);
  assert.throws(() => importPack(ctx, 'null'), /^Error: not a BenchKeeper pack file$/);
  assert.throws(() => importPack(ctx, JSON.stringify({ kind: 'benchkeeper-pack' })), /^Error: pack schemaVersion undefined, this app reads 1$/);
  assert.throws(() => importPack(ctx, '{'), /^Error: pack file: /);
});

test('pack scopes: only stored scopes count, a damaged file reads as none, the write keeps other packs', () => {
  const ctx = ctxAt();
  assert.deepEqual(storedScopes(ctx), {});
  mkdirSync(ctx.config, { recursive: true });
  writeFileSync(scopeFile(ctx), '{');
  assert.deepEqual(storedScopes(ctx), {});
  writeFileSync(scopeFile(ctx), JSON.stringify({ scopes: { frontend: 'global', docs: 'projects', data: 'machine' } }));
  assert.deepEqual(storedScopes(ctx), { frontend: 'global', docs: 'projects' });
  assert.deepEqual(globalSkillPacks(ctx).map((p) => p.id), ['frontend']);
  writeFileSync(scopeFile(ctx), JSON.stringify({ scopes: { ponytail: 'global' } }));
  assert.deepEqual(globalSkillPacks(ctx), []);
  const w = scopeWrite(ctx, 'docs', 'global');
  assert.equal(w.kind, 'write');
  assert.equal(w.path, scopeFile(ctx));
  assert.deepEqual(JSON.parse(w.edit(readFileSync(scopeFile(ctx), 'utf8'))), { scopes: { ponytail: 'global', docs: 'global' }, schemaVersion: 1 });
  assert.equal(scopeText('global'), 'all projects');
  assert.equal(scopeText('projects'), 'selected projects');
});

test('overlap: shared words against the shorter text, stop words and short words left out', () => {
  assert.equal(overlap('browser tests', 'browser tests with playwright and more words'), true);
  assert.equal(overlap('browser tests code', 'browser other words here'), false);
  assert.equal(overlap('browser tests', 'browser other'), true);
  assert.equal(overlap('the repository and project', 'the repository and project'), false);
  assert.equal(overlap('go go', 'go go'), false);
  assert.equal(overlap('Browser', 'BROWSER'), true);
  assert.equal(overlap('', 'browser'), false);
  assert.equal(overlap(undefined, undefined), false);
});

test('warnings: overlapping descriptions, no limit on the count', () => {
  const lib = { skills: [
    { name: 'a', pickWhen: 'Browser tests with Playwright' }, { name: 'b', pickWhen: 'The repository has Playwright browser tests' },
    { name: 'c', pickWhen: 'Statistics' }, ...['d', 'e', 'f'].map((name) => ({ name, pickWhen: name })),
  ] };
  assert.deepEqual(warnings(['a', 'b', 'c'], lib), ['a and b have overlapping descriptions']);
  assert.deepEqual(warnings(['a', 'c', 'd', 'e', 'f', 'x'], lib), []);
});

test('the library: every skill has a pick-when text of its own, so a pack choice raises no overlap warning', () => {
  assert.deepEqual(warnings(library().skills.map((s) => s.name)), []);
});

test('a project turns a skill off and on, uses an own pack, and drops a pack it no longer has', () => {
  const ctx0 = ctxAt();
  const dir = mkdtempSync(join(TMP, 'bk-proj-'));
  execFileSync('git', ['init', '-q', dir]);
  const ctx = { ...ctx0, roots: [...ctx0.roots, dir] };
  savePack(ctx, { id: 'mine', skills: ['designing-technical-uis'] });
  const run = (answers) => {
    const p = projectPlan({ ctx, dir, answers, plugins: {} });
    return { ...p, run: apply(preview(p.changes), ctx, { scope: dir }) };
  };
  const skill = join(dir, '.claude/skills/designing-technical-uis/SKILL.md');
  const parked = join(dir, '.benchkeeper/disabled/.claude/skills/designing-technical-uis/SKILL.md');
  let r = run({ agents: ['claude'], env: 'host', packs: ['mine'] });
  assert.deepEqual(r.skills, { added: ['designing-technical-uis'], removed: [] });
  assert.ok(existsSync(skill));
  r = run({ disable: ['designing-technical-uis'] });
  assert.equal(r.run.status, 'done', JSON.stringify(r.run.entries));
  assert.deepEqual([existsSync(skill), existsSync(parked)], [false, true]);
  assert.deepEqual(readState(dir).disabled, ['designing-technical-uis']);
  writeFileSync(parked, 'kept local edit\n');
  run({ enable: ['designing-technical-uis'] });
  assert.deepEqual([existsSync(skill), existsSync(parked)], [true, false]);
  assert.deepEqual(readState(dir).disabled, []);
  // The edited copy is kept until the skill is reset to the library's.
  r = run({});
  assert.ok(!r.run.entries.some((e) => e.path === skill));
  assert.equal(readFileSync(skill, 'utf8'), 'kept local edit\n');
  r = run({ reset: ['designing-technical-uis'] });
  assert.ok(r.run.entries.some((e) => e.path === skill));
  const last = run({ packs: [] });
  assert.deepEqual(last.skills.removed, ['designing-technical-uis']);
  assert.equal(existsSync(skill), false);
  undo(last.run.id, ctx);
  assert.ok(existsSync(skill));
});

test('a pack file whose id only starts like a plain id is invalid', () => {
  const ctx = ctxAt();
  mkdirSync(join(ctx.config, 'packs'), { recursive: true });
  writeFileSync(join(ctx.config, 'packs', 'a_b.json'), JSON.stringify({ id: 'a_b' }));
  assert.deepEqual(invalidPacks(ctx), [{ file: 'a_b.json', reason: 'the id is not a plain id' }]);
});

test('overlap: the longer stop words count for nothing', () => {
  assert.equal(overlap('for with has adds uses its alpha', 'for with has adds uses its beta'), false);
});

test('copied: own and user skills; no skill is not copied', () => {
  assert.equal(copied(undefined), false);
  assert.equal(copied({ source: 'user' }), true);
  assert.equal(copied({ source: 'own' }), true);
  assert.equal(copied({ source: 'skills' }), false);
});

test('ownSkillFiles: the path globs go under the description line of SKILL.md only', () => {
  const src = mkdtempSync(join(TMP, 'bk-own-skill-'));
  writeFileSync(join(src, 'SKILL.md'), '---\nname: mine\ndescription: Checks notes.\n---\nbody\n');
  writeFileSync(join(src, 'notes.md'), 'description: not front matter\n');
  const byFile = (paths) => Object.fromEntries(ownSkillFiles(src, paths).map((f) => [f.file, f.text]));
  assert.deepEqual(byFile('src/**'), { 'SKILL.md': '---\nname: mine\ndescription: Checks notes.\npaths: src/**\n---\nbody\n', 'notes.md': 'description: not front matter\n' });
  assert.equal(byFile(undefined)['SKILL.md'], '---\nname: mine\ndescription: Checks notes.\n---\nbody\n');
  // A "description: " inside another key's value is not the description line.
  writeFileSync(join(src, 'SKILL.md'), '---\nname: mine\nnote: "old description: none"\ndescription: Checks notes.\n---\n');
  assert.equal(byFile('src/**')['SKILL.md'], '---\nname: mine\nnote: "old description: none"\ndescription: Checks notes.\npaths: src/**\n---\n');
});

test('user skills: front matter edge cases, the plan changes, and no skills folder', () => {
  const ctx = ctxAt();
  const text = (description) => `---\nname: mine\ndescription: ${description}\n---\n`;
  assert.deepEqual(userSkills(ctx), []);
  assert.ok(userSkillWrite(ctx, 'mine', '---\r\nname: mine\r\ndescription: d\r\n---\r\n', { isNew: true }));
  assert.ok(userSkillWrite(ctx, 'mine', text('d'.repeat(1024)), { isNew: true }));
  assert.throws(() => userSkillWrite(ctx, 'mine', `intro\n${text('d')}`, { isNew: true }), /name must be mine/);
  assert.throws(() => userSkillWrite(ctx, 'mine', text('42'), { isNew: true }), /a description of 1 to 1024/);
  assert.throws(() => userSkillWrite(ctx, 'mine', '---\nname: [\n---\n', { isNew: true }), (e) => /^SKILL.md front matter: /.test(e.message) && !/name must be/.test(e.message));
  const path = join(userSkillDir(ctx, 'mine'), 'SKILL.md');
  assert.deepEqual(userSkillWrite(ctx, 'mine', text('d'), { isNew: true }), { id: 'user-skill:mine', step: 'user-skill:mine', title: 'your skill mine: new SKILL.md', kind: 'write', path, after: text('d'), selected: true });
  mkdirSync(userSkillDir(ctx, 'mine'), { recursive: true });
  writeFileSync(path, text('"  Checks notes.  "'));
  assert.equal(userSkills(ctx)[0].pickWhen, 'Checks notes.');
  assert.equal(userSkillWrite(ctx, 'mine', text('d'), { isNew: false }).title, 'your skill mine: edited SKILL.md');
  assert.deepEqual(userSkillRemove(ctx, 'mine'), { id: 'user-skill:mine', step: 'user-skill:mine', title: 'remove your skill mine', kind: 'remove', path: userSkillDir(ctx, 'mine'), selected: true });
  assert.throws(() => userSkillRemove(ctx, 'mine', { usedBy: ['a', 'b'] }), /in use by a, b:/);
});

test('globalSkillPacks: skill packs with skills set to all projects, never plugin packs; packScopes says why only projects', () => {
  const ctx = { ...ctxAt(), packScopes: { g: 'global', p: 'global', e: 'global' } };
  const lib = { packs: [{ id: 's', skills: ['x'] }, { id: 'g', skills: ['y'] }, { id: 'p', plugins: { claude: {} }, skills: ['z'] }, { id: 'e' }] };
  assert.deepEqual(globalSkillPacks(ctx, lib).map((p) => p.id), ['g']);
  assert.match(packScopes({ skills: ['x'] }, 'gemini').fixed, /global folders of Claude Code and Codex only/);
});

test('removePack: the backup of an invalid file keeps its whole name before .json', () => {
  const ctx = ctxAt();
  mkdirSync(join(ctx.config, 'packs'), { recursive: true });
  writeFileSync(join(ctx.config, 'packs', 'x.json5.json'), '{');
  removePack(ctx, 'x.json5.json');
  assert.match(readdirSync(join(ctx.config, 'backup', 'packs'))[0], /^x\.json5-\d+\.json$/);
});

test('exportPack: a pack naming own skills is refused with every own skill named', () => {
  const ctx = ctxAt();
  for (const name of ['mine-a', 'mine-b']) {
    mkdirSync(userSkillDir(ctx, name), { recursive: true });
    writeFileSync(join(userSkillDir(ctx, name), 'SKILL.md'), `---\nname: ${name}\ndescription: Notes ${name}.\n---\n`);
  }
  savePack(ctx, { id: 'mine', title: 'Mine', skills: ['mine-a', 'mine-b'] });
  assert.throws(() => exportPack(ctx, 'mine'), /\(mine-a, mine-b\)/);
});
