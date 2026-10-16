// Exports a store file as CSV (header key,value,updatedAt) for the nightly billing import.
// Usage: node tools/export-csv.js <store.json>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const field = (s) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function toCsv(text) {
  const data = JSON.parse(text);
  if (data.version !== 1) throw new Error(`unsupported store version ${data.version}`);
  const rows = Object.entries(data.entries).map(([key, e]) => [key, JSON.stringify(e.value), new Date(e.updatedAt).toISOString()]);
  return `${['key,value,updatedAt', ...rows.map((r) => r.map(field).join(','))].join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(toCsv(readFileSync(process.argv[2], 'utf8')));
