// Trigger eval summary (#36 step 3): per-skill recall and precision from the run_eval outputs of
// bench/scripts/trigger-eval.sh. Usage: node bench/scripts/trigger-summary.mjs <results dir>   prints a Markdown table.
// Counted per run (each query runs `runs` times): recall = triggers on should-trigger runs / should-trigger runs;
// precision = triggers on should-trigger runs / all triggers; false triggers = triggers on should-not-trigger runs.
// Check column: "ok", or why the row is suspect: queries missing against the prompt set, runs per query other than the
// run's setting, or no trigger in any run (run_eval scores a failed claude call as not triggered).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarize(skill, output, expected = {}) {
  let pos = 0, tp = 0, neg = 0, fp = 0;
  for (const r of output.results) {
    if (r.should_trigger) { pos += r.runs; tp += r.triggers; } else { neg += r.runs; fp += r.triggers; }
  }
  const flags = [];
  if (expected.queries !== undefined && output.results.length !== expected.queries) flags.push(`${output.results.length} of ${expected.queries} queries`);
  if (expected.runs !== undefined && output.results.some((r) => r.runs !== expected.runs)) flags.push(`runs other than ${expected.runs}`);
  if (tp + fp === 0) flags.push('no triggers');
  return { skill, pos, tp, neg, fp, passed: output.summary.passed, total: output.summary.total, check: flags.join(', ') || 'ok' };
}

const ratio = (a, b) => (b ? `${a}/${b} (${(a / b).toFixed(2)})` : 'n/a');

export function table(rows) {
  return ['| Skill | Recall | Precision | False triggers | Queries passed | Check |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| \`${r.skill}\` | ${ratio(r.tp, r.pos)} | ${ratio(r.tp, r.tp + r.fp)} | ${ratio(r.fp, r.neg)} | ${r.passed}/${r.total} | ${r.check} |`)]
    .join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const settings = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
  const set = JSON.parse(readFileSync(new URL(`../triggers/${settings.collection}.json`, import.meta.url), 'utf8'));
  const rows = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'settings.json').sort().map((f) => {
    const skill = f.slice(0, -5);
    return summarize(skill, JSON.parse(readFileSync(join(dir, f), 'utf8')), { queries: set[skill]?.length ?? 0, runs: settings.runs });
  });
  console.log(table(rows));
}
