// Benchmark trials for the /bench/ page, read at build time from bench/results/<run>/round-<n>/<arm>/
// (trial.json, review.json) and the run's manifest.txt. Cost fields are never read (owner decision, #33).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Arm descriptors (bench/SCENARIOS.md). The BenchKeeper layer includes Ponytail.
const FW = { F: 'agent-skills', G: 'Superpowers', H: 'ECC', V: 'Matt Pocock' };
const ARMS = {
  A: {}, B: { ponytail: true }, AB: { spec: 'OpenSpec' }, AC: { spec: 'Spec Kit' },
  O: { ponytail: true, spec: 'OpenSpec' }, P: { ponytail: true, spec: 'Spec Kit' },
  F: { fw: 'F' }, G: { fw: 'G' }, H: { fw: 'H' }, V: { fw: 'V' },
  I: { fw: 'F', spec: 'OpenSpec' }, J: { fw: 'G', spec: 'OpenSpec' }, K: { fw: 'H', spec: 'OpenSpec' }, W: { fw: 'V', spec: 'OpenSpec' },
  L: { fw: 'F', bk: true }, M: { fw: 'G', bk: true }, N: { fw: 'H', bk: true }, X: { fw: 'V', bk: true },
  C: { fw: 'F', bk: true, spec: 'OpenSpec' }, D: { fw: 'G', bk: true, spec: 'OpenSpec' },
  E: { fw: 'H', bk: true, spec: 'OpenSpec' }, Y: { fw: 'V', bk: true, spec: 'OpenSpec' },
  Q: { framework: 'targeted agent-skills', spec: 'OpenSpec' }, R: { fw: 'G' }, S: { fw: 'G', spec: 'OpenSpec', label: 'OpenSpec + Superpowers (oso)' },
  T: { fw: 'F' }, U: { fw: 'F', spec: 'OpenSpec' }, Z: { fw: 'V' }, AA: { fw: 'V', spec: 'OpenSpec' },
};

export function arm(id) {
  const a = ARMS[id];
  if (!a) throw new Error(`unknown arm ${id}`);
  const framework = a.framework || FW[a.fw] || 'none';
  const parts = [a.bk && 'BK', framework !== 'none' && framework, a.ponytail && !a.bk && 'Ponytail', a.spec].filter(Boolean);
  return { framework, spec: a.spec || 'none', bk: Boolean(a.bk), ponytail: Boolean(a.ponytail || a.bk), setup: a.label || parts.join(' + ') || 'plain' };
}

const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
const MODELS = { 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5' };

export function loadTrials(results) {
  const trials = [];
  for (const run of readdirSync(results).filter((d) => existsSync(join(results, d, 'manifest.txt'))).sort()) {
    const head = readFileSync(join(results, run, 'manifest.txt'), 'utf8').split('\n')[0];
    const meta = Object.fromEntries(head.split(' ').map((kv) => kv.split('=')));
    if (!meta.brief || !meta.model) throw new Error(`${run}/manifest.txt: first line needs brief= and model=`);
    for (const round of readdirSync(join(results, run)).filter((d) => /^round-\d+$/.test(d)).sort()) {
      for (const id of readdirSync(join(results, run, round)).sort()) {
        const dir = join(results, run, round, id);
        const t = json(join(dir, 'trial.json'));
        if (!t) continue;
        const r = json(join(dir, 'review.json'))?.review;
        trials.push({
          key: `${run}/${round}/${id}`, run, brief: meta.brief, model: MODELS[meta.model] || meta.model, effort: meta.effort, k: meta.k,
          runtime: t.runtime === 'opencode' ? 'OpenCode' : 'Claude Code', arm: id, setup: arm(id).setup,
          features: t.score?.features_passed ?? null, robustness: t.score?.robustness_passed ?? null,
          featuresOf: Object.keys(t.score?.features || {}).length || null, robustnessOf: Object.keys(t.score?.robustness || {}).length || null,
          minutes: Math.round((t.wall_seconds ?? 0) / 60), overall: r?.overall ?? null,
          protocol: t.method?.protocol ?? null, criteria: Object.keys(r?.scores || {}).length || null,
        });
      }
    }
  }
  return trials;
}

// Missing values sort last; equal scores are ordered by fewer minutes.
const desc = (a, b) => (b ?? -1) - (a ?? -1);
const rankOrder = (a, b) => desc(a.overall, b.overall) || desc(a.features, b.features) || desc(a.robustness, b.robustness) || a.minutes - b.minutes;

// One entry per run (brief and model), newest first: setup facts, the report file, and per runtime the trials ranked by
// review overall, then features, robustness and fewer minutes. Runtimes are kept apart: their reviews may use other criteria.
export function summarizeRuns(trials, reports = []) {
  return [...new Set(trials.map((t) => t.run))].map((run) => {
    const ts = trials.filter((t) => t.run === run), [t0] = ts;
    const report = reports.includes(`${run}.md`) ? `${run}.md` : reports.filter((f) => new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${t0.brief}\\.md$`).test(f)).sort().at(-1) ?? null;
    return {
      run, brief: t0.brief, model: t0.model, effort: t0.effort, k: t0.k, date: run.slice(0, 10), report,
      // Test totals of the run: an app that did not start records no tests.
      featuresOf: Math.max(0, ...ts.map((t) => t.featuresOf ?? 0)) || null, robustnessOf: Math.max(0, ...ts.map((t) => t.robustnessOf ?? 0)) || null,
      protocols: [...new Set(ts.map((t) => t.protocol).filter(Boolean))].sort(),
      groups: [...new Set(ts.map((t) => t.runtime))].sort().map((runtime) => {
        const rows = ts.filter((t) => t.runtime === runtime).sort(rankOrder);
        // Equal scores share a rank; minutes only order the rows.
        rows.forEach((t, i) => { const p = rows[i - 1]; t.rank = p && p.overall === t.overall && p.features === t.features && p.robustness === t.robustness ? p.rank : i + 1; });
        return { runtime, criteria: [...new Set(rows.map((t) => t.criteria).filter(Boolean))].sort((a, b) => a - b), rows };
      }),
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.run.localeCompare(b.run));
}
