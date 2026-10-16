// A key-value store kept in one JSON file (format and rules: docs/ARCHITECTURE.md).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

export function openStore(file, { now = Date.now } = {}) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, entries: {} };
  if (data.version !== 1) throw new Error(`unsupported store version ${data.version}`);
  const entries = new Map(Object.entries(data.entries));
  return {
    get: (key) => entries.get(key)?.value,
    has: (key) => entries.has(key),
    set(key, value) {
      entries.set(key, { value, updatedAt: now() });
    },
    delete: (key) => entries.delete(key),
    keys: () => [...entries.keys()],
    get size() {
      return entries.size;
    },
    save() {
      writeFileSync(`${file}.tmp`, `${JSON.stringify({ version: 1, entries: Object.fromEntries(entries) }, null, 2)}\n`);
      renameSync(`${file}.tmp`, file);
    },
  };
}
