import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { savePack } from '../src/packs.mjs';
import { createPlan, listPresets, recommend, removePreset, savePreset } from '../src/presets.mjs';
import { addProject, listProjects } from '../src/projects.mjs';
import { apply, context, preview } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { projectPlan, readState } from '../src/steps/project.mjs';
// Links resolved: the registry keeps canonical paths (macOS: /var is /private/var).
const TMP = realpathSync(tmpdir());
const SKILL = 'designing-technical-uis';

// A home with an own pack of a skill the app ships (no npx install) and a project set up with it, saved as the preset web.
function home() {
  const h = mkdtempSync(join(TMP, 'bk-preset-'));
  const ctx = context({ home: h, appVersion: '6.0.0' });
  savePack(ctx, { id: 'ui', skills: [SKILL] });
  const setUp = (name, answers) => {
    const dir = join(h, name);
    mkdirSync(dir);
    const plan = preview(projectPlan({ ctx, dir, answers, plugins: {} }).changes);
    apply(plan, ctx, { scope: dir, select: plan.filter((c) => c.kind !== 'command').map((c) => c.id) });
    return dir;
  };
  savePreset(ctx, 'web', setUp('first', { agents: ['claude'], env: 'host', packs: ['ui'], tier: 'standard' }));
  return { ctx, h, setUp };
}
function sink() {
  let text = '';
  return { out: new Writable({ write(c, _, done) { text += c; done(); } }), text: () => text };
}
const cli = (ctx, args, answers = '') => { const s = sink(); return main(args, { out: s.out, ctx, input: Readable.from([answers]) }).then((code) => ({ code, text: s.text() })); };

test('presets: saved from a project with a setup, listed, never replaced, removed into the backup', () => {
  const { ctx, h } = home();
  const [p] = listPresets(ctx);
  assert.deepEqual([p.id, p.answers.agents, p.answers.packs, p.answers.tier], ['web', ['claude'], ['ui'], 'standard']);
  assert.throws(() => savePreset(ctx, 'web', join(h, 'first')), /preset web exists/);
  assert.throws(() => savePreset(ctx, '../x', join(h, 'first')), /preset id/);
  assert.throws(() => savePreset(ctx, 'none', h), /has no setup yet/);
  writeFileSync(join(ctx.config, 'presets', 'broken.json'), '{');
  writeFileSync(join(ctx.config, 'presets', 'other.json'), JSON.stringify({ ...p, id: 'renamed' }));
  writeFileSync(join(ctx.config, 'presets', 'flat.json'), JSON.stringify({ ...p, id: 'flat', answers: { agents: 'claude' } }));
  writeFileSync(join(ctx.config, 'presets', 'odd.json'), JSON.stringify({ ...p, id: 'odd', answers: { agents: ['claude'], packs: 'ui' } }));
  assert.deepEqual(listPresets(ctx).map((x) => x.id), ['web']);
  assert.throws(() => savePreset(ctx, 'broken', join(h, 'first')), /preset broken exists/, 'a file that is not a valid preset is not replaced');
  removePreset(ctx, 'web');
  removePreset(ctx, 'broken');
  assert.deepEqual(listPresets(ctx), []);
  assert.equal(readdirSync(join(ctx.config, 'backup', 'presets')).length, 2);
  assert.throws(() => removePreset(ctx, '../x'), /unknown preset/);
  assert.throws(() => removePreset(ctx, 'web'), /unknown preset web/);
});

test('creating from a preset is a plan of a new folder; existing, missing parent, inside a project and unknown preset are refused', () => {
  const { ctx, h } = home();
  const dir = join(h, 'new');
  const { plan, skills } = createPlan(ctx, dir, 'web');
  assert.deepEqual(skills.added, [SKILL]);
  assert.ok(plan.some((c) => c.path === join(dir, '.claude/skills', SKILL, 'SKILL.md')));
  assert.ok(plan.every((c) => c.diff !== undefined || c.kind === 'command'));
  assert.equal(existsSync(dir), false, 'a plan writes nothing');
  assert.throws(() => createPlan(ctx, dir, 'nope'), /unknown preset nope/);
  assert.throws(() => createPlan(ctx, join(h, 'first'), 'web'), /exists already/);
  assert.throws(() => createPlan(ctx, join(h, 'no', 'new'), 'web'), /parent folder .* does not exist/);
  addProject(ctx, join(h, 'first'));
  mkdirSync(join(h, 'first', 'sub'));
  assert.throws(() => createPlan(ctx, join(h, 'first', 'sub', 'x'), 'web'), /inside the registered project/);
});

