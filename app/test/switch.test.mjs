import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { hashPath } from '../src/fsx.mjs';
import { removePack, savePack } from '../src/packs.mjs';
import { addProject, projectsUsing, updateAll } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { focusOn, globalUntracked, projectSkills, skillAction } from '../src/skills.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { STATE, projectPlan, readState } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());
const SKILL = 'designing-technical-uis';

function repo() {
  const dir = mkdtempSync(join(TMP, 'bk-sw-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), '# P\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  const home = mkdtempSync(join(TMP, 'bk-swhome-'));
  const ctx = context({ home, roots: [home, dir], appVersion: '6.0.0' });
  // Two own packs that share one skill, and one that holds another skill the library has.
  savePack(ctx, { id: 'ui-a', skills: [SKILL] });
  savePack(ctx, { id: 'ui-b', skills: [SKILL] });
  return { dir, ctx, git, home, skill: join(dir, '.claude/skills', SKILL, 'SKILL.md') };
}
// The plan of the answers, applied without the commands (no network, no npx).
const run = (r, answers, select) => {
  const p = projectPlan({ ctx: r.ctx, dir: r.dir, answers, plugins: {} });
  const plan = preview(p.changes);
  return { ...p, run: apply(plan, r.ctx, { scope: r.dir, select: select ?? plan.filter((c) => c.kind !== 'command' && c.selected).map((c) => c.id) }) };
};
// Every file below dir (not .git objects) with its content.
function tree(dir, base = dir, out = {}) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === '.git' && dir === base) { out['.git/info/exclude'] = readFileSync(join(p, 'info/exclude'), 'utf8'); continue; }
    if (statSync(p).isDirectory()) tree(p, base, out); else out[p.slice(base.length + 1)] = readFileSync(p, 'utf8');
  }
  return out;
}
const sink = () => { let text = ''; return { out: new Writable({ write(c, _, done) { text += c; done(); } }), text: () => text }; };
const cli = (r, args) => { const s = sink(); return main(args, { out: s.out, ctx: r.ctx, input: Readable.from(['']) }).then((code) => ({ code, text: s.text() })); };

test('disabling a pack removes only the skills no other pack or single pick still needs', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a', 'ui-b'] });
  assert.ok(existsSync(r.skill));
  // Shared by two packs: stays.
  let p = run(r, { packOff: ['ui-a'] });
  assert.deepEqual(p.skills.removed, []);
  assert.ok(existsSync(r.skill));
  assert.deepEqual(readState(r.dir).packs, ['ui-b']);
  // Also a single pick keeps it, and the last pack going takes it away.
  run(r, { packOn: ['ui-a'], skills: [SKILL] });
  p = run(r, { packOff: ['ui-a', 'ui-b'] });
  assert.deepEqual([p.skills.removed, existsSync(r.skill)], [[], true]);
  p = run(r, { drop: [SKILL] });
  assert.deepEqual([p.skills.removed, existsSync(r.skill)], [[SKILL], false]);
});

test('enable then disable returns the project to its files byte for byte, and undo restores each step', () => {
  const r = repo();
  run(r, { agents: ['claude', 'codex'], env: 'host', packs: [], tier: 'quick' });
  const before = tree(r.dir);
  const on = run(r, { packOn: ['ui-a'] });
  assert.equal(on.run.status, 'done');
  assert.ok(existsSync(r.skill));
  assert.notDeepEqual(tree(r.dir), before);
  const off = run(r, { packOff: ['ui-a'] });
  assert.equal(off.run.status, 'done');
  assert.deepEqual(tree(r.dir), before);
  assert.equal(undo(off.run.id, r.ctx).status, 'done');
  assert.ok(existsSync(r.skill));
  assert.equal(undo(on.run.id, r.ctx).status, 'done');
  assert.deepEqual(tree(r.dir), before);
});

