// The cases of plugins/benchkeeper/setup.test.sh against the global steps, with stub agent commands.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { contentDir } from '../src/content.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { inventory } from '../src/inventory.mjs';
import { MATT_POCOCK_COMMIT, PLUGINS, PONYTAIL_COMMIT, benchkeeperPlugin, globalPlan, globalSkills, newest, pin, pluginState } from '../src/steps/global.mjs';
import { verifyArgv, verifyPackage } from '../src/verify.mjs';

// Stubs: one foreign plugin, marketplace and MCP server per agent; installs and removals change what the lists show.
function machine({ failCodexInstall = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bk-global-'));
  const s = { claude: new Set(), codex: new Set(), removed: new Set(), calls: [], verified: [] };
  const run = (argv) => {
    const cmd = argv.join(' ');
    s.calls.push(cmd);
    const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
    if (cmd === 'claude --version') return ok('2.1.310 (Claude Code)');
    if (cmd === 'codex --version') return ok('codex-cli 0.163.0');
    if (cmd === 'claude plugin list --json') return ok(JSON.stringify([...(s.removed.has('c-pu') ? [] : [{ id: 'other@x', enabled: true, scope: 'user' }]), ...[...s.claude].map((id) => ({ id, enabled: true, scope: 'user' }))]));
    if (cmd === 'codex plugin list --json') return ok(JSON.stringify({ installed: [...(s.removed.has('x-pu') ? [] : [{ pluginId: 'other@x', enabled: true }]), ...[...s.codex].map((pluginId) => ({ pluginId, enabled: true }))] }));
    if (cmd === 'claude plugin marketplace list --json') return ok(JSON.stringify([{ name: 'ponytail' }, ...(s.removed.has('c-mr') ? [] : [{ name: 'old' }])]));
    if (cmd === 'codex plugin marketplace list --json') return ok(JSON.stringify({ marketplaces: [{ name: 'ponytail' }] }));
    if (cmd === 'codex mcp list --json') return ok(JSON.stringify(s.removed.has('x-mcp') ? [] : [{ name: 'extra' }]));
    if (cmd.startsWith('claude plugin install ')) { s.claude.add(argv[3]); return ok(); }
    if (cmd.startsWith('codex plugin add ')) { if (failCodexInstall) return { code: 1, stdout: '', stderr: 'network down' }; s.codex.add(argv[3]); return ok(); }
    if (cmd === 'claude plugin uninstall other@x') { s.removed.add('c-pu'); return ok(); }
    if (cmd === 'codex plugin remove other@x') { s.removed.add('x-pu'); return ok(); }
    if (cmd === 'claude plugin marketplace remove old') { s.removed.add('c-mr'); return ok(); }
    if (cmd === 'claude mcp remove --scope user extra') {
      const f = join(home, '.claude.json');
      writeFileSync(f, JSON.stringify({ mcpServers: {} }));
      return ok();
    }
    if (cmd === 'codex mcp remove extra') { s.removed.add('x-mcp'); return ok(); }
    if (cmd === 'npm view @devcontainers/cli time versions --json') return ok(JSON.stringify({ time: { created: '2020-01-01T00:00:00Z', '1.0.0': '2020-01-01T00:00:00Z', '9.9.9': '2999-01-01T00:00:00Z' }, versions: ['1.0.0', '9.9.9'] }));
    if (cmd === 'devcontainer --version') return ok(s.dc ?? '');
    if (cmd.startsWith('npm i -g --ignore-scripts @devcontainers/cli@')) { s.dc = argv[4].split('@').pop(); return ok(); }
    if (cmd === 'orca --version') return ok('1.0.0');
    if (argv[1]?.endsWith('verify.mjs')) { s.verified.push(argv[2]); return s.failVerify ? { code: 1, stdout: '', stderr: 'npm error signature mismatch' } : ok(); }
    if (argv[0] === 'npx') {
      const name = argv[argv.indexOf('-s') + 1];
      if (argv.includes('claude-code')) mkdirSync(join(home, '.claude/skills', name), { recursive: true });
      if (argv.includes('codex')) mkdirSync(join(home, '.agents/skills', name), { recursive: true });
      return ok();
    }
    if (argv[1] === 'plugin' && argv[2] === 'marketplace') return ok();
    return { code: 127, stdout: '', stderr: `stub: ${cmd}` };
  };
  mkdirSync(join(home, '.claude/rules'), { recursive: true });
  mkdirSync(join(home, '.claude/skills'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.agents/skills/old-skill'), { recursive: true });
  writeFileSync(join(home, '.claude/CLAUDE.md'), 'old rules');
  writeFileSync(join(home, '.claude/rules/10-other.md'), 'other');
  symlinkSync('/nowhere/skills/following-dev-workflow', join(home, '.claude/skills/following-dev-workflow'));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { extra: { command: 'x' } } }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'echo mine' }] }], SessionStart: [{ hooks: [{ command: 'ORCA_AGENT_HOOK_PORT=1 x' }] }], PreToolUse: [{ hooks: [{ command: 'ORCA_AGENT_HOOK_PORT=1 y' }] }, { hooks: [{ command: 'echo mine too' }] }], PostToolUse: [] }, model: 'opus', autoCompactWindow: 600000, modelSettings: { 'claude-opus-5-5': { autoCompactWindow: 800000, effortLevel: 'high' }, 'claude-fable-5-1': { autoCompactWindow: 'auto' } }, permissions: { ask: ['Bash(mine *)', 'Bash(gh pr merge *)'] } }, null, 2));
  mkdirSync(join(home, '.codex/rules'), { recursive: true });
  writeFileSync(join(home, '.codex/rules/benchkeeper.rules'), 'prefix_rule(pattern = ["gh", "pr", "merge"], decision = "prompt")\n');
  writeFileSync(join(home, '.codex/config.toml'), '[analytics]\nenabled = false\n');
  writeFileSync(join(home, '.codex/AGENTS.md'), 'my codex rules\n');
  const ctx = context({ home, run, appVersion: '6.0.0' });
  return { home, ctx, s, plan: (packs = ['matt-pocock']) => preview(globalPlan({ ctx, agents: ['claude', 'codex'], options: { packs } })) };
}
const all = (plan) => plan.map((c) => c.id);
const settings = (home) => JSON.parse(readFileSync(join(home, '.claude/settings.json'), 'utf8'));

