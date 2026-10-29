import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { doctor } from '../src/doctor.mjs';
import { removeTable, removeToml, setToml } from '../src/merge.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { api } from '../src/server.mjs';
import { COUPLINGS, agentSettings, bundleEdits, describeKey, isSettingsFile, listSettings, maskSecrets, notes, readSettings, redact, schemaKeys, settingFacts, settingsAgents, settingsChanges } from '../src/settings.mjs';

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
// The security controls (#313 and the sandbox settings, #312) fire on a home that sets none; tests of other rules leave them out.
const CONTROLS = /CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is off|credential files/;
const HIDDEN = new RegExp(`${CONTROLS.source}|sandbox\\.|sandbox is unsupported|sandbox_mode`);
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
    // The kind picks the title; the plain words say what the default is, what it risks and what the fix changes.
    assert.ok(['conflict', 'hardening', 'ignored', 'note'].includes(r.kind), `${r.id}: kind must be conflict, hardening, ignored or note`);
    for (const f of ['default', 'risk', 'fixChanges']) assert.ok(typeof r[f] === 'string' && /^\S.*\.$/.test(r[f]), `${r.id}: ${f} must be one sentence`);
  }
  // Every catalog entry has a sentence, a default and a source.
  for (const id of settingsAgents) for (const s of agentSettings(id).settings) assert.ok(s.sentence && s.default && /^https:\/\//.test(s.source), s.key);
});

test('describeKey: names of built-in object members are not schema keys', () => {
  const nested = { claude: 'permissions', codex: 'sandbox_workspace_write' };
  for (const id of settingsAgents) for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(describeKey(id, name), null, `${id} ${name}`);
    assert.equal(describeKey(id, `${nested[id]}.${name}`), null, `${id} ${nested[id]}.${name}`);
  }
});

test('pinned schemas: advanced mode lists every schema leaf, none is left undescribed', () => {
  for (const id of settingsAgents) for (const k of schemaKeys(id)) assert.ok(describeKey(id, k), `${id} ${k}`);
  const ctx = machine();
  const list = listSettings(ctx, 'codex', { advanced: true });
  assert.ok(list.advanced.some((a) => a.key === 'sandbox_workspace_write.network_access'));
  assert.ok(listSettings(ctx, 'claude', { advanced: true }).advanced.some((a) => a.key === 'modelSettings'), 'a reference key the schema lacks');
});

// Sentences end at a period, question or exclamation mark before a space or the end, so v2.1.281 and Opus 5.5 stay one.
const sentences = (s) => s.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;
test('explainer: every catalog entry has a one-line summary, an eli5 of up to two sentences and an impact of up to three', () => {
  for (const id of settingsAgents) {
    for (const s of agentSettings(id).settings) {
      for (const f of ['summary', 'eli5', 'impact']) assert.ok(typeof s[f] === 'string' && s[f].trim(), `${id} ${s.key}: ${f} is missing or empty`);
      assert.ok(!s.summary.includes('\n') && sentences(s.summary) === 1, `${id} ${s.key}: the summary is one line`);
      assert.ok(sentences(s.eli5) <= 2, `${id} ${s.key}: the eli5 is at most two sentences`);
      assert.ok(sentences(s.impact) <= 3, `${id} ${s.key}: the impact is at most three sentences`);
    }
  }
});

test('facts: the current value names its source: user, project, local or managed file, the environment, or the default', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(claudeUser(ctx), JSON.stringify({ model: 'user', env: { DISABLE_ERROR_REPORTING: '1' } }));
  write(join(dir, '.claude/settings.json'), '{ "cleanupPeriodDays": 9 }');
  write(join(dir, '.claude/settings.local.json'), '{ "outputStyle": "Explanatory" }');
  write(`${ctx.managedRoot}/etc/claude-code/managed-settings.json`, '{ "theme": "light" }');
  // A file's env value wins over the shell's; a variable no file sets comes from the environment.
  const env = { DISABLE_ERROR_REPORTING: 'shell', DISABLE_TELEMETRY: '1' };
  const keys = ['model', 'cleanupPeriodDays', 'outputStyle', 'theme', 'env.DISABLE_ERROR_REPORTING', 'env.DISABLE_TELEMETRY', 'autoMemoryEnabled'];
  const facts = Object.fromEntries(settingFacts(ctx, 'claude', keys, { dir, env }).map((f) => [f.key, f]));
  assert.deepEqual(keys.map((k) => [facts[k].value, facts[k].from]), [['user', 'user'], [9, 'project'], ['Explanatory', 'local'], ['light', 'managed'], ['1', 'user'], ['1', 'environment'], [undefined, 'default']]);
  const memory = agentSettings('claude').settings.find((s) => s.key === 'autoMemoryEnabled');
  assert.deepEqual(facts.autoMemoryEnabled, { key: 'autoMemoryEnabled', summary: memory.summary, eli5: memory.eli5, impact: memory.impact, default: 'true', docs: memory.source, value: undefined, from: 'default' });
  // The editor's rows carry the same facts.
  const row = listSettings(ctx, 'claude', { dir, env }).settings.find((s) => s.key === 'env.DISABLE_TELEMETRY');
  assert.deepEqual([row.value, row.from, row.summary], ['1', 'environment', facts['env.DISABLE_TELEMETRY'].summary]);
});