test('the check recommends turning off a skill installed for all projects and adding a pack most projects with the agent use', () => {
  const { ctx, h, setUp } = home();
  const dir = join(h, 'new');
  const { plan, pctx } = createPlan(ctx, dir, 'web');
  apply(plan, pctx, { scope: dir, select: plan.map((c) => c.id) });
  assert.deepEqual(recommend(ctx, dir).items, [], 'nothing known yet');
  mkdirSync(join(h, '.claude/skills', SKILL), { recursive: true });
  writeFileSync(join(h, '.claude/skills', SKILL, 'SKILL.md'), '---\nname: x\ndescription: "x"\n---\n');
  for (const n of ['a', 'b']) addProject(ctx, setUp(n, { agents: ['claude'], env: 'host', packs: ['ui', 'docs'] }));
  addProject(ctx, setUp('codex-only', { agents: ['codex'], env: 'host', packs: ['testing'] }));
  const r = recommend(ctx, dir);
  assert.deepEqual(r.items.map((x) => `${x.action} ${x.name}`), [`remove ${SKILL}`, 'add docs']);
  assert.match(r.items[0].reason, /also installed for all projects in .*\.claude\/skills/);
  assert.equal(r.items[1].reason, 'on in 2 of 2 registered projects with the same agents');
  assert.ok(r.plan.length && r.plan.every((c) => c.selected === false), 'no change selected');
});

test('CLI: projects create applies the plan, registers the folder and offers the recommendations unselected', async () => {
  const { ctx, h, setUp } = home();
  for (const n of ['a', 'b']) addProject(ctx, setUp(n, { agents: ['claude'], env: 'host', packs: ['ui', 'docs'] }));
  // No network: the skills CLI of the docs pack would run only if the recommendation were taken.
  const run = ctx.run;
  ctx.run = (argv, opts) => { assert.notEqual(argv[0], 'npx'); return run(argv, opts); };
  const dir = join(h, 'new');
  let o = await cli(ctx, ['projects', 'create', dir, '--preset', 'web', '--yes']);
  assert.equal(o.code, 0, o.text);
  assert.match(o.text, new RegExp(`skills: \\+${SKILL}`));
  assert.match(o.text, /recommended: add pack docs: on in 2 of 2 registered projects/);
  assert.match(o.text, /nothing applied\n$/);
  assert.deepEqual(readState(dir).packs, ['ui']);
  assert.ok(listProjects(ctx).some((p) => p.path === dir));
  for (const [args, text] of [
    [['projects', 'create', dir, '--preset', 'web'], /exists already/],
    [['projects', 'create', join(h, 'x'), '--preset', 'nope'], /unknown preset nope/],
    [['projects', 'create', join(h, 'x')], /needs a directory and --preset/],
  ]) { o = await cli(ctx, args); assert.deepEqual([o.code, text.test(o.text)], [2, true], `${args.join(' ')}: ${o.text}`); }
  o = await cli(ctx, ['projects', 'create', join(h, 'y'), '--preset', 'web'], 'n\n'.repeat(20));
  assert.equal(existsSync(join(h, 'y')), false, 'declined: no folder');
  // Every change but the state file: the folder exists, but it is not set up and not registered.
  o = await cli(ctx, ['projects', 'create', join(h, 'z'), '--preset', 'web'], `${'y\n'.repeat(createPlan(ctx, join(h, 'z'), 'web').plan.length - 1)}n\n`);
  assert.deepEqual([o.code, /has no setup state .*not registered/.test(o.text)], [1, true], o.text);
  assert.ok(existsSync(join(h, 'z')) && !listProjects(ctx).some((x) => x.path === join(h, 'z')));
  o = await cli(ctx, ['presets']);
  assert.match(o.text, /^web +claude {2}packs: ui\n$/);
  assert.equal((await cli(ctx, ['presets', 'save', 'copy', '--project', dir])).code, 0);
  assert.equal((await cli(ctx, ['presets', 'remove', 'copy'])).code, 0);
});

test('server: presets, the plan of a new folder, and the recommendations of a registered project', () => {
  const { ctx, h, setUp } = home();
  for (const n of ['a', 'b']) addProject(ctx, setUp(n, { agents: ['claude'], env: 'host', packs: ['ui', 'docs'] }));
  const routes = api(ctx);
  const status = (f) => { try { f(); } catch (e) { return e.status ?? 500; } return 200; };
  assert.deepEqual(routes['GET /api/presets']().map((p) => p.id), ['web']);
  const dir = join(h, 'new');
  const p = routes['GET /api/create-plan'](new URLSearchParams({ dir, preset: 'web' }));
  assert.equal(p.dir, dir);
  assert.ok(p.planId && p.changes.length);
  assert.equal(status(() => routes['GET /api/create-plan'](new URLSearchParams({ dir, preset: 'nope' }))), 404);
  assert.equal(status(() => routes['GET /api/create-plan'](new URLSearchParams({ dir: h, preset: 'web' }))), 400);
  assert.equal(status(() => routes['GET /api/recommendations'](new URLSearchParams({ dir }))), 400);
  const { plan, pctx } = createPlan(ctx, dir, 'web');
  apply(plan, pctx, { scope: dir, select: plan.map((c) => c.id) });
  mkdirSync(join(h, 'bare'));
  assert.equal(status(() => routes['POST /api/projects']({ action: 'add', path: join(h, 'bare'), setup: true })), 400);
  routes['POST /api/projects']({ action: 'add', path: dir, setup: true });
  const r = routes['GET /api/recommendations'](new URLSearchParams({ dir }));
  assert.deepEqual(r.items.map((x) => x.name), ['docs']);
  assert.ok(r.planId && r.changes.every((c) => c.selected === false));
});