test('plan changes nothing, leaves rule files of the user alone and lists the other items as destructive', () => {
  const m = machine();
  const plan = m.plan();
  assert.equal(readFileSync(join(m.home, '.claude/CLAUDE.md'), 'utf8'), 'old rules');
  assert.ok(!plan.some((c) => c.step.startsWith('rules:claude:other') || c.title.includes('CLAUDE.md') || c.title.includes('10-other')), 'rule files of the user are not part of the plan');
  assert.equal(plan.find((c) => c.step === 'settings:claude:tier-band').selected, false);
  const ask = plan.filter((c) => c.step.startsWith('ask:'));
  assert.deepEqual(ask.map((c) => c.step).sort(), ['ask:claude:Bash(gh pr merge *)', 'ask:claude:Bash(mine *)', 'ask:codex:benchkeeper.rules']);
  assert.ok(ask.every((c) => c.selected === false), 'ask rules are offered, not preselected');
  assert.ok(plan.every((c) => !c.title.includes('find-skills') || c.kind === 'command'));
});

test('a failed install does not stop the other steps', () => {
  const m = machine({ failCodexInstall: true });
  const run = apply(m.plan(), m.ctx, { select: all(m.plan()) });
  assert.equal(run.status, 'failed');
  assert.ok(existsSync(join(m.home, '.claude/rules/00-global.md')));
  assert.equal(settings(m.home).advisorModel, 'opus');
});

