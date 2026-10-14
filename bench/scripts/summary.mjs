// Descriptive per-arm table for a brief run (no significance tests: too few trials).
// Usage: node bench/scripts/summary.mjs <run-dir>   (reads round-*/<arm>/trial.json, prints Markdown)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const range = (xs) => {
  const s = xs.filter((x) => typeof x === 'number');
  return s.length ? `${median(s)} (${Math.min(...s)} to ${Math.max(...s)})` : 'n/a';
};
const r1 = (x) => (typeof x === 'number' ? Math.round(x * 10) / 10 : x);

export function table(trials) {
  const arms = [...new Set(trials.map((t) => t.arm))].sort();
  const rows = arms.map((arm) => {
    const ts = trials.filter((t) => t.arm === arm);
    const valid = ts.filter((t) => t.audit.ok && !t.outcome.infra_error);
    const col = (f) => range(valid.map(f).map(r1));
    return `| ${arm} | ${ts.length} | ${ts.length - valid.length} | ${col((t) => t.score.features_passed)} | ${col((t) => t.score.lighthouse?.performance * 100)} | ${col((t) => Object.values(t.score.axe || {}).reduce((a, b) => a + b, 0))} | ${valid.filter((t) => t.workflow.tests_written).length} | ${valid.filter((t) => t.workflow.review).length} | ${col((t) => t.lines.source)} | ${col((t) => t.outcome.duration_ms / 60000)} | ${col((t) => t.outcome.cost_usd_api_equivalent)} |`;
  });
  return ['| Arm | Trials | Invalid | Features (of 6) | Lighthouse perf | axe violations | Tests written | Review ran | Source lines | Minutes | USD (API-equivalent) |',
    '|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const trials = readdirSync(dir).filter((d) => d.startsWith('round-')).flatMap((r) => readdirSync(join(dir, r))
    .map((a) => join(dir, r, a, 'trial.json')).filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8'))));
  console.log('Median (min to max) over valid trials; invalid = failed delivery audit or infrastructure error.\n');
  console.log(table(trials));
}
