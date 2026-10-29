import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { context } from '../src/runner.mjs';
import { agentSettings, describeKey, listSettings, maskSecrets, parseInput, readSettings, settingsChanges, settingsChecks, valuesOf } from '../src/settings.mjs';

const run = () => ({ code: 0, stdout: '', stderr: '' });
const ctx = Object.assign(context({ home: mkdtempSync(join(tmpdir(), 'bk-setv-')), run }), { managedRoot: mkdtempSync(join(tmpdir(), 'bk-setv-managed-')) });
const dir = mkdtempSync(join(tmpdir(), 'bk-setv-proj-'));
// The reason a one-key edit is refused, or null when it is planned.
const refused = (agent, key, value, layer = 'user') => {
  try { settingsChanges(ctx, agent, { layer, dir, edits: { [key]: value } }); return null; } catch (e) { return e.message; }
};

test('parseInput: typed text to the value the key takes', () => {
  const def = (type) => ({ key: 'k', type });
  assert.deepEqual(parseInput(def('bool'), ['x']), ['x']);
  assert.equal(parseInput(def('bool'), ' TRUE '), true);
  assert.equal(parseInput(def('bool'), 'False'), false);
  for (const s of ['yes', 'xtrue', 'truex', 'xfalse', 'falsex']) assert.throws(() => parseInput(def('bool'), s), { message: 'k takes true or false' }, s);
  assert.equal(parseInput(def('int'), ' 5 '), 5);
  assert.equal(parseInput(def('number'), '1.5'), 1.5);
  for (const s of ['', '  ', 'abc']) assert.throws(() => parseInput(def('int'), s), { message: 'k takes a number' }, s);
  assert.throws(() => parseInput(def('number'), 'x'), { message: 'k takes a number' });
  for (const s of ['set', 'ON', '1', 'true', 'Yes']) assert.equal(parseInput(def('switch'), s), true, s);
  for (const s of ['0', 'FALSE', 'off', 'no']) assert.equal(parseInput(def('switch'), s), false, s);
  for (const s of ['maybe', 'xon', 'onx', 'xno', 'nox']) assert.equal(parseInput(def('switch'), s), s, s);
  assert.equal(parseInput(def('enum'), ' a '), ' a ');
  assert.equal(parseInput(def('string'), ' [1] '), ' [1] ');
  assert.equal(parseInput(def('attribution'), 'Hidden'), false);
  assert.equal(parseInput(def('attribution'), 'false'), false);
  assert.equal(parseInput(def('attribution'), 'hiddenx'), 'hiddenx');
  assert.deepEqual(parseInput(def('attribution'), ' {"commit":""} '), { commit: '' });
  assert.deepEqual(parseInput(def('json'), ' [1] '), [1]);
  assert.equal(parseInput(def('json'), ' {x '), ' {x ');
});