test('full apply: rules, removals, plugins, settings, tools; a second plan is empty', () => {
  const m = machine();
  const run = apply(m.plan(), m.ctx, { select: all(m.plan()) });
  assert.equal(run.status, 'done', JSON.stringify(run.entries.filter((e) => e.status !== 'done')));
  const rules = readFileSync(join(contentDir, 'rules/global.md'), 'utf8');
  assert.equal(readFileSync(join(m.home, '.claude/rules/00-global.md'), 'utf8'), rules);
  const codexRules = readFileSync(join(m.home, '.codex/AGENTS.md'), 'utf8');
  assert.ok(codexRules.startsWith('my codex rules\n') && codexRules.includes(rules.trim()), 'Codex rules merged as a block');
  assert.equal(existsSync(join(m.home, '.codex/rules/benchkeeper.rules')), false, 'old Codex ask rules removed');
  for (const p of ['.claude/skills/following-dev-workflow', '.agents/skills/old-skill']) assert.equal(existsSync(join(m.home, p)), false, p);
  for (const p of ['.claude/CLAUDE.md', '.claude/rules/10-other.md']) assert.equal(existsSync(join(m.home, p)), true, `${p} is the user's: kept`);
  const backup = run.entries.find((e) => e.path?.endsWith('.claude/skills/following-dev-workflow')).backup;
  assert.match(backup, new RegExp(`${run.id}/\\d+/\\.claude/skills/following-dev-workflow$`), 'backup keeps the path below HOME');
  assert.deepEqual([...m.s.claude].sort(), ['benchkeeper@benchkeeper', 'mattpocock-skills@claude-plugins-official', 'ponytail@ponytail']);
  assert.ok(m.s.removed.has('c-pu') && m.s.removed.has('c-mr') && m.s.removed.has('x-pu') && m.s.removed.has('x-mcp'));
  assert.deepEqual(JSON.parse(readFileSync(join(m.home, '.claude.json'), 'utf8')).mcpServers, {});
  const st = settings(m.home);
  assert.equal(st.hooks.Stop, undefined);
  assert.ok(st.hooks.SessionStart);
  assert.equal(st.hooks.PreToolUse.length, 1);
  assert.deepEqual(st.hooks.PostToolUse, []);
  assert.equal(st.model, 'opusplan');
  assert.equal(st.attribution.sessionUrl, false);
  assert.ok(st.cleanupPeriodDays === 14 && st.autoUpdatesChannel === 'stable' && st.env.DISABLE_FEEDBACK_COMMAND === '1' && st.env.CLAUDE_CODE_SUBAGENT_MODEL === 'sonnet');
  assert.equal(st.autoCompactWindow, 400000);
  assert.equal(st.pluginConfigs['benchkeeper@benchkeeper'].options.tierBand, true);
  assert.deepEqual(st.modelSettings, { 'claude-opus-5-5': { effortLevel: 'high' }, 'claude-sonnet-5-5': { effortLevel: 'high' } });
  assert.equal(st.permissions, undefined, 'ask rules offered and removed when selected');
  assert.equal(readFileSync(join(m.home, '.codex/config.toml'), 'utf8'), 'model_reasoning_effort = "high"\n[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n');
  assert.equal(m.s.dc, '1.0.0', 'host tool at the newest release older than 7 days');
  assert.ok(existsSync(join(m.home, '.claude/skills/find-skills')) && existsSync(join(m.home, '.agents/skills/orca-cli')));
  assert.equal(JSON.parse(readFileSync(join(m.home, '.config/ponytail/config.json'), 'utf8')).defaultMode, 'full');
  assert.deepEqual(m.plan().map((c) => c.title), []);
  const u = undo(run.id, m.ctx);
  assert.equal(readFileSync(join(m.home, '.claude/CLAUDE.md'), 'utf8'), 'old rules');
  assert.equal(readFileSync(join(m.home, '.codex/AGENTS.md'), 'utf8'), 'my codex rules\n');
  assert.equal(settings(m.home).model, 'opus');
  assert.ok(u.entries.some((e) => e.status === 'manual'), 'removals through agent commands are reported for manual reinstall');
});

test('Matt Pocock pack is optional', () => {
  const m = machine();
  assert.ok(!m.plan([]).some((c) => c.title.includes('mattpocock')));
  assert.ok(m.plan(['matt-pocock']).some((c) => c.title.includes('mattpocock')));
});

test('agents without plugins get the rules as a block and skill copies with bare names', () => {
  const m = machine();
  const plan = preview(globalPlan({ ctx: m.ctx, agents: ['gemini'], options: {} , devcontainerCli: null }));
  apply(plan, m.ctx, { select: all(plan) });
  const rules = readFileSync(join(m.home, '.gemini/GEMINI.md'), 'utf8');
  assert.match(rules, /Keep secrets out of output/);
  assert.ok(existsSync(join(m.home, '.gemini/skills/workflow/SKILL.md')));
});

