// Usage per account, from the files the status line and the StopFailure hook of an account keep (usage-hook.mjs).
// Headroom is 100 minus used_percentage of a rate limit window. A reading counts only until its window resets: after that
// the window is unknown, never full. Everything here is pure: the files are read by accounts.mjs, the clock is a parameter.
import { readFileSync } from 'node:fs';
import { mergeJson, parseJson } from './merge.mjs';
import { FAILURES, LEGACY_MATCHER } from './usage-hook.mjs';

export const WINDOWS = [['fiveHour', '5-hour'], ['sevenDay', '7-day']];
// The minimum headroom (percent) to start a task; the notice level before it defaults to twice that. Defaults, not claims about what a task needs.
// rotate: per agent, off or handover (usage-gated handover to another account of the pool); off until the user turns it on.
const DEFAULTS = { minimum: { fiveHour: 8, sevenDay: 3 }, autoPick: false, whenNone: 'stop', continueBelow: false, rotate: { claude: 'off', codex: 'off' } };
export const ROTATE = ['off', 'handover'];
// The agents rotation can be turned on for. Codex is left out for now: a stored codex handover counts as off and the flag is
// refused. Adding 'codex' here turns its rotation back on.
export const ROTATABLE = ['claude'];
export const STATE_DIR = 'benchkeeper';
export const HOOK_SOURCE = readFileSync(new URL('./usage-hook.mjs', import.meta.url), 'utf8');
const FAILURE_HOURS = 24;
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- thresholds and settings, as accounts.json holds them

const validWindows = (w) => w === undefined || (isObject(w) && Object.entries(w).every(([k, v]) => WINDOWS.some(([n]) => n === k) && typeof v === 'number' && v >= 0 && v <= 100));
export const validLimits = (l) => l === undefined || (isObject(l) && validWindows(l.minimum) && validWindows(l.warn));
export const validSettings = (s) => s === undefined || (isObject(s) && validLimits(s) && (s.autoPick === undefined || typeof s.autoPick === 'boolean') && (s.continueBelow === undefined || typeof s.continueBelow === 'boolean') && (s.whenNone === undefined || ['stop', 'wait'].includes(s.whenNone))
  && (s.rotate === undefined || (isObject(s.rotate) && Object.entries(s.rotate).every(([k, v]) => Object.hasOwn(DEFAULTS.rotate, k) && ROTATE.includes(v)))));

export const settingsOf = (s) => ({ ...DEFAULTS, ...s, minimum: { ...DEFAULTS.minimum, ...s?.minimum },
  rotate: Object.fromEntries(Object.entries({ ...DEFAULTS.rotate, ...s?.rotate }).map(([k, v]) => [k, ROTATABLE.includes(k) ? v : 'off'])) });
// The thresholds of one account: its own override, else the settings, else the defaults.
export function limitsFor(settings, a) {
  const minimum = {}, warn = {};
  for (const [k] of WINDOWS) {
    minimum[k] = a?.limits?.minimum?.[k] ?? settingsOf(settings).minimum[k];
    warn[k] = Math.min(100, Math.max(minimum[k], a?.limits?.warn?.[k] ?? settings?.warn?.[k] ?? 2 * minimum[k]));
  }
  return { minimum, warn };
}

// ---- state files

const win = (w) => (isObject(w) && typeof w.used === 'number' && w.used >= 0 && w.used <= 100 && typeof w.resetsAt === 'number' && w.resetsAt >= 1e9 && w.resetsAt <= 4e9 ? { used: w.used, resetsAt: w.resetsAt } : null);
// The files can be written by any process of the account: each field is checked, the rest is dropped.
export function parseState(usageText, failuresText) {
  let usage = null;
  try {
    const d = JSON.parse(String(usageText).slice(0, 65536));
    if (isObject(d) && typeof d.checkedAt === 'string' && !Number.isNaN(Date.parse(d.checkedAt))) usage = { checkedAt: d.checkedAt, fiveHour: win(d.fiveHour), sevenDay: win(d.sevenDay) };
  } catch { /* none, or not JSON */ }
  const failures = [];
  for (const line of String(failuresText ?? '').slice(-65536).split('\n')) {
    try {
      const d = JSON.parse(line);
      if (isObject(d) && FAILURES.includes(d.error) && !Number.isNaN(Date.parse(d.at))) failures.push({ at: new Date(d.at).toISOString(), error: d.error });
    } catch { /* a line that is not one */ }
  }
  return { usage, failures };
}

