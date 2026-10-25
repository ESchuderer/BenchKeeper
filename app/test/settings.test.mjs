import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { removeTable, removeToml, setToml } from '../src/merge.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { COUPLINGS, agentSettings, bundleEdits, describeKey, listSettings, maskSecrets, notes, readSettings, redact, schemaKeys, settingsAgents, settingsChanges } from '../src/settings.mjs';

const SECRET = 'sk-value-not-for-output';
const docs = JSON.parse(readFileSync(new URL('./fixtures/settings-docs.json', import.meta.url), 'utf8'));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const run = (argv) => ({ code: argv[0] === 'npm' ? 1 : 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' });

function machine() {
  const home = mkdtempSync(join(tmpdir(), 'bk-set-'));
  const managed = mkdtempSync(join(tmpdir(), 'bk-managed-'));
  return Object.assign(context({ home, run }), { managedRoot: managed });
}
const write = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const claudeUser = (ctx) => join(ctx.home, '.claude/settings.json');
const codexUser = (ctx) => join(ctx.home, '.codex/config.toml');
// Plan, apply and return the run.
const change = (ctx, agent, opts) => apply(preview(settingsChanges(ctx, agent, opts)), ctx, { scope: 'global' });

test('pins: every catalog key is in a pinned schema or the reference, every coupling quote is in the pinned doc page', () => {
  for (const id of settingsAgents) {
    for (const s of agentSettings(id).settings) assert.ok(describeKey(id, s.key), `${id} ${s.key}`);
  }
  // Listed keys come from the agents' own key tables: the reference index (Claude Code) or the schema (Codex).
  const reference = JSON.parse(readFileSync(new URL('../src/settings/claude-settings-keys.json', import.meta.url), 'utf8')).map((r) => r.key);
  for (const s of agentSettings('claude').settings.filter((x) => !x.key.startsWith('env.'))) assert.ok(reference.includes(s.key), `${s.key} is not in the settings reference`);
  const codex = new Set(schemaKeys('codex'));
  for (const s of agentSettings('codex').settings) assert.ok(codex.has(s.key), `${s.key} is not in the Codex schema`);
  for (const r of COUPLINGS.rules) {
    const page = norm((docs.pages[r.source.split('#')[0]] ?? []).join(' '));
    assert.ok(page, `${r.id}: no pinned page for ${r.source}`);
    for (const q of [r.quote].flat()) assert.ok(page.includes(norm(q)), `${r.id}: the pinned page no longer holds: ${q}`);
    assert.ok(/^https:\/\//.test(r.source), r.id);
  }
  // Every catalog entry has a sentence, a default and a source.
  for (const id of settingsAgents) for (const s of agentSettings(id).settings) assert.ok(s.sentence && s.default && /^https:\/\//.test(s.source), s.key);
});

test('pinned schemas: advanced mode lists every schema leaf, none is left undescribed', () => {
  for (const id of settingsAgents) for (const k of schemaKeys(id)) assert.ok(describeKey(id, k), `${id} ${k}`);
  const ctx = machine();
  const list = listSettings(ctx, 'codex', { advanced: true });
  assert.ok(list.advanced.some((a) => a.key === 'sandbox_workspace_write.network_access'));
  assert.ok(listSettings(ctx, 'claude', { advanced: true }).advanced.some((a) => a.key === 'modelSettings'), 'a reference key the schema lacks');
});

test('Claude Code: set and remove keep other keys and their order; unknown keys survive; secrets stay out of the list', () => {
  const ctx = machine();
  write(claudeUser(ctx), JSON.stringify({ zzUnknown: { a: 1 }, env: { MY_API_TOKEN: SECRET, KEEP: 'x' }, model: 'opus' }, null, 2));
  change(ctx, 'claude', { edits: { 'permissions.defaultMode': 'plan', cleanupPeriodDays: 45 } });
  let data = JSON.parse(readFileSync(claudeUser(ctx), 'utf8'));
  assert.deepEqual(Object.keys(data), ['zzUnknown', 'env', 'model', 'permissions', 'cleanupPeriodDays']);
  assert.deepEqual(data.zzUnknown, { a: 1 });
  change(ctx, 'claude', { edits: { 'permissions.defaultMode': null, model: null } });
  data = JSON.parse(readFileSync(claudeUser(ctx), 'utf8'));
  assert.deepEqual(Object.keys(data), ['zzUnknown', 'env', 'cleanupPeriodDays'], 'an emptied permissions object is pruned');
  const list = listSettings(ctx, 'claude', { advanced: true });
  assert.deepEqual(list.outside.map((x) => x.key), ['zzUnknown']);
  assert.ok(!JSON.stringify(list).includes(SECRET));
  assert.equal(list.env.find((e) => e.name === 'MY_API_TOKEN').value, '(set)');
  assert.equal(list.env.find((e) => e.name === 'KEEP').value, 'x');
});

test('a plan is a diff that never shows a secret, and undo restores the file', () => {
  const ctx = machine();
  write(claudeUser(ctx), `{\n  "env": {\n    "MY_API_TOKEN": "${SECRET}"\n  }\n}\n`);
  const before = readFileSync(claudeUser(ctx), 'utf8');
  const plan = preview(settingsChanges(ctx, 'claude', { edits: { 'env.DISABLE_ERROR_REPORTING': true } }));
  assert.equal(plan.length, 1);
  assert.match(plan[0].diff, /DISABLE_ERROR_REPORTING/);
  assert.ok(plan[0].diff.includes(SECRET), 'the raw diff holds it (the server and CLI redact it)');
  assert.ok(!redact(plan[0].diff).includes(SECRET));
  assert.match(redact('MY_PASSWORD = "x"\n{"A_KEY":"y"}\nnotes: fine'), /^MY_PASSWORD = "\(set\)"\n\{"A_KEY":"\(set\)"\}\nnotes: fine$/);
  assert.deepEqual(maskSecrets({ env: { API_KEY: 'x', PATH: 'y' }, headers: { Authorization: 'z' } }), { env: { API_KEY: '(set)', PATH: 'y' }, headers: { Authorization: '(set)' } });
  const r = apply(plan, ctx, { scope: 'global' });
  assert.equal(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).env.DISABLE_ERROR_REPORTING, '1');
  assert.equal(undo(r.id, ctx).status, 'done');
  assert.equal(readFileSync(claudeUser(ctx), 'utf8'), before);
});

test('environment switches are set or removed, never 0 or false', () => {
  const ctx = machine();
  for (const bad of ['0', false, 'false', 0]) assert.throws(() => settingsChanges(ctx, 'claude', { edits: { 'env.DISABLE_TELEMETRY': bad } }), /never 0 or false/);
  change(ctx, 'claude', { edits: { 'env.DISABLE_TELEMETRY': true } });
  assert.deepEqual(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')), { env: { DISABLE_TELEMETRY: '1' } });
  change(ctx, 'claude', { edits: { 'env.DISABLE_TELEMETRY': null } });
  assert.deepEqual(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')), {});
});

test('an invalid value is refused before any write', () => {
  const ctx = machine();
  write(claudeUser(ctx), '{ "model": "opus" }\n');
  const text = readFileSync(claudeUser(ctx), 'utf8');
  for (const edits of [{ 'permissions.defaultMode': 'yolo' }, { cleanupPeriodDays: 0 }, { cleanupPeriodDays: '30' }, { 'sandbox.enabled': 'yes' }, { attribution: { commit: 1 } }, { theme: 'neon' }, { statusLine: 'x' }, { notAKey: 1 }]) {
    assert.throws(() => settingsChanges(ctx, 'claude', { edits }), (e) => e.message.length > 0, JSON.stringify(edits));
  }
  assert.throws(() => settingsChanges(ctx, 'claude', { layer: 'managed', edits: { model: 'x' } }), /read-only/);
  assert.throws(() => settingsChanges(ctx, 'claude', { layer: 'project', edits: { model: 'x' } }), /project folder/);
  assert.equal(readFileSync(claudeUser(ctx), 'utf8'), text);
});

test('Claude Code reads strict JSON: a file with a comment is not edited and Doctor says so', () => {
  const ctx = machine();
  write(claudeUser(ctx), '{\n  // mine\n  "model": "opus"\n}\n');
  const text = readFileSync(claudeUser(ctx), 'utf8');
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { cleanupPeriodDays: 40 } }), /cannot be read/);
  const found = doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings');
  assert.equal(found.length, 1);
  assert.equal(found[0].level, 'error');
  assert.equal(readFileSync(claudeUser(ctx), 'utf8'), text);
});

test('a value another shape sits in refuses the edit instead of corrupting the file', () => {
  const ctx = machine();
  write(claudeUser(ctx), '{ "permissions": "oops" }\n');
  const plan = preview(settingsChanges(ctx, 'claude', { edits: { 'permissions.defaultMode': 'plan' } }));
  assert.match(plan[0].error, /edit it by hand|another shape/);
  assert.equal(plan[0].selected, false);
});

test('auto and bypassPermissions are not written to a project or local file; the user file takes them', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  for (const layer of ['project', 'local']) {
    assert.throws(() => settingsChanges(ctx, 'claude', { layer, dir, edits: { 'permissions.defaultMode': 'auto' } }), /silently ignored/);
    assert.throws(() => settingsChanges(ctx, 'claude', { layer, dir, edits: { 'permissions.defaultMode': 'bypassPermissions' } }), /silently ignored/);
    assert.equal(settingsChanges(ctx, 'claude', { layer, dir, edits: { 'permissions.defaultMode': 'plan' } }).length, 1);
  }
  assert.equal(settingsChanges(ctx, 'claude', { edits: { 'permissions.defaultMode': 'auto' } }).length, 1);
  assert.ok(!existsSync(join(dir, '.claude')));
});

test('layers: local over project over user, managed over all and never written', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(claudeUser(ctx), '{ "model": "user", "theme": "dark" }');
  write(join(dir, '.claude/settings.json'), '{ "model": "project" }');
  write(join(dir, '.claude/settings.local.json'), '{ "model": "local" }');
  write(`${ctx.managedRoot}/etc/claude-code/managed-settings.json`, '{ "theme": "light" }');
  const list = listSettings(ctx, 'claude', { dir });
  const model = list.settings.find((s) => s.key === 'model'), theme = list.settings.find((s) => s.key === 'theme');
  assert.deepEqual([model.value, model.layer], ['local', 'local']);
  assert.deepEqual(model.sets.map((x) => x.layer), ['local', 'project', 'user']);
  assert.deepEqual([theme.value, theme.layer], ['light', 'managed']);
  assert.ok(list.layers.find((l) => l.layer === 'managed').readOnly);
  const r = change({ ...ctx, roots: [dir, ctx.home] }, 'claude', { layer: 'project', dir, edits: { model: 'p2' } });
  assert.equal(r.status, 'done');
  assert.equal(JSON.parse(readFileSync(join(dir, '.claude/settings.json'), 'utf8')).model, 'p2');
});

