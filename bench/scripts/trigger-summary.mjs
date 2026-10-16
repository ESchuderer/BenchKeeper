// Trigger eval summary (#36 step 3): per-skill recall and precision from the run_eval outputs of
// bench/scripts/trigger-eval.sh. Usage: node bench/scripts/trigger-summary.mjs <results dir>   prints a Markdown table.
// Counted per run (each query runs `runs` times): recall = triggers on should-trigger runs / should-trigger runs;
// precision = triggers on should-trigger runs / all triggers; false triggers = triggers on should-not-trigger runs.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarize(skill, output) {
  let pos = 0, tp = 0, neg = 0, fp = 0;
  for (const r of output.results) {
    if (r.should_trigger) { pos += r.runs; tp += r.triggers; } else { neg += r.runs; fp += r.triggers; }
  }
  return { skill, pos, tp, neg, fp, passed: output.summary.passed, total: output.summary.total };
}

const ratio = (a, b) => (b ? `${a}/${b} (${(a / b).toFixed(2)})` : 'n/a');

export function table(rows) {
  return ['| Skill | Recall | Precision | False triggers | Queries passed |', '|---|---|---|---|---|',
    ...rows.map((r) => `| \`${r.skill}\` | ${ratio(r.tp, r.pos)} | ${ratio(r.tp, r.tp + r.fp)} | ${ratio(r.fp, r.neg)} | ${r.passed}/${r.total} |`)]
    .join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const rows = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => summarize(f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), 'utf8'))));
  console.log(table(rows));
}
