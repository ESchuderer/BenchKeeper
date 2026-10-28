// Insights triage: the findings the user dismissed or snoozed, kept in the BenchKeeper config folder, never in a repository.
// The file holds finding keys (id and a digest of the evidence set, see findingKey) and dates, nothing else. A finding whose
// evidence set changed has a new key, so it shows again; a snooze also ends at its date.
import { join } from 'node:path';
import { readText, writeAtomic } from './fsx.mjs';
import { findingKey } from './insights.mjs';

export const SNOOZE_DAYS = 7;
const file = (ctx) => join(ctx.config, 'insights-triage.json');
const KEY = /^[\w:.-]{1,200}@[0-9a-f]{8}$/;
const ACTIONS = ['dismiss', 'snooze', 'reopen'];
const dates = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => KEY.test(k) && typeof v === 'string' && !Number.isNaN(Date.parse(v))));

// A missing or damaged file reads as empty.
export function readTriage(ctx) {
  let doc = null;
  try { doc = JSON.parse(readText(file(ctx))); } catch { /* empty */ }
  return { dismissed: dates(doc?.dismissed), snoozed: dates(doc?.snoozed) };
}

// Each finding with its key and its triage: null (shown), { state: 'dismissed' } or { state: 'snoozed', until } (an expired snooze shows again).
export function withTriage(findings, state, now = Date.now()) {
  return findings.map((f) => {
    const key = findingKey(f), until = state.snoozed[key];
    return { ...f, key, triage: key in state.dismissed ? { state: 'dismissed' } : until && Date.parse(until) > now ? { state: 'snoozed', until } : null };
  });
}

// action: dismiss, snooze (SNOOZE_DAYS days) or reopen. Returns the key's triage as withTriage shows it.
export function setTriage(ctx, key, action, now = Date.now()) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('key must be a finding key');
  if (!ACTIONS.includes(action)) throw new Error(`action must be ${ACTIONS.join(', ')}`);
  const state = readTriage(ctx), id = `${key.slice(0, key.lastIndexOf('@'))}@`;
  // One entry per finding: an older digest of it is dropped, and so is a snooze that has run out.
  for (const m of [state.dismissed, state.snoozed]) for (const k of Object.keys(m)) if (k.startsWith(id) || (m === state.snoozed && Date.parse(m[k]) <= now)) delete m[k];
  if (action === 'dismiss') state.dismissed[key] = new Date(now).toISOString();
  if (action === 'snooze') state.snoozed[key] = new Date(now + SNOOZE_DAYS * 864e5).toISOString();
  writeAtomic(file(ctx), `${JSON.stringify({ schemaVersion: 1, ...state }, null, 2)}\n`, 0o600);
  return { key, triage: action === 'dismiss' ? { state: 'dismissed' } : action === 'snooze' ? { state: 'snoozed', until: state.snoozed[key] } : null };
}