test('the advisor with a flag-fetching switch: a note on both keys and a Doctor warning', () => {
  const ctx = machine();
  write(claudeUser(ctx), JSON.stringify({ advisorModel: 'opus', env: { DISABLE_TELEMETRY: '1' } }));
  const list = listSettings(ctx, 'claude');
  for (const key of ['advisorModel', 'env.DISABLE_TELEMETRY']) {
    assert.ok(list.settings.find((s) => s.key === key).notes.some((n) => n.id === 'advisor-needs-flags'), key);
  }
  const found = doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings');
  assert.ok(found.some((i) => i.level === 'warning' && /advisor stays off/.test(i.message)));
  // The same pair set through the process environment.
  write(claudeUser(ctx), JSON.stringify({ advisorModel: 'opus' }));
  assert.ok(!doctor(ctx, { agents: ['claude'], env: {} }).some((i) => /advisor stays off/.test(i.message)));
  assert.ok(doctor(ctx, { agents: ['claude'], env: { DO_NOT_TRACK: '1' } }).some((i) => /advisor stays off/.test(i.message)));
  assert.ok(!doctor(ctx, { agents: ['claude'], env: { DO_NOT_TRACK: '0' } }).some((i) => /advisor stays off/.test(i.message)), 'DO_NOT_TRACK is a plain boolean');
});