test('skill states: current, modified, outdated, removed, disabled; an edit is never replaced without a reset', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'] });
  const row = () => projectSkills(r.ctx, r.dir).skills.find((s) => s.name === SKILL);
  assert.deepEqual([row().state, row().packs, row().single, row().own], ['current', ['ui-a'], false, true]);
  const library = readFileSync(r.skill, 'utf8');
  // Outdated: the file is what an older setup wrote. Run ids carry seconds: the older run must not share the second.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100);
  apply(preview([{ id: 'old', step: 'old', title: 'old', kind: 'write', path: r.skill, after: 'older version\n' }]), r.ctx, { scope: r.dir });
  assert.equal(row().state, 'outdated');
  assert.ok(run(r, {}).run.entries.some((e) => e.path === r.skill));
  assert.equal(readFileSync(r.skill, 'utf8'), library);
  // Modified: edited here. A plan shows the diff but does not select it; applying the default selection keeps the edit.
  writeFileSync(r.skill, `${library}my edit\n`);
  assert.equal(row().state, 'modified');
  const held = preview(projectPlan({ ctx: r.ctx, dir: r.dir, answers: {} }).changes).find((c) => c.path === r.skill);
  assert.deepEqual([held.selected, held.diff.includes('-my edit')], [false, true], held.diff);
  assert.match(held.title, /differs from the library/);
  run(r, {});
  assert.equal(readFileSync(r.skill, 'utf8'), `${library}my edit\n`);
  // Reset: the edit is backed up before it is replaced, so undo brings it back.
  const reset = run(r, { reset: [SKILL] });
  assert.equal(readFileSync(r.skill, 'utf8'), library);
  assert.equal(row().state, 'current');
  assert.equal(undo(reset.run.id, r.ctx).status, 'done');
  assert.equal(readFileSync(r.skill, 'utf8'), `${library}my edit\n`);
  // Removed, then disabled.
  rmSync(join(r.dir, '.claude/skills', SKILL), { recursive: true });
  assert.equal(row().state, 'removed');
  run(r, { disable: [SKILL] });
  assert.equal(row().state, 'disabled');
});

test('a copy no run on this machine wrote (a clone, another worktree) counts as outdated and is replaced with its diff shown', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'] });
  const other = mkdtempSync(join(TMP, 'bk-swhome-'));
  const fresh = { ...r.ctx, ledger: context({ home: other }).ledger };
  writeFileSync(r.skill, 'written elsewhere\n');
  assert.equal(projectSkills(fresh, r.dir).skills.find((x) => x.name === SKILL).state, 'outdated');
  const change = preview(projectPlan({ ctx: fresh, dir: r.dir, answers: {}, plugins: {} }).changes).find((c) => c.path === r.skill);
  assert.deepEqual([change.selected, change.diff.includes('-written elsewhere')], [true, true]);
});

