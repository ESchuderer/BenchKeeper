// Writes the framework variants of the BenchKeeper rules: bench/arms/bk-rules.md (the pinned rules) with the sections and lines that name agent-skills replaced by
// the framework's own flow, from bench/arms/<framework>.md (`<!-- section: Heading -->` blocks, `<!-- replace: from ==> to -->` lines).
// Usage: node bench/scripts/arm-rules.mjs [--check]   (--check fails when bench/arms/<framework>.rules.md is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FRAMEWORKS = ['superpowers', 'ecc', 'mattpocock'];

export function parse(spec) {
  const sections = {};
  for (const m of spec.matchAll(/<!-- section: (.+?) -->\n([\s\S]*?)(?=\n<!-- |$)/g)) sections[m[1]] = m[2].trim() + '\n';
  const replace = [...spec.matchAll(/<!-- replace: (.+?) ==> (.*?) -->/g)].map((m) => [m[1], m[2]]);
  return { sections, replace };
}

export function variant(rules, spec) {
  const { sections, replace } = parse(spec);
  const parts = rules.split(/^(?=## )/m);
  const missing = Object.keys(sections).filter((h) => !parts.some((p) => p.startsWith(`## ${h}\n`)));
  if (missing.length) throw new Error(`sections not found in rules: ${missing.join(', ')}`);
  let out = parts.map((p) => {
    const h = Object.keys(sections).find((k) => p.startsWith(`## ${k}\n`));
    return h ? sections[h] + (p.endsWith('\n\n') ? '\n' : '') : p;
  }).join('');
  for (const [from, to] of replace) {
    if (!out.includes(from)) throw new Error(`text not found in rules: ${from}`);
    out = out.split(from).join(to);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL('../../', import.meta.url);
  const rules = readFileSync(new URL('bench/arms/bk-rules.md', root), 'utf8');
  for (const fw of FRAMEWORKS) {
    const out = variant(rules, readFileSync(new URL(`bench/arms/${fw}.md`, root), 'utf8'));
    const target = new URL(`bench/arms/${fw}.rules.md`, root);
    if (process.argv[2] === '--check') {
      if (readFileSync(target, 'utf8') !== out) { console.error(`bench/arms/${fw}.rules.md is out of date`); process.exit(1); }
    } else writeFileSync(target, out);
  }
}
