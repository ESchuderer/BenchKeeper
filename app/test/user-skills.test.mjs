import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { main } from '../src/cli.mjs';
import { harnessTest } from '../src/harness.mjs';
import { exportPack, libraryWith, savePack, scopeWrite, userSkillDir, userSkillRemove, userSkills, userSkillWrite, warnings } from '../src/packs.mjs';
import { addProject, skillUsers } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { projectPlan, readState } from '../src/steps/project.mjs';
import { projectSkills } from '../src/skills.mjs';

const TMP = realpathSync(tmpdir());
const ctxAt = () => context({ home: mkdtempSync(join(TMP, 'bk-user-skills-')) });
const skillText = (name, description = 'Checks release notes. Use when a release is cut.', body = '') => `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n${body}`;
const add = (ctx, name, text = skillText(name)) => apply(preview([userSkillWrite(ctx, name, text, { isNew: true })]), ctx, { scope: 'global' });

test('user skill names and front matter follow the Agent Skills rules; library names and missing skills are refused', () => {
  const ctx = ctxAt();
  for (const bad of ['a--b', 'a-', '-a', 'A', 'a_b', 'x'.repeat(65), '', '../x']) assert.throws(() => userSkillWrite(ctx, bad, skillText(bad), { isNew: true }), /skill name: 1 to 64/, bad);
  assert.ok(userSkillWrite(ctx, 'x'.repeat(64), skillText('x'.repeat(64)), { isNew: true }));
  assert.throws(() => userSkillWrite(ctx, 'mine', skillText('other'), { isNew: true }), /name must be mine/);
  assert.throws(() => userSkillWrite(ctx, 'mine', 'no front matter', { isNew: true }), /name must be mine/);
  assert.throws(() => userSkillWrite(ctx, 'mine', '---\nname: [\n---\n', { isNew: true }), /SKILL.md front matter: /);
  assert.throws(() => userSkillWrite(ctx, 'mine', skillText('mine', ' '), { isNew: true }), /description of 1 to 1024/);
  assert.throws(() => userSkillWrite(ctx, 'mine', skillText('mine', 'd'.repeat(1025)), { isNew: true }), /description of 1 to 1024/);
  assert.throws(() => userSkillWrite(ctx, 'accessibility', skillText('accessibility'), { isNew: true }), /accessibility is a library skill/);
  assert.throws(() => userSkillWrite(ctx, 'mine', skillText('mine'), { isNew: false }), /you have no skill mine/);
  assert.throws(() => userSkillRemove(ctx, 'mine'), /you have no skill mine/);
  assert.throws(() => userSkillRemove(ctx, '../packs'), /you have no skill/);
  add(ctx, 'mine');
  assert.throws(() => userSkillWrite(ctx, 'mine', skillText('mine'), { isNew: true }), /you have a skill mine/);
});

test('add, edit and remove are plans with a diff, each undone in History; the library lists the skill as the user\'s', () => {
  const ctx = ctxAt();
  const file = join(userSkillDir(ctx, 'release-notes'), 'SKILL.md');
  const created = add(ctx, 'release-notes');
  assert.equal(created.status, 'done');
  assert.deepEqual(libraryWith(ctx).skills.at(-1), { name: 'release-notes', source: 'user', agents: 'both', pickWhen: 'Checks release notes. Use when a release is cut.' });
  const edit = preview([userSkillWrite(ctx, 'release-notes', skillText('release-notes', 'Edited.'), { isNew: false })]);
  assert.match(edit[0].diff, /\+description: "Edited\."/);
  const edited = apply(edit, ctx, { scope: 'global' });
  assert.match(readFileSync(file, 'utf8'), /Edited\./);
  undo(edited.id, ctx);
  assert.match(readFileSync(file, 'utf8'), /Checks release notes/);
  writeFileSync(join(userSkillDir(ctx, 'release-notes'), 'notes.md'), 'more\n');
  const removed = apply(preview([userSkillRemove(ctx, 'release-notes')]), ctx, { scope: 'global' });
  assert.equal(removed.status, 'done');
  assert.equal(existsSync(userSkillDir(ctx, 'release-notes')), false);
  assert.deepEqual(userSkills(ctx), []);
  undo(removed.id, ctx);
  assert.equal(readFileSync(join(userSkillDir(ctx, 'release-notes'), 'notes.md'), 'utf8'), 'more\n');
  undo(created.id, ctx);
  assert.equal(existsSync(file), false);
});

