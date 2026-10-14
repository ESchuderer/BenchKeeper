// Writes the base rules for arms D and E: rules/global.md without the sections that set the workflow, so Superpowers or ECC runs its own flow.
// Usage: node bench/scripts/arm-rules.mjs [--check]   (--check fails when bench/arms/base.rules.md is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DROPPED = ['Ponytail and agent-skills', 'Branches, issues and pull requests', 'Task tiers', 'SDLC'];

export function base(rules) {
  const sections = rules.split(/^(?=## )/m);
  const missing = DROPPED.filter((h) => !sections.some((s) => s.startsWith(`## ${h}\n`)));
  if (missing.length) throw new Error(`sections not found in rules: ${missing.join(', ')}`);
  return sections.filter((s) => !DROPPED.some((h) => s.startsWith(`## ${h}\n`))).join('').trimEnd() + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../../', import.meta.url);
  const out = base(readFileSync(new URL('rules/global.md', root), 'utf8'));
  const target = new URL('bench/arms/base.rules.md', root);
  if (process.argv[2] === '--check') {
    if (readFileSync(target, 'utf8') !== out) { console.error('bench/arms/base.rules.md is out of date'); process.exit(1); }
  } else writeFileSync(target, out);
}