test('community skills: outdated by the source\'s commit once checked, modified by the hash recorded at install, removed with the folder', () => {
  const r = repo();
  const folders = ['frontend-design', 'accessibility'].map((n) => join(r.dir, '.claude/skills', n));
  // The skills CLI is stubbed: it writes the folders the install would leave.
  const npx = { ...r.ctx, run: (argv) => { if (argv[0] === 'npx' && argv.includes('add')) for (const f of folders) { mkdirSync(f, { recursive: true }); writeFileSync(join(f, 'SKILL.md'), `---\nname: x\n---\nupstream\n`); } return { code: 0, stdout: argv[0] === 'git' ? `${'e'.repeat(40)}\tHEAD\n` : '', stderr: '' }; } };
  const first = preview(projectPlan({ ctx: r.ctx, dir: r.dir, answers: { agents: ['claude'], env: 'host', packs: ['frontend'] } }).changes);
  apply(first, npx, { scope: r.dir });
  const rec = readState(r.dir).skills.find((s) => s.name === 'frontend-design');
  assert.deepEqual([rec.ref, rec.hash], [rec.ref, hashPath(folders[0])]);
  assert.match(rec.ref, /^[0-9a-f]{40}$/);
  // The source's default branch is asked only on a check (one ls-remote per source); until then nothing is outdated.
  const asked = [];
  const remote = (sha) => ({ ...r.ctx, run: (argv) => { asked.push(argv); return { code: 0, stdout: sha ? `${sha}\tHEAD\n` : '', stderr: '' }; } });
  const row = (n = 'frontend-design', sha = rec.ref) => projectSkills(remote(sha), r.dir, sha === null ? {} : { check: true }).skills.find((s) => s.name === n);
  asked.length = 0;
  const checked = row();
  assert.deepEqual([checked.state, checked.pinned === checked.newest, checked.own], ['current', true, false]);
  assert.deepEqual(asked.map((a) => a.slice(0, 2).join(' ')), ['git ls-remote', 'git ls-remote'], 'one per source');
  asked.length = 0;
  const unchecked = row('frontend-design', null);
  assert.deepEqual([unchecked.state, unchecked.newest, asked.length], ['current', null, 0]);
  // No commit recorded (the remote could not be read at install): unknown, so outdated once the source is known.
  const recorded = readFileSync(join(r.dir, STATE), 'utf8');
  const noRef = JSON.parse(recorded);
  delete noRef.skills.find((s) => s.name === 'frontend-design').ref;
  writeFileSync(join(r.dir, STATE), JSON.stringify(noRef));
  assert.deepEqual([row('frontend-design', null).state, row('frontend-design', 'a'.repeat(40)).state], ['current', 'outdated']);
  writeFileSync(join(r.dir, STATE), recorded);
  // The source moved on: outdated; an edit on top of it is modified and not overwritten by an update.
  assert.equal(row('frontend-design', 'a'.repeat(40)).state, 'outdated');
  assert.equal(row('frontend-design', '').state, 'current', 'a source that cannot be read leaves the state alone');
  const state = JSON.parse(readFileSync(join(r.dir, STATE), 'utf8'));
  writeFileSync(join(r.dir, STATE), JSON.stringify(state));
  writeFileSync(join(folders[0], 'SKILL.md'), 'edited here\n');
  assert.equal(row('frontend-design', 'a'.repeat(40)).state, 'modified');
  const install = (answers) => preview(projectPlan({ ctx: r.ctx, dir: r.dir, answers }).changes).find((c) => c.kind === 'command' && /frontend-design/.test(c.title));
  const held = install({ update: ['frontend-design'] });
  assert.deepEqual([held.selected, /edited here/.test(held.title)], [false, true]);
  // Reset replaces it; the snapshot of the command holds the folder, so the edit is in the backup.
  const reset = install({ reset: ['frontend-design'] });
  assert.equal(reset.selected, true);
  assert.ok(reset.snapshot.includes(folders[0]));
  rmSync(folders[1], { recursive: true });
  assert.equal(row('accessibility', null).state, 'removed');
});