test('facts outside the catalog: the reference description, the schema default, the value, its source and the docs link', () => {
  const ctx = machine();
  write(claudeUser(ctx), '{ "agent": "reviewer" }');
  write(codexUser(ctx), 'file_opener = "cursor"\n');
  const [agent] = settingFacts(ctx, 'claude', ['agent']);
  assert.deepEqual(agent, { key: 'agent', summary: describeKey('claude', 'agent').sentence, eli5: null, impact: null, default: null, docs: 'https://code.claude.com/docs/en/settings-reference#agent', value: 'reviewer', from: 'user' });
  // An env.* key outside the catalog's switches never reads the process environment.
  assert.deepEqual(settingFacts(ctx, 'claude', ['env.HOME_SECRET'], { env: { HOME_SECRET: 'x' } }).map((f) => [f.value, f.from]), [[undefined, 'default']]);
  const [opener] = settingFacts(ctx, 'codex', ['file_opener']);
  assert.deepEqual([opener.summary, opener.value, opener.from, opener.docs], [describeKey('codex', 'file_opener').sentence, 'cursor', 'user', 'https://learn.chatgpt.com/docs/config-file/config-reference']);
  const advanced = listSettings(ctx, 'claude', { advanced: true }).advanced.find((r) => r.key === 'agent');
  assert.deepEqual([advanced.summary, advanced.from, advanced.docs], [agent.summary, 'user', agent.docs]);
  const [excludes] = settingFacts(ctx, 'claude', ['claudeMdExcludes']);
  assert.equal(excludes.summary, 'Skip specific CLAUDE.md files when memory loads');
  // A key no catalog, schema or reference describes stays not explained.
  assert.equal(settingFacts(ctx, 'claude', ['noSuchKey'])[0].summary, null);
});