test('Doctor: the other pairs, no-op keys, retention, switches that are not booleans', () => {
  const ctx = machine();
  const messages = (settings, env = {}) => { write(claudeUser(ctx), JSON.stringify(settings)); return doctor(ctx, { agents: ['claude'], env }).filter((i) => i.check === 'agent-settings').map((i) => i.message); };
  assert.match(messages({ remoteControlAtStartup: true, env: { DISABLE_GROWTHBOOK: '1' } })[0], /Remote Control is unavailable/);
  assert.deepEqual(messages({ remoteControlAtStartup: true, env: { DISABLE_TELEMETRY: '1' } }), [], 'Remote Control stays available with only DISABLE_TELEMETRY');
  assert.match(messages({ autoUpdatesChannel: 'stable', env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })[0], /stops auto-updates/);
  assert.match(messages({ advisorModel: 'claude-sonnet-5-5', model: 'claude-opus-5-5' })[0], /ranks below the main model/);
  assert.deepEqual(messages({ advisorModel: 'claude-opus-5-5', model: 'claude-sonnet-5-5' }), []);
  assert.deepEqual(messages({ advisorModel: 'sonnet', model: 'claude-opus-5-5' }), [], 'an alias resolves to the current default: not checked');
  assert.match(messages({ effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } })[0], /likely a no-op/);
  assert.deepEqual(messages({ effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'high' } } }), [], 'the same level on both is what the setup writes');
  assert.deepEqual(messages({ effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { maxEffortLevel: 'xhigh' } } }), []);
  assert.deepEqual(messages({ effortLevel: 'high' }), []);
  assert.match(messages({ includeCoAuthoredBy: false, attribution: false })[0], /includeCoAuthoredBy is deprecated/);
  assert.match(messages({ cleanupPeriodDays: 7 })[0], /below 30/);
  assert.deepEqual(messages({ cleanupPeriodDays: 14 }), [], 'the value BenchKeeper setup writes is on purpose');
  assert.deepEqual(messages({ cleanupPeriodDays: 30 }), []);
  for (const v of ['0', 'false']) assert.match(messages({ env: { DISABLE_TELEMETRY: v } }).join(), /DISABLE_TELEMETRY counts as set even with 0 or false/);
  assert.deepEqual(messages({ env: { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '0' } }), [], 'DO_NOT_TRACK 0 is off, a plain boolean');
  assert.ok(!JSON.stringify(messages({ env: { MY_TOKEN: SECRET, DISABLE_TELEMETRY: '0' } })).includes(SECRET));
});

