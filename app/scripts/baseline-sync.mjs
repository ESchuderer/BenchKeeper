// Writes src/baseline/ from repo-baseline at the commit REF names (src/baseline.mjs), or with --check reports files that differ.
// A new REF: change it there, run this script, commit both.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASELINE_REPO, CALLERS, PROFILES, REF, TEMPLATES } from '../src/baseline.mjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../src/baseline');
const files = [...PROFILES.map((p) => `profiles/${p}.json`), ...CALLERS.map((c) => `callers/${c}.yml`), ...TEMPLATES.map((t) => `templates/${t}`)];
let differ = 0;
for (const f of files) {
  const r = await fetch(`https://raw.githubusercontent.com/${BASELINE_REPO}/${REF}/${f}`);
  if (!r.ok) throw new Error(`${f} at ${REF}: HTTP ${r.status}`);
  const text = await r.text();
  const path = join(dir, f);
  let have = null;
  try { have = readFileSync(path, 'utf8'); } catch { /* new file */ }
  if (have === text) continue;
  if (process.argv.includes('--check')) { differ++; console.log(`differs: ${f}`); continue; }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.log(`wrote ${f}`);
}
process.exitCode = differ ? 1 : 0;