test('validation of the catalog types: the reason names what the key takes', () => {
  assert.equal(refused('claude', 'remoteControlAtStartup', 'true'), 'remoteControlAtStartup: true or false');
  assert.equal(refused('claude', 'remoteControlAtStartup', false), null);
  assert.equal(refused('claude', 'cleanupPeriodDays', 0), 'cleanupPeriodDays: a whole number of 1 or more');
  assert.equal(refused('claude', 'cleanupPeriodDays', 1.5), 'cleanupPeriodDays: a whole number of 1 or more');
  assert.equal(refused('claude', 'cleanupPeriodDays', 1), null);
  assert.equal(refused('claude', 'model', ''), 'model: a non-empty text');
  assert.equal(refused('claude', 'model', 5), 'model: a non-empty text');
  assert.equal(refused('claude', 'theme', 'custom:mine'), null);
  assert.equal(refused('claude', 'theme', 'dark'), null);
  assert.equal(refused('claude', 'theme', 'xcustom:mine'), 'theme: one of auto, dark, light, dark-daltonized, light-daltonized, dark-ansi, light-ansi or a custom one');
  assert.equal(refused('claude', 'effortLevel', 'max'), 'effortLevel: one of low, medium, high, xhigh');
  assert.equal(refused('claude', 'effortLevel', ['low']), 'effortLevel: one of low, medium, high, xhigh');
  assert.equal(refused('claude', 'permissions.ask', ['Bash(ls)']), null);
  assert.equal(refused('claude', 'permissions.ask', ['Bash(ls)', 1]), 'permissions.ask: a list of texts');
  assert.equal(refused('claude', 'permissions.ask', 'Bash(ls)'), 'permissions.ask: a list of texts');
  assert.equal(refused('claude', 'statusLine', { type: 'command' }), 'statusLine: edit it in the file; the app shows it only');
  assert.equal(refused('claude', 'env.DO_NOT_TRACK', '1'), 'env.DO_NOT_TRACK: an environment switch is set or removed, never 0 or false: use "set" or remove it');
  assert.equal(refused('claude', 'env.DO_NOT_TRACK', null), null);
  assert.equal(refused('codex', 'model_reasoning_effort', 'high'), null);
});

test('validation of attribution and autoMode', () => {
  const shape = 'attribution: false, or an object with commit, pr (texts) and sessionUrl (true or false)';
  const fields = 'attribution: commit and pr are texts, sessionUrl is true or false';
  assert.equal(refused('claude', 'attribution', false), null);
  assert.equal(refused('claude', 'attribution', { commit: 'c', pr: 'p', sessionUrl: true }), null);
  assert.equal(refused('claude', 'attribution', {}), null);
  for (const v of [true, [], 'x', { commit: 'c', other: 1 }]) assert.equal(refused('claude', 'attribution', v), shape, JSON.stringify(v));
  for (const v of [{ commit: 1 }, { pr: false }, { sessionUrl: 'yes' }]) assert.equal(refused('claude', 'attribution', v), fields, JSON.stringify(v));
  const lists = 'autoMode: an object with allow, soft_deny, environment and hard_deny (lists of texts) and classifyAllShell (true or false)';
  assert.equal(refused('claude', 'autoMode', { allow: ['a'], soft_deny: [], environment: ['e'], hard_deny: ['h'], classifyAllShell: true }), null);
  assert.equal(refused('claude', 'autoMode', {}), null);
  for (const v of [5, [], { classifyAllShell: 'yes' }, { deny: [] }, { allow: 'a' }, { hard_deny: ['a', 1] }]) assert.equal(refused('claude', 'autoMode', v), lists, JSON.stringify(v));
  assert.equal(refused('claude', 'autoMode', {}, 'local'), 'autoMode: the classifier reads it from the user file only (or managed settings)');
});

