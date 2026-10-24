// Install levels: lite is the BenchKeeper plugin alone, standard adds a project setup, full adds the global rules.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { detectLevel } from '../src/level.mjs';
import { addProject } from '../src/projects.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { STATE } from '../src/steps/project.mjs';

const ID = 'benchkeeper@benchkeeper';
// A Claude Code and a Codex with a foreign plugin and marketplace each; installing and uninstalling BenchKeeper changes the lists.
function machine() {
  const home = mkdtempSync(join(tmpdir(), 'bk-level-'));
  const s = { installed: false, calls: [] };
  const run = (argv) => {
    const cmd = argv.join(' ');
    s.calls.push(cmd);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (cmd.endsWith('--version')) return ok('1.0.0');
    if (cmd === 'claude plugin list --json') return ok(JSON.stringify([{ id: 'other@x', enabled: true, scope: 'user' }, ...(s.installed ? [{ id: ID, version: '9.0.0', enabled: true, scope: 'user' }] : [])]));
    if (cmd === 'codex plugin list --json') return ok(JSON.stringify({ installed: [{ pluginId: 'other@x', enabled: true }] }));
    if (cmd === 'claude plugin marketplace list --json') return ok(JSON.stringify([{ name: 'foreign' }]));
    if (cmd === 'codex plugin marketplace list --json') return ok(JSON.stringify({ marketplaces: [{ name: 'foreign' }] }));
    if (cmd === `claude plugin install ${ID}`) { s.installed = true; return ok(); }
    if (cmd === `claude plugin uninstall ${ID}`) { s.installed = false; return ok(); }
    return ok(argv.includes('--json') ? '[]' : '');
  };
  mkdirSync(join(home, '.claude/rules'), { recursive: true });
  writeFileSync(join(home, '.claude/rules/10-other.md'), 'mine');
  writeFileSync(join(home, '.claude/settings.json'), '{"model":"opus","permissions":{"ask":["Bash(mine *)"]}}');
  return { home, s, ctx: context({ home, run, appVersion: '6.5.0' }) };
}
const files = (dir) => readdirSync(dir, { recursive: true }).filter((f) => !f.startsWith('.config')).sort();

test('lite and standard plan the BenchKeeper plugin alone: no write, no removal, no other plugin or tool', () => {
  const m = machine();
  for (const level of ['lite', 'standard']) {
    const plan = globalPlan({ ctx: m.ctx, agents: ['claude', 'codex'], options: { level } });
    assert.ok(plan.length > 0);
    assert.ok(plan.every((c) => c.kind === 'command' && !c.destructive && c.step.endsWith(ID)), JSON.stringify(plan.map((c) => c.step)));
  }
  assert.ok(globalPlan({ ctx: m.ctx, agents: ['claude'], options: {} }).some((c) => c.kind === 'write'), 'no level plans everything');
  assert.throws(() => globalPlan({ ctx: m.ctx, agents: ['claude'], options: { level: 'tiny' } }), /level must be one of lite, standard, full/);
});

test('lite apply writes nothing outside the plugin install; undo removes the plugin', () => {
  const m = machine();
  const before = files(m.home);
  const plan = preview(globalPlan({ ctx: m.ctx, agents: ['claude'], options: { level: 'lite' } }));
  const run = apply(plan, m.ctx, { scope: 'global', select: plan.map((c) => c.id) });
  assert.equal(run.status, 'done');
  assert.deepEqual(files(m.home), before);
  assert.equal(m.s.installed, true);
  assert.ok(!m.s.calls.some((c) => /uninstall|remove/.test(c)), 'foreign plugins and marketplaces stay');
  undo(run.id, m.ctx);
  assert.equal(m.s.installed, false);
  assert.deepEqual(files(m.home), before);
});

test('the level found: the highest of plugin, project setup, global rules', () => {
  const m = machine();
  assert.deepEqual(detectLevel(m.ctx, ['claude']), { level: null, adds: null });
  m.s.installed = true;
  const lite = detectLevel(m.ctx, ['claude']);
  assert.equal(lite.level, 'lite');
  assert.match(lite.adds, /standard adds the local project block.*full adds the global rules/);
  const dir = mkdtempSync(join(tmpdir(), 'bk-level-proj-'));
  mkdirSync(join(dir, '.benchkeeper'));
  writeFileSync(join(dir, STATE), JSON.stringify({ schemaVersion: 1, setupVersion: '6.5.0', agents: ['claude'], skills: [] }));
  assert.equal(detectLevel(m.ctx, ['claude'], dir).level, 'standard');
  addProject(m.ctx, dir);
  assert.equal(detectLevel(m.ctx, ['claude']).level, 'standard', 'a registered project counts without a directory argument');
  writeFileSync(join(m.home, '.claude/rules/00-global.md'), 'Keep secrets out of output, logs and commits.\n');
  const full = detectLevel(m.ctx, ['claude']);
  assert.deepEqual([full.level, full.adds], ['full', null]);
});

test('without --level the level found counts: a standard machine is not grown to full, and doctor names the level in its fix', async () => {
  const m = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-level-proj-'));
  mkdirSync(join(dir, '.benchkeeper'));
  writeFileSync(join(dir, STATE), JSON.stringify({ schemaVersion: 1, setupVersion: '6.5.0', agents: ['claude'], skills: [] }));
  addProject(m.ctx, dir);
  const found = doctor(m.ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  const plugin = found.find((i) => i.check === 'plugin');
  assert.equal(plugin.fix, 'benchkeeper apply --level standard');
  assert.ok(!found.some((i) => i.check === 'rules'));
  const c = cli(m.ctx);
  assert.equal(await c.exec(['plan', '--agents', 'claude']), 0);
  assert.doesNotMatch(c.text(), /Claude Code rules|Claude settings/);
  assert.match(c.text(), /benchkeeper@benchkeeper/);
});

test('doctor below full expects the plugin only: missing global rules and tools are not drift', () => {
  const m = machine();
  m.s.installed = true;
  const found = doctor(m.ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' });
  assert.deepEqual(found.filter((i) => ['rules', 'settings', 'tools', 'pins', 'unexpected'].includes(i.check)), []);
});

function cli(ctx) {
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  return { exec: (args) => main(args, { out, ctx, input: Readable.from(['']) }), text: () => text };
}

test('the CLI: --level lite plans the plugin only, an unknown level exits 2, doctor names the level and what a higher one adds', async () => {
  const m = machine();
  const c = cli(m.ctx);
  assert.equal(await c.exec(['plan', '--agents', 'claude', '--level', 'lite']), 0);
  assert.match(c.text(), /Claude Code plugin benchkeeper@benchkeeper/);
  assert.doesNotMatch(c.text(), /rules|settings/);
  assert.equal(await c.exec(['plan', '--agents', 'claude', '--level', 'tiny']), 2);
  m.s.installed = true;
  const d = cli(m.ctx);
  await d.exec(['doctor', m.home, '--agents', 'claude']);
  assert.match(d.text(), /^level    lite: standard adds the local project block/);
});
