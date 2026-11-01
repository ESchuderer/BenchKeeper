import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { CLAUDE_TOKEN, CODEX_TOKEN, grep, machine, win } from './fixtures/accounts.mjs';
import { NeedsConfirm, accountChecks, accountStatus, findAccount, handover, listAccounts, rotationFor, runAs } from '../src/accounts.mjs';
import { main } from '../src/cli.mjs';
import { runCommand } from '../src/runner.mjs';
import { HOOK_SOURCE, assess, codexReading, limitsFor, parseState, rotation, trackedSettings, usageFindings } from '../src/usage.mjs';
import { FAILURES, LEGACY_MATCHER, failureLine, run as hook, usageRecord } from '../src/usage-hook.mjs';

function cli(m, answers = []) {
  let text = '';
  const sink = new Writable({ write(c, _, done) { text += String(c); done(); } });
  const input = Readable.from(answers);
  input.isTTY = false;
  const exec = (args) => main(args, { out: sink, err: sink, ctx: m.ctx, input });
  return { exec, input, text: () => text, json: () => JSON.parse(text) };
}
const skip = win ? { skip: 'the fake agents are shell scripts' } : {};
const T0 = Date.parse('2026-10-26T12:00:00Z');
const epoch = (ms) => Math.floor(ms / 1000);
const HOUR = 36e5;

// The status line input of Claude Code, with fields the hook must not keep.
const input = (five, seven, extra = {}) => ({ session_id: 's1', cwd: '/work', model: { id: 'x' }, token: CLAUDE_TOKEN, rate_limits: { five_hour: five, seven_day: seven }, ...extra });
const windows = (used5, used7, now = T0) => input({ used_percentage: used5, resets_at: epoch(now + 3 * HOUR) }, { used_percentage: used7, resets_at: epoch(now + 48 * HOUR) });

async function add(m, name, agent = 'claude', ...more) {
  assert.equal(await cli(m).exec(['accounts', 'add', name, '--agent', agent, '--yes', ...more]), 0);
  const a = findAccount(m.ctx, name);
  // A signed-in account: the fake agent looks for the login file.
  if (a.mode === 'host') { mkdirSync(a.dir, { recursive: true }); writeFileSync(join(a.dir, agent === 'claude' ? '.credentials.json' : 'auth.json'), '{}'); }
  return a;
}
// What the status line script of the account would have written, for a given clock.
const reading = (a, five, seven, now = Date.now()) => {
  mkdirSync(join(a.dir, 'benchkeeper'), { recursive: true });
  writeFileSync(join(a.dir, 'benchkeeper', 'usage.json'), JSON.stringify({ schemaVersion: 1, checkedAt: new Date(now).toISOString(), fiveHour: { used: five, resetsAt: epoch(now + 3 * HOUR) }, sevenDay: { used: seven, resetsAt: epoch(now + 48 * HOUR) } }));
};

test('the hook keeps only the two windows and the error type: no token, path, message or session id reaches a file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-usage-'));
  const text = JSON.stringify(windows(41.5, 7));
  assert.equal(hook('statusline', text, dir, T0), '5h 59% left  7d 93% left');
  const kept = readFileSync(join(dir, 'usage.json'), 'utf8');
  assert.deepEqual(JSON.parse(kept), { schemaVersion: 1, checkedAt: '2026-10-26T12:00:00.000Z', fiveHour: { used: 41.5, resetsAt: epoch(T0 + 3 * HOUR) }, sevenDay: { used: 7, resetsAt: epoch(T0 + 48 * HOUR) } });
  assert.equal(statSync(join(dir, 'usage.json')).mode & 0o777, 0o600);
  hook('failure', JSON.stringify({ hook_event_name: 'StopFailure', error: 'authentication_failed', error_details: `Bearer ${CLAUDE_TOKEN}`, last_assistant_message: `API Error ${CLAUDE_TOKEN}`, cwd: '/work', session_id: 's1' }), dir, T0);
  hook('failure', JSON.stringify({ error: 'overloaded' }), dir, T0);
  hook('failure', JSON.stringify({ error: 'something_new' }), dir, T0);
  hook('failure', 'not json', dir, T0);
  assert.equal(readFileSync(join(dir, 'failures.jsonl'), 'utf8'), '{"at":"2026-10-26T12:00:00.000Z","error":"authentication_failed"}\n{"at":"2026-10-26T12:00:00.000Z","error":"overloaded"}\n');
  assert.deepEqual(grep(dir, CLAUDE_TOKEN), []);
  assert.equal(statSync(join(dir, 'failures.jsonl')).mode & 0o777, 0o600);
  // Out of range or missing numbers drop the window; an input without any window keeps the last reading.
  assert.equal(usageRecord(input({ used_percentage: 120, resets_at: epoch(T0) }, { used_percentage: '5', resets_at: 1 }), T0), null);
  assert.equal(usageRecord({}, T0), null);
  assert.equal(hook('statusline', '{}', dir, T0), '');
  assert.equal(JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8')).fiveHour.used, 41.5);
  assert.equal(failureLine({ error: 'rate_limit' }, T0).includes('rate_limit'), true);
});

test('the status line style: usage and Ponytail\'s level from the account folder, usage.json written in every style', () => {
  const account = mkdtempSync(join(tmpdir(), 'bk-style-'));
  const dir = join(account, 'benchkeeper');
  const env = { XDG_CONFIG_HOME: join(account, 'xdg') };
  const style = (v) => writeFileSync(join(account, 'settings.json'), JSON.stringify({ pluginConfigs: { 'benchkeeper@benchkeeper': { options: { statusStyle: v } } } }));
  const level = (v) => writeFileSync(join(account, '.ponytail-active'), `${v}\n`);
  const line = (text = JSON.stringify(windows(41.5, 7))) => hook('statusline', text, dir, T0, env);
  const written = () => { const f = join(dir, 'usage.json'); const r = existsSync(f); rmSync(f, { force: true }); return r; };
  const usage = '5h 59% left  7d 93% left';
  // No flag file: no segment, no error.
  assert.equal(line(), usage);
  level('full');
  assert.equal(line(), `${usage}  \x1b[38;5;108m[PONYTAIL]\x1b[0m`, 'unset is merged');
  style('merged'); level('ultra');
  assert.equal(line(), `${usage}  \x1b[38;5;173m[PONYTAIL:ULTRA]\x1b[0m`);
  level('lite');
  assert.equal(line(), `${usage}  \x1b[38;5;108m[PONYTAIL:LITE]\x1b[0m`);
  style('plugin');
  assert.equal(line(), '\x1b[38;5;108m[PONYTAIL:LITE]\x1b[0m');
  assert.equal(written(), true);
  style('benchkeeper');
  assert.equal(line(), usage);
  assert.equal(written(), true);
  style('none');
  assert.equal(line(), '');
  assert.equal(written(), true);
  style('rainbow');
  assert.match(line(), /^5h .*\[PONYTAIL:LITE\]/, 'an unknown style is merged');
  // An input without rate_limits still shows the level and writes no reading.
  written();
  assert.equal(line('{}'), '\x1b[38;5;108m[PONYTAIL:LITE]\x1b[0m');
  assert.equal(written(), false);
  level('sideways');
  assert.equal(line(), usage, 'an unknown level shows nothing');
  // Ponytail's hide switch: hideStatus in its config, or the variable, which wins.
  level('full');
  mkdirSync(join(account, 'xdg', 'ponytail'), { recursive: true });
  writeFileSync(join(account, 'xdg', 'ponytail', 'config.json'), '{"hideStatus":true}');
  assert.equal(line(), usage);
  assert.equal(hook('statusline', '{}', dir, T0, { ...env, PONYTAIL_HIDE_STATUS: '0' }), '\x1b[38;5;108m[PONYTAIL]\x1b[0m');
  assert.equal(hook('statusline', '{}', dir, T0, { PONYTAIL_HIDE_STATUS: '1' }), '');
});

