// A key-value store kept in one JSON file (format and rules: docs/ARCHITECTURE.md).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export function openStore(file, { now = Date.now } = {}) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, entries: {} };
  if (data.version !== 1) throw new Error(`unsupported store version ${data.version}`);
  const entries = new Map(Object.entries(data.entries));
  // An entry with expiresAt (ms since the epoch) is gone from that time on; expiresAt is an added field (format 1).
  const live = (e) => e !== undefined && !(e.expiresAt !== undefined && now() >= e.expiresAt);
  return {
    get: (key) => (live(entries.get(key)) ? entries.get(key).value : undefined),
    has: (key) => live(entries.get(key)),
    set(key, value, { ttl } = {}) {
      if (ttl !== undefined && !(Number.isFinite(ttl) && ttl >= 0)) throw new RangeError(`invalid ttl ${ttl}`);
      const t = now();
      entries.set(key, { value, updatedAt: t, expiresAt: ttl === undefined ? undefined : t + ttl });
    },
    delete: (key) => entries.delete(key),
    keys: () => [...entries].filter(([, e]) => live(e)).map(([k]) => k),
    get size() {
      return this.keys().length;
    },
    save() {
      writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }, null, 2)}\n`);
      renameSync(`${file}.tmp`, file);
    },
  };
}