test('Doctor reads the project and local layers for project checks only', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(join(dir, '.claude/settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'auto' }, env: { OTEL_METRICS_EXPORTER: 'otlp' } }));
  write(join(dir, 'AGENTS.md'), 'x\n');
  assert.deepEqual(doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings'), []);
  const found = doctor(ctx, { agents: ['claude'], env: {}, dir }).filter((i) => i.check === 'agent-settings').map((i) => i.message);
  assert.equal(found.length, 2);
  assert.ok(found.some((m) => /silently ignored/.test(m)) && found.some((m) => /OpenTelemetry export variables/.test(m)));
});

test('Codex: a TOML edit keeps comments, key order and keys the app does not know', () => {
  const ctx = machine();
  const text = '# my config\nmodel = "gpt-x" # keep this\nunknown_key = [1, 2]\n\n# analytics\n[analytics]\nenabled = true # on\n\n[tui]\nnotifications = true\n\n[projects."/gone/worktree"]\ntrust_level = "trusted"\n';
  write(codexUser(ctx), text);
  change(ctx, 'codex', { edits: { 'analytics.enabled': false, approval_policy: 'on-request', sandbox_mode: 'workspace-write', notify: ['say', 'done'] } });
  const out = readFileSync(codexUser(ctx), 'utf8');
  assert.equal(out, '# my config\nmodel = "gpt-x" # keep this\nunknown_key = [1, 2]\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nnotify = ["say", "done"]\n\n# analytics\n[analytics]\nenabled = false # on\n\n[tui]\nnotifications = true\n\n[projects."/gone/worktree"]\ntrust_level = "trusted"\n');
  change(ctx, 'codex', { edits: { model: 'gpt-y' } });
  assert.ok(readFileSync(codexUser(ctx), 'utf8').startsWith('# my config\nmodel = "gpt-y" # keep this\n'), 'the comment after a changed value stays');
  change(ctx, 'codex', { edits: { sandbox_mode: null, model: null } });
  assert.equal(readFileSync(codexUser(ctx), 'utf8').includes('sandbox_mode'), false);
  assert.ok(readFileSync(codexUser(ctx), 'utf8').startsWith('# my config\nunknown_key'));
});

test('Codex: removal and unrepresentable forms; the file stays as it was', () => {
  assert.equal(removeToml('a = 1\n# c\nb = 2\n', '', 'a'), '# c\nb = 2\n');
  assert.equal(removeToml('[t]\nx = 1\ny = 2\n', 't', 'y'), '[t]\nx = 1\n');
  assert.equal(removeToml('a = 1\n', '', 'zz'), 'a = 1\n');
  assert.throws(() => removeToml('a.b = 1\n', 'a', 'b'), /manual editing/);
  assert.throws(() => removeToml('a = [\n 1,\n 2,\n]\n', '', 'a'), /manual editing/);
  assert.equal(removeTable('# keep\n[x]\na = 1\n\n[projects."/a.b/c"]\ntrust_level = "trusted"\n\n[y]\nb = 2\n', ['projects', '/a.b/c']), '# keep\n[x]\na = 1\n\n[y]\nb = 2\n');
  assert.equal(setToml('', 'tui', 'notifications', ['a', 'b']), '[tui]\nnotifications = ["a", "b"]\n');
  const ctx = machine();
  write(codexUser(ctx), 'analytics.enabled = true\n');
  const plan = preview(settingsChanges(ctx, 'codex', { edits: { 'analytics.enabled': false } }));
  assert.match(plan[0].error, /manual editing/);
  assert.equal(readFileSync(codexUser(ctx), 'utf8'), 'analytics.enabled = true\n');
  assert.throws(() => settingsChanges(ctx, 'codex', { edits: { sandbox_mode: 'wide-open' } }), /one of read-only/);
  assert.throws(() => settingsChanges(ctx, 'codex', { edits: { mcp_servers: { a: { command: 'x' } } } }), /scalar|type|edit/);
});

test('Codex trust list: gone folders are a Doctor warning with a remove action, and removing keeps the rest', () => {
  const ctx = machine();
  const here = mkdtempSync(join(tmpdir(), 'bk-trust-'));
  write(codexUser(ctx), `# top\n[projects."/gone/wt.1"]\ntrust_level = "trusted"\n\n[projects."${here}"]\ntrust_level = "trusted"\n`);
  const found = doctor(ctx, { agents: ['codex'], env: {} }).filter((i) => i.check === 'agent-settings');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /\/gone\/wt\.1, which no longer exists/);
  assert.match(found[0].fix, /settings set 'projects\.\/gone\/wt\.1' --unset --agent codex/);
  assert.equal(readFileSync(codexUser(ctx), 'utf8').includes('/gone/wt.1'), true, 'Doctor removes nothing');
  assert.equal(change(ctx, 'codex', { edits: { 'projects./gone/wt.1': null } }).status, 'done');
  const out = readFileSync(codexUser(ctx), 'utf8');
  assert.ok(!out.includes('/gone/wt.1') && out.startsWith('# top\n') && out.includes(here));
  assert.throws(() => settingsChanges(ctx, 'codex', { edits: { 'projects./x': 'trusted' } }), /only removed/);
});

test('Codex notes: a project-local notify, the permissions pair, no prompts and no sandbox', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(join(dir, '.codex/config.toml'), 'notify = ["x"]\n');
  write(codexUser(ctx), 'default_permissions = ":workspace"\nsandbox_mode = "read-only"\napproval_policy = "never"\n');
  const ids = (layers) => notes('codex', layers).map((n) => n.rule);
  assert.deepEqual(ids(readSettings(ctx, 'codex', { dir })).sort(), ['codex-analytics-otlp', 'codex-permissions-pair', 'codex-project-ignores', 'codex-trust-list']);
  write(codexUser(ctx), 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
  assert.ok(ids(readSettings(ctx, 'codex', {})).includes('codex-no-prompts-no-sandbox'));
});

test('bundles: less noise is three switches for Claude Code and two false booleans for Codex', () => {
  assert.deepEqual(bundleEdits('claude', 'less-noise'), { 'env.DISABLE_ERROR_REPORTING': true, 'env.CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY': true, 'env.DISABLE_FEEDBACK_COMMAND': true });
  assert.deepEqual(bundleEdits('codex', 'less-noise'), { 'analytics.enabled': false, 'feedback.enabled': false });
  const ctx = machine();
  assert.equal(settingsChanges(ctx, 'claude', { edits: bundleEdits('claude', 'less-noise') }).length, 3);
  assert.throws(() => bundleEdits('claude', 'nope'), /no bundle/);
});

test('CLI: list, get, set with a diff and undo, --unset, refused values', async () => {
  const ctx = machine();
  const home = ctx.home;
  write(claudeUser(ctx), JSON.stringify({ env: { MY_TOKEN: SECRET }, cleanupPeriodDays: 7 }, null, 2));
  let text = '';
  const out = new Writable({ write(chunk, _, done) { text += chunk; done(); } });
  const exec = (args, answers = '') => main(args, { out, ctx, input: Readable.from([answers]) });
  assert.equal(await exec(['settings', 'list', '--advanced']), 0);
  assert.match(text, /cleanupPeriodDays\s+7 \(user\)/);
  assert.match(text, /below 30/);
  assert.match(text, /env\.MY_TOKEN\s+\(set\)/);
  assert.ok(!text.includes(SECRET));
  text = '';
  assert.equal(await exec(['settings', 'get', 'cleanupPeriodDays']), 0);
  assert.match(text, /^7 \(user\)/);
  assert.equal(await exec(['settings', 'get', 'noSuchKey']), 1);
  text = '';
  assert.equal(await exec(['settings', 'set', 'cleanupPeriodDays', '60'], 'n\n'), 0);
  assert.match(text, /\+ {2}"cleanupPeriodDays": 60/);
  assert.equal(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).cleanupPeriodDays, 7, 'declined: nothing written');
  text = '';
  assert.equal(await exec(['settings', 'set', 'cleanupPeriodDays', '60', '--yes']), 0);
  const id = text.match(/undo with benchkeeper undo (\S+)/)[1];
  assert.equal(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).cleanupPeriodDays, 60);
  assert.ok(!text.includes(SECRET), 'the diff context masks the secret');
  assert.equal(await exec(['undo', id]), 0);
  assert.equal(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).cleanupPeriodDays, 7);
  assert.equal(await exec(['settings', 'set', 'env.DISABLE_TELEMETRY', '0', '--yes']), 1);
  assert.match(text, /never 0 or false/);
  assert.equal(await exec(['settings', 'set', 'env.DISABLE_TELEMETRY', 'set', '--yes']), 0);
  assert.equal(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).env.DISABLE_TELEMETRY, '1');
  assert.equal(await exec(['settings', 'set', 'env.DISABLE_TELEMETRY', '--unset', '--yes']), 0);
  assert.equal(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).env.DISABLE_TELEMETRY, undefined);
  assert.equal(await exec(['settings', 'set', 'model', 'x', '--layer', 'managed', '--yes']), 1);
  assert.equal(await exec(['settings', 'set', 'model', '--yes']), 2);
  assert.equal(await exec(['settings', 'set', '--bundle', 'less-noise', '--agent', 'codex', '--yes']), 0);
  assert.equal(readFileSync(join(home, '.codex/config.toml'), 'utf8'), '[analytics]\nenabled = false\n\n[feedback]\nenabled = false\n');
});