test('validation of keys from the pinned schema or the reference: scope, type and what TOML can hold', () => {
  assert.equal(refused('claude', 'copyOnSelect', true), 'copyOnSelect: lives in the .claude.json file of the home folder, which this editor does not touch');
  assert.equal(refused('claude', 'allowedProviders', []), 'allowedProviders: managed settings only: read-only here');
  assert.equal(refused('claude', 'appendPlugins', 'x'), null);
  assert.equal(refused('claude', 'appendPlugins', 'x', 'project'), 'appendPlugins: this key is taken from the user file only');
  assert.equal(refused('claude', 'syncClaudeAiPlugins', true, 'project'), 'syncClaudeAiPlugins: this key is not taken from the project file');
  assert.equal(refused('claude', 'syncClaudeAiPlugins', true, 'local'), null);
  // The scope holds for typed keys too, not only for json ones.
  assert.equal(refused('claude', 'autoConnectIde', true, 'project'), 'autoConnectIde: lives in the .claude.json file of the home folder, which this editor does not touch');
  assert.equal(refused('claude', 'axScreenReader', true), null);
  assert.equal(refused('claude', 'axScreenReader', true, 'project'), 'axScreenReader: this key is taken from the user file only');
  assert.equal(refused('claude', 'askUserQuestionTimeout', '5m'), null);
  assert.equal(refused('claude', 'askUserQuestionTimeout', '5m', 'project'), 'askUserQuestionTimeout: this key is taken from the user file only');
  assert.equal(refused('claude', 'skipDangerousModePermissionPrompt', true, 'local'), null);
  assert.equal(refused('claude', 'skipDangerousModePermissionPrompt', true, 'project'), 'skipDangerousModePermissionPrompt: this key is not taken from the project file');
  // Managed-only: no file the editor writes takes it.
  for (const layer of ['user', 'project']) assert.equal(refused('claude', 'policyHelper.timeoutMs', 5000, layer), 'policyHelper.timeoutMs: managed settings only: read-only here', layer);
  assert.equal(refused('claude', 'permissions.allow', ['Read']), null);
  assert.equal(refused('claude', 'permissions.allow', 'Read'), 'permissions.allow: a value of type array');
  assert.equal(refused('claude', 'feedbackSurveyRate', '0.5'), 'feedbackSurveyRate: a number');
  assert.equal(refused('claude', 'feedbackSurveyRate', 0.5), null);
  assert.equal(refused('claude', 'statusLine.refreshInterval', 1.5), 'statusLine.refreshInterval: a whole number');
  assert.equal(refused('claude', 'statusLine.refreshInterval', -5), null);
  assert.equal(refused('codex', 'audio.microphone_channel', 2), null);
  assert.equal(refused('codex', 'audio.microphone_channel', [1, 2]), null);
  assert.equal(refused('codex', 'audio.microphone_channel', 1.5), 'audio.microphone_channel: a value of type integer or array');
  assert.equal(refused('codex', 'audio.microphone_channel', [{}]), 'audio.microphone_channel: a value the app writes into TOML only as a scalar or a list of scalars: edit tables by hand');
  assert.equal(refused('codex', 'otel.exporter', 'none'), null);
  assert.equal(refused('codex', 'otel.exporter', {}), 'otel.exporter: a value the app writes into TOML only as a scalar or a list of scalars: edit tables by hand');
  assert.equal(refused('codex', 'otel.exporter', 5), 'otel.exporter: a value of type string or object');
  assert.equal(refused('claude', 'notAKey', 1), "notAKey: not a key of Claude Code's settings reference or schema");
});