test('facts are named where a setting is: a settings plan, a doctor finding and the route', async () => {
  const ctx = machine();
  const [planned] = settingsChanges(ctx, 'claude', { edits: { theme: 'light' } });
  assert.deepEqual(planned.settings, { agent: 'claude', keys: ['theme'] });
  write(claudeUser(ctx), JSON.stringify({ advisorModel: 'opus', env: { DISABLE_TELEMETRY: '1' } }));
  const found = doctor(ctx, { agents: ['claude'], env: {} }).find((i) => /advisor stays off/.test(i.message));
  assert.deepEqual(found.settings, { agent: 'claude', keys: COUPLINGS.rules.find((r) => r.id === 'advisor-needs-flags').keys });
  const facts = await api(ctx)['GET /api/settings'](new URLSearchParams({ agent: 'claude', keys: 'advisorModel,theme' }));
  assert.deepEqual(facts.map((f) => [f.key, f.value, f.from]), [['advisorModel', 'opus', 'user'], ['theme', undefined, 'default']]);
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
  assert.ok(!plan[0].diff.includes(SECRET), 'the plan diff is masked already');
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
  const messages = (settings, env = {}) => { write(claudeUser(ctx), JSON.stringify(settings)); return doctor(ctx, { agents: ['claude'], env }).filter((i) => i.check === 'agent-settings' && !HIDDEN.test(i.message)).map((i) => i.message); };
  assert.match(messages({ remoteControlAtStartup: true, env: { DISABLE_GROWTHBOOK: '1' } })[0], /Remote Control is unavailable/);
  assert.deepEqual(messages({ remoteControlAtStartup: true, env: { DISABLE_TELEMETRY: '1' } }), [], 'Remote Control stays available with only DISABLE_TELEMETRY');
  assert.match(messages({ autoUpdatesChannel: 'stable', env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } })[0], /stops auto-updates/);
  assert.match(messages({ advisorModel: 'claude-sonnet-5-5', model: 'claude-opus-5-5' })[0], /ranks below the main model/);
  assert.deepEqual(messages({ advisorModel: 'claude-opus-5-5', model: 'claude-sonnet-5-5' }), []);
  assert.deepEqual(messages({ advisorModel: 'sonnet', model: 'claude-opus-5-5' }), [], 'an alias resolves to the current default: not checked');
  assert.match(messages({ effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } })[0], /effortLevel \(high\) in the user file differs from the level medium saved under modelSettings for claude-opus-5-5:/);
  assert.match(messages({ effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-fable-5-1': { effortLevel: 'medium' }, 'claude-sonnet-5-5': { maxEffortLevel: 'xhigh' } } })[0], /for claude-opus-5-5, claude-fable-5-1:/, 'names every model that differs');
  assert.deepEqual(messages({ effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' }, 'claude-fable-5-1': { effortLevel: 'xhigh' } } }), [], 'different levels per model are on purpose');
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

test('Doctor: the environment scrub and the credential Read deny rules', () => {
  const ctx = machine();
  const found = (settings, env = {}) => { write(claudeUser(ctx), JSON.stringify(settings)); return doctor(ctx, { agents: ['claude'], env }).filter((i) => i.check === 'agent-settings' && CONTROLS.test(i.message)); };
  const home = '~';
  const deny = [`Read(${home}/.ssh/**)`, `Read(//Users/x/.aws/**)`, 'Read(//**/.config/gh/**)'];
  const both = found({}), scrub = both.find((i) => /SUBPROCESS_ENV_SCRUB/.test(i.message)), reads = both.find((i) => /credential files/.test(i.message));
  assert.equal(both.length, 2);
  assert.match(scrub.message, /SUBPROCESS_ENV_SCRUB is off/);
  assert.match(scrub.fix, /user settings.*code\.claude\.com\/docs\/en\/env-vars#/);
  assert.match(reads.fix, /Read\(\/\/\*\*\/\.ssh\/\*\*\).*code\.claude\.com\/docs\/en\/permissions#read-and-edit/);
  assert.equal(scrub.level, 'warning');
  assert.deepEqual(found({ env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' }, permissions: { deny } }), []);
  assert.equal(found({ permissions: { deny } }).length, 1, 'only the scrub is off');
  assert.equal(found({ env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0' }, permissions: { deny } }).length, 1, '0 is off');
  assert.deepEqual(found({ permissions: { deny } }, { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' }), [], 'the process environment counts');
  assert.equal(found({ env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '0' }, permissions: { deny } }, { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' }).length, 1, 'a settings 0 overrides the process 1');
  const on = { env: { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' } };
  assert.equal(found({ ...on, permissions: { deny: deny.slice(0, 2) } }).length, 1, 'a missing folder is flagged');
  assert.equal(found({ ...on, permissions: { deny: ['Read(./.ssh/**)', 'Read(./.aws/**)', 'Read(./.config/gh/**)'] } }).length, 1, 'project-relative rules do not count');
  assert.equal(found({ ...on, permissions: { deny: [`Read(${home}/.ssh-backup/**)`, `Read(${home}/.aws/credentials)`, 'Read(//**/.config/gh/hosts.yml)'] } }).length, 1, 'another folder or one file in it is not the folder');
  assert.deepEqual(found({ ...on, permissions: { deny: [`Read(${home}/.ssh)`, `Read(${home}/.aws/*)`, 'Read(//**/.config/gh/**)'] } }), [], 'the folder bare or with /* or /**');
  assert.equal(found({ ...on, permissions: { deny: [`Read(${home}/.ssh/**)`, 'Read(//srv/app/.aws/**)', 'Read(//**/.config/gh/**)'] } }).length, 1, 'an absolute path elsewhere is another folder');
  assert.equal(found({ ...on, permissions: { deny: [`Read(${home}/work/.ssh/**)`, `Read(${home}/.aws/**)`, 'Read(//**/.config/gh/**)'] } }).length, 1, 'a folder of the same name deeper down is not the credential folder');
  assert.equal(found({ ...on, permissions: { allow: deny } }).length, 1, 'allow rules are not deny rules');
  assert.equal(found({ ...on, permissions: { deny: deny.map((r) => r.replace('Read', 'Edit')) } }).length, 1, 'Edit rules do not stop reads');
  // A file that cannot be read may hold both: no guess.
  write(claudeUser(ctx), '{\n  // mine\n}\n');
  assert.deepEqual(doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => CONTROLS.test(i.message)), []);
  assert.deepEqual(listSettings(ctx, 'claude', { env: {} }).notes.filter((n) => CONTROLS.test(n.message)), [], 'the settings list skips them too');
});

test('Doctor: the sandbox settings, per platform, for Claude Code and Codex', () => {
  const ctx = machine();
  const SANDBOX = /sandbox\.|sandbox is unsupported/;
  const have = (...bins) => (b) => bins.includes(b);
  // Returns the findings (level and the first words) of the sandbox rules for a settings object on a platform.
  const found = (settings, platform = 'linux', has = have('bwrap', 'socat')) => {
    write(claudeUser(ctx), JSON.stringify(settings));
    ctx.sandbox = { platform, has, node: '22.22.0' };
    return doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings' && SANDBOX.test(i.message));
  };
  const keys = (list) => list.map((i) => i.message.match(/sandbox\.\w+(\.\w+)?|bubblewrap|socat/)?.[0] ?? 'unsupported').sort();
  const on = { sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, network: { allowedDomains: ['registry.npmjs.org'] } } };
  for (const platform of ['linux', 'darwin']) {
    // Nothing set: the sandbox is off, a warning; the retry key matters only while the sandbox is on, so no more.
    const none = found({}, platform);
    assert.deepEqual(keys(none), ['sandbox.enabled'], platform);
    assert.ok(none.every((i) => i.level === 'warning' && /benchkeeper settings set sandbox\./.test(i.fix) && /code\.claude\.com\/docs\/en\/sandboxing/.test(i.fix)));
    assert.deepEqual(found(on, platform), [], `${platform}: everything set`);
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, enabled: false } }, platform)), ['sandbox.enabled'], 'explicitly off');
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, failIfUnavailable: undefined } }, platform)), ['sandbox.failIfUnavailable']);
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, failIfUnavailable: false } }, platform)), ['sandbox.failIfUnavailable']);
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, allowUnsandboxedCommands: true } }, platform)), ['sandbox.allowUnsandboxedCommands']);
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, allowUnsandboxedCommands: undefined } }, platform)), ['sandbox.allowUnsandboxedCommands'], 'unset is true while the sandbox is on');
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, enabled: false, allowUnsandboxedCommands: true } }, platform)), ['sandbox.enabled'], 'the retry is no note while the sandbox is off');
    // The empty allowlist is advice (info) while the sandbox is on, and never a warning.
    const empty = found({ sandbox: { ...on.sandbox, network: { allowedDomains: [] } } }, platform);
    assert.deepEqual(keys(empty), ['sandbox.network.allowedDomains']);
    assert.equal(empty[0].level, 'info');
    assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, network: undefined } }, platform)), ['sandbox.network.allowedDomains'], 'no list is an empty list');
    assert.ok(!keys(found({}, platform)).includes('sandbox.network.allowedDomains'), 'no advice while the sandbox is off');
  }
  // Linux and WSL2 (platform linux) name the missing program; macOS ships its own.
  assert.deepEqual(keys(found(on, 'linux', have('socat'))), ['bubblewrap']);
  assert.deepEqual(keys(found(on, 'linux', have('bwrap'))), ['socat']);
  assert.deepEqual(keys(found(on, 'linux', have())), ['bubblewrap', 'socat']);
  // Only a managed path counts, and only when it names an executable file; a user path is ignored by Claude Code.
  const bwrap = join(ctx.managedRoot, 'bwrap'), socat = join(ctx.managedRoot, 'socat');
  for (const f of [bwrap, socat]) { write(f, '#!/bin/sh\n'); chmodSync(f, 0o755); }
  const managed = (sandbox) => write(`${ctx.managedRoot}/etc/claude-code/managed-settings.json`, JSON.stringify({ sandbox }));
  managed({ bwrapPath: bwrap, socatPath: socat });
  assert.deepEqual(found(on, 'linux', have()), [], 'a managed path replaces the PATH lookup');
  if (process.platform !== 'win32') { // Windows has no execute bit.
    chmodSync(socat, 0o644);
    assert.deepEqual(keys(found(on, 'linux', have())), ['socat'], 'a managed path that is no executable file is unset');
  }
  managed({ bwrapPath: join(ctx.managedRoot, 'absent'), socatPath: join(ctx.managedRoot, 'absent-socat') });
  assert.deepEqual(keys(found(on, 'linux', have())), ['bubblewrap', 'socat'], 'a managed path that is missing is unset');
  managed({ bwrapPath: relative(process.cwd(), bwrap), socatPath: relative(process.cwd(), socat) }); // would run from the working directory
  assert.deepEqual(keys(found(on, 'linux', have())), ['bubblewrap', 'socat'], 'a relative managed path is unset');
  managed({});
  assert.deepEqual(keys(found({ sandbox: { ...on.sandbox, bwrapPath: bwrap, socatPath: socat } }, 'linux', have())), ['bubblewrap', 'socat'], 'a user path is ignored');
  // A managed enabledPlatforms list that leaves the platform out makes the sandbox inert, whatever sandbox.enabled says.
  managed({ enabledPlatforms: ['macos'] });
  assert.deepEqual(keys(found(on, 'linux', have())), ['sandbox.enabled'], 'managed list without this platform');
  assert.match(found(on, 'linux', have())[0].fix, /administrator/);
  managed({ enabledPlatforms: ['wsl'] });
  assert.deepEqual(found(on, 'linux', have('bwrap', 'socat')), [], 'WSL2 reports linux');
  managed({ enabledPlatforms: ['linux'] });
  assert.deepEqual(found(on, 'darwin', have()).map((i) => i.level), ['warning'], 'macOS left out');
  assert.deepEqual(found(on, 'linux', have('bwrap', 'socat')), []);
  write(`${ctx.managedRoot}/etc/claude-code/managed-settings.json`, '{}');
  assert.deepEqual(keys(found({}, 'linux', have())), ['sandbox.enabled'], 'a missing program matters only while the sandbox is on');
  assert.deepEqual(found(on, 'darwin', have()), [], 'macOS needs neither');
  // Native Windows: unsupported, information, never a warning, whatever the settings say.
  for (const settings of [{}, on]) {
    const win = found(settings, 'win32', have());
    assert.equal(win.length, 1);
    assert.equal(win[0].level, 'info');
    assert.match(win[0].message, /unsupported on native Windows.*exits at startup when sandbox\.failIfUnavailable is true, unless a managed sandbox\.enabledPlatforms list leaves Windows out/);
  }
  // Layers: the highest wins (a local file turns the user's sandbox off); a file that cannot be read may hold the keys: no guess.
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(join(dir, 'AGENTS.md'), 'x\n');
  write(claudeUser(ctx), JSON.stringify(on));
  ctx.sandbox = { platform: 'linux', has: have('bwrap', 'socat') };
  const project = (local) => { write(join(dir, '.claude/settings.local.json'), JSON.stringify(local)); return doctor(ctx, { agents: ['claude'], env: {}, dir }).filter((i) => SANDBOX.test(i.message)); };
  assert.deepEqual(keys(project({ sandbox: { enabled: false } })), ['sandbox.enabled']);
  assert.deepEqual(project({ sandbox: { enabled: true } }), []);
  write(claudeUser(ctx), '{\n  // mine\n}\n');
  assert.deepEqual(doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => SANDBOX.test(i.message)), [], 'unreadable file');
  // The settings list shows them next to the key.
  write(claudeUser(ctx), '{}');
  assert.ok(listSettings(ctx, 'claude', { env: {} }).settings.find((s) => s.key === 'sandbox.enabled').notes.some((n) => /sandbox\.enabled is off/.test(n.message)));
  // Codex: danger-full-access warns; the other modes and no value do not. The project file counts.
  const codex = (text, name = 'user') => { write(name === 'user' ? codexUser(ctx) : join(dir, '.codex/config.toml'), text); return doctor(ctx, { agents: ['codex'], env: {}, dir }).filter((i) => /sandbox_mode/.test(i.message)); };
  const full = codex('sandbox_mode = "danger-full-access"\n');
  assert.equal(full.length, 1);
  assert.equal(full[0].level, 'warning');
  assert.match(full[0].fix, /workspace-write.*learn\.chatgpt\.com/);
  assert.deepEqual(codex('sandbox_mode = "workspace-write"\n'), []);
  assert.deepEqual(codex('sandbox_mode = "read-only"\n'), []);
  assert.deepEqual(codex('model = "x"\n'), []);
  // Setup writes none of the keys; settings set does, as for the environment scrub.
  const home = mkdtempSync(join(tmpdir(), 'bk-home-'));
  const fresh = Object.assign(context({ home, run }), { managedRoot: mkdtempSync(join(tmpdir(), 'bk-managed-')) });
  apply(preview(settingsChanges(fresh, 'claude', { edits: { 'sandbox.failIfUnavailable': true, 'sandbox.allowUnsandboxedCommands': false } })), fresh, { scope: 'global' });
  assert.deepEqual(JSON.parse(readFileSync(claudeUser(fresh), 'utf8')).sandbox, { failIfUnavailable: true, allowUnsandboxedCommands: false });
  const entries = Object.fromEntries(agentSettings('claude').settings.filter((x) => x.key.startsWith('sandbox.')).map((x) => [x.key, x]));
  for (const k of ['sandbox.enabled', 'sandbox.failIfUnavailable', 'sandbox.allowUnsandboxedCommands']) assert.ok(entries[k] && !entries[k].setup && entries[k].suggest?.reason && /^https:\/\//.test(entries[k].source), k);
  assert.equal(entries['sandbox.failIfUnavailable'].suggest.value, true);
  assert.equal(entries['sandbox.allowUnsandboxedCommands'].suggest.value, false);
  assert.ok(!('sandbox.network.allowedDomains' in entries), 'the allowlist is never suggested or written');
  assert.equal(agentSettings('codex').settings.find((x) => x.key === 'sandbox_mode').suggest.value, 'workspace-write');
});