test('the store leaves out folders that break the rules or have a library skill\'s name', () => {
  const ctx = ctxAt();
  const put = (name, text) => { mkdirSync(userSkillDir(ctx, name), { recursive: true }); if (text) writeFileSync(join(userSkillDir(ctx, name), 'SKILL.md'), text); };
  put('Bad', skillText('Bad'));
  put('no-file');
  put('other-name', skillText('else'));
  put('accessibility', skillText('accessibility'));
  put('good', skillText('good'));
  assert.deepEqual(userSkills(ctx).map((s) => s.name), ['good']);
  assert.equal(libraryWith(ctx).skills.filter((s) => s.name === 'accessibility').length, 1);
});

test('an own pack names user skills: saved, warned about, not exported; a remove is refused while a project or pack names the skill', () => {
  const ctx = ctxAt();
  add(ctx, 'release-notes');
  add(ctx, 'release-check', skillText('release-check', 'Checks release notes. Use when a release is cut today.'));
  savePack(ctx, { id: 'mine', skills: ['release-notes', 'accessibility'] });
  assert.deepEqual(warnings(['release-notes', 'release-check'], libraryWith(ctx)), ['release-check and release-notes have overlapping descriptions']);
  assert.throws(() => exportPack(ctx, 'mine'), /^Error: mine names your own skills \(release-notes\): a pack file carries library skills only, so this pack stays on this machine$/);
  assert.deepEqual(skillUsers(ctx, 'release-notes'), ['pack mine']);
  assert.throws(() => userSkillRemove(ctx, 'release-notes', { usedBy: skillUsers(ctx, 'release-notes') }), /skill release-notes is in use by pack mine: take it out there first/);
});

test('a project gets a copy of a user skill; an edit there is held until reset, the next plan offers the store\'s new text', () => {
  const ctx0 = ctxAt();
  const dir = mkdtempSync(join(TMP, 'bk-user-skill-proj-'));
  execFileSync('git', ['init', '-q', dir]);
  const ctx = { ...ctx0, roots: [...ctx0.roots, dir] };
  add(ctx, 'release-notes');
  writeFileSync(join(userSkillDir(ctx, 'release-notes'), 'checklist.md'), '- notes\n');
  const run = (answers) => apply(preview(projectPlan({ ctx, dir, answers, plugins: {} }).changes), ctx, { scope: dir });
  const copy = join(dir, '.claude/skills/release-notes/SKILL.md');
  let r = run({ agents: ['claude', 'codex'], env: 'host', skills: ['release-notes'] });
  assert.equal(r.status, 'done', JSON.stringify(r.entries));
  assert.equal(readFileSync(copy, 'utf8'), skillText('release-notes'));
  assert.equal(readFileSync(join(dir, '.agents/skills/release-notes/checklist.md'), 'utf8'), '- notes\n');
  assert.ok(r.entries.some((e) => e.title === 'skill release-notes (yours) in .claude/skills'));
  assert.deepEqual(readState(dir).skills.find((s) => s.name === 'release-notes'), { name: 'release-notes', source: 'user' });
  assert.deepEqual(r.units.find((u) => u.id === 'skill:release-notes').source, { type: 'user' });
  assert.deepEqual(harnessTest(ctx, { agents: [], dir }).at(-1).problems, []);
  assert.deepEqual(projectSkills(ctx, dir).skills.find((s) => s.name === 'release-notes'), { name: 'release-notes', source: 'user', own: true, state: 'current', pinned: null, newest: null, packs: [], single: true });
  addProject(ctx, dir);
  assert.deepEqual(skillUsers(ctx, 'release-notes'), [dir]);
  // Hand edit in the project: held, the plan says so; the store's edit shows on reset.
  writeFileSync(copy, 'edited here\n');
  apply(preview([userSkillWrite(ctx, 'release-notes', skillText('release-notes', 'New text.'), { isNew: false })]), ctx, { scope: 'global' });
  const held = preview(projectPlan({ ctx, dir, answers: {}, plugins: {} }).changes).find((c) => c.path === copy);
  assert.deepEqual([held.held, held.selected, held.title], [true, false, 'skill release-notes (yours) in .claude/skills (SKILL.md differs from the copy in your skills: reset the skill to replace it)']);
  run({ reset: ['release-notes'] });
  assert.match(readFileSync(copy, 'utf8'), /New text\./);
  // Taken out of the project: its copies are removed as files, not through the skills CLI.
  r = run({ skills: [] });
  assert.ok(!r.entries.some((e) => e.kind === 'command'));
  assert.equal(existsSync(join(dir, '.claude/skills/release-notes')), false);
});

