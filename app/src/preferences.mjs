// The app's own preferences, kept in the BenchKeeper config folder: editors turns on the editor view for presets, pins
// and the orchestrator policy (off by default); dismissed lists the Agent settings notes the user accepted, by note id.
// Written directly, without a plan.
import { join } from 'node:path';
import { readText, writeAtomic } from './fsx.mjs';

const file = (ctx) => join(ctx.config, 'preferences.json');
const DEFAULTS = { editors: false, dismissed: [] };

// A missing or damaged file, or one that is not an object, reads as the defaults; unknown keys are kept.
export function readPreferences(ctx) {
  let doc = null;
  try { doc = JSON.parse(readText(file(ctx))); } catch { /* defaults */ }
  return { ...DEFAULTS, ...(doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}) };
}

export function setPreference(ctx, key, value) {
  if (!(key in DEFAULTS)) throw new Error(`key must be one of ${Object.keys(DEFAULTS).join(', ')}`);
  if (Array.isArray(DEFAULTS[key]) ? !(Array.isArray(value) && value.every((x) => typeof x === 'string')) : typeof value !== typeof DEFAULTS[key]) throw new Error(`${key} must be ${Array.isArray(DEFAULTS[key]) ? 'a list of strings' : typeof DEFAULTS[key] === 'boolean' ? 'true or false' : typeof DEFAULTS[key]}`);
  const next = { ...readPreferences(ctx), schemaVersion: 1, [key]: value };
  writeAtomic(file(ctx), `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}

// The dismissed note ids; a hand-edited list that is not one reads as empty, entries that are no string are skipped.
export const dismissedNotes = (ctx) => { const d = readPreferences(ctx).dismissed; return new Set(Array.isArray(d) ? d.filter((x) => typeof x === 'string') : []); };

// Dismisses a note (on) or shows it again.
export function dismissNote(ctx, id, on = true) {
  if (typeof id !== 'string' || !id) throw new Error('id must be a note id');
  const rest = [...dismissedNotes(ctx)].filter((x) => x !== id);
  return setPreference(ctx, 'dismissed', on ? [...rest, id] : rest);
}