test('Doctor reads the project and local layers for project checks only', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(join(dir, '.claude/settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'auto' }, env: { OTEL_METRICS_EXPORTER: 'otlp' } }));
  write(join(dir, 'AGENTS.md'), 'x\n');
  assert.deepEqual(doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings' && !HIDDEN.test(i.message)), []);
  const found = doctor(ctx, { agents: ['claude'], env: {}, dir }).filter((i) => i.check === 'agent-settings' && !HIDDEN.test(i.message)).map((i) => i.message);
  assert.equal(found.length, 2);
  assert.ok(found.some((m) => /silently ignored/.test(m)) && found.some((m) => /OpenTelemetry export variables/.test(m)));
});

test('catalog coverage of #468: manual alias, ask rules, read block, sandbox disclosure and autoMode are read, planned and undone', () => {
  const ctx = machine();
  const rows = () => Object.fromEntries(listSettings(ctx, 'claude').settings.map((r) => [r.key, r]));
  const AUTO = { allow: ['$defaults', 'Allow `gh pr merge` in the session\'s repository when the user\'s message asks to merge that pull request'] };
  const cases = [
    ['permissions.defaultMode', 'manual', ['permissions', 'defaultMode']],
    ['permissions.ask', ['Bash(git push *)', 'Bash(gh pr create *)'], ['permissions', 'ask']],
    ['permissions.blockReadsOutsideWorkingDirectories', true, ['permissions', 'blockReadsOutsideWorkingDirectories']],
    ['sandbox.autoAllowBashIfSandboxed', false, ['sandbox', 'autoAllowBashIfSandboxed']],
    ['autoMode', AUTO, ['autoMode']],
  ];
  // Offered, not written: a fresh home has none of them set, and each row carries a sentence and a source.
  for (const [key] of cases.slice(1)) assert.ok(rows()[key] && rows()[key].sentence && /^https:\/\//.test(rows()[key].source) && rows()[key].value === undefined && !rows()[key].setByApp, key);
  assert.deepEqual(rows()['permissions.ask'].suggest.value, ['Bash(git push *)', 'Bash(gh pr create *)']);
  for (const [key, value, path] of cases) {
    write(claudeUser(ctx), '{\n  "model": "x"\n}\n');
    const before = readFileSync(claudeUser(ctx), 'utf8');
    const plan = preview(settingsChanges(ctx, 'claude', { edits: { [key]: value } }));
    assert.equal(plan.length, 1, key);
    assert.equal(readFileSync(claudeUser(ctx), 'utf8'), before, 'a plan writes nothing');
    const r = apply(plan, ctx, { scope: 'global' });
    assert.deepEqual(path.reduce((o, k) => o[k], JSON.parse(readFileSync(claudeUser(ctx), 'utf8'))), value, key);
    assert.deepEqual(rows()[key].value, value, `${key} is read back`);
    assert.equal(undo(r.id, ctx).status, 'done');
    assert.equal(readFileSync(claudeUser(ctx), 'utf8'), before, `${key}: undo restores the file`);
  }
  // manual is an alias of default: it is a valid value in the project and local files too, and nothing warns.
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  for (const layer of ['project', 'local']) assert.equal(settingsChanges(ctx, 'claude', { layer, dir, edits: { 'permissions.defaultMode': 'manual' } }).length, 1);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { 'permissions.defaultMode': 'nonsense' } }), /one of/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { 'permissions.ask': 'Bash(git push *)' } }), /list of texts/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { 'permissions.blockReadsOutsideWorkingDirectories': 'yes' } }), /true or false/);
});