test('routes: the list masks secrets, the plan is a plan the apply route takes, bad input is a 400', async () => {
  const ctx = machine();
  write(claudeUser(ctx), JSON.stringify({ env: { MY_TOKEN: SECRET } }, null, 2));
  const routes = api(ctx);
  const get = (q) => routes['GET /api/settings'](new URLSearchParams(q));
  const list = await get({ agent: 'claude', advanced: '1' });
  assert.ok(!JSON.stringify(list).includes(SECRET));
  await assert.rejects(async () => get({ agent: 'gemini' }), (e) => e.status === 400);
  await assert.rejects(async () => get({ agent: 'claude', dir: '/not/registered' }), (e) => e.status === 400);
  await assert.rejects(async () => routes['POST /api/settings-plan']({ agent: 'claude', edits: { 'env.DISABLE_TELEMETRY': '0' } }), (e) => e.status === 400 && /never 0 or false/.test(e.message));
  await assert.rejects(async () => routes['POST /api/settings-plan']({ agent: 'claude', layer: 'managed', edits: { model: 'x' } }), (e) => e.status === 400);
  const plan = await routes['POST /api/settings-plan']({ agent: 'claude', edits: { 'env.DISABLE_ERROR_REPORTING': true } });
  assert.equal(plan.changes.length, 1);
  assert.ok(!JSON.stringify(plan).includes(SECRET), 'the diff context is masked');
  assert.equal(plan.changes[0].selected, true);
  assert.deepEqual((await routes['POST /api/settings-plan']({ agent: 'claude', edits: { 'env.DISABLE_TELEMETRY': null } })).changes, [], 'nothing to change');
});