test('a skill pack for all projects copies a user skill into the global skill folders', () => {
  const ctx = ctxAt();
  add(ctx, 'release-notes');
  savePack(ctx, { id: 'mine', skills: ['release-notes'] });
  apply(preview([{ id: 'scope', step: 'scope', title: 'scope', ...scopeWrite(ctx, 'mine', 'global') }]), ctx, { scope: 'global' });
  const plan = preview(globalPlan({ ctx, agents: ['claude', 'codex'], devcontainerCli: '0.0.0', options: { packs: [], containers: false } })).filter((c) => c.step === 'pack:mine');
  assert.deepEqual(plan.map((c) => [c.kind, c.path, c.installUnit.source.type]), [
    ['write', join(ctx.home, '.claude/skills/release-notes/SKILL.md'), 'user'],
    ['write', join(ctx.home, '.agents/skills/release-notes/SKILL.md'), 'user'],
  ]);
});

test('a file of a user skill that is not UTF-8 text is copied byte for byte, in a project and globally', () => {
  const ctx0 = ctxAt();
  const dir = mkdtempSync(join(TMP, 'bk-user-skill-bin-'));
  execFileSync('git', ['init', '-q', dir]);
  const ctx = { ...ctx0, roots: [...ctx0.roots, dir] };
  add(ctx, 'release-notes');
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0xfe]);
  writeFileSync(join(userSkillDir(ctx, 'release-notes'), 'logo.png'), bytes);
  const plan = preview(projectPlan({ ctx, dir, answers: { agents: ['claude'], env: 'host', skills: ['release-notes'] }, plugins: {} }).changes);
  assert.equal(apply(plan, ctx, { scope: dir }).status, 'done');
  assert.ok(readFileSync(join(dir, '.claude/skills/release-notes/logo.png')).equals(bytes));
  assert.ok(!preview(projectPlan({ ctx, dir, answers: {}, plugins: {} }).changes).some((c) => c.path?.endsWith('logo.png') && !c.noop));
  assert.equal(projectSkills(ctx, dir).skills[0].state, 'current');
  savePack(ctx, { id: 'mine', skills: ['release-notes'] });
  apply(preview([{ id: 'scope', step: 'scope', title: 'scope', ...scopeWrite(ctx, 'mine', 'global') }]), ctx, { scope: 'global' });
  const global = preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '0.0.0', options: { packs: [], containers: false } })).filter((c) => c.step === 'pack:mine');
  assert.equal(apply(global, ctx, { scope: 'global' }).status, 'done');
  assert.ok(readFileSync(join(ctx.home, '.claude/skills/release-notes/logo.png')).equals(bytes));
});

test('a link to nothing or to a folder in a user skill is not copied and the project plan warns; the views keep working (#914)', () => {
  const ctx0 = ctxAt();
  const dir = mkdtempSync(join(TMP, 'bk-user-skill-link-'));
  execFileSync('git', ['init', '-q', dir]);
  const ctx = { ...ctx0, roots: [...ctx0.roots, dir] };
  add(ctx, 'release-notes');
  const src = userSkillDir(ctx, 'release-notes');
  writeFileSync(join(ctx.home, 'kept.md'), 'kept\n');
  symlinkSync(join(ctx.home, 'kept.md'), join(src, 'kept.md'));
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  writeFileSync(join(ctx.home, 'logo.png'), bytes);
  symlinkSync(join(ctx.home, 'logo.png'), join(src, 'logo.png'));
  symlinkSync(join(ctx.home, 'nothing-here'), join(src, 'notes.md'));
  mkdirSync(join(ctx.home, 'shared'));
  symlinkSync(join(ctx.home, 'shared'), join(src, 'refs'));
  const answers = { agents: ['claude'], env: 'host', skills: ['release-notes'] };
  const p = projectPlan({ ctx, dir, answers, plugins: {} });
  const paths = preview(p.changes).filter((c) => c.step === 'skill:release-notes').map((c) => c.path.slice(dir.length + 1));
  assert.deepEqual(paths, ['.claude/skills/release-notes/kept.md', '.claude/skills/release-notes/logo.png', '.claude/skills/release-notes/SKILL.md']);
  assert.ok(p.warnings.includes('your skill release-notes: notes.md, refs are links to nothing or to a folder, so they are not copied: replace each with the file or remove it'), JSON.stringify(p.warnings));
  assert.equal(apply(preview(p.changes), ctx, { scope: dir }).status, 'done');
  assert.equal(readFileSync(join(dir, '.claude/skills/release-notes/kept.md'), 'utf8'), 'kept\n');
  // A link to a binary file is copied as the file's bytes, not as a link into the home folder.
  assert.equal(lstatSync(join(dir, '.claude/skills/release-notes/logo.png')).isSymbolicLink(), false);
  assert.ok(readFileSync(join(dir, '.claude/skills/release-notes/logo.png')).equals(bytes));
  assert.equal(projectSkills(ctx, dir).skills.find((s) => s.name === 'release-notes').state, 'current');
  savePack(ctx, { id: 'mine', skills: ['release-notes'] });
  apply(preview([{ id: 'scope', step: 'scope', title: 'scope', ...scopeWrite(ctx, 'mine', 'global') }]), ctx, { scope: 'global' });
  const global = preview(globalPlan({ ctx, agents: ['claude'], devcontainerCli: '0.0.0', options: { packs: [], containers: false } })).filter((c) => c.step === 'pack:mine');
  assert.deepEqual(global.map((c) => c.path), [join(ctx.home, '.claude/skills/release-notes/kept.md'), join(ctx.home, '.claude/skills/release-notes/logo.png'), join(ctx.home, '.claude/skills/release-notes/SKILL.md')]);
});