test('autoMode is taken from the user file only; a project or local file is refused and Doctor flags one that exists', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  for (const layer of ['project', 'local']) assert.throws(() => settingsChanges(ctx, 'claude', { layer, dir, edits: { autoMode: { allow: ['$defaults'] } } }), /user file only|does not read autoMode/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { autoMode: { allow: 'x' } } }), /object with allow/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { autoMode: { other: [] } } }), /object with allow/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { autoMode: { classifyAllShell: 'yes' } } }), /object with allow/);
  assert.throws(() => settingsChanges(ctx, 'claude', { edits: { autoMode: 'allow' } }), /object with allow/);
  // The documented classifyAllShell boolean is kept in the object the editor writes.
  write(claudeUser(ctx), JSON.stringify({ autoMode: { classifyAllShell: true } }));
  const before = readFileSync(claudeUser(ctx), 'utf8');
  const r = apply(preview(settingsChanges(ctx, 'claude', { edits: { autoMode: { allow: ['$defaults'], classifyAllShell: true } } })), ctx, { scope: 'global' });
  assert.deepEqual(JSON.parse(readFileSync(claudeUser(ctx), 'utf8')).autoMode, { allow: ['$defaults'], classifyAllShell: true });
  assert.equal(undo(r.id, ctx).status, 'done');
  assert.equal(readFileSync(claudeUser(ctx), 'utf8'), before);
  write(join(dir, '.claude/settings.local.json'), JSON.stringify({ autoMode: { allow: ['$defaults'] } }));
  write(join(dir, 'AGENTS.md'), 'x\n');
  assert.ok(doctor(ctx, { agents: ['claude'], env: {}, dir }).some((i) => i.check === 'agent-settings' && /does not read autoMode/.test(i.message)));
});

