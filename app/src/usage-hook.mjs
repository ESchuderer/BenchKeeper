// Runs inside one account's folder as the Claude Code status line (`statusline`) and as its StopFailure hook (`failure`).
// BenchKeeper copies this file there (`accounts track`); it imports nothing but node builtins. It keeps next to itself
// usage.json (the two rate limit windows) and failures.jsonl (one line per failed turn). Only the fields listed here are
// kept: no credential, path, message or session id from the input ever reaches a file.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
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

function main(mode, text, dir, now = Date.now()) {
  let input = null;
  try { input = JSON.parse(text); } catch { /* not JSON: nothing is kept */ }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (mode === 'statusline') {
    const r = usageRecord(input, now);
    if (!r) return '';
    const tmp = join(dir, `usage.json.${process.pid}`);
    writeFileSync(tmp, `${JSON.stringify(r)}\n`, { mode: 0o600 });
    renameSync(tmp, join(dir, 'usage.json'));
    return shown(r);
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
