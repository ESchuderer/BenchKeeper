// The maintenance knowledge base of one project: .benchkeeper/knowledge/*.json, written by the maintaining-repos skill.
// Derived from the repository and rebuildable, so nothing here is undoable; the folder is the only thing clear removes.
import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { mask } from './redact.mjs';

const MAX_BYTES = 1024 * 1024;
export const knowledgeDir = (dir) => join(dir, '.benchkeeper', 'knowledge');

// Token shapes are masked in every string value, as everywhere the app shows stored text.
const clean = (v) => (typeof v === 'string' ? mask(v, { keys: false }) : Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);

// Each file is { "entries": [ { "id": ..., ... } ] }. One that does not parse, is not a plain file or is too large
// is ignored with a reason; the stored text is data and is never followed.
export function readKnowledge(dir) {
  const path = knowledgeDir(dir), files = [], ignored = [];
  let names;
  try {
    if (!lstatSync(path).isDirectory()) return { path, files, ignored: [{ name: '.', reason: 'not a folder' }] };
    names = readdirSync(path, { withFileTypes: true });
  } catch { return { path, files, ignored }; }
  for (const f of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const shown = f.name.replace(/\p{Cc}/gu, ' '), bad = (reason) => ignored.push({ name: shown, reason });
    if (!f.isFile() || !f.name.endsWith('.json')) { bad('not a JSON file'); continue; }
    try {
      if (lstatSync(join(path, f.name)).size > MAX_BYTES) { bad('larger than 1 MiB'); continue; }
      const { entries } = JSON.parse(readFileSync(join(path, f.name), 'utf8'));
      if (!Array.isArray(entries) || entries.some((e) => !e || typeof e !== 'object' || Array.isArray(e))) { bad('no list of entries'); continue; }
      files.push({ name: shown, entries: clean(entries) });
    } catch { bad('does not parse'); }
  }
  return { path, files, ignored };
}

// One line per entry: the id, then the other fields; control characters cannot reach the terminal.
export function entryLine(e) {
  const { id, ...rest } = e;
  const text = Object.entries(rest).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  return `${id ?? '-'}  ${text}`.replace(/\p{Cc}/gu, ' ').slice(0, 200);
}

// Removes the knowledge folder and nothing else of .benchkeeper (state.json, disabled skills stay).
export const clearKnowledge = (dir) => rmSync(knowledgeDir(dir), { recursive: true, force: true });