test('newest picks the highest release older than 7 days', () => {
  const run = () => ({ code: 0, stdout: JSON.stringify({ time: { '1.2.0': '2026-01-01T00:00:00Z', '1.10.0': '2026-02-01T00:00:00Z', '2.0.0': '2026-10-21T00:00:00Z', '2.0.0-beta': '2026-01-01T00:00:00Z' }, versions: ['1.2.0', '1.10.0', '2.0.0', '2.0.0-beta'] }) });
  assert.equal(newest({ run }, 'x', Date.parse('2026-10-22')), '1.10.0');
  assert.equal(newest({ run: () => ({ code: 1 }) }, 'x'), null);
  let calls = 0;
  const ctx = { run: () => { calls++; return run(); } };
  newest(ctx, 'x'); newest(ctx, 'x');
  assert.equal(calls, 1, 'one registry request per package and context');
  // A failed answer is asked again after a minute.
  let fails = 0;
  const off = { run: () => { fails++; return { code: 1 }; } };
  newest(off, 'x', 0); newest(off, 'x', 30e3); newest(off, 'x', 61e3);
  assert.equal(fails, 2);
});

test('plugin state comes from the agents\' files; the CLI answers only when they cannot be read', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-plugins-'));
  const calls = [];
  const ctx = context({ home, run: (argv) => { calls.push(argv.join(' ')); return { code: 0, stdout: argv[0] === 'claude' ? '[{"id":"cli@x","enabled":true,"scope":"user"}]' : '{"installed":[{"pluginId":"cli@x","enabled":true}]}', stderr: '' }; } });
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  mkdirSync(join(home, '.codex/plugins/cache/ponytail/ponytail/5.2.0'), { recursive: true });
  mkdirSync(join(home, '.codex/plugins/cache/ponytail/ponytail/5.10.0'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'ponytail@ponytail': [{ scope: 'user', version: '5.2.0' }], 'off@x': [{ scope: 'user', version: '1.0.0' }], 'proj@x': [{ scope: 'project', version: '1.0.0', projectPath: '/p' }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ ponytail: { source: { ref: 'v5.2.0' } }, benchkeeper: {} }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true, 'off@x': false } }));
  writeFileSync(join(home, '.codex/config.toml'), '[marketplaces.ponytail]\nsource = "x"\nref = "v5.3.2"\n\n[plugins."ponytail@ponytail"]\nenabled = true\n');
  assert.deepEqual(pluginState(ctx, 'claude'), { listed: [{ id: 'ponytail@ponytail', version: '5.2.0', enabled: true }, { id: 'off@x', version: '1.0.0', enabled: false }], markets: ['ponytail', 'benchkeeper'], refs: { ponytail: 'v5.2.0', benchkeeper: undefined } });
  assert.deepEqual(pluginState(ctx, 'codex'), { listed: [{ id: 'ponytail@ponytail', version: '5.10.0', enabled: true, missing: false }], markets: ['ponytail'], refs: { ponytail: 'v5.3.2' } });
  assert.deepEqual(calls, []);
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), '{broken');
  writeFileSync(join(home, '.codex/config.toml'), 'model = "x"\n');
  assert.equal(pluginState(ctx, 'claude').listed[0].id, 'cli@x');
  assert.equal(pluginState(ctx, 'codex').listed[0].id, 'cli@x');
  assert.ok(calls.includes('claude plugin list --json') && calls.includes('codex plugin list --json'));
});