test('masking: whole words of the name, tokens inside values, no false hits', () => {
  assert.deepEqual(maskSecrets({ includeCoAuthoredBy: false, MAX_THINKING_TOKENS: '5', apiKeyHelper: 'x', ANTHROPIC_AUTH_TOKEN: 'y' }), { includeCoAuthoredBy: false, MAX_THINKING_TOKENS: '5', apiKeyHelper: '(set)', ANTHROPIC_AUTH_TOKEN: '(set)' });
  assert.equal(redact('"commit": "Co-Authored-By: Name <x>"'), '"commit": "Co-Authored-By: Name <x>"');
  assert.ok(!redact('curl -H "Authorization: Bearer abc123"').includes('abc123'));
  assert.ok(!redact('{"a": {"token": "SEKRET"}}').includes('SEKRET'), 'a pair inside a one-line object');
  assert.ok(!redact('{"env": {"API_KEY": "SEKRET"}, "b": [{"password": "SEKRET2"}]}').match(/SEKRET/));
  assert.equal(redact('https://h/?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9&j=10&k=11 -x'), 'https://h/?a=1&b=2&c=3&d=4&e=5&f=6&g=7&h=8&i=9&j=10&k=11 -x');
  assert.ok(!redact('API_KEY = """\nSEKRET\n"""\nother = 1\n').includes('SEKRET'), 'a multiline TOML string');
  assert.equal(redact("API_KEY = '''\nSEKRET\n'''\nother = 1"), 'API_KEY = "(set)"\nother = 1');
  assert.equal(redact('"HTTPS_PROXY": "https://user:pw0rd@proxy:8080/x"'), '"HTTPS_PROXY": "https://user:(set)@proxy:8080/x"');
  assert.equal(redact('see https://example.com/a:b and git@host:x'), 'see https://example.com/a:b and git@host:x');
  assert.doesNotThrow(() => redact('A="""'.repeat(30000) + 'x'), 'unterminated multiline strings stay linear');
  assert.doesNotThrow(() => redact('a='.repeat(50000)), 'a long chain of pairs does not exhaust the stack');
  assert.ok(!redact(`${'a='.repeat(40)}${SECRET}`).includes(SECRET), 'a chain deeper than the cap is masked whole');
  assert.ok(!maskSecrets({ hooks: { command: "export API_KEY=abc123 && run" } }).hooks.command.includes('abc123'));
});