test('an untracked skill survives project apply, a pack switch and Update all; adopt takes a library skill in', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'] });
  for (const n of ['mine', 'mermaid-diagrams']) { mkdirSync(join(r.dir, '.claude/skills', n), { recursive: true }); writeFileSync(join(r.dir, '.claude/skills', n, 'SKILL.md'), `---\nname: ${n}\n---\nmine\n`); }
  const found = () => projectSkills(r.ctx, r.dir).untracked.map((u) => [u.name, u.library]);
  assert.deepEqual(found(), [['mermaid-diagrams', true], ['mine', false]]);
  const before = tree(join(r.dir, '.claude/skills'));
  const everything = (answers) => { const p = preview(projectPlan({ ctx: r.ctx, dir: r.dir, answers, plugins: {} }).changes); return apply(p, r.ctx, { scope: r.dir, select: p.filter((c) => c.kind !== 'command').map((c) => c.id) }); };
  everything({});
  everything({ packOff: ['ui-a'] });
  everything({ packOn: ['ui-a'] });
  const survivors = tree(join(r.dir, '.claude/skills'));
  for (const f of Object.keys(before).filter((x) => !x.startsWith(SKILL))) assert.equal(survivors[f], before[f], f);
  // Update all on a registered local setup behind the app.
  const state = JSON.parse(readFileSync(join(r.dir, STATE), 'utf8'));
  writeFileSync(join(r.dir, STATE), JSON.stringify({ ...state, setupVersion: '5.0.0' }));
  addProject(r.ctx, r.dir);
  const [u] = updateAll(r.ctx, { push: false });
  assert.notEqual(u.status, 'stopped', u.reason);
  for (const f of Object.keys(before).filter((x) => !x.startsWith(SKILL))) assert.equal(readFileSync(join(r.dir, '.claude/skills', f), 'utf8'), before[f], f);
  // Adopt: only a library name; the pick is recorded and the folder is kept.
  const rows = projectSkills(r.ctx, r.dir);
  assert.throws(() => skillAction(rows, 'adopt', ['mine']), /not an untracked library skill/);
  assert.deepEqual(skillAction(rows, 'adopt', ['mermaid-diagrams']).answers.pick, ['mermaid-diagrams']);
  const adopted = projectPlan({ ctx: r.ctx, dir: r.dir, answers: { pick: ['mermaid-diagrams'] }, plugins: {} });
  assert.deepEqual(adopted.skills.added, ['mermaid-diagrams']);
  assert.ok(!adopted.changes.some((c) => c.kind === 'command' && /mermaid-diagrams/.test(c.title)), 'the folder is there: no install');
  // No commit is claimed for a folder BenchKeeper did not install; the setup version stays when only a skill changes.
  writeFileSync(join(r.dir, STATE), JSON.stringify({ ...JSON.parse(readFileSync(join(r.dir, STATE), 'utf8')), setupVersion: '5.0.0' }));
  const partial = projectPlan({ ctx: r.ctx, dir: r.dir, answers: { pick: ['mermaid-diagrams'], partial: true }, plugins: {} });
  apply(preview(focusOn(partial.changes, ['mermaid-diagrams'])), r.ctx, { scope: r.dir });
  const after = readState(r.dir);
  assert.deepEqual([after.setupVersion, after.singles, after.skills.find((x) => x.name === 'mermaid-diagrams').ref], ['5.0.0', ['mermaid-diagrams'], undefined]);
});

test('skill actions: remove takes a single pick and names the pack for the others; focus keeps one skill', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'], skills: ['mermaid-diagrams'] });
  const rows = projectSkills(r.ctx, r.dir);
  assert.throws(() => skillAction(rows, 'remove', [SKILL]), /pack ui-a: switch the pack off \(benchkeeper packs disable ui-a\)/);
  assert.throws(() => skillAction(rows, 'reset', ['nope']), /not a skill of this project/);
  const a = skillAction(rows, 'remove', ['mermaid-diagrams']);
  assert.deepEqual(a.answers.drop, ['mermaid-diagrams']);
  const p = projectPlan({ ctx: r.ctx, dir: r.dir, answers: a.answers, plugins: {} });
  assert.ok(focusOn(p.changes, a.names).every((c) => /^(remove:mermaid-diagrams|state|exclude|local-claude)$/.test(c.step)), p.changes.map((c) => c.step).join());
  assert.deepEqual(skillAction(rows, 'update', []).names, []);
  assert.throws(() => skillAction(rows, 'update', ['typo']), /not a skill of this project/);
});

test('an own pack a project names cannot be removed; the message names the project', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'] });
  addProject(r.ctx, r.dir);
  assert.deepEqual(projectsUsing(r.ctx, 'ui-a'), [realpathSync(r.dir)]);
  assert.throws(() => removePack(r.ctx, 'ui-a', { usedBy: projectsUsing(r.ctx, 'ui-a') }), (e) => e.message.includes(realpathSync(r.dir)) && /switch it off/.test(e.message));
  removePack(r.ctx, 'ui-b', { usedBy: projectsUsing(r.ctx, 'ui-b') });
  assert.ok(!existsSync(join(r.ctx.config, 'packs/ui-b.json')));
});

