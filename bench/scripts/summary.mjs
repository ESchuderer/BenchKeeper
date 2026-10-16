// Descriptive per-arm table for a brief run (no significance tests: too few trials).
// Usage: node bench/scripts/summary.mjs <run-dir>   (reads round-*/<arm>/trial.json, prints Markdown)
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const range = (xs) => {
  const s = xs.filter(Number.isFinite);
  return s.length ? `${Math.round(median(s) * 1e6) / 1e6} (${Math.min(...s)} to ${Math.max(...s)})` : 'n/a';
};
const round = (d) => (x) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

// Iterative briefs: steps passed strictly, erosion and duplication at the last step, per arm.
export function stepsTable(trials) {
  const arms = [...new Set(trials.filter((t) => t.checkpoints).map((t) => t.arm))].sort();
  const rows = arms.map((arm) => {
    const ts = trials.filter((t) => t.arm === arm && t.checkpoints && t.audit.ok && !t.outcome.infra_error);
    const col = (f, d = 1) => range(ts.map(f).map(round(d)));
    return `| ${arm} | ${ts.length} | ${col((t) => t.checkpoints.filter((c) => c.strict).length)} of ${ts[0]?.checkpoints.length ?? 'n/a'} | ${col((t) => t.checkpoints.at(-1).code?.erosion, 3)} | ${col((t) => t.checkpoints.at(-1).code?.duplication)} | ${col((t) => t.checkpoints.at(-1).code?.source_lines, 0)} |`;
  });
  return ['| Arm | Valid trials | Steps passed strictly | Erosion (last step) | Duplication % (last step) | Source lines (last step) |',
    '|---|---|---|---|---|---|', ...rows].join('\n');
}

export function table(trials) {
  const arms = [...new Set(trials.map((t) => t.arm))].sort();
  const rows = arms.map((arm) => {
    const ts = trials.filter((t) => t.arm === arm);
    const valid = ts.filter((t) => t.audit.ok && !t.outcome.infra_error);
    const col = (f, d = 1) => range(valid.map(f).map(round(d)));
    return `| ${arm} | ${ts.length} | ${ts.length - valid.length} | ${col((t) => t.score.features_passed)} | ${col((t) => t.score.robustness_passed)} | ${col((t) => t.followups)} | ${col((t) => (t.score.lighthouse?.performance == null ? null : t.score.lighthouse.performance * 100))} | ${col((t) => (t.score.axe ? Object.values(t.score.axe).reduce((a, b) => a + b, 0) : null))} | ${valid.filter((t) => t.workflow.tests_written).length} | ${valid.filter((t) => t.workflow.review).length} | ${col((t) => t.lines.source)} | ${col((t) => t.wall_seconds / 60)} | ${col((t) => t.outcome.cost_usd_api_equivalent, 3)} |`;
  });
  return ['| Arm | Trials | Invalid | Features (of 6) | Robustness (of 12) | Follow-ups | Lighthouse perf | axe violations | Tests written | Review ran | Source lines | Minutes | USD (API-equivalent) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const trials = readdirSync(dir).filter((d) => d.startsWith('round-')).flatMap((r) => readdirSync(join(dir, r))
    .map((a) => join(dir, r, a, 'trial.json')).filter(existsSync).map((f) => JSON.parse(readFileSync(f, 'utf8'))));
  console.log('Median (min to max) over valid trials; invalid = failed delivery audit or infrastructure error; n/a = not measured (for example the app did not start).\n');
  console.log(table(trials));
  if (trials.some((t) => t.checkpoints)) console.log(`\n${stepsTable(trials)}`);
}