// The document `accounts status --json` shows. Per window: state ok, warn (below the notice level), low (below the
// minimum) or unknown, with the reason.
export function assess(state, limits, now) {
  const u = state?.usage ?? null;
  const out = { tracked: !!u, checkedAt: u?.checkedAt ?? null, ageSeconds: u ? Math.max(0, Math.floor((now - Date.parse(u.checkedAt)) / 1000)) : null, minimum: limits.minimum, warn: limits.warn };
  for (const [k] of WINDOWS) {
    const w = u?.[k];
    if (!w || w.resetsAt * 1000 <= now) { out[k] = { state: 'unknown', used: null, remaining: null, resetsAt: null, reason: !u ? 'not tracked' : !w ? 'no reading of this window' : 'the window has reset since the last reading' }; continue; }
    const remaining = Math.round((100 - w.used) * 10) / 10;
    out[k] = { state: remaining < limits.minimum[k] ? 'low' : remaining < limits.warn[k] ? 'warn' : 'ok', used: w.used, remaining, resetsAt: new Date(w.resetsAt * 1000).toISOString(), reason: null };
  }
  out.failures = (state?.failures ?? []).filter((f) => Date.parse(f.at) >= now - FAILURE_HOURS * 36e5);
  return out;
}

const at = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;
const FAILURE_TEXT = {
  rate_limit: ['info', 'the last session stopped at a rate limit', 'wait for the reset or start under another account'],
  overloaded: ['info', 'the last session stopped because the API was overloaded', 'try again later'],
  authentication_failed: ['warning', 'the last session ended with an authentication failure', null],
  oauth_org_not_allowed: ['warning', 'the last session ended because the organization does not allow this login', null],
  account_on_hold: ['warning', 'the last session ended because the account is on hold', 'check the account with its provider'],
  billing_error: ['warning', 'the last session ended with a billing error', 'check the plan and billing of the account'],
  invalid_request: ['info', 'the last session ended with an invalid request', 'look at the last turn of that session'],
  model_not_found: ['warning', 'the last session ended because the model was not found', 'check the model setting and whether the account has access to it'],
  server_error: ['info', 'the last session ended with an API server error', 'try again later'],
  max_output_tokens: ['info', 'the last session stopped at the output token limit', 'ask for a shorter answer or raise the limit'],
  cloud_credential_error: ['warning', 'the last session ended because the cloud provider credentials failed to load', 'check the provider login (Bedrock, Vertex or Foundry)'],
  unknown: ['info', 'the last session ended with an error of no known type', 'look at the last turn of that session'],
};
// Findings for doctor and status: a warning below the minimum, an info below the notice level, the latest failure of each kind.
export function usageFindings(name, u, relogin) {
  const f = (level, message, fix) => ({ level, check: 'accounts', message: `account ${name}: ${message}`, fix });
  const out = [];
  for (const [k, label] of WINDOWS) {
    const w = u[k];
    if (w.state === 'low') out.push(f('warning', `${label} window has ${w.remaining}% left, below the minimum of ${u.minimum[k]}% (resets ${at(w.resetsAt)})`, `start under another account (benchkeeper run --account <name>) or wait for the reset`));
    else if (w.state === 'warn') out.push(f('info', `${label} window has ${w.remaining}% left (notice below ${u.warn[k]}%, resets ${at(w.resetsAt)})`, 'a long task may not finish before the reset: --account <name> starts under another account'));
  }
  for (const error of FAILURES) {
    const last = u.failures.filter((x) => x.error === error).at(-1);
    if (last) out.push(f(FAILURE_TEXT[error][0], `${FAILURE_TEXT[error][1]} at ${at(last.at)}`, FAILURE_TEXT[error][2] ?? relogin));
  }
  return out;
}

// The notices near a limit (below the notice level, at or above the minimum) that a launch shows; the choice stays with the user.
export const nearNotices = (name, u) => usageFindings(name, { ...u, failures: [] }).filter((f) => f.level === 'info');

// ---- Codex: the app-server method account/rateLimits/read, run with the account's CODEX_HOME

// The server answers only while its input is open, so a node child holds it open and prints the one answer line.
export const CODEX_READER = `const p = require('node:child_process').spawn('codex', ['app-server'], { stdio: ['pipe', 'pipe', 'ignore'] });
const quit = (t) => { process.stdout.write(t); p.kill(); process.exit(0); };
setTimeout(() => quit(''), 20000);
p.on('error', () => quit('')).on('exit', () => quit(''));
let buf = '';
p.stdout.on('data', (c) => {
  const lines = (buf + c).split('\\n');
  buf = lines.pop();
  for (const l of lines) { try { if (JSON.parse(l).id === 2) quit(l); } catch {} }
});
p.stdin.write([{ id: 1, method: 'initialize', params: { clientInfo: { name: 'benchkeeper', version: '0' } } }, { method: 'initialized' }, { id: 2, method: 'account/rateLimits/read' }].map((m) => JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n').join(''));`;
const WINDOW_MINUTES = { 300: 'fiveHour', 10080: 'sevenDay' };
// The answer as the usage state: windows by their length (a plan may have the weekly one only), used capped at 100.
// Only the two windows are kept; the account id, plan and the rest of the answer are dropped.
export function codexReading(text, now) {
  let d = null;
  try { d = JSON.parse(String(text).slice(0, 65536)); } catch { /* no answer */ }
  if (!isObject(d?.result)) return { usage: null, reason: typeof d?.error?.message === 'string' ? d.error.message.slice(0, 200) : 'codex app-server gave no answer' };
  const usage = { checkedAt: new Date(now).toISOString(), fiveHour: null, sevenDay: null };
  for (const w of [d.result.rateLimits?.primary, d.result.rateLimits?.secondary]) {
    const k = WINDOW_MINUTES[w?.windowDurationMins];
    if (k && typeof w.usedPercent === 'number') usage[k] = win({ used: Math.min(100, w.usedPercent), resetsAt: w.resetsAt });
  }
  return { usage };
}