test('describeKey outside the catalog: type, values, default, sentence, scope and group from the schema and the reference', () => {
  const pick = (id, key) => { const d = describeKey(id, key); return d && { type: d.type, values: d.values, types: d.types, sentence: d.sentence, default: d.default, scope: d.scope, group: d.group, advanced: d.advanced, schema: d.schema }; };
  assert.deepEqual(pick('claude', 'teammateMode'), { type: 'enum', values: ['auto', 'in-process', 'tmux', 'iterm2'], types: ['string'], sentence: 'Choose how agent team teammates display', default: 'in-process', scope: 'Any file', group: 'Agents, sessions, and worktrees', advanced: true, schema: true });
  assert.deepEqual(pick('claude', 'skillListingBudgetFraction'), { type: 'number', values: undefined, types: ['number'], sentence: 'Reserve more or less context for the skill listing', default: '0.01', scope: 'Any file', group: 'Memory and context', advanced: true, schema: true });
  assert.equal(pick('claude', 'autoConnectIde').type, 'bool');
  assert.equal(pick('claude', 'autoConnectIde').default, 'false');
  assert.equal(pick('claude', 'statusLine.refreshInterval').type, 'int');
  assert.equal(pick('claude', 'statusLine.refreshInterval').group, 'Other');
  assert.equal(pick('claude', 'statusLine.refreshInterval').scope, undefined);
  assert.match(pick('claude', 'statusLine.refreshInterval').sentence, /^Re-run the status line command every N seconds/);
  assert.deepEqual(pick('claude', 'autoCompactWindow'), { type: 'any', values: undefined, types: [], sentence: pick('claude', 'autoCompactWindow').sentence, default: null, scope: 'Any file', group: pick('claude', 'autoCompactWindow').group, advanced: true, schema: false });
  assert.ok(pick('claude', 'autoCompactWindow').sentence);
  assert.equal(pick('claude', 'permissions.allow').type, 'json');
  assert.deepEqual(pick('codex', 'otel.exporter'), { type: 'json', values: ['none', 'statsig'], types: ['string', 'object'], sentence: 'Optional log exporter', default: null, scope: undefined, group: 'Other', advanced: true, schema: true });
  // The Codex schema adds a description to a $ref through a lone allOf entry: the outer description is the sentence.
  assert.match(pick('codex', 'approvals_reviewer').sentence, /^Configures who approval requests are routed to/);
  assert.deepEqual(pick('codex', 'approvals_reviewer').values, ['user', 'auto_review', 'guardian_subagent']);
  assert.equal(pick('codex', 'history.max_bytes').default, 'null');
  assert.equal(pick('codex', 'tui.mouse_scroll_speed').type, 'number');
  assert.equal(pick('codex', 'projects./x').type, 'json');
  assert.equal(describeKey('codex', 'nope'), null);
  assert.equal(describeKey('claude', 'nope.x'), null);
  assert.equal(describeKey('codex', 'history.max_bytes.x'), null);
});

test('agentSettings names the agents it knows; secret names are whole words', () => {
  assert.throws(() => agentSettings('nope'), { message: 'no settings for agent nope: claude, codex' });
  const masked = maskSecrets({ apiKey: 'v', mytoken: 'v', mysecret: 'v', mypassword: 'v', credential: 'v', oauth: 'v', mypasswd: 'v', keys: 'v', tokens: 'v' });
  assert.deepEqual(masked, { apiKey: '(set)', mytoken: '(set)', mysecret: '(set)', mypassword: '(set)', credential: '(set)', oauth: '(set)', mypasswd: 'v', keys: 'v', tokens: 'v' });
});

test('readSettings: a missing file, an unreadable one, one that does not parse; project and user layers on the same path stay apart', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-setv-home-'));
  const c = Object.assign(context({ home, run }), { managedRoot: ctx.managedRoot });
  const user = (layers) => layers.find((l) => l.layer === 'user');
  assert.deepEqual(user(readSettings(c, 'claude')), { layer: 'user', path: join(home, '.claude/settings.json'), exists: false, data: {} });
  mkdirSync(join(home, '.claude/settings.json'), { recursive: true });
  assert.deepEqual(user(readSettings(c, 'claude')), { layer: 'user', path: join(home, '.claude/settings.json'), exists: true, data: {}, error: 'the file cannot be read' });
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/config.toml'), 'a = 1\nb = = 2\n');
  const codex = user(readSettings(c, 'codex'));
  assert.equal(codex.exists, true);
  assert.deepEqual(codex.data, {});
  assert.ok(codex.error && !codex.error.includes('\n'), codex.error);
  const both = readSettings(c, 'claude', { dir: home }).filter((l) => l.path === join(home, '.claude/settings.json')).map((l) => l.layer);
  assert.deepEqual(both, ['user', 'project']);
});

test('valuesOf: highest precedence first, a Codex project entry keyed by its path, no value through a text', () => {
  const layers = [{ layer: 'user', data: { model: 'opus', projects: { '/a.b': { trust_level: 'trusted' } } } }, { layer: 'project', data: { model: 'sonnet' } }, { layer: 'managed', data: { model: 'haiku' } }, { layer: 'local', error: 'x', data: { model: 'x' } }];
  assert.deepEqual(valuesOf(layers, 'claude', 'model').map((v) => v.layer), ['managed', 'project', 'user']);
  assert.deepEqual(valuesOf(layers, 'codex', 'projects./a.b').map((v) => v.value), [{ trust_level: 'trusted' }]);
  assert.deepEqual(valuesOf(layers, 'claude', 'projects./a.b'), []);
  assert.deepEqual(valuesOf(layers, 'claude', 'model.length'), []);
});