test('the failure file keeps its last 20 lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-usage-'));
  for (let i = 0; i < 25; i++) hook('failure', JSON.stringify({ error: 'rate_limit' }), dir, T0 + i * 1000);
  const lines = readFileSync(join(dir, 'failures.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 20);
  assert.match(lines[0], /12:00:05/);
});

test('assess with a fake clock: below the minimum is low, at it is fine, a reset window is unknown, never full', () => {
  const limits = limitsFor(undefined);
  assert.deepEqual(limits, { minimum: { fiveHour: 8, sevenDay: 3 }, warn: { fiveHour: 16, sevenDay: 6 } });
  const state = (five, seven) => parseState(JSON.stringify({ checkedAt: new Date(T0).toISOString(), fiveHour: { used: five, resetsAt: epoch(T0 + HOUR) }, sevenDay: { used: seven, resetsAt: epoch(T0 + 10 * HOUR) } }), '');
  const states = (u) => [u.fiveHour.state, u.sevenDay.state];
  assert.deepEqual(states(assess(state(50, 50), limits, T0)), ['ok', 'ok']);
  assert.deepEqual(states(assess(state(92, 97), limits, T0)), ['warn', 'warn'], 'exactly the minimum is not low');
  assert.deepEqual(states(assess(state(84, 94), limits, T0)), ['ok', 'ok'], 'exactly the notice level is fine');
  assert.deepEqual(states(assess(state(92.5, 97.5), limits, T0)), ['low', 'low']);
  assert.deepEqual(states(assess(state(85, 95), limits, T0)), ['warn', 'warn']);
  assert.equal(assess(state(95, 50), limits, T0).fiveHour.remaining, 5);
  assert.equal(assess(state(50, 50), limits, T0 + 5 * 60e3).ageSeconds, 300);
  // The 5-hour window reset one hour on: its reading is unknown, the weekly one still holds.
  const later = assess(state(99, 99), limits, T0 + 2 * HOUR);
  assert.deepEqual(states(later), ['unknown', 'low']);
  assert.equal(later.fiveHour.reason, 'the window has reset since the last reading');
  assert.equal(later.fiveHour.remaining, null);
  // No file, a file that is not one, values out of range: not tracked or unknown.
  assert.equal(assess(parseState(null, null), limits, T0).tracked, false);
  assert.equal(assess(parseState('[1]', ''), limits, T0).tracked, false);
  const hostile = parseState(JSON.stringify({ checkedAt: new Date(T0).toISOString(), fiveHour: { used: 'a', resetsAt: 5 }, sevenDay: { used: -3, resetsAt: epoch(T0 + HOUR) } }), 'x\n{"error":"rate_limit","at":"nope"}\n{"error":"other","at":"2026-10-26T11:00:00Z"}');
  assert.deepEqual(states(assess(hostile, limits, T0)), ['unknown', 'unknown']);
  assert.deepEqual(hostile.failures, []);
  // Failures older than a day are not shown.
  const f = parseState(null, `{"error":"rate_limit","at":"${new Date(T0 - 25 * HOUR).toISOString()}"}\n{"error":"billing_error","at":"${new Date(T0 - HOUR).toISOString()}"}\n`);
  assert.deepEqual(assess(f, limits, T0).failures.map((x) => x.error), ['billing_error']);
  // Thresholds: an account's own value wins over the settings, which win over the defaults; the notice is never below the minimum.
  const settings = { minimum: { fiveHour: 20 }, warn: { sevenDay: 1 } };
  assert.deepEqual(limitsFor(settings, { limits: { minimum: { sevenDay: 10 } } }), { minimum: { fiveHour: 20, sevenDay: 10 }, warn: { fiveHour: 40, sevenDay: 10 } });
});

test('every documented StopFailure error type is kept and has a finding', () => {
  const limits = limitsFor();
  const state = parseState(null, FAILURES.map((error) => `{"error":"${error}","at":"${new Date(T0 - HOUR).toISOString()}"}`).join('\n') + '\n');
  const found = usageFindings('main', assess(state, limits, T0), 'relogin');
  assert.equal(found.length, 12);
  assert.ok(found.every((f) => f.message && f.fix));
  assert.equal(failureLine({ error: 'cloud_credential_error' }, T0).includes('cloud_credential_error'), true);
  assert.equal(failureLine({ error: 'other' }, T0), null);
});

