// The app's own preferences, kept in the BenchKeeper config folder: editors turns on the editor view for the
// orchestrator policy (off by default); dismissed lists the Agent settings notes the user accepted, by note id,
// the settings the user decided to keep, as setting:<agent>:<key>, and the global changes the user left unselected, as
// change:<step>:<hash of what the change writes or runs>.
// Written directly, without a plan.
import { join } from 'node:path';
import { exists, readText, writeAtomic } from './fsx.mjs';

const file = (ctx) => join(ctx.config, 'preferences.json');
const DEFAULTS = { editors: false, dismissed: [] };

// A missing or damaged file, or one that is not an object, reads as the defaults; unknown keys are kept.
export function readPreferences(ctx) {
  let doc = null;
  try { doc = JSON.parse(readText(file(ctx))); } catch { /* defaults */ }
  return { ...DEFAULTS, ...(doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}) };
}

// Why the file cannot be written over, null when it is fine or missing: one that exists but does not parse, or is no
// object, reads as the defaults, so a write would replace the user's list with them. A parser's message can quote the
// file, so none is passed on.
export function preferencesProblem(ctx) {
  const path = file(ctx), text = readText(path);
  if (text == null) return exists(path) ? `${path} cannot be read: fix it, then try again` : null;
  let doc;
  try { doc = JSON.parse(text); } catch { return `${path} is not valid JSON: fix it, then try again`; }
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? null : `${path} is not a JSON object: fix it, then try again`;
}

export function setPreference(ctx, key, value) {
  if (!(key in DEFAULTS)) throw new Error(`key must be one of ${Object.keys(DEFAULTS).join(', ')}`);
  if (Array.isArray(DEFAULTS[key]) ? !(Array.isArray(value) && value.every((x) => typeof x === 'string')) : typeof value !== typeof DEFAULTS[key]) throw new Error(`${key} must be ${Array.isArray(DEFAULTS[key]) ? 'a list of strings' : typeof DEFAULTS[key] === 'boolean' ? 'true or false' : typeof DEFAULTS[key]}`);
  const problem = preferencesProblem(ctx);
  if (problem) throw Object.assign(new Error(problem), { status: 409, preferences: true });
  const next = { ...readPreferences(ctx), schemaVersion: 1, [key]: value };
  writeAtomic(file(ctx), `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}

// The dismissed note ids; a hand-edited list that is not one reads as empty, entries that are no string are skipped.
export const dismissedNotes = (ctx) => { const d = readPreferences(ctx).dismissed; return new Set(Array.isArray(d) ? d.filter((x) => typeof x === 'string') : []); };

// Adds ids to the list and takes others out, in one write.
export function dismissAll(ctx, ids, shown = []) {
  const off = dismissedNotes(ctx), add = ids.filter((x) => !off.has(x)), drop = shown.filter((x) => off.has(x));
  if (add.length || drop.length) setPreference(ctx, 'dismissed', [...[...off].filter((x) => !drop.includes(x)), ...new Set(add)]);
}

// Dismisses a note (on) or shows it again.
export function dismissNote(ctx, id, on = true) {
  if (typeof id !== 'string' || !id) throw new Error('id must be a note id');
  const rest = [...dismissedNotes(ctx)].filter((x) => x !== id);
  return setPreference(ctx, 'dismissed', on ? [...rest, id] : rest);
}
