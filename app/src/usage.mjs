// Usage per account, from the files the status line and the StopFailure hook of an account keep (usage-hook.mjs).
// Headroom is 100 minus used_percentage of a rate limit window. A reading counts only until its window resets: after that
// the window is unknown, never full. Everything here is pure: the files are read by accounts.mjs, the clock is a parameter.
import { readFileSync } from 'node:fs';
import { mergeJson, parseJson } from './merge.mjs';
import { FAILURES } from './usage-hook.mjs';

export const WINDOWS = [['fiveHour', '5-hour'], ['sevenDay', '7-day']];
// The minimum headroom (percent) to start a task; the notice level before it defaults to twice that. Defaults, not claims about what a task needs.
export const DEFAULTS = { minimum: { fiveHour: 8, sevenDay: 3 }, autoPick: false, whenNone: 'stop', continueBelow: false };
export const STATE_DIR = 'benchkeeper';
export const HOOK_SOURCE = readFileSync(new URL('./usage-hook.mjs', import.meta.url), 'utf8');
const FAILURE_HOURS = 24;
const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// ---- thresholds and settings, as accounts.json holds them

const validWindows = (w) => w === undefined || (isObject(w) && Object.entries(w).every(([k, v]) => WINDOWS.some(([n]) => n === k) && typeof v === 'number' && v >= 0 && v <= 100));
export const validLimits = (l) => l === undefined || (isObject(l) && validWindows(l.minimum) && validWindows(l.warn));
export const validSettings = (s) => s === undefined || (isObject(s) && validLimits(s) && (s.autoPick === undefined || typeof s.autoPick === 'boolean') && (s.continueBelow === undefined || typeof s.continueBelow === 'boolean') && (s.whenNone === undefined || ['stop', 'wait'].includes(s.whenNone)));

export const settingsOf = (s) => ({ ...DEFAULTS, ...s, minimum: { ...DEFAULTS.minimum, ...s?.minimum } });
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
  authentication_failed: ['warning', 'the last session ended with an authentication failure', null],
  billing_error: ['warning', 'the last session ended with a billing error', 'check the plan and billing of the account'],
};
// Findings for doctor and status: a warning below the minimum, an info below the notice level, the latest failure of each kind.
export function usageFindings(name, u, relogin) {
  const f = (level, message, fix) => ({ level, check: 'accounts', message: `account ${name}: ${message}`, fix });
  const out = [];
  for (const [k, label] of WINDOWS) {
    const w = u[k];
    if (w.state === 'low') out.push(f('warning', `${label} window has ${w.remaining}% left, below the minimum of ${u.minimum[k]}% (resets ${at(w.resetsAt)})`, `start under another account (benchkeeper run --account <name>) or wait for the reset`));
    else if (w.state === 'warn') out.push(f('info', `${label} window has ${w.remaining}% left (notice below ${u.warn[k]}%, resets ${at(w.resetsAt)})`, 'a long task may not finish before the reset'));
  }
  for (const error of FAILURES) {
    const last = u.failures.filter((x) => x.error === error).at(-1);
    if (last) out.push(f(FAILURE_TEXT[error][0], `${FAILURE_TEXT[error][1]} at ${at(last.at)}`, FAILURE_TEXT[error][2] ?? relogin));
  }
  return out;
}

// ---- launch decision

export const lowWindows = (u) => WINDOWS.filter(([k]) => u?.[k]?.state === 'low').map(([k, label]) => ({ key: k, label, ...u[k], minimum: u.minimum[k] }));
// At or above the minimum in both windows, both known.
export const qualifies = (u) => !!u?.tracked && WINDOWS.every(([k]) => ['ok', 'warn'].includes(u[k].state));
export const headroom = (u) => Math.min(...WINDOWS.map(([k]) => u[k].remaining));
// When an account with a window below its minimum is expected to qualify again: its last low window resets.
export const readyAt = (u) => Math.max(...lowWindows(u).map((w) => Date.parse(w.resetsAt)));

// ---- the files of an account's folder

// The command goes through a shell: only plain path characters are accepted.
const SAFE = /^[\w ./\\:@+~-]+$/;
const status = (script) => ({ type: 'command', command: `node "${script}" statusline` });
const hook = (script) => ({ matcher: FAILURES.join('|'), hooks: [{ type: 'command', command: `node "${script}" failure` }] });
// The account's settings.json with the status line and the StopFailure hook (remove: without them). An existing status line of
// another kind is not replaced: the agent has one only. The hook is added to the user's own StopFailure entries.
export function trackedSettings(text, script, { remove = false } = {}) {
  if (!SAFE.test(script)) throw new Error(`the path ${script} has characters that do not go into a hook command`);
  const current = parseJson(text, 'settings.json');
  const ours = typeof current.statusLine?.command === 'string' && current.statusLine.command.includes(script);
  if (remove) return text == null ? text : mergeJson(text, [...(ours ? [{ path: ['statusLine'], remove: true }] : []), { path: ['hooks', 'StopFailure'], pull: [hook(script)] }, { path: ['hooks'], prune: true }], 'settings.json');
  if (current.statusLine && !ours) throw new Error('this account already has a status line of its own, and the agent has one only: remove it from its settings.json first');
  return mergeJson(text, [{ path: ['statusLine'], value: status(script) }, { path: ['hooks', 'StopFailure'], append: [hook(script)] }], 'settings.json');
}
