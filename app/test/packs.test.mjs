import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { library } from '../src/content.mjs';
import { exportPack, importPack, libraryWith, ownPacks, removePack, savePack, warnings } from '../src/packs.mjs';
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
  assert.throws(() => importPack(ctx, '{"id":"p"}'), /not a BenchKeeper pack/);
  assert.throws(() => importPack(ctx, 'nope'), /pack file/);
  assert.throws(() => exportPack(ctx, 'matt-pocock'), /plugin/);
  assert.deepEqual(ownPacks(ctx), []);
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
  r = run({ enable: ['designing-technical-uis'] });
  assert.deepEqual([existsSync(skill), existsSync(parked)], [true, false]);
  assert.deepEqual(readState(dir).disabled, []);
  // The own copy is refreshed after it moves back.
  r = run({});
  assert.ok(r.run.entries.some((e) => e.path === skill));
  const last = run({ packs: [] });
  assert.deepEqual(last.skills.removed, ['designing-technical-uis']);
  assert.equal(existsSync(skill), false);
  undo(last.run.id, ctx);
  assert.ok(existsSync(skill));
});