test('settings.json: the status line and the hook are added next to the user\'s own and taken out again', () => {
  const script = '/home/u/acct/benchkeeper/usage.mjs';
  const own = '{\n  "model": "x",\n  "hooks": { "StopFailure": [{ "matcher": "overloaded", "hooks": [{ "type": "command", "command": "echo hi" }] }] }\n}\n';
  const on = trackedSettings(own, script);
  const doc = JSON.parse(on);
  assert.equal(doc.model, 'x');
  assert.equal(doc.statusLine.command, `node "${script}" statusline`);
  assert.equal(doc.hooks.StopFailure.length, 2);
  assert.equal(doc.hooks.StopFailure[0].hooks[0].command, 'echo hi');
  assert.equal(doc.hooks.StopFailure[1].matcher, FAILURES.join('|'));
  assert.equal(FAILURES.length, 12, 'every StopFailure error type the hooks page documents');
  // An entry an earlier version installed (three types) is replaced, not duplicated, and taken out again.
  const legacy = JSON.parse(own);
  legacy.hooks.StopFailure.push({ matcher: LEGACY_MATCHER, hooks: [{ type: 'command', command: `node "${script}" failure` }] });
  assert.deepEqual(JSON.parse(trackedSettings(JSON.stringify(legacy), script)).hooks.StopFailure, doc.hooks.StopFailure);
  assert.deepEqual(JSON.parse(trackedSettings(JSON.stringify(legacy), script, { remove: true })), JSON.parse(own));
  assert.equal(trackedSettings(on, script), on, 'twice changes nothing');
  // A formatter that reorders the keys of an installed entry does not hide it.
  const reordered = JSON.parse(own);
  reordered.hooks.StopFailure.push({ hooks: [{ command: `node "${script}" failure`, type: 'command' }], matcher: LEGACY_MATCHER });
  assert.deepEqual(JSON.parse(trackedSettings(JSON.stringify(reordered), script)).hooks.StopFailure, doc.hooks.StopFailure);
  assert.deepEqual(JSON.parse(trackedSettings(JSON.stringify(reordered), script, { remove: true })), JSON.parse(own));
  assert.deepEqual(JSON.parse(trackedSettings(on, script, { remove: true })), JSON.parse(own));
  assert.equal(trackedSettings(null, script, { remove: true }), null);
  assert.deepEqual(JSON.parse(trackedSettings(trackedSettings(null, script), script, { remove: true })), {});
  // A status line of another kind is not replaced; a path with shell characters is refused.
  assert.throws(() => trackedSettings('{"statusLine":{"type":"command","command":"my-line"}}', script), /already has a status line of its own/);
  // Ponytail's own status line is replaced; one combined with another command is not.
  const ponytail = '{"statusLine":{"type":"command","command":"bash \\"/home/u/.claude/ponytail-statusline.sh\\"","padding":0}}\n';
  assert.deepEqual(JSON.parse(trackedSettings(ponytail, script)).statusLine, { type: 'command', command: `node "${script}" statusline` });
  // The replaced line is kept and written back by remove, padding and all.
  assert.deepEqual(JSON.parse(trackedSettings(trackedSettings(trackedSettings(ponytail, script), script), script, { remove: true })), JSON.parse(ponytail));
  assert.equal(JSON.parse(trackedSettings('{"statusLine":{"command":"powershell -File C:\\\\u\\\\.claude\\\\ponytail-statusline.ps1"}}', script)).statusLine.command, `node "${script}" statusline`);
  assert.equal(JSON.parse(trackedSettings(JSON.stringify({ statusLine: { command: 'bash "$HOME/.claude/ponytail-statusline.sh"' } }), script)).statusLine.command, `node "${script}" statusline`);
  for (const command of ['my-line && bash ~/.claude/ponytail-statusline.sh', 'bash ~/.claude/ponytail-statusline.sh; my-line', 'bash $(echo ponytail-statusline.sh)', 'bash ~/.claude/my-ponytail-statusline.sh']) {
    assert.throws(() => trackedSettings(JSON.stringify({ statusLine: { type: 'command', command } }), script), /already has a status line of its own/, command);
  }
  assert.throws(() => trackedSettings(null, '/x/$(id)/usage.mjs'), /do not go into a hook command/);
  assert.match(HOOK_SOURCE, /^\/\/ Runs inside one account's folder/);
});

test('track: a plan with a diff and an undo; the installed script writes what status reads; no token reaches the folder', skip, async () => {
  const m = machine({ flow: 'callback' });
  const a = await add(m, 'work');
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'track', 'work', '--yes']), 0, c.text());
  assert.match(c.text(), /tracking starts with the next Claude Code session/);
  const script = join(a.dir, 'benchkeeper', 'usage.mjs');
  assert.equal(readFileSync(script, 'utf8'), HOOK_SOURCE);
  const settings = JSON.parse(readFileSync(join(a.dir, 'settings.json'), 'utf8'));
  assert.equal(settings.statusLine.command, `node "${script}" statusline`);
  // Nothing is read yet.
  const s0 = cli(m);
  assert.equal(await s0.exec(['accounts', 'status', 'work']), 0);
  assert.match(s0.text(), /signed in/);
  // Run the installed script the way Claude Code does: the input on stdin, the readings land in the folder.
  const now = Date.now();
  const r = runCommand([process.execPath, script, 'statusline'], { input: JSON.stringify(windows(30, 96, now)) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(runCommand([process.execPath, script, 'failure'], { input: JSON.stringify({ error: 'authentication_failed', last_assistant_message: CLAUDE_TOKEN }) }).code, 0);
  const s = cli(m);
  assert.equal(await s.exec(['accounts', 'status', 'work']), 0);
  assert.match(s.text(), /usage {4}5-hour 70% left, resets .*; 7-day 4% left, resets .*; read \d+ seconds ago/);
  assert.match(s.text(), /warning {2}account work: the last session ended with an authentication failure at .*\n {11}fix: benchkeeper accounts login work/);
  const j = cli(m);
  await j.exec(['accounts', 'status', 'work', '--json']);
  const u = j.json().accounts[0].usage;
  assert.deepEqual(Object.keys(u), ['tracked', 'checkedAt', 'ageSeconds', 'minimum', 'warn', 'fiveHour', 'sevenDay', 'failures']);
  assert.deepEqual([u.tracked, u.fiveHour.state, u.fiveHour.remaining, u.sevenDay.state, u.sevenDay.remaining, u.failures.map((f) => f.error)], [true, 'ok', 70, 'warn', 4, ['authentication_failed']]);
  assert.deepEqual(grep(a.dir, CLAUDE_TOKEN), []);
  // doctor reports the failure under the same check; a login that failed is a warning, not an error.
  const checks = accountChecks(m.ctx, {});
  assert.ok(checks.some((f) => f.level === 'warning' && /authentication failure/.test(f.message)));
  assert.ok(checks.every((f) => f.level !== 'error'));
  // Undo restores the folder as it was: no script, no settings.json.
  const run = m.ctx.ledger.list().find((x) => x.entries.some((e) => /usage script/.test(e.title)));
  const u1 = cli(m);
  assert.equal(await u1.exec(['undo', run.id]), 0, u1.text());
  assert.equal(existsSync(script), false);
  assert.equal(existsSync(join(a.dir, 'settings.json')), false);
  // --off on a tracked account removes both again (the plan is the same kind).
  await cli(m).exec(['accounts', 'track', 'work', '--yes']);
  const off = cli(m);
  assert.equal(await off.exec(['accounts', 'track', 'work', '--off', '--yes']), 0, off.text());
  assert.match(off.text(), /removed/);
  assert.equal(existsSync(script), false);
  assert.deepEqual(JSON.parse(readFileSync(join(a.dir, 'settings.json'), 'utf8')), {});
  const again = cli(m);
  assert.equal(await again.exec(['accounts', 'track', 'work', '--off', '--yes']), 0);
  assert.match(again.text(), /nothing to change/);
});

test('track: a status line that only runs Ponytail\'s script is replaced, and undo restores it byte for byte', skip, async () => {
  const m = machine();
  const a = await add(m, 'work');
  const own = '{\n    "statusLine": { "type": "command", "command": "bash \\"/home/u/.claude/ponytail-statusline.sh\\"" }\n}\n';
  writeFileSync(join(a.dir, 'settings.json'), own);
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'track', 'work', '--yes']), 0, c.text());
  assert.match(JSON.parse(readFileSync(join(a.dir, 'settings.json'), 'utf8')).statusLine.command, /usage\.mjs" statusline$/);
  const run = m.ctx.ledger.list().find((x) => x.entries.some((e) => /usage script/.test(e.title)));
  assert.equal(await cli(m).exec(['undo', run.id]), 0);
  assert.equal(readFileSync(join(a.dir, 'settings.json'), 'utf8'), own);
  // --off writes the replaced line back, and its plan shows it.
  assert.equal(await cli(m).exec(['accounts', 'track', 'work', '--yes']), 0);
  const plan = cli(m, ['n\n'.repeat(10)]);
  assert.equal(await plan.exec(['accounts', 'track', 'work', '--off']), 1);
  assert.match(plan.text(), /-.*usage\.mjs\\" statusline[\s\S]*ponytail-statusline\.sh/);
  assert.equal(await cli(m).exec(['accounts', 'track', 'work', '--off', '--yes']), 0);
  assert.deepEqual(JSON.parse(readFileSync(join(a.dir, 'settings.json'), 'utf8')), JSON.parse(own));
});

test('track: an account folder outside the home folder is written and undone', skip, async () => {
  const m = machine();
  const a = await add(m, 'work', 'claude', '--dir', join(m.root, 'elsewhere', 'work'));
  assert.equal(await cli(m).exec(['accounts', 'track', 'work', '--yes']), 0);
  assert.ok(existsSync(join(a.dir, 'settings.json')));
  const run = m.ctx.ledger.list().find((x) => x.entries.some((e) => /usage script/.test(e.title)));
  const u = cli(m);
  assert.equal(await u.exec(['undo', run.id]), 0, u.text());
  assert.equal(existsSync(join(a.dir, 'settings.json')), false);
});

test('track: a status line of the user\'s own is an error in the plan and nothing is written; Codex has no usage source', skip, async () => {
  const m = machine();
  const a = await add(m, 'work');
  writeFileSync(join(a.dir, 'settings.json'), '{"statusLine":{"type":"command","command":"my-line"}}\n');
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'track', 'work', '--yes']), 1);
  assert.match(c.text(), /already has a status line of its own/);
  assert.equal(existsSync(join(a.dir, 'benchkeeper', 'usage.mjs')), false);
  const x = await add(m, 'dev', 'codex');
  const t = cli(m);
  assert.equal(await t.exec(['accounts', 'track', 'dev', '--yes']), 1);
  assert.match(t.text(), /Codex has no status line to track/);
  const st = cli(m);
  assert.equal(await st.exec(['accounts', 'status', 'dev', '--json']), 0);
  assert.equal(st.json().accounts[0].usage, null);
  assert.equal(accountStatus(m.ctx, x).usage, null);
});

