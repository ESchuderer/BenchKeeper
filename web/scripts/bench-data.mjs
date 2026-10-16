// Benchmark trials for the /bench/ page, read at build time from bench/results/<run>/round-<n>/<arm>/
// (trial.json, review.json, screenshots/) and the run's manifest.txt. Cost fields are never read (owner decision, #33).
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

// The site never shows an em dash (rules/global.md); recorded review text may contain one.
const clean = (s) => String(s ?? '').replace(/\s*\u2014\s*/g, ', ');
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
        const shots = existsSync(join(dir, 'screenshots')) ? readdirSync(join(dir, 'screenshots')).filter((f) => f.endsWith('.jpg')).sort() : [];
        trials.push({
          key: `${run}/${round}/${id}`, run, brief: meta.brief, model: MODELS[meta.model] || meta.model, effort: meta.effort,
          runtime: t.runtime === 'opencode' ? 'OpenCode' : 'Claude Code', arm: id, ...arm(id),
          features: t.score?.features_passed ?? null, robustness: t.score?.robustness_passed ?? null,
          followups: t.followups ?? 0, minutes: Math.round((t.wall_seconds ?? 0) / 60),
          testsFirst: Boolean(t.workflow?.tests_first), reviewStep: Boolean(t.workflow?.review),
          overall: r?.overall ?? null,
          method: { protocol: t.method?.protocol ?? null, tests: t.score?.hidden_tests ?? null, criteria: Object.keys(r?.scores || {}).length || null, bk: t.method?.bk ?? 'v1' },
          scores: Object.fromEntries(Object.entries(r?.scores || {}).map(([k, v]) => [k, typeof v === 'object' ? v.score : v])),
          verdict: clean(r?.verdict), strengths: (r?.strengths || []).map(clean), issues: (r?.issues || []).map(clean),
          screenshots: shots.map((f) => ({ page: f.replace(/\.jpg$/, ''), file: `${run}/${round}/${id}/screenshots/${f}` })),
        });
      }
    }
  }
  return trials;
}

export const methodLabel = (m = {}) => [m.protocol ? `protocol ${m.protocol}` : 'protocol not recorded', m.tests && `hidden tests ${m.tests}`, m.criteria && `${m.criteria} review criteria`, `BenchKeeper layer ${m.bk || 'v1'}`].filter(Boolean).join(', ');

// One entry per brief that has trials: its first paragraph, counts, runtimes, models, run dates, testing methods with
// their trial counts and the report file; newest run first.
export function summarizeBriefs(trials, briefsDir, resultsDir) {
  return [...new Set(trials.map((t) => t.brief))].map((id) => {
    const ts = trials.filter((t) => t.brief === id);
    const file = join(briefsDir, id, 'brief.md');
    const summary = existsSync(file) ? clean(readFileSync(file, 'utf8').split(/\n\s*\n/)[0].trim()) : '';
    const dates = [...new Set(ts.map((t) => t.run.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    const reports = existsSync(resultsDir) ? readdirSync(resultsDir).filter((f) => f.endsWith(`-${id}.md`)).sort() : [];
    const methods = Object.entries(ts.reduce((n, t) => ({ ...n, [methodLabel(t.method)]: (n[methodLabel(t.method)] || 0) + 1 }), {}))
      .map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    return {
      id, summary, trials: ts.length, arms: new Set(ts.map((t) => t.arm)).size,
      runtimes: [...new Set(ts.map((t) => t.runtime))].sort(), models: [...new Set(ts.map((t) => t.model))].sort(), dates, methods, reports,
    };
  }).sort((a, b) => (b.dates.at(-1) || '').localeCompare(a.dates.at(-1) || '') || a.id.localeCompare(b.id));
}