test('CLI: packs enable and disable are a plan with a diff, in the project or for the plugin of a pack', async () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: [] });
  const before = tree(r.dir);
  let o = await cli(r, ['packs', 'enable', 'ui-a', '--project', r.dir]);
  assert.equal(o.code, 0, o.text);
  assert.match(o.text, /change .*designing-technical-uis/);
  assert.equal(existsSync(r.skill), false, 'no answer: nothing applied');
  o = await cli(r, ['packs', 'enable', 'ui-a', '--project', r.dir, '--yes']);
  assert.equal(o.code, 0, o.text);
  assert.match(o.text, /skills: \+designing-technical-uis/);
  assert.match(o.text, /undo with benchkeeper undo /);
  assert.ok(existsSync(r.skill));
  addProject(r.ctx, r.dir);
  await assert.rejects(cli(r, ['packs', 'remove', 'ui-a']), /in use by .*switch it off/);
  o = await cli(r, ['packs', 'disable', 'ui-a', '--project', r.dir, '--yes']);
  assert.equal(o.code, 0, o.text);
  assert.deepEqual(tree(r.dir), before);
  o = await cli(r, ['packs', 'disable', 'ui-a', '--project', r.dir, '--yes']);
  assert.match(o.text, /nothing to change/);
  assert.equal((await cli(r, ['packs', 'remove', 'ui-a'])).code, 0);
  for (const [args, code, text] of [
    [['packs', 'enable'], 2, /needs a pack id/],
    [['packs', 'enable', 'nope', '--project', r.dir], 1, /unknown pack nope/],
    [['packs', 'enable', 'ui-b', '--project', r.dir, '--global'], 2, /exclude each other/],
    [['packs', 'enable', 'frontend', '--global'], 1, /per project, not on the machine/],
    [['packs', 'enable', 'frontend', '--project', mkdtempSync(join(TMP, 'bk-none-'))], 1, /has no setup yet/],
  ]) { o = await cli(r, args); assert.deepEqual([o.code, text.test(o.text)], [code, true], `${args.join(' ')}: ${o.text}`); }
});

test('CLI --global: the plugin of a pack is a plan of that pack alone, on and off', async () => {
  const r = repo();
  const plugins = new Map();
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const stub = { ...r.ctx, run: (argv) => {
    const cmd = argv.join(' ');
    if (/^claude --version/.test(cmd)) return ok('2.1.0 (Claude Code)');
    if (/^claude plugin list --json/.test(cmd)) return ok(JSON.stringify([...plugins.values()]));
    if (/^claude plugin marketplace list/.test(cmd)) return ok('[]');
    if (/^claude plugin install /.test(cmd)) { plugins.set(argv[3], { id: argv[3], version: '1.0.0', enabled: true, installPath: r.home }); return ok(); }
    if (/^claude plugin uninstall /.test(cmd)) { plugins.delete(argv[3]); return ok(); }
    return ok();
  } };
  const o = await cli({ ctx: stub }, ['packs', 'enable', 'matt-pocock', '--global', '--agents', 'claude']);
  assert.equal(o.code, 0, o.text);
  assert.match(o.text, /mattpocock-skills/);
  assert.ok(!/rules|settings/i.test(o.text.replace(/mattpocock-skills[^\n]*/g, '')), 'only the pack plugin steps are listed');
});