test('a plugin older than its pin gets update steps; at or above the pin it is left alone', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-pins-'));
  const ctx = context({ home, appVersion: '6.0.0', run: (argv) => ({ code: argv[0] === 'npm' ? 1 : 0, stdout: '', stderr: '' }) });
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  mkdirSync(join(home, '.codex/plugins/cache/ponytail/ponytail/5.2.0'), { recursive: true });
  mkdirSync(join(home, '.codex/plugins/cache/benchkeeper/benchkeeper/6.0.0'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'ponytail@ponytail': [{ scope: 'user', version: '5.2.0' }], 'benchkeeper@benchkeeper': [{ scope: 'user', version: '5.4.0' }], 'mattpocock-skills@claude-plugins-official': [{ scope: 'user', version: '1.2.0' }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ ponytail: { source: { repo: 'DietrichGebert/ponytail' } }, benchkeeper: { source: { ref: 'stable' } } }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true, 'benchkeeper@benchkeeper': true, 'mattpocock-skills@claude-plugins-official': true } }));
  writeFileSync(join(home, '.codex/config.toml'), '[marketplaces.ponytail]\nsource = "x"\nref = "v5.3.2"\n\n[plugins."ponytail@ponytail"]\nenabled = true\n\n[plugins."benchkeeper@benchkeeper"]\nenabled = true\n');
  const steps = (id) => globalPlan({ ctx, agents: ['claude', 'codex'] }).filter((c) => c.step === id);
  const argv = (id) => steps(id).map((c) => c.argv.join(' '));
  // Refresh and update; never a marketplace removal (it deletes the plugin's options and data).
  assert.deepEqual(argv('plugin:claude:ponytail@ponytail'), ['claude plugin marketplace update ponytail', 'claude plugin update ponytail@ponytail']);
  assert.ok(steps('plugin:claude:ponytail@ponytail').every((c) => c.outdated && c.title === 'Claude Code plugin ponytail@ponytail 5.2.0 to 5.3.2'));
  assert.deepEqual(argv('plugin:claude:benchkeeper@benchkeeper'), ['claude plugin marketplace update benchkeeper', 'claude plugin update benchkeeper@benchkeeper']);
  assert.deepEqual(argv('plugin:codex:ponytail@ponytail'), ['codex plugin marketplace upgrade ponytail', 'codex plugin add ponytail@ponytail']);
  assert.deepEqual(argv('plugin:codex:benchkeeper@benchkeeper'), []);
  // An installed pack plugin is checked without its pack chosen.
  assert.deepEqual(argv('plugin:claude:mattpocock-skills@claude-plugins-official'), ['claude plugin marketplace update claude-plugins-official', 'claude plugin update mattpocock-skills@claude-plugins-official']);
  // No registered project uses its pack any more: removal offered, not preselected; a project that uses it keeps it.
  const mp = (packsInUse, packs) => globalPlan({ ctx, agents: ['claude'], options: { packs, packsInUse } }).filter((c) => c.step === 'plugin:claude:mattpocock-skills@claude-plugins-official');
  const [rm] = mp(['frontend']);
  assert.ok(rm.destructive && rm.argv.join(' ') === 'claude plugin uninstall mattpocock-skills@claude-plugins-official' && rm.undoArgv.join(' ') === 'claude plugin install mattpocock-skills@claude-plugins-official');
  assert.equal(preview([rm])[0].selected, false);
  assert.ok(!mp(['matt-pocock'])[0].destructive && !mp(['frontend'], ['matt-pocock'])[0].destructive && !mp(null)[0].destructive);
  const inv = inventory(ctx, ['claude', 'codex']);
  assert.equal(inv.find((i) => i.step === 'plugin:claude:ponytail@ponytail').state, 'outdated');
  // A version that is not x.y.z (a commit) cannot be compared and counts as current.
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'ponytail@ponytail': [{ scope: 'user', version: '5.2.0' }], 'benchkeeper@benchkeeper': [{ scope: 'user', version: '5.4.0' }], 'mattpocock-skills@claude-plugins-official': [{ scope: 'user', version: '0a1b2c3d4e5f' }] } }));
  assert.deepEqual(argv('plugin:claude:mattpocock-skills@claude-plugins-official'), []);
  assert.equal(inv.find((i) => i.step === 'plugin:codex:benchkeeper@benchkeeper').state, 'current');
  assert.deepEqual(pin(PLUGINS.claude[0], '6.0.0'), { ref: 'stable', version: '6.0.0' });
  // A marketplace added at another ref: a manual step with the commands, never applied.
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ ponytail: { source: { ref: 'v5.2.0' } }, benchkeeper: { source: { ref: 'stable' } } }));
  const [stuck] = steps('plugin:claude:ponytail@ponytail');
  assert.equal(steps('plugin:claude:ponytail@ponytail').length, 1);
  assert.ok(stuck.title.endsWith(': by hand') && /at v5\.2\.0, not v5\.3\.2.*marketplace remove ponytail/.test(stuck.error));
  assert.equal(preview([stuck])[0].selected, false);
  assert.equal(apply([stuck], ctx, { select: [stuck.id] }).entries.length, 0);
  // Turned off in Claude Code: a settings write turns it on; in Codex a step by hand. Codex files gone: install again.
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': false, 'benchkeeper@benchkeeper': true } }));
  const [on] = steps('plugin:claude:ponytail@ponytail');
  assert.ok(on.kind === 'write' && on.title.endsWith('turn on') && JSON.parse(on.edit('{}')).enabledPlugins['ponytail@ponytail'] === true);
  writeFileSync(join(home, '.codex/config.toml'), '[plugins."ponytail@ponytail"]\nenabled = false\n\n[plugins."benchkeeper@benchkeeper"]\nenabled = true\n');
  assert.match(steps('plugin:codex:ponytail@ponytail')[0].error, /turned off/);
  assert.deepEqual(argv('plugin:codex:benchkeeper@benchkeeper'), []);
  rmSync(join(home, '.codex/plugins/cache/benchkeeper'), { recursive: true });
  assert.deepEqual(argv('plugin:codex:benchkeeper@benchkeeper'), ['codex plugin add benchkeeper@benchkeeper']);
});