test('a row whose shown value is masked is not editable, and a masked value is never written back', () => {
  const ctx = machine();
  const text = JSON.stringify({ env: { MY_API_TOKEN: SECRET, KEEP: 'x' }, hooks: { Stop: [{ command: `export API_KEY=${SECRET} && run` }] }, availableModels: ['opus'] }, null, 2);
  write(claudeUser(ctx), text);
  const rows = Object.fromEntries(listSettings(ctx, 'claude', { advanced: true }).advanced.map((r) => [r.key, r]));
  assert.equal(rows.env.editable, false);
  assert.equal(rows.hooks.editable, false);
  assert.equal(rows.availableModels.editable, true, 'a value without a secret stays editable');
  assert.equal(settingsChanges(ctx, 'claude', { edits: { availableModels: ['Bash(set)'] } }).length, 1, 'text that only contains (set) is a value');
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { availableModels: ['https://u:(set)@h'] } }), /placeholder/);
  for (const value of ['(set)', { MY_API_TOKEN: '(set)', KEEP: 'y' }, { Stop: [{ command: 'export API_KEY="(set)" && run' }] }]) {
    assert.throws(() => settingsChanges(ctx, 'claude', { edits: { env: value } }), /placeholder/);
    assert.throws(() => settingsChanges(ctx, 'claude', { edits: { hooks: value } }), /placeholder/);
  }
  assert.equal(readFileSync(claudeUser(ctx), 'utf8'), text);
});

