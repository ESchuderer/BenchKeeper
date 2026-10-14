// Writes the global rules for a benchmark arm: rules/global.md with agent-skills names and mentions swapped by bench/arms/<arm>.json.
// Usage: node bench/scripts/arm-rules.mjs <arm> [--check]   (--check fails when bench/arms/<arm>.rules.md is out of date)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const render = (m) => (m.skill ? `\`${m.skill}\`` : m.agent ? `the \`${m.agent}\` agent` : `any installed ${m.none} skill`);

export function variant(rules, map) {
  // Backticked names only, so prose and other tools stay untouched.
  let out = rules.replace(/`([a-z0-9-]+)`/g, (whole, name) => (map.skills[name] ? render(map.skills[name]) : whole));
  // Longest phrase first, so "agent-skills (addyosmani)" wins over "agent-skills".
  for (const [from, to] of Object.entries(map.text).sort((a, b) => b[0].length - a[0].length)) out = out.split(from).join(to);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arm, flag] = process.argv.slice(2);
  if (!arm) throw new Error('usage: arm-rules.mjs <arm> [--check]');
  const out = variant(read('rules/global.md'), JSON.parse(read(`bench/arms/${arm}.json`)));
  const target = new URL(`bench/arms/${arm}.rules.md`, root);
  if (flag === '--check') {
    if (readFileSync(target, 'utf8') !== out) { console.error(`bench/arms/${arm}.rules.md is out of date`); process.exit(1); }
  } else writeFileSync(target, out);
}