test('the BenchKeeper plugin behind the app is updated by apply; the next plan is empty', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-self-'));
  const installedFile = join(home, '.claude/plugins/installed_plugins.json');
  const installAt = (version) => writeFileSync(installedFile, JSON.stringify({ version: 2, plugins: { 'benchkeeper@benchkeeper': [{ scope: 'user', version }] } }));
  const calls = [];
  const run = (argv) => { calls.push(argv.join(' ')); if (argv.join(' ') === 'claude plugin update benchkeeper@benchkeeper') installAt('6.5.0'); return { code: 0, stdout: '', stderr: '' }; };
  const ctx = context({ home, appVersion: '6.5.0', run });
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ benchkeeper: { source: { ref: 'stable' } } }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'benchkeeper@benchkeeper': true } }));
  const plan = () => globalPlan({ ctx, agents: ['claude'] }).filter((c) => c.step === 'plugin:claude:benchkeeper@benchkeeper');
  installAt('6.0.0');
  assert.deepEqual(benchkeeperPlugin(ctx, 'claude'), { installed: '6.0.0', available: '6.5.0' });
  assert.deepEqual(plan().map((c) => c.argv.join(' ')), ['claude plugin marketplace update benchkeeper', 'claude plugin update benchkeeper@benchkeeper']);
  assert.equal(apply(plan(), ctx).entries.length, 2);
  assert.deepEqual(calls.slice(-2), ['claude plugin marketplace update benchkeeper', 'claude plugin update benchkeeper@benchkeeper']);
  assert.deepEqual(benchkeeperPlugin(ctx, 'claude'), { installed: '6.5.0', available: '6.5.0' });
  assert.deepEqual(plan(), []);
  writeFileSync(installedFile, JSON.stringify({ version: 2, plugins: {} }));
  assert.equal(benchkeeperPlugin(ctx, 'claude').installed, null);
  // Codex reads the version from its plugin cache; the update step is an upgrade and an add.
  const cache = join(home, '.codex/plugins/cache/benchkeeper/benchkeeper');
  const codexRun = (argv) => { if (argv.join(' ') === 'codex plugin add benchkeeper@benchkeeper') mkdirSync(join(cache, '6.5.0'), { recursive: true }); return { code: 0, stdout: '', stderr: '' }; };
  const cctx = context({ home, appVersion: '6.5.0', run: codexRun });
  mkdirSync(join(cache, '6.0.0'), { recursive: true });
  writeFileSync(join(home, '.codex/config.toml'), '[marketplaces.benchkeeper]\nsource = "x"\nref = "stable"\n\n[plugins."benchkeeper@benchkeeper"]\nenabled = true\n');
  const cplan = () => globalPlan({ ctx: cctx, agents: ['codex'] }).filter((c) => c.step === 'plugin:codex:benchkeeper@benchkeeper');
  assert.deepEqual(cplan().map((c) => c.argv.join(' ')), ['codex plugin marketplace upgrade benchkeeper', 'codex plugin add benchkeeper@benchkeeper']);
  apply(cplan(), cctx);
  assert.deepEqual(benchkeeperPlugin(cctx, 'codex'), { installed: '6.5.0', available: '6.5.0' });
  assert.deepEqual(cplan(), []);
});