test('limits: defaults, per-account values, the pool, and the refusals', skip, async () => {
  const m = machine();
  await add(m, 'work');
  await add(m, 'home');
  const show = cli(m);
  assert.equal(await show.exec(['accounts', 'limits']), 0);
  assert.match(show.text(), /defaults: minimum headroom 5-hour 8% \(notice below 16%\), 7-day 3% \(notice below 6%\)\nauto-pick off; when no pool member has headroom: stop; below the minimum run asks\nrotation: claude off, codex off\n$/);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--five-hour', '10', '--warn-seven-day', '9', '--auto-pick', 'on', '--when-none', 'wait', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', 'work', '--seven-day', '5', '--pool', 'me', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', 'home', '--pool', 'me', '--yes']), 0);
  const doc = JSON.parse(readFileSync(join(m.ctx.config, 'accounts.json'), 'utf8'));
  assert.deepEqual(doc.settings, { minimum: { fiveHour: 10 }, warn: { sevenDay: 9 }, autoPick: true, whenNone: 'wait' });
  assert.deepEqual([doc.accounts[0].limits, doc.accounts[0].pool, doc.accounts[1].pool], [{ minimum: { sevenDay: 5 } }, 'me', 'me']);
  const l = cli(m);
  assert.equal(await l.exec(['accounts', 'list', '--json']), 0);
  assert.deepEqual(l.json().accounts[0].limits, { minimum: { fiveHour: 10, sevenDay: 5 }, warn: { fiveHour: 20, sevenDay: 9 } });
  assert.equal(l.json().accounts[0].pool, 'me');
  assert.deepEqual(l.json().settings.minimum, { fiveHour: 10, sevenDay: 3 });
  assert.equal(l.json().settings.autoPick, true);
  const text = cli(m);
  await text.exec(['accounts', 'limits']);
  assert.match(text.text(), /auto-pick on; when no pool member has headroom: wait/);
  assert.match(text.text(), /work: minimum headroom 5-hour 10% .*7-day 5%.*; pool me\nhome: defaults; pool me/);
  // --reset drops an account's values, --pool none its pool, and the undo of a change restores the file.
  assert.equal(await cli(m).exec(['accounts', 'limits', 'work', '--reset', '--pool', 'none', '--yes']), 0);
  assert.equal(listAccounts(m.ctx)[0].limits, undefined);
  assert.equal(listAccounts(m.ctx)[0].pool, undefined);
  const run = m.ctx.ledger.list().find((r) => r.entries[0].title.startsWith('reset the usage thresholds'));
  assert.equal(await cli(m).exec(['undo', run.id]), 0);
  assert.equal(listAccounts(m.ctx)[0].pool, 'me');
  // Refusals leave the file alone.
  const before = readFileSync(join(m.ctx.config, 'accounts.json'), 'utf8');
  for (const [args, message, code] of [
    [['--five-hour', '150'], /--five-hour is a percentage/, 2], [['--seven-day', ''], /--seven-day is a percentage/, 2], [['--auto-pick', 'maybe'], /--auto-pick is on or off/, 2],
    [['--when-none', 'sleep'], /--when-none is stop or wait/, 2], [['work', '--auto-pick', 'on'], /settings for all accounts/, 2], [['--pool', 'me'], /belong to one account/, 2],
    // A pool name the plan cannot take is a change that cannot be made.
    [['work', '--pool', 'Not A Name'], /a pool name is 1 to 32/], [['ghost', '--five-hour', '5'], /no account ghost/, 2]]) {
    const r = cli(m);
    assert.equal(await r.exec(['accounts', 'limits', ...args, '--yes']), code ?? 1, `${args.join(' ')}: ${r.text()}`);
    assert.match(r.text(), message);
  }
  assert.equal(readFileSync(join(m.ctx.config, 'accounts.json'), 'utf8'), before);
});

// run: the launch preflight

const launches = (m) => m.calls().filter((x) => x.me === 'claude' && x.args[0] === '--go');
const go = (m, c, ...flags) => c.exec(['run', ...flags, '--', 'claude', '--go']);

test('run below the minimum asks first; yes, --yes or the setting starts anyway; above the minimum it just starts', skip, async () => {
  const m = machine();
  const a = await add(m, 'work');
  reading(a, 50, 50);
  const ok = cli(m);
  assert.equal(await go(m, ok), 0);
  assert.equal(launches(m).length, 1);
  assert.doesNotMatch(ok.text(), /minimum/);
  // A notice level is not a stop: the account and the window are named, and the launch goes on.
  reading(a, 88, 50);
  const warn = cli(m);
  assert.equal(await go(m, warn), 0);
  assert.equal(launches(m).length, 2);
  assert.match(warn.text(), /notice: account work: 5-hour window has 12% left \(notice below 16%, resets .+ UTC\) \(a long task may not finish before the reset: --account <name> starts under another account\)/);
  assert.doesNotMatch(ok.text(), /notice:/);
  // Below the minimum: the account, the window, what is left and the reset are shown, then the question.
  reading(a, 95, 50);
  const no = cli(m, ['n\n']);
  assert.equal(await go(m, no), 1);
  assert.match(no.text(), /warning: account work: 5-hour window has 5% left, below the minimum of 8% \(resets \d{4}-\d\d-\d\d \d\d:\d\d UTC\)/);
  assert.match(no.text(), /Start anyway\? \[y\/N\] not started/);
  assert.equal(launches(m).length, 2);
  const yes = cli(m, ['y\n']);
  assert.equal(await go(m, yes), 0);
  assert.equal(launches(m).length, 3);
  assert.equal(await go(m, cli(m), '--yes'), 0);
  assert.equal(launches(m).length, 4);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--continue-below', 'on', '--yes']), 0);
  assert.equal(await go(m, cli(m)), 0);
  assert.equal(launches(m).length, 5);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--continue-below', 'off', '--yes']), 0);
  // The weekly window counts too, and a per-account minimum moves the line.
  reading(a, 50, 98);
  assert.equal(await go(m, cli(m)), 2);
  assert.equal(await cli(m).exec(['accounts', 'limits', 'work', '--seven-day', '1', '--yes']), 0);
  assert.equal(await go(m, cli(m)), 0);
});

test('run: stale or missing readings are unknown, not full and not low', skip, async () => {
  const m = machine();
  const a = await add(m, 'work');
  assert.equal(await go(m, cli(m)), 0, 'not tracked');
  reading(a, 99, 10, Date.now() - 5 * 36e5);
  assert.equal(await go(m, cli(m)), 0, 'both windows reset since the reading');
  const s = cli(m);
  await s.exec(['accounts', 'status', 'work']);
  assert.match(s.text(), /5-hour unknown \(the window has reset since the last reading\)/);
});