test('listSettings: basic and advanced rows, the app value, what is editable, keys outside every list and env entries', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-setv-list-'));
  const c = Object.assign(context({ home, run }), { managedRoot: ctx.managedRoot });
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ model: 'opus', promptCacheTtl: '1h', teammateMode: 'tmux', mystery: { apiKey: 'zz' }, env: { DO_NOT_TRACK: '1', MY_TOKEN: 'q', PLAIN: 'p' } }));
  const basic = listSettings(c, 'claude', { env: {} });
  assert.ok(!basic.settings.some((s) => s.key === 'promptCacheTtl'));
  assert.ok(!('advanced' in basic) && !('trust' in basic) && !('env' in basic));
  const l = listSettings(c, 'claude', { advanced: true, env: {} });
  const row = (k) => l.settings.find((s) => s.key === k);
  assert.equal(row('promptCacheTtl').basic, false);
  assert.equal(row('model').basic, true);
  assert.deepEqual([row('model').layer, row('model').file, row('model').changed, row('model').setByApp, 'appValue' in row('model')], ['user', join(home, '.claude/settings.json'), true, true, false]);
  assert.deepEqual([row('cleanupPeriodDays').layer, row('cleanupPeriodDays').file, row('cleanupPeriodDays').changed, row('cleanupPeriodDays').appValue, row('cleanupPeriodDays').from], [null, null, false, 14, 'default']);
  assert.equal(row('remoteControlAtStartup').setByApp, false);
  const adv = (k) => l.advanced.find((s) => s.key === k);
  assert.deepEqual([adv('teammateMode').editable, adv('teammateMode').inSchema, adv('teammateMode').layer, adv('teammateMode').changed, adv('teammateMode').scope], [true, true, 'user', true, 'Any file']);
  assert.deepEqual([adv('copyOnSelect').editable, adv('copyOnSelect').inSchema, adv('copyOnSelect').layer, adv('copyOnSelect').changed], [false, false, null, false]);
  assert.equal(adv('pluginConfigs').editable, true);
  // The layers a key's scope refuses: the project and local files for a user key, the project file for a user or local one.
  for (const [k, scope, refusedIn] of [['worktree.location', 'User', ['project', 'local']], ['appendPlugins', 'User or managed', ['project', 'local']], ['syncClaudeAiPlugins', 'User, local, or managed', ['project']], ['teammateMode', 'Any file', []]]) assert.deepEqual([adv(k).scope, adv(k).editable, adv(k).refusedIn], [scope, true, refusedIn], k);
  assert.equal(adv('feedbackSurveyRate').scope, 'Any file');
  assert.ok(!l.advanced.some((a) => a.key === 'model'));
  const keys = l.advanced.map((a) => a.key);
  assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : 1)));
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(l.outside, [{ key: 'mystery', layer: 'user', path: join(home, '.claude/settings.json'), value: { apiKey: '(set)' } }]);
  assert.deepEqual(l.env, [{ name: 'DO_NOT_TRACK', layer: 'user', value: '1', secret: false, editable: true }, { name: 'MY_TOKEN', layer: 'user', value: '(set)', secret: true, editable: false }, { name: 'PLAIN', layer: 'user', value: 'p', secret: false, editable: false }]);
  // Codex: a table key is shown but not edited here, the trust list comes from the user file.
  mkdirSync(join(home, '.codex'));
  writeFileSync(join(home, '.codex/config.toml'), 'model = "o3"\n[projects."/gone/x"]\ntrust_level = "trusted"\n[projects."/b"]\n[desktop]\na = 1\n');
  const x = listSettings(c, 'codex', { advanced: true, env: {} });
  assert.deepEqual(x.trust, [{ path: '/gone/x', trust: 'trusted', exists: false }, { path: '/b', trust: null, exists: false }]);
  const cadv = (k) => x.advanced.find((s) => s.key === k);
  assert.deepEqual([cadv('desktop').editable, cadv('desktop').scope, cadv('desktop').docs], [false, null, 'https://learn.chatgpt.com/docs/config-file/config-reference']);
  assert.equal(cadv('otel.exporter').editable, true);
  assert.equal(x.settings.find((s) => s.key === 'model').appValue, undefined);
});