test('Doctor: a bypass default mode in project or local settings is flagged, in the user file it is left alone', () => {
  const ctx = machine();
  const dir = mkdtempSync(join(tmpdir(), 'bk-proj-'));
  write(join(dir, 'AGENTS.md'), 'x\n');
  const found = () => doctor(ctx, { agents: ['claude'], env: {}, dir }).filter((i) => i.check === 'agent-settings' && /silently ignored/.test(i.message));
  write(join(dir, '.claude/settings.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  assert.equal(found().length, 1);
  write(join(dir, '.claude/settings.json'), '{}');
  write(join(dir, '.claude/settings.local.json'), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  assert.equal(found().length, 1);
  write(join(dir, '.claude/settings.local.json'), '{}');
  write(claudeUser(ctx), JSON.stringify({ permissions: { defaultMode: 'bypassPermissions' } }));
  assert.equal(found().length, 0, 'the user file takes the mode: the user\'s own choice');
});

test('Doctor: the advisor rank sees a [1m] model id', () => {
  const ctx = machine();
  const messages = (settings, env = {}) => { write(claudeUser(ctx), JSON.stringify(settings)); return doctor(ctx, { agents: ['claude'], env }).filter((i) => i.check === 'agent-settings' && !HIDDEN.test(i.message)).map((i) => i.message); };
  assert.match(messages({ advisorModel: 'claude-sonnet-5-5[1m]', model: 'claude-opus-5-5' })[0], /ranks below the main model/);
  assert.match(messages({ advisorModel: 'claude-opus-4-6[1m]', model: 'claude-opus-5-5[1m]' })[0], /ranks below the main model/);
  assert.deepEqual(messages({ advisorModel: 'claude-opus-5-5[1m]', model: 'claude-sonnet-5-5' }), []);
});

test('Doctor: the keys the settings reference marks deprecated or removed are flagged, derived from the pinned reference', () => {
  const ctx = machine();
  const keys = ['disableArtifact', 'keybindingFlavor', 'permissionExplainerEnabled', 'taskOutputMaxChars', 'teammateDefaultModel'];
  const reference = JSON.parse(readFileSync(new URL('../src/settings/claude-settings-keys.json', import.meta.url), 'utf8'));
  assert.deepEqual(reference.filter((r) => /^(Deprecated|Removed)\b/.test(r.description) && r.key !== 'includeCoAuthoredBy').map((r) => r.key).sort(), keys);
  for (const key of keys) {
    write(claudeUser(ctx), JSON.stringify({ [key]: true }));
    const found = doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings' && !HIDDEN.test(i.message));
    assert.equal(found.length, 1, key);
    assert.match(found[0].message, new RegExp(`${key}: (Deprecated|Removed)`));
    assert.ok(listSettings(ctx, 'claude', { advanced: true }).advanced.find((a) => a.key === key), key);
  }
  write(claudeUser(ctx), '{}');
  assert.deepEqual(doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'agent-settings' && !HIDDEN.test(i.message)), []);
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

test('kinds and dismiss: only a real conflict is titled as one; a dismissed note leaves the list and Doctor, across restarts, until shown again', async () => {
  const ctx = machine();
  ctx.sandbox = { platform: 'linux', has: () => true };
  const off = { effortLevel: 'high', modelSettings: { 'claude-opus-5-5': { effortLevel: 'medium' } } };
  write(claudeUser(ctx), JSON.stringify(off));
  const kinds = (c = ctx) => Object.fromEntries(listSettings(c, 'claude', { env: {} }).notes.map((n) => [n.id, n.kind]));
  assert.deepEqual(kinds(), { 'effort-user-noop': 'conflict', 'env-scrub-off': 'hardening', 'read-deny-credentials': 'hardening', 'sandbox-off': 'hardening' });
  assert.equal(listSettings(ctx, 'claude', { env: {} }).notes.find((n) => n.id === 'effort-user-noop').default, 'The top-level effortLevel is high; claude-opus-5-5 have medium saved under modelSettings and use that.');
  write(claudeUser(ctx), JSON.stringify({ ...off, sandbox: { enabled: true, failIfUnavailable: true, network: { allowedDomains: ['registry.npmjs.org'] } } }));
  assert.equal(kinds()['sandbox-unsandboxed-retry'], 'hardening', 'the retry is raised while the sandbox is on');
  const note = listSettings(ctx, 'claude', { env: {} }).notes.find((n) => n.id === 'env-scrub-off');
  assert.ok(note.default && note.risk && note.fixChanges, 'the plain words travel with the note');
  // Dismiss through the route; a new context on the same home is a restart.
  const routes = api(ctx);
  const doctorIds = (c) => doctor(c, { agents: ['claude'], env: {} }).filter((i) => /SUBPROCESS_ENV_SCRUB/.test(i.message));
  assert.equal(doctorIds(ctx).length, 1);
  assert.deepEqual((await routes['POST /api/settings-dismiss']({ id: 'env-scrub-off' })).dismissed, ['env-scrub-off']);
  const again = Object.assign(context({ home: ctx.home, run }), { managedRoot: ctx.managedRoot, sandbox: ctx.sandbox });
  const list = listSettings(again, 'claude', { env: {} });
  assert.ok(!list.notes.some((n) => n.id === 'env-scrub-off'));
  assert.deepEqual(list.dismissed.map((n) => n.id), ['env-scrub-off']);
  assert.ok(!list.settings.find((s) => s.key === 'env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB').notes.some((n) => n.id === 'env-scrub-off'), 'not on its row either');
  assert.deepEqual(doctorIds(again), [], 'Doctor leaves it out');
  assert.ok('read-deny-credentials' in kinds(again), 'other notes stay');
  await routes['POST /api/settings-dismiss']({ id: 'env-scrub-off', dismissed: false });
  assert.equal(kinds(again)['env-scrub-off'], 'hardening');
  assert.deepEqual(listSettings(again, 'claude', { env: {} }).dismissed, []);
  assert.equal(doctorIds(again).length, 1);
  await assert.rejects(async () => routes['POST /api/settings-dismiss']({ id: 3 }), (e) => e.status === 400);
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
  assert.ok(isSettingsFile(['C:', 'work', '.claude', 'settings.json'].join('\\')) && isSettingsFile('/work/x/.codex/config.toml') && !isSettingsFile('/work/x/AGENTS.md'), 'both path separators');
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
