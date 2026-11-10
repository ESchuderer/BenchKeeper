import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { library } from '../src/content.mjs';
import { exportPack, globalSkillPacks, importPack, invalidPacks, libraryWith, overlap, ownPacks, removePack, savePack, scopeFile, scopeText, scopeWrite, storedScopes, warnings } from '../src/packs.mjs';
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