test('skills new, edit, delete and show on the command line, with --json and refusals', async () => {
  const ctx = ctxAt();
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const err = new Writable({ write(chunk, _, done) { done(); } });
  const cli = async (...args) => { text = ''; return main(args, { out, err, ctx, input: Readable.from(['']) }); };
  assert.equal(await cli('skills', 'new', 'release-notes', '--description', 'Checks release notes.', '--yes', '--json'), 0);
  assert.equal(JSON.parse(text).runs[0].entries[0].title, 'your skill release-notes: new SKILL.md');
  assert.equal(await cli('skills', 'show', 'release-notes', '--json'), 0);
  assert.equal(JSON.parse(text).text, '---\nname: release-notes\ndescription: "Checks release notes."\n---\n\n# release-notes\n');
  const file = join(ctx.home, 'SKILL.md');
  writeFileSync(file, skillText('release-notes', 'From a file.'));
  assert.equal(await cli('skills', 'edit', 'release-notes', '--file', file, '--yes'), 0);
  assert.match(readFileSync(join(userSkillDir(ctx, 'release-notes'), 'SKILL.md'), 'utf8'), /From a file\./);
  assert.equal(await cli('skills', 'edit', 'release-notes', '--yes'), 2);
  assert.match(text, /skills edit needs --file/);
  assert.equal(await cli('skills', 'new', 'release-notes', '--yes'), 2);
  assert.match(text, /you have a skill release-notes/);
  assert.equal(await cli('skills', 'delete', '--yes'), 2);
  assert.match(text, /skills delete needs one skill name/);
  savePack(ctx, { id: 'mine', skills: ['release-notes'] });
  assert.equal(await cli('skills', 'delete', 'release-notes', '--yes'), 2);
  assert.match(text, /in use by pack mine/);
  assert.equal(await cli('packs', 'warnings', 'mine', '--json'), 0);
  writeFileSync(join(ctx.config, 'packs', 'mine.json'), JSON.stringify({ id: 'mine', skills: ['accessibility'] }));
  assert.equal(await cli('skills', 'delete', 'release-notes', '--yes', '--json'), 0);
  assert.equal(JSON.parse(text).runs[0].entries[0].title, 'remove your skill release-notes');
  assert.equal(existsSync(userSkillDir(ctx, 'release-notes')), false);
});

test('the server plans a user skill change for /api/apply and reads its text', () => {
  const ctx = ctxAt();
  const routes = api(ctx);
  const plan = routes['POST /api/user-skill-plan']({ op: 'new', name: 'release-notes', text: skillText('release-notes') });
  assert.deepEqual(plan.changes.map((c) => c.title), ['your skill release-notes: new SKILL.md']);
  assert.throws(() => routes['POST /api/user-skill-plan']({ op: 'rename', name: 'release-notes' }), /op must be new, edit or remove/);
  add(ctx, 'release-notes');
  assert.equal(routes['GET /api/skill'](new URLSearchParams([['name', 'release-notes']])).text, skillText('release-notes'));
  assert.equal(routes['GET /api/catalog']().skills.find((s) => s.name === 'release-notes').source, 'user');
  savePack(ctx, { id: 'mine', skills: ['release-notes'] });
  assert.throws(() => routes['POST /api/user-skill-plan']({ op: 'remove', name: 'release-notes' }), /in use by pack mine/);
});