test('server: project-plan switches packs and acts on one skill; /api/skills lists states and untracked folders', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'] });
  // Claude Code counts as installed.
  const routes = api({ ...r.ctx, run: (argv, o) => (argv.join(' ') === 'claude --version' ? { code: 0, stdout: '2.1.0 (Claude Code)', stderr: '' } : r.ctx.run(argv, o)) });
  routes['POST /api/projects']({ action: 'add', path: r.dir });
  const q = (extra) => new URLSearchParams([['dir', r.dir], ...extra]);
  const status = (f) => { try { f(); } catch (e) { return e.status ?? 500; } return 200; };
  let p = routes['GET /api/project-plan'](q([]));
  assert.deepEqual(p.packs.filter((x) => x.enabled).map((x) => x.id), ['ui-a']);
  p = routes['GET /api/project-plan'](q([['pack-on', 'ui-b'], ['pack-off', 'ui-a']]));
  assert.deepEqual(p.packs.filter((x) => x.enabled).map((x) => x.id), ['ui-b']);
  assert.deepEqual(p.skills.removed, [], 'the skill is in the other pack');
  assert.equal(status(() => routes['GET /api/project-plan'](q([['pack-on', 'nope']]))), 400);
  assert.equal(status(() => routes['GET /api/project-plan'](q([['pick', 'not-in-the-library']]))), 400);
  assert.equal(status(() => routes['GET /api/project-plan'](q([['reset', 'not-a-skill']]))), 400);
  // One skill's reset: its changes only, with the records of them.
  writeFileSync(r.skill, 'edited\n');
  const reset = routes['GET /api/project-plan'](q([['reset', SKILL], ['focus', SKILL]]));
  assert.ok(reset.changes.every((c) => /^(skill:designing-technical-uis|state|exclude|local-claude)$/.test(c.step)), reset.changes.map((c) => c.step).join());
  const edit = reset.changes.find((c) => c.path === r.skill);
  assert.deepEqual([edit.selected, edit.diff.includes('-edited')], [true, true]);
  mkdirSync(join(r.dir, '.claude/skills/mine'));
  writeFileSync(join(r.dir, '.claude/skills/mine/SKILL.md'), 'mine\n');
  mkdirSync(join(r.home, '.claude/skills/theirs'), { recursive: true });
  const all = routes['GET /api/skills']();
  assert.deepEqual(all.projects.map((x) => [x.path, x.skills.find((s) => s.name === SKILL).state, x.untracked.map((u) => u.name)]), [[realpathSync(r.dir), 'modified', ['mine']]]);
  assert.deepEqual(all.global.map((x) => x.name), ['theirs']);
  assert.deepEqual(globalUntracked(r.ctx, ['claude']).map((x) => x.name), ['theirs']);
  // A pack a project names: the catalog says by whom, and removal is refused with a 400.
  assert.deepEqual(routes['GET /api/catalog']().packs.find((x) => x.id === 'ui-a').usedBy, [realpathSync(r.dir)]);
  assert.equal(status(() => routes['POST /api/packs']({ action: 'remove', id: 'ui-a' })), 400);
  assert.equal(status(() => routes['POST /api/packs']({ action: 'remove', id: 'ui-b' })), 200);
  // The global plan offers moving a skill it did not install to the backup, never preselected.
  const move = preview(globalPlan({ ctx: r.ctx, agents: ['claude'], devcontainerCli: '1.0.0' })).find((c) => /theirs/.test(c.title));
  assert.deepEqual([move.destructive, move.selected], [true, false]);
});

test('a focused plan keeps the rules block that points to an own skill; adopting a folder of an own skill replaces it only on reset', () => {
  const r = repo();
  run(r, { agents: ['claude'], env: 'host', packs: ['ui-a'] });
  assert.match(readFileSync(join(r.dir, 'CLAUDE.local.md'), 'utf8'), /designing-technical-uis/);
  const off = focusOn(projectPlan({ ctx: r.ctx, dir: r.dir, answers: { disable: [SKILL] }, plugins: {} }).changes, [SKILL]);
  const rules = preview(off).find((c) => c.step === 'local-claude');
  assert.ok(rules?.diff.includes(`-- UI screens`) || rules?.diff.includes(SKILL), 'the pointer line leaves the block with the skill');
  // A folder of that name nobody installed: adopt shows it, a reset replaces it.
  const other = repo();
  mkdirSync(join(other.dir, '.claude/skills', SKILL), { recursive: true });
  writeFileSync(join(other.dir, '.claude/skills', SKILL, 'SKILL.md'), 'not ours\n');
  const write = (answers) => preview(projectPlan({ ctx: other.ctx, dir: other.dir, answers: { agents: ['claude'], env: 'host', packs: [], ...answers }, plugins: {} }).changes).find((c) => c.path === other.skill);
  assert.deepEqual([write({ pick: [SKILL] }).selected, write({ pick: [SKILL], reset: [SKILL] }).selected], [false, true]);
  // Adopted and saved: a later plan without pick keeps the folder too, until reset.
  run(other, { agents: ['claude'], env: 'host', packs: [], pick: [SKILL] });
  assert.equal(readFileSync(other.skill, 'utf8'), 'not ours\n');
  assert.deepEqual([write({}).selected, write({ reset: [SKILL] }).selected], [false, true]);
});