test('auto-pick is off by default: below the minimum the chosen account stays chosen, and asks', skip, async () => {
  const m = machine();
  const a = await add(m, 'work'), b = await add(m, 'home');
  assert.equal(await cli(m).exec(['accounts', 'limits', 'work', '--pool', 'me', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', 'home', '--pool', 'me', '--yes']), 0);
  reading(a, 97, 10);
  reading(b, 10, 10);
  const c = cli(m);
  assert.equal(await go(m, c), 2);
  assert.match(c.text(), /Start anyway\?/);
  assert.equal(launches(m).length, 0);
  assert.equal(await go(m, cli(m), '--yes'), 0);
  assert.equal(launches(m)[0].env.CLAUDE_CONFIG_DIR, a.dir);
});

test('auto-pick on: a new launch under the default account starts under the pool member with the most headroom, and says so', skip, async () => {
  const m = machine();
  const work = await add(m, 'work'), home = await add(m, 'home'), spare = await add(m, 'spare'), other = await add(m, 'other');
  for (const n of ['work', 'home', 'spare']) assert.equal(await cli(m).exec(['accounts', 'limits', n, '--pool', 'me', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--auto-pick', 'on', '--yes']), 0);
  reading(work, 97, 10);
  reading(home, 60, 10);
  reading(spare, 30, 10);
  reading(other, 0, 0);
  const c = cli(m);
  assert.equal(await go(m, c), 0, c.text());
  assert.match(c.text(), /auto-pick: starting under account spare of pool me \(70% left\) instead of work/);
  assert.equal(launches(m).length, 1);
  assert.equal(launches(m)[0].env.CLAUDE_CONFIG_DIR, spare.dir, 'one launch, under the pick; the account outside the pool is never one');
  // An account named with --account is never replaced.
  const named = cli(m);
  assert.equal(await go(m, named, '--account', 'work'), 2);
  assert.match(named.text(), /Start anyway\?/);
  assert.equal(launches(m).length, 1);
  // A member that is below its minimum, unknown, or not tracked is no candidate.
  reading(spare, 99, 10);
  reading(home, 60, 10, Date.now() - 5 * 36e5);
  const none = cli(m);
  assert.equal(await go(m, none), 1);
  assert.match(none.text(), /no account of pool me is at or above its minimum; the earliest reset is \d{4}-\d\d-\d\dT.* \(account (work|spare)\)/);
  assert.equal(launches(m).length, 1);
  // An account that is not in a pool has no candidates: the usual question.
  assert.equal(await cli(m).exec(['accounts', 'limits', 'work', '--pool', 'none', '--yes']), 0);
  const solo = cli(m);
  assert.equal(await go(m, solo), 2);
  assert.match(solo.text(), /Start anyway\?/);
});

test('auto-pick with when-none wait: sleeps until the earliest reset, then starts under that account', skip, async () => {
  const m = machine();
  const work = await add(m, 'work'), home = await add(m, 'home');
  for (const n of ['work', 'home']) assert.equal(await cli(m).exec(['accounts', 'limits', n, '--pool', 'me', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--auto-pick', 'on', '--when-none', 'wait', '--yes']), 0);
  const now = Date.now();
  mkdirSync(join(work.dir, 'benchkeeper'), { recursive: true });
  mkdirSync(join(home.dir, 'benchkeeper'), { recursive: true });
  const put = (a, resetsIn) => writeFileSync(join(a.dir, 'benchkeeper', 'usage.json'), JSON.stringify({ checkedAt: new Date(now).toISOString(), fiveHour: { used: 99, resetsAt: epoch(now + resetsIn) }, sevenDay: { used: 10, resetsAt: epoch(now + 48 * HOUR) } }));
  put(work, 3 * HOUR);
  put(home, 2 * HOUR);
  const slept = [];
  const ctx = { ...m.ctx, sleep: (ms) => slept.push(ms) };
  const lines = [];
  const code = runAs(ctx, findAccount(ctx, 'work'), ['claude', '--go'], { dir: m.root, pick: true, now, say: (l) => lines.push(l) });
  assert.equal(code, 0);
  assert.deepEqual(slept, [2 * HOUR - (now % 1000)]);
  assert.match(lines.join('\n'), /waiting until .* for account home/);
  assert.equal(launches(m)[0].env.CLAUDE_CONFIG_DIR, home.dir);
});

test('a launch checks usage once and never touches a session that runs: status and limits do not start or stop an agent', skip, async () => {
  const m = machine();
  const a = await add(m, 'work');
  reading(a, 50, 50);
  assert.equal(await go(m, cli(m)), 0);
  const before = m.calls().length;
  await cli(m).exec(['accounts', 'status']);
  await cli(m).exec(['accounts', 'limits', '--auto-pick', 'on', '--yes']);
  assert.deepEqual(m.calls().slice(before).filter((x) => x.me === 'claude' && x.args[0] !== 'auth'), []);
  assert.throws(() => runAs(m.ctx, a, ['codex'], { dir: m.root }), /is a claude account/);
  assert.ok(new NeedsConfirm().message.includes('--yes'));
});

test('a dev container account: usage and failures are read through devcontainer exec, track writes the volume and --off removes', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{ "name": "x" }\n');
  assert.equal(await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/boxed', '--yes']), 0);
  m.mode('container-login', 'yes');
  const vol = (p) => join(m.bin, 'vol', p);
  // Not checked without a project: no usage either.
  const s0 = cli(m);
  await s0.exec(['accounts', 'status', 'boxed', '--json']);
  assert.equal(s0.json().accounts[0].usage, null);
  const t = cli(m);
  assert.equal(await t.exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 0, t.text());
  assert.match(t.text(), /statusLine/);
  const settings = JSON.parse(readFileSync(vol('/data/boxed/settings.json'), 'utf8'));
  assert.equal(settings.statusLine.command, 'node "/data/boxed/benchkeeper/usage.mjs" statusline');
  assert.equal(readFileSync(vol('/data/boxed/benchkeeper/usage.mjs'), 'utf8'), HOOK_SOURCE);
  const now = Date.now();
  mkdirSync(vol('/data/boxed/benchkeeper'), { recursive: true });
  writeFileSync(vol('/data/boxed/benchkeeper/usage.json'), JSON.stringify({ checkedAt: new Date(now).toISOString(), fiveHour: { used: 96, resetsAt: epoch(now + HOUR) }, sevenDay: { used: 5, resetsAt: epoch(now + 48 * HOUR) } }));
  writeFileSync(vol('/data/boxed/benchkeeper/failures.jsonl'), `{"at":"${new Date(now).toISOString()}","error":"rate_limit"}\n`);
  const s = cli(m);
  assert.equal(await s.exec(['accounts', 'status', 'boxed', '--project', project, '--json']), 0);
  const u = s.json().accounts[0].usage;
  assert.deepEqual([u.fiveHour.state, u.fiveHour.remaining, u.failures.length], ['low', 4, 1]);
  assert.ok(s.json().accounts[0].findings.some((f) => /5-hour window has 4% left/.test(f.message)));
  const off = cli(m);
  assert.equal(await off.exec(['accounts', 'track', 'boxed', '--off', '--project', project, '--yes']), 0, off.text());
  assert.equal(existsSync(vol('/data/boxed/benchkeeper/usage.mjs')), false);
  assert.deepEqual(JSON.parse(readFileSync(vol('/data/boxed/settings.json'), 'utf8')), {});
  // Asked without --yes: no answer refuses and nothing is written.
  const no = cli(m);
  assert.equal(await no.exec(['accounts', 'track', 'boxed', '--project', project]), 2);
  assert.equal(existsSync(vol('/data/boxed/benchkeeper/usage.mjs')), false);
});

test('the script runs from a folder reached through a link; a huge or non-regular state file is read as missing', skip, async () => {
  const m = machine();
  const a = await add(m, 'work');
  assert.equal(await cli(m).exec(['accounts', 'track', 'work', '--yes']), 0);
  const link = join(m.root, 'link');
  symlinkSync(a.dir, link);
  const r = runCommand([process.execPath, join(link, 'benchkeeper', 'usage.mjs'), 'statusline'], { input: JSON.stringify(windows(30, 50, Date.now())) });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /5h 70% left/);
  assert.equal(JSON.parse(readFileSync(join(a.dir, 'benchkeeper', 'usage.json'), 'utf8')).fiveHour.used, 30);
  writeFileSync(join(a.dir, 'benchkeeper', 'usage.json'), ' '.repeat(70000));
  assert.equal(accountStatus(m.ctx, a).usage.tracked, false);
  writeFileSync(join(a.dir, 'benchkeeper', 'usage.json'), '{}');
  assert.equal(accountStatus(m.ctx, a).usage.tracked, false);
  mkdirSync(join(a.dir, 'benchkeeper', 'failures.jsonl'));
  assert.deepEqual(accountStatus(m.ctx, a).usage.failures, []);
});

test('auto-pick on with no member above its minimum: --yes goes on under the chosen account, the setting stop refuses without it', skip, async () => {
  const m = machine();
  const work = await add(m, 'work'), home = await add(m, 'home');
  for (const n of ['work', 'home']) assert.equal(await cli(m).exec(['accounts', 'limits', n, '--pool', 'me', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--auto-pick', 'on', '--yes']), 0);
  reading(work, 99, 10);
  reading(home, 99, 10);
  assert.equal(await go(m, cli(m)), 1);
  assert.equal(launches(m).length, 0);
  assert.equal(await go(m, cli(m), '--yes'), 0);
  assert.equal(launches(m)[0].env.CLAUDE_CONFIG_DIR, work.dir);
});

test('a dev container account: --off writes back the Ponytail status line that track replaced', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{ "name": "x" }\n');
  assert.equal(await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/boxed', '--yes']), 0);
  const vol = (p) => join(m.bin, 'vol', p);
  const own = { statusLine: { type: 'command', command: 'bash "/data/boxed/ponytail-statusline.sh"' } };
  mkdirSync(vol('/data/boxed'), { recursive: true });
  writeFileSync(vol('/data/boxed/settings.json'), JSON.stringify(own));
  assert.equal(await cli(m).exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 0);
  assert.match(JSON.parse(readFileSync(vol('/data/boxed/settings.json'), 'utf8')).statusLine.command, /usage\.mjs" statusline$/);
  const off = cli(m);
  assert.equal(await off.exec(['accounts', 'track', 'boxed', '--off', '--project', project, '--yes']), 0, off.text());
  assert.match(off.text(), /-.*usage\.mjs\\" statusline[\s\S]*ponytail-statusline\.sh/);
  assert.deepEqual(JSON.parse(readFileSync(vol('/data/boxed/settings.json'), 'utf8')), own);
});

test('a dev container track twice or --off twice has nothing to change; the script is written before the settings that name it', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{ "name": "x" }\n');
  assert.equal(await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/boxed', '--yes']), 0);
  const off0 = cli(m);
  assert.equal(await off0.exec(['accounts', 'track', 'boxed', '--off', '--project', project, '--yes']), 0);
  assert.match(off0.text(), /nothing to change/);
  assert.equal(await cli(m).exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 0);
  const writes = m.calls().filter((x) => x.me === 'devcontainer' && x.args.includes('tee')).map((x) => x.args.at(-1));
  assert.deepEqual(writes, ['/data/boxed/benchkeeper/usage.mjs', '/data/boxed/settings.json']);
  const again = cli(m);
  assert.equal(await again.exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 0);
  assert.match(again.text(), /nothing to change/);
});

test('a dev container whose settings.json cannot be read is not an empty one: nothing is written', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{ "name": "x" }\n');
  assert.equal(await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/boxed', '--yes']), 0);
  m.mode('cat', 'fail');
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 1);
  assert.match(c.text(), /could not read \/data\/boxed\/settings.json in the container: devcontainer exec failed/);
  assert.deepEqual(m.calls().filter((x) => x.args.includes('tee')), []);
});

test('a dev container account of an agent without a usage source is refused before the container is touched', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{ "name": "x" }\n');
  assert.equal(await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'codex', '--container', '--mount', '/data/boxed', '--yes']), 0);
  const before = m.calls().length;
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 1);
  assert.match(c.text(), /Codex has no status line to track/);
  assert.equal(m.calls().length, before);
});

test('a container settings.json diff is masked like a host one before it is shown', skip, async () => {
  const m = machine();
  const project = join(m.root, 'project');
  mkdirSync(join(project, '.devcontainer'), { recursive: true });
  writeFileSync(join(project, '.devcontainer/devcontainer.json'), '{ "name": "x" }\n');
  assert.equal(await cli(m).exec(['accounts', 'add', 'boxed', '--agent', 'claude', '--container', '--mount', '/data/boxed', '--yes']), 0);
  mkdirSync(join(m.bin, 'vol/data/boxed'), { recursive: true });
  writeFileSync(join(m.bin, 'vol/data/boxed/settings.json'), JSON.stringify({ env: { ANTHROPIC_API_KEY: 'dummy-key-value-0123456789', GH_TOKEN: 'dummy-gh-value' }, model: 'x' }, null, 2));
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'track', 'boxed', '--project', project, '--yes']), 0, c.text());
  assert.doesNotMatch(c.text(), /dummy-key-value|dummy-gh-value/);
  assert.match(readFileSync(join(m.bin, 'vol/data/boxed/settings.json'), 'utf8'), /dummy-key-value-0123456789/, 'the file keeps what it had');
});

// The answer of account/rateLimits/read, as the fake app-server gives it.
const codexLimits = (m, primary, secondary = null) => m.mode('limits', JSON.stringify({ limitId: 'codex', primary, secondary, planType: 'plus' }));
const codexWindow = (used, mins, now = Date.now()) => ({ usedPercent: used, windowDurationMins: mins, resetsAt: epoch(now + 3 * HOUR) });

test('Codex app-server answers: windows by their length, used capped at 100, nothing else kept; an error or no answer is a reason', () => {
  const answer = (rateLimits) => JSON.stringify({ id: 2, result: { accountId: 'acct-1', rateLimits } });
  const both = codexReading(answer({ primary: codexWindow(95, 300, T0), secondary: codexWindow(120, 10080, T0), planType: 'pro' }), T0);
  assert.deepEqual(both.usage, { checkedAt: new Date(T0).toISOString(), fiveHour: { used: 95, resetsAt: epoch(T0 + 3 * HOUR) }, sevenDay: { used: 100, resetsAt: epoch(T0 + 3 * HOUR) } });
  // A plan without the 5-hour window sends the weekly one as primary; an unknown length is dropped.
  const weekly = codexReading(answer({ primary: codexWindow(40, 10080, T0), secondary: codexWindow(10, 60, T0) }), T0);
  assert.equal(weekly.usage.fiveHour, null);
  assert.equal(weekly.usage.sevenDay.used, 40);
  assert.equal(assess({ usage: weekly.usage, failures: [] }, limitsFor(undefined), T0).fiveHour.state, 'unknown');
  assert.deepEqual(codexReading(JSON.stringify({ id: 2, error: { code: -32600, message: 'codex account authentication required to read rate limits' } }), T0), { usage: null, reason: 'codex account authentication required to read rate limits' });
  assert.deepEqual(codexReading('', T0), { usage: null, reason: 'codex app-server gave no answer' });
  assert.equal(codexReading(answer({ primary: { usedPercent: 'x', windowDurationMins: 300, resetsAt: 1 } }), T0).usage.fiveHour, null);
});

test('Codex: status, list and run read the app-server of the account\'s CODEX_HOME; a notice at a limit names the account and never switches it', skip, async () => {
  const m = machine();
  const a = await add(m, 'dev', 'codex'), b = await add(m, 'spare', 'codex');
  codexLimits(m, codexWindow(90, 300), codexWindow(20, 10080));
  const st = cli(m);
  assert.equal(await st.exec(['accounts', 'status', 'dev', '--json']), 0);
  const doc = st.json().accounts[0];
  assert.equal(doc.loggedIn, true);
  assert.equal(doc.usage.fiveHour.state, 'warn');
  assert.equal(doc.usage.sevenDay.state, 'ok');
  assert.doesNotMatch(JSON.stringify(doc), /acct-secret-id|plus/);
  assert.match(doc.findings.map((f) => f.message).join('\n'), /account dev: 5-hour window has 10% left \(notice below 16%/);
  const servers = m.calls().filter((x) => x.me === 'codex' && x.args[0] === 'app-server');
  assert.ok(servers.length);
  assert.ok(servers.every((x) => x.env.CODEX_HOME === a.dir));
  // A notice starts the launch under the chosen account and says so.
  const near = cli(m);
  assert.equal(await near.exec(['run', '--', 'codex', '--go']), 0);
  assert.match(near.text(), /notice: account dev: 5-hour window has 10% left/);
  // Below the minimum with auto-pick on and a pool: Codex is never switched, the user is asked.
  for (const n of ['dev', 'spare']) assert.equal(await cli(m).exec(['accounts', 'limits', n, '--pool', 'me', '--yes']), 0);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--auto-pick', 'on', '--yes']), 0);
  codexLimits(m, codexWindow(97, 300), codexWindow(20, 10080));
  const low = cli(m);
  assert.equal(await low.exec(['run', '--', 'codex', '--go']), 2);
  assert.match(low.text(), /Start anyway\?/);
  assert.doesNotMatch(low.text(), /auto-pick/);
  assert.ok(m.calls().filter((x) => x.me === 'codex' && x.args[0] === '--go').every((x) => x.env.CODEX_HOME === a.dir));
  // Not signed in: no app-server is started, the list and status say so.
  rmSync(join(b.dir, 'auth.json'));
  const before = m.calls().length;
  const list = cli(m);
  assert.equal(await list.exec(['accounts', 'list']), 0);
  assert.match(list.text(), /^dev .+ signed in$/m);
  assert.match(list.text(), /^spare .+ not signed in$/m);
  assert.ok(m.calls().slice(before).every((x) => x.args[0] !== 'app-server'), 'list reads the sign-in only');
  const lj = cli(m);
  assert.equal(await lj.exec(['accounts', 'list', '--json']), 0);
  assert.deepEqual(lj.json().accounts.map((x) => [x.name, x.loggedIn]), [['dev', true], ['spare', false]]);
  assert.equal(accountStatus(m.ctx, findAccount(m.ctx, 'spare')).notAvailable, 'not read: not signed in');
  // The server refuses: the reason is shown, no usage.
  m.mode('limits', '');
  assert.match(accountStatus(m.ctx, a).notAvailable, /^not read: codex account authentication required/);
  // No token in any argument, and the app-server gets the account's filtered environment.
  assert.ok(m.calls().every((x) => ![CLAUDE_TOKEN, CODEX_TOKEN].some((t) => JSON.stringify(x.args).includes(t))));
  // No GH_TOKEN in an account's session; a machine account session uses gh's login of that account instead (machine.test.mjs).
  for (const x of m.calls().filter((c) => c.args[0] === 'app-server')) for (const k of ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(x.env[k], undefined, k);
});

test('rotation: none, notice or rotate from the assessment, the pool, the setting and the clock', () => {
  const l = limitsFor(undefined);
  // An assessment with r5 and r7 percent left, read at T0, assessed at now.
  const u = (r5, r7, now = T0) => assess({ usage: { checkedAt: new Date(T0).toISOString(), fiveHour: r5 === null ? null : { used: 100 - r5, resetsAt: epoch(T0 + 3 * HOUR) }, sevenDay: { used: 100 - r7, resetsAt: epoch(T0 + 48 * HOUR) } }, failures: [] }, l, now);
  const member = (name, r5, r7) => ({ account: { name }, usage: u(r5, r7) });
  const pool = [member('half', 50, 50), member('most', 90, 90), member('low', 5, 50)];
  const none = { action: 'none' }, notice = { action: 'notice' };
  assert.deepEqual(rotation(u(5, 50), pool, 'off', T0), none, 'off');
  assert.deepEqual(rotation(u(50, 50), pool, 'handover', T0), none, 'above the notice level');
  assert.deepEqual(rotation(u(12, 50), pool, 'handover', T0), notice, 'between the notice level and the minimum');
  assert.deepEqual(rotation(u(5, 50), pool, 'handover', T0), { action: 'rotate', target: { name: 'most' } }, 'below the minimum: the member with the most headroom');
  assert.deepEqual(rotation(u(50, 2), pool, 'handover', T0).action, 'rotate', 'the 7-day window too');
  assert.deepEqual(rotation(u(5, 50), [], 'handover', T0), notice, 'no other pool member');
  assert.deepEqual(rotation(u(5, 50), [pool[2], { account: { name: 'untracked' }, usage: null }], 'handover', T0), notice, 'no member at or above its minimum');
  assert.deepEqual(rotation(assess(null, l, T0), pool, 'handover', T0), none, 'not tracked');
  assert.deepEqual(rotation(u(null, 2), pool, 'handover', T0), notice, 'a window unknown never rotates');
  assert.deepEqual(rotation(null, pool, 'handover', T0), none, 'no usage source');
  // The clock: the low 5-hour window has reset since the assessment, and so has every member's.
  assert.deepEqual(rotation(u(5, 50), pool, 'handover', T0 + 4 * HOUR), none, 'the reset time passed');
  assert.deepEqual(rotation(u(50, 2, T0 + 4 * HOUR), pool, 'handover', T0 + 4 * HOUR), notice, 'a member read before its reset is no target');
});

// A worktree with a commit, an uncommitted change, a new file and a worker's handoff block that names a token.
function worktree(m) {
  const dir = join(m.root, 'work-tree');
  mkdirSync(join(dir, '.benchkeeper'), { recursive: true });
  const g = (...args) => assert.equal(runCommand(['git', '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { env: m.env }).code, 0, args.join(' '));
  g('init', '-q', '-b', 'feat/thing');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  writeFileSync(join(dir, '.gitignore'), '.benchkeeper/\n');
  g('add', '.');
  g('commit', '-q', '-m', 'feat: first part');
  writeFileSync(join(dir, 'a.txt'), 'two\n');
  writeFileSync(join(dir, 'new.txt'), 'x\n');
  writeFileSync(join(dir, '.benchkeeper', 'handoff.md'), `Outcome: DONE\nWhat changed: commit 1, a.txt\nChecks and results: npm test passed\nOpen risks: the second part\n  is not started, token ${CLAUDE_TOKEN}\nNext step: write the second part\n`);
  return dir;
}
const pooled = async (m, agent, ...names) => {
  const out = [];
  for (const n of names) { out.push(await add(m, n, agent)); assert.equal(await cli(m).exec(['accounts', 'limits', n, '--pool', 'me', '--yes']), 0); }
  return out;
};
const SIX = ['## Task and goal', '## Done', '## Open', '## Worktree and branch', '## Uncommitted changes', '## Next step'];

test('handover with rotation off (the default): nothing is read, written or started, whatever the usage', skip, async () => {
  const m = machine();
  const [work, spare] = await pooled(m, 'claude', 'work', 'spare');
  reading(work, 99, 10);
  reading(spare, 10, 10);
  const dir = worktree(m);
  const before = m.calls().length;
  const c = cli(m, ['y\n']);
  assert.equal(await c.exec(['accounts', 'handover', 'work', '--project', dir, '--yes']), 0);
  assert.match(c.text(), /rotation is off for claude: accounts limits --rotate-claude handover turns it on/);
  assert.equal(m.calls().length, before, 'no status read, no agent started');
  assert.equal(existsSync(join(dir, '.benchkeeper', 'handover.md')), false);
  // run: after the session nothing follows.
  const r = cli(m);
  assert.equal(await r.exec(['run', '--project', dir, '--yes', '--', 'claude', '--go']), 0);
  assert.equal(m.calls().filter((x) => x.me === 'claude' && x.args[0] !== 'auth').length, 1);
  assert.equal(existsSync(join(dir, '.benchkeeper', 'handover.md')), false);
  // The setting is per agent, validated, and for all accounts only.
  const file = join(m.ctx.config, 'accounts.json'), doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, settings: { rotate: { toString: 'handover' } } }));
  const broken = cli(m);
  assert.equal(await broken.exec(['accounts', 'limits']), 2);
  assert.match(broken.text(), /settings that are not valid/);
  writeFileSync(file, JSON.stringify(doc));
  for (const [args, re] of [[['--rotate-claude', 'on'], /--rotate-claude is off or handover/], [['work', '--rotate-codex', 'handover'], /settings for all accounts/]]) {
    const bad = cli(m);
    assert.equal(await bad.exec(['accounts', 'limits', ...args, '--yes']), 2);
    assert.match(bad.text(), re);
  }
});

test('handover (Claude Code): shows both accounts and the text, declining starts nothing, yes starts the target with it', skip, async () => {
  const m = machine();
  const [work, spare, most] = await pooled(m, 'claude', 'work', 'spare', 'most');
  await add(m, 'outside');
  const on = cli(m);
  assert.equal(await on.exec(['accounts', 'limits', '--rotate-claude', 'handover', '--yes']), 0);
  assert.match(on.text(), /^warning: rotating accounts .*https:\/\/code\.claude\.com\/docs\/en\/legal-and-compliance\).*consumer-terms, section 3\)\. The risk is yours; this is not legal advice\.$/m);
  const shown = cli(m);
  await shown.exec(['accounts', 'limits']);
  assert.match(shown.text(), /rotation: claude handover, codex off/);
  reading(work, 97, 10);
  reading(spare, 50, 10);
  reading(most, 20, 10);
  reading(findAccount(m.ctx, 'outside'), 0, 0);
  // A transcript in the account's folder is never read into the handover.
  mkdirSync(join(work.dir, 'projects', 'x'), { recursive: true });
  writeFileSync(join(work.dir, 'projects', 'x', 's.jsonl'), '{"message":"TRANSCRIPT-LINE"}\n');
  const dir = worktree(m);
  const starts = () => m.calls().filter((x) => x.me === 'claude' && x.args[0] !== 'auth');
  const no = cli(m, ['n\n']);
  assert.equal(await no.exec(['accounts', 'handover', 'work', '--project', dir]), 1);
  assert.match(no.text(), /current account: work\ntarget account: {2}most \(pool me\)\n\n# Handover from account work to most/);
  for (const h of SIX) assert.ok(no.text().includes(h), h);
  assert.match(no.text(), /section 3\)\. The risk is yours; this is not legal advice\.\nwarning: ANTHROPIC_API_KEY is set in this environment; .*\nwarning: CLAUDE_CODE_OAUTH_TOKEN is set .*\nWrite .*start claude as most with it as the first prompt\? \[y\/N\] not started/);
  assert.doesNotMatch(no.text(), /dummy-api-key|inherited-oauth-token/);
  assert.equal(starts().length, 0);
  assert.equal(existsSync(join(dir, '.benchkeeper', 'handover.md')), false);
  const yes = cli(m, ['y\n']);
  assert.equal(await yes.exec(['accounts', 'handover', 'work', '--project', dir]), 0, yes.text());
  const text = readFileSync(join(dir, '.benchkeeper', 'handover.md'), 'utf8');
  assert.equal(starts().length, 1);
  assert.deepEqual(starts()[0].args, [text], 'the handover is the first prompt');
  assert.equal(starts()[0].env.CLAUDE_CONFIG_DIR, most.dir);
  for (const h of SIX) assert.ok(text.includes(h), h);
  assert.match(text, /## Worktree and branch\n\n.*work-tree, branch feat\/thing/);
  assert.match(text, /## Uncommitted changes\n\n- a.txt\n- new.txt\n\n/);
  assert.match(text, /## Done\n\ncommit 1, a.txt/);
  assert.match(text, /## Open\n\nthe second part is not started, token \*\*\*/);
  assert.match(text, /## Next step\n\nwrite the second part/);
  assert.doesNotMatch(text, /TRANSCRIPT-LINE|sk-ant-/);
  assert.deepEqual(grep(dir, CLAUDE_TOKEN), [join(dir, '.benchkeeper', 'handoff.md')], 'only the file the worker wrote');
  // In a worktree that does not ignore .benchkeeper/, an earlier handover is not listed as work.
  rmSync(join(dir, '.gitignore'));
  const again = handover(m.ctx, dir, { from: work, to: most }).text;
  assert.match(again, /## Uncommitted changes\n\n- \.gitignore\n- a\.txt\n- \.benchkeeper\/handoff\.md\n- new\.txt\n\n/);
});

test('run: after the session the handover is offered in a terminal only, for the account that ran', skip, async () => {
  const m = machine();
  const [work, spare] = await pooled(m, 'claude', 'work', 'spare');
  assert.equal(await cli(m).exec(['accounts', 'limits', '--rotate-claude', 'handover', '--yes']), 0);
  reading(work, 97, 10);
  reading(spare, 10, 10);
  const dir = worktree(m);
  const piped = cli(m, ['y\n']);
  assert.equal(await piped.exec(['run', '--project', dir, '--yes', '--', 'claude', '--go']), 0);
  assert.match(piped.text(), /account work is below its minimum: benchkeeper accounts handover work hands the work to spare/);
  assert.equal(existsSync(join(dir, '.benchkeeper', 'handover.md')), false);
  const tty = cli(m, ['y\n']);
  tty.input.isTTY = true;
  assert.equal(await tty.exec(['run', '--project', dir, '--yes', '--', 'claude', '--go']), 0, tty.text());
  const after = m.calls().filter((x) => x.me === 'claude' && x.args[0] !== 'auth').at(-1);
  assert.equal(after.env.CLAUDE_CONFIG_DIR, spare.dir);
  assert.match(after.args[0], /^# Handover from account work to spare/);
});

test('handover (Codex): rotation is not available, through the flag or a stored setting; nothing is read or started', skip, async () => {
  const m = machine();
  const [dev, spare] = await pooled(m, 'codex', 'dev', 'spare');
  const on = cli(m);
  assert.equal(await on.exec(['accounts', 'limits', '--rotate-codex', 'handover', '--yes']), 2);
  assert.match(on.text(), /--rotate-codex handover is not available: rotation is for claude only/);
  assert.doesNotMatch(on.text(), /OpenAI's Terms of Use/);
  assert.equal(await cli(m).exec(['accounts', 'limits', '--rotate-codex', 'off', '--yes']), 0);
  // A codex handover stored before the switch counts as off.
  const file = join(m.ctx.config, 'accounts.json'), doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, settings: { ...doc.settings, rotate: { codex: 'handover' } } }));
  const shown = cli(m);
  assert.equal(await shown.exec(['accounts', 'limits']), 0);
  assert.match(shown.text(), /rotation: claude off, codex off/);
  assert.deepEqual(rotationFor(m.ctx, dev), { action: 'none', setting: 'off' });
  const limits = (a, used) => writeFileSync(join(a.dir, 'limits.json'), JSON.stringify({ primary: codexWindow(used, 300), secondary: codexWindow(10, 10080) }));
  limits(dev, 97);
  limits(spare, 20);
  const dir = worktree(m);
  const before = m.calls().length;
  const c = cli(m);
  assert.equal(await c.exec(['accounts', 'handover', 'dev', '--project', dir, '--yes']), 0);
  assert.match(c.text(), /rotation is not available for codex/);
  assert.equal(m.calls().length, before, 'no app-server read, no agent started');
  assert.equal(existsSync(join(dir, '.benchkeeper', 'handover.md')), false);
});
