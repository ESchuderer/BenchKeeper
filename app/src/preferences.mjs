// The app's own preferences, kept in the BenchKeeper config folder: editors turns on the editor view for presets, pins
// and the orchestrator policy (off by default). Written directly, without a plan.
import { join } from 'node:path';
import { readText, writeAtomic } from './fsx.mjs';

const file = (ctx) => join(ctx.config, 'preferences.json');
const DEFAULTS = { editors: false };

// A missing or damaged file, or one that is not an object, reads as the defaults; unknown keys are kept.
export function readPreferences(ctx) {
  let doc = null;
  try { doc = JSON.parse(readText(file(ctx))); } catch { /* defaults */ }
  return { ...DEFAULTS, ...(doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {}) };
}

export function setPreference(ctx, key, value) {
  if (!(key in DEFAULTS)) throw new Error(`key must be one of ${Object.keys(DEFAULTS).join(', ')}`);
  if (typeof value !== typeof DEFAULTS[key]) throw new Error(`${key} must be ${typeof DEFAULTS[key] === 'boolean' ? 'true or false' : typeof DEFAULTS[key]}`);
  const next = { ...readPreferences(ctx), schemaVersion: 1, [key]: value };
  writeAtomic(file(ctx), `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}
