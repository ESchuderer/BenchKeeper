// Runs inside one account's folder as the Claude Code status line (`statusline`) and as its StopFailure hook (`failure`).
// BenchKeeper copies this file there (`accounts track`); it imports nothing but node builtins. It keeps next to itself
// usage.json (the two rate limit windows) and failures.jsonl (one line per failed turn). Only the fields listed here are
// kept: no credential, path, message or session id from the input ever reaches a file. The status line also shows
// Ponytail's level, read from the account folder (the plugin option statusStyle in settings.json picks what it prints).
import { appendFileSync, chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The error types the StopFailure hook documents (cloud_credential_error needs Claude Code v2.1.267).
export const FAILURES = ['rate_limit', 'overloaded', 'authentication_failed', 'oauth_org_not_allowed', 'account_on_hold', 'billing_error', 'invalid_request', 'model_not_found', 'server_error', 'max_output_tokens', 'cloud_credential_error', 'unknown'];
// The matcher of the hook an earlier version installed, for the three types it recorded.
export const LEGACY_MATCHER = 'rate_limit|authentication_failed|billing_error';
const KEEP = 20;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// The status line input as the file holds it: used_percentage (0 to 100) and resets_at (epoch seconds) of each window,
// both present, else the window is left out. null when the input has no window at all.
export function usageRecord(input, now) {
  const out = { schemaVersion: 1, checkedAt: new Date(now).toISOString() };
  for (const [key, name] of [['five_hour', 'fiveHour'], ['seven_day', 'sevenDay']]) {
    const w = input?.rate_limits?.[key];
    const used = num(w?.used_percentage, 0, 100), resetsAt = num(w?.resets_at, 1e9, 4e9);
    if (used !== null && resetsAt !== null) out[name] = { used, resetsAt };
  }
  return out.fiveHour || out.sevenDay ? out : null;
}

// The StopFailure input as one line: the time and the error type, when it is one the hook is installed for.
export const failureLine = (input, now) => (FAILURES.includes(input?.error) ? `${JSON.stringify({ at: new Date(now).toISOString(), error: input.error })}\n` : null);

const shown = (r) => ['fiveHour', 'sevenDay'].filter((k) => r[k]).map((k) => `${k === 'fiveHour' ? '5h' : '7d'} ${Math.round(100 - r[k].used)}% left`).join('  ');

const read = (p) => { try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };
const parsed = (t) => { try { return JSON.parse(t); } catch { return null; } };
// The plugin option is a plain string (an option list stops older Claude Code versions from loading the plugin): any other value is merged.
const STYLES = ['merged', 'plugin', 'benchkeeper', 'none'];
const styleOf = (account) => {
  const v = parsed(read(join(account, 'settings.json')))?.pluginConfigs?.['benchkeeper@benchkeeper']?.options?.statusStyle;
  return STYLES.includes(v) ? v : 'merged';
};
// Ponytail's hide switch as its own scripts read it: the variable wins, else hideStatus in its config file.
function ponytailHidden(env) {
  if (env.PONYTAIL_HIDE_STATUS !== undefined) return !['', '0', 'false', 'no'].includes(env.PONYTAIL_HIDE_STATUS.trim().toLowerCase());
  const base = env.XDG_CONFIG_HOME || (process.platform === 'win32' ? env.APPDATA || join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.config'));
  return parsed(read(join(base, 'ponytail', 'config.json')))?.hideStatus === true;
}
// Ponytail's badge as its own status line draws it: green, amber for ultra. An unknown level or no flag file shows nothing.
function ponytailSegment(account, env) {
  const flag = read(join(account, '.ponytail-active'));
  const level = flag === null ? null : flag.split('\n')[0].trim() || 'full';
  if (!['lite', 'full', 'ultra'].includes(level) || ponytailHidden(env)) return '';
  return `\x1b[38;5;${level === 'ultra' ? 173 : 108}m[PONYTAIL${level === 'full' ? '' : `:${level.toUpperCase()}`}]\x1b[0m`;
}

function main(mode, text, dir, now = Date.now(), env = process.env) {
  let input = null;
  try { input = JSON.parse(text); } catch { /* not JSON: nothing is kept */ }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (mode === 'statusline') {
    const r = usageRecord(input, now);
    if (r) {
      const tmp = join(dir, `usage.json.${process.pid}`);
      writeFileSync(tmp, `${JSON.stringify(r)}\n`, { mode: 0o600 });
      renameSync(tmp, join(dir, 'usage.json'));
    }
    // The script sits in <account>/benchkeeper/, so the account folder is its parent.
    const account = dirname(dir), style = styleOf(account);
    const usage = r && ['merged', 'benchkeeper'].includes(style) ? shown(r) : '';
    const segment = ['merged', 'plugin'].includes(style) ? ponytailSegment(account, env) : '';
    return [usage, segment].filter(Boolean).join('  ');
  }
  const line = mode === 'failure' ? failureLine(input, now) : null;
  if (!line) return '';
  const file = join(dir, 'failures.jsonl');
  appendFileSync(file, line, { mode: 0o600 });
  chmodSync(file, 0o600);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  if (lines.length > KEEP) {
    // A reader never sees a half written file; a line appended between the read and the rename can be lost.
    const tmp = join(dir, `failures.jsonl.${process.pid}`);
    writeFileSync(tmp, `${lines.slice(-KEEP).join('\n')}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  }
  return '';
}

// import.meta.url is the real path: a folder reached through a link must match it too.
const real = (p) => { try { return realpathSync(p); } catch { return null; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    try { process.stdout.write(main(process.argv[2], Buffer.concat(chunks).toString('utf8'), dirname(fileURLToPath(import.meta.url)))); } catch { /* a hook never breaks the session */ }
  });
}
export { main as run };