test('a plan names the change, masks a secret by the key and the path, and removes a Codex trust entry only', () => {
  const titles = settingsChanges(ctx, 'claude', { edits: { 'env.MY_TOKEN': null, 'env.ANTHROPIC_API_KEY': 'x', apiKeyHelper: '/bin/k', model: 'sonnet', 'env.DO_NOT_TRACK': true } }).map((ch) => ch.title);
  assert.deepEqual(titles, ['Claude Code user settings: env.MY_TOKEN removed', 'Claude Code user settings: env.ANTHROPIC_API_KEY = (set)', 'Claude Code user settings: apiKeyHelper = (set)', 'Claude Code user settings: model = "sonnet"', 'Claude Code user settings: env.DO_NOT_TRACK = "1"']);
  const [ch] = settingsChanges(ctx, 'claude', { layer: 'project', dir, edits: { model: 'opus' } });
  assert.deepEqual([ch.id, ch.step, ch.kind, ch.path, ch.settings], ['settings:claude:project:model', 'settings:claude', 'write', join(dir, '.claude/settings.json'), { agent: 'claude', keys: ['model'], dir }]);
  const [trust] = settingsChanges(ctx, 'codex', { edits: { 'projects./gone/x': null } });
  assert.equal(trust.title, 'Codex user settings: projects./gone/x removed');
  assert.equal(trust.edit('model = "o3"\n[projects."/gone/x"]\ntrust_level = "trusted"\n'), 'model = "o3"\n');
  assert.equal(refused('codex', 'projects./gone/x', { trust_level: 'trusted' }), 'projects./gone/x: trusted projects are only removed here');
});

test('Doctor: a file an agent cannot read, with the project folder for project layers; with dir the user file is left out', () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-setv-doc-'));
  const c = Object.assign(context({ home, run }), { managedRoot: ctx.managedRoot });
  const proj = mkdtempSync(join(tmpdir(), 'bk-setv-docp-'));
  for (const [base, rel, text] of [[home, '.codex/config.toml', 'x = = 1'], [proj, '.claude/settings.json', '{ bad'], [proj, '.codex/config.toml', 'y = = 1']]) {
    mkdirSync(join(base, rel, '..'), { recursive: true });
    writeFileSync(join(base, rel), text);
  }
  const errors = (opts) => settingsChecks(c, { env: {}, ...opts }).filter((i) => i.level === 'error');
  const fix = 'fix the file by hand, then run benchkeeper doctor again';
  assert.deepEqual(errors({}).map(({ message, fix: f, dir: d }) => [message.replace(/: .*$/, ''), f, d]), [[`Codex cannot read ${join(home, '.codex/config.toml')}`, fix, undefined]]);
  const inProject = errors({ dir: proj });
  assert.deepEqual(inProject.map((i) => [i.check, i.dir]), [['agent-settings', proj], ['agent-settings', proj]]);
  assert.match(inProject[0].message, new RegExp(`^Claude Code cannot read ${join(proj, '.claude/settings.json')}: .+; it skips the whole file$`));
  assert.match(inProject[1].message, new RegExp(`^Codex cannot read ${join(proj, '.codex/config.toml')}: [^;]+$`));
});