test('globalSkills: the global skill folder plus turned-on plugins, turned-off ones not', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-gskills-'));
  const ctx = context({ home, run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const skill = (d) => { mkdirSync(join(home, d), { recursive: true }); writeFileSync(join(home, d, 'SKILL.md'), 'x\n'); };
  skill('.claude/skills/mine');
  for (const n of ['a', 'b']) skill(`.claude/plugins/cache/m/on/1.0.0/skills/${n}`);
  skill('.claude/plugins/cache/m/off/1.0.0/skills/c');
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'on@m': [{ scope: 'user', version: '1.0.0' }], 'off@m': [{ scope: 'user', version: '1.0.0' }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), '{"m":{}}');
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'on@m': true, 'off@m': false } }));
  assert.equal(globalSkills(ctx, 'claude'), 3);
});

test('pins: Codex adds a marketplace at the pinned commit, Claude Code at the tag; both forms count as the pin', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-commit-'));
  const ctx = context({ home, appVersion: '6.0.0', run: () => ({ code: 1, stdout: '', stderr: '' }) });
  const add = (a, id, options) => globalPlan({ ctx, agents: [a], options }).find((c) => c.step === `plugin:${a}:${id}` && c.argv[3] === 'add')?.argv[4];
  assert.equal(add('claude', 'ponytail@ponytail'), 'DietrichGebert/ponytail#v5.3.2');
  assert.equal(add('codex', 'ponytail@ponytail'), `DietrichGebert/ponytail@${PONYTAIL_COMMIT}`);
  assert.equal(add('codex', 'mattpocock-skills@mattpocock', { packs: ['matt-pocock'] }), `mattpocock/skills@${MATT_POCOCK_COMMIT}`);
  assert.equal(add('codex', 'benchkeeper@benchkeeper'), 'ESchuderer/BenchKeeper@stable');
  assert.deepEqual(pin(PLUGINS.codex[1], '6.0.0'), { ref: 'v5.3.2', commit: PONYTAIL_COMMIT, version: '5.3.2' });
  // A marketplace recorded at the commit or at the tag is the pin: the plan installs, it does not ask for a manual move.
  for (const ref of [PONYTAIL_COMMIT, 'v5.3.2']) {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex/config.toml'), `[marketplaces.ponytail]\nsource = "x"\nref = "${ref}"\n`);
    const steps = globalPlan({ ctx, agents: ['codex'] }).filter((c) => c.step === 'plugin:codex:ponytail@ponytail');
    assert.deepEqual(steps.map((c) => c.argv.join(' ')), ['codex plugin add ponytail@ponytail'], ref);
  }
  writeFileSync(join(home, '.codex/config.toml'), '[marketplaces.ponytail]\nsource = "x"\nref = "v5.2.0"\n');
  assert.match(globalPlan({ ctx, agents: ['codex'] }).find((c) => c.step === 'plugin:codex:ponytail@ponytail').error, new RegExp(`at v5\\.2\\.0, not ${PONYTAIL_COMMIT}`));
});