// ---- launch decision

export const lowWindows = (u) => WINDOWS.filter(([k]) => u?.[k]?.state === 'low').map(([k, label]) => ({ key: k, label, ...u[k], minimum: u.minimum[k] }));
// At or above the minimum in both windows, both known.
export const qualifies = (u) => !!u?.tracked && WINDOWS.every(([k]) => ['ok', 'warn'].includes(u[k].state));
export const headroom = (u) => Math.min(...WINDOWS.map(([k]) => u[k].remaining));
// When an account with a window below its minimum is expected to qualify again: its last low window resets.
export const readyAt = (u) => Math.max(...lowWindows(u).map((w) => Date.parse(w.resetsAt)));

// ---- rotation by handover (opt-in per agent): the minimum that decides a launch decides it too

// u: the account's assessment; pool: the other accounts of its pool and agent as [{ account, usage }]; setting: off or handover.
// A window counts only before its reset (now), so a stale reading never rotates. rotate needs both windows known, one below its
// minimum and a pool member at or above its minimum; with none, or a window unknown, a window below a threshold is a notice only.
export function rotation(u, pool, setting, now) {
  const known = (x) => WINDOWS.filter(([k]) => x?.[k]?.resetsAt && Date.parse(x[k].resetsAt) > now).map(([k]) => x[k].state);
  const states = known(u);
  if (setting !== 'handover' || !states.some((s) => s === 'low' || s === 'warn')) return { action: 'none' };
  if (!states.includes('low') || states.length < WINDOWS.length) return { action: 'notice' };
  const best = pool.filter((c) => known(c.usage).length === WINDOWS.length && qualifies(c.usage)).sort((p, q) => headroom(q.usage) - headroom(p.usage))[0];
  return best ? { action: 'rotate', target: best.account } : { action: 'notice' };
}

// ---- the files of an account's folder

// The command goes through a shell: only plain path characters are accepted.
const SAFE = /^[\w ./\\:@+~-]+$/;
const status = (script) => ({ type: 'command', command: `node "${script}" statusline` });
const hook = (script, matcher = FAILURES.join('|')) => ({ matcher, hooks: [{ type: 'command', command: `node "${script}" failure` }] });
// A status line that runs Ponytail's script and nothing else: the usage script draws its badge too (plugin option statusStyle).
const PONYTAIL_LINE = /^[^;&|`()<>\n]*ponytail-statusline\.(?:sh|ps1)["']?\s*$/;
// The account's settings.json with the status line and the StopFailure hook (remove: without them). An existing status line of
// another kind is not replaced: the agent has one only. Ponytail's own is replaced (the backup and undo restore it). The hook is
// added to the user's own StopFailure entries.
export function trackedSettings(text, script, { remove = false } = {}) {
  if (!SAFE.test(script)) throw new Error(`the path ${script} has characters that do not go into a hook command`);
  const current = parseJson(text, 'settings.json');
  const ours = typeof current.statusLine?.command === 'string' && current.statusLine.command.includes(script);
  if (remove) return text == null ? text : mergeJson(text, [...(ours ? [{ path: ['statusLine'], remove: true }] : []), { path: ['hooks', 'StopFailure'], pull: [hook(script), hook(script, LEGACY_MATCHER)] }, { path: ['hooks'], prune: true }], 'settings.json');
  if (current.statusLine && !ours && !PONYTAIL_LINE.test(current.statusLine.command ?? '')) throw new Error('this account already has a status line of its own, and the agent has one only: remove it from its settings.json first');
  return mergeJson(text, [{ path: ['statusLine'], value: status(script) }, { path: ['hooks', 'StopFailure'], pull: [hook(script, LEGACY_MATCHER)] }, { path: ['hooks', 'StopFailure'], append: [hook(script)] }], 'settings.json');
}