test('environment values and plan titles mask a secret inside a value whose name looks harmless', () => {
  const ctx = machine();
  write(claudeUser(ctx), JSON.stringify({ env: { SETUP_COMMAND: `export API_KEY=${SECRET} && run` } }, null, 2));
  assert.ok(!JSON.stringify(listSettings(ctx, 'claude', { advanced: true }).env).includes(SECRET));
  const [change] = settingsChanges(ctx, 'claude', { edits: { availableModels: [`API_KEY=${SECRET}`] } });
  assert.ok(!change.title.includes(SECRET));
});

test('a refused value depends on the layer written only, not on another layer that holds it', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(join(dir, '.claude/settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'auto' } }));
  assert.equal(settingsChanges(ctx, 'claude', { layer: 'project', dir, edits: { 'permissions.defaultMode': 'plan' } }).length, 1);
  assert.equal(settingsChanges(ctx, 'claude', { dir, edits: { 'permissions.defaultMode': 'plan' } }).length, 1);
  assert.throws(() => settingsChanges(ctx, 'claude', { layer: 'local', dir, edits: { 'permissions.defaultMode': 'auto' } }), /silently ignored/);
});

test('an existing file that cannot be read is an error, not an empty layer', () => {
  const ctx = machine();
  mkdirSync(claudeUser(ctx), { recursive: true });
  assert.match(readSettings(ctx, 'claude').find((l) => l.layer === 'user').error, /cannot be read/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { cleanupPeriodDays: 20 } }));
});

test('Doctor fix for a stale Codex trust entry quotes the path', () => {
  const ctx = machine();
  write(codexUser(ctx), "[projects.\"/gone/my 'dir\"]\ntrust_level = \"trusted\"\n");
  const fix = doctor(ctx, { agents: ['codex'], env: {} }).find((i) => i.check === 'agent-settings' && /no longer exists/.test(i.message))?.fix;
  assert.ok(fix?.includes("'projects./gone/my '\\''dir'"), fix);
});