test('pins: an installed Claude Code plugin at the pin version from another commit is flagged, never reinstalled', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-sha-'));
  const ctx = context({ home, appVersion: '6.0.0', run: () => ({ code: 1, stdout: '', stderr: '' }) });
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ ponytail: { source: { ref: 'v5.3.2' } } }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ponytail@ponytail': true } }));
  const installed = (entry) => writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'ponytail@ponytail': [{ scope: 'user', version: '5.3.2', ...entry }] } }));
  const steps = () => globalPlan({ ctx, agents: ['claude'] }).filter((c) => c.step === 'plugin:claude:ponytail@ponytail');
  installed({ gitCommitSha: PONYTAIL_COMMIT });
  assert.deepEqual(steps(), []);
  installed({});
  assert.deepEqual(steps(), [], 'no recorded commit: nothing to compare');
  installed({ gitCommitSha: PONYTAIL_COMMIT.slice(0, 12) });
  assert.deepEqual(steps(), [], 'an abbreviated commit is the same commit');
  installed({ gitCommitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
  const [flag] = steps();
  assert.equal(steps().length, 1);
  assert.match(flag.error, /installed from commit deadbeefdead, the pin for 5\.3\.2 is 16352ac229eb/);
  assert.equal(preview([flag])[0].selected, false);
  assert.equal(apply([flag], ctx, { select: [flag.id] }).entries.length, 0);
});

test('names from agent files that start with a dash or hold a path are skipped', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-names-'));
  const ctx = context({ home, run: (argv) => ({ code: argv[0] === 'npm' || argv[0] === 'orca' ? 1 : 0, stdout: '', stderr: '' }) });
  mkdirSync(join(home, '.claude/plugins'), { recursive: true });
  writeFileSync(join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: {
    'ok@x': [{ scope: 'user', version: '1.0.0' }], '--force@x': [{ scope: 'user', version: '1.0.0' }], '../up@x': [{ scope: 'user', version: '1.0.0' }] } }));
  writeFileSync(join(home, '.claude/plugins/known_marketplaces.json'), JSON.stringify({ fine: {}, '--all': {}, 'a/b': {} }));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'ok@x': true, '--force@x': true, '../up@x': true } }));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { good: {}, '-bad': {} } }));
  const argvs = globalPlan({ ctx, agents: ['claude'] }).filter((c) => c.destructive && c.kind === 'command').map((c) => c.argv.join(' '));
  assert.deepEqual(argvs.sort(), ['claude mcp remove --scope user good', 'claude plugin marketplace remove fine', 'claude plugin uninstall ok@x']);
});

test('signature check: the host tool and the skills CLI run only after npm audit signatures passed, once per run', () => {
  const m = machine();
  const tools = () => m.plan().filter((c) => c.step.startsWith('tools:'));
  const dc = tools().find((c) => c.step === 'tools:devcontainer');
  assert.deepEqual(dc.verify, verifyArgv('@devcontainers/cli@1.0.0'));
  assert.deepEqual(tools().filter((c) => c.step.startsWith('tools:skill:')).map((c) => c.verify), Array(3).fill(verifyArgv('skills@1.7.2')));
  const run = apply(tools(), m.ctx, { select: all(tools()) });
  assert.equal(run.status, 'done');
  assert.deepEqual(m.s.verified, ['@devcontainers/cli@1.0.0', 'skills@1.7.2']);
  assert.ok(m.s.calls.findIndex((c) => c.startsWith('npm i -g')) > m.s.calls.findIndex((c) => c.includes('verify.mjs')));
  // A failed check: nothing is installed, the entry says why, the run reports failure.
  const bad = machine();
  bad.s.failVerify = true;
  const failed = apply(bad.plan().filter((c) => c.step.startsWith('tools:')), bad.ctx, { select: all(bad.plan().filter((c) => c.step.startsWith('tools:'))) });
  assert.equal(failed.status, 'failed');
  assert.ok(failed.entries.every((e) => e.status === 'failed' && !e.touched && /signature check failed: npm error signature mismatch/.test(e.error)));
  assert.ok(!bad.s.calls.some((c) => c.startsWith('npm i -g') || c.startsWith('npx')));
  assert.equal(bad.s.dc, undefined);
});

test('verifyPackage takes only an exact name@version and reports a package it cannot fetch', () => {
  for (const spec of ['', '--registry=x', 'skills', 'skills@latest', 'skills@^1.7.2', 'a b@1.0.0', '../x@1.0.0']) assert.equal(verifyPackage(spec).code, 2, spec);
  assert.notEqual(verifyPackage('skills@1.7.2-rc.1', { PATH: '/nonexistent' }).code, 2, 'a prerelease is exact too');
  const r = verifyPackage('skills@1.7.2', { PATH: '/nonexistent' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /could not fetch skills@1\.7\.2 to verify it/);
});
