// Benchmark trials for the /bench/ pages, read at build time from bench/results/<run>/round-<n>/<arm>/
// (trial.json, review.json, drawing-review.json, screenshots/), the run's manifest.txt, final-score.json (bench/scripts/final-score.mjs)
// and brownfield-score.json (bench/scripts/brownfield-score.mjs).
// Cost fields are never read (owner decision).
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
  AD: { fw: 'V', bk: true, label: 'BK v3 + Matt Pocock' }, AE: { fw: 'V', bk: true, spec: 'OpenSpec', label: 'BK v3 + Matt Pocock + OpenSpec' }, AF: { fw: 'V', ponytail: true },
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

// Runs kept off the site (owner, 2026-10-16: no Haiku). Their data and Markdown report stay in bench/results.
export const OFF_SITE = new Set(['2026-10-15-winery-react-haiku', '2026-10-16-cartridges-haiku']);

const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
// Drawing review per app (drawing-review.json, one verdict per drawing). Reviewers differed on the shoulder angle drawn as
// a leader label instead of an angle dimension: a drawing faulted only for that counts as correct in correctAlphaApart.
// Confirmations some reviewers listed among the issues ("values match record ...") are not faults.
const ALPHA = /α|alpha|shoulder angle/i, NOTE = /^values? match/i;
function drawingReview(d) {
  if (!d?.drawings) return null;
  const v = Object.values(d.drawings);
  const faults = (x) => (x.issues ?? []).filter((i) => !NOTE.test(i));
  const alphaOnly = v.filter((x) => x.verdict === 'partly' && faults(x).length && faults(x).every((i) => ALPHA.test(i))).length;
  const count = (k) => v.filter((x) => x.verdict === k).length;
  return { of: v.length, correct: count('correct'), partly: count('partly'), wrong: count('wrong'), correctAlphaApart: count('correct') + alphaOnly, alphaOnly };
}
const MODELS = { 'claude-haiku-5-5': 'Haiku 5.5', 'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5' };

export function loadTrials(results) {
  const trials = [];
  for (const run of readdirSync(results).filter((d) => existsSync(join(results, d, 'manifest.txt'))).sort()) {
    const head = readFileSync(join(results, run, 'manifest.txt'), 'utf8').split('\n')[0];
    const meta = Object.fromEntries(head.split(' ').map((kv) => kv.split('=')));
    // final-score.mjs scores round 1 only.
    const finals = new Map((json(join(results, run, 'final-score.json'))?.trials ?? []).map((f) => [f.arm, { total: f.total, categories: f.categories }]));
    const brownfield = new Map((json(join(results, run, 'brownfield-score.json'))?.trials ?? []).map((b) => [`${b.round}/${b.arm}`, b.total]));
    if (!meta.brief || !meta.model) throw new Error(`${run}/manifest.txt: first line needs brief= and model=`);
    for (const round of readdirSync(join(results, run)).filter((d) => /^round-\d+$/.test(d)).sort()) {
      for (const id of readdirSync(join(results, run, round)).sort()) {
        const dir = join(results, run, round, id);
        const t = json(join(dir, 'trial.json'));
        if (!t) continue;
        const r = json(join(dir, 'review.json'))?.review;
        const shots = join(dir, 'screenshots');
        trials.push({
          key: `${run}/${round}/${id}`, run, round: Number(round.slice(6)), brief: meta.brief, model: MODELS[meta.model] || meta.model, effort: meta.effort, k: meta.k,
          runtime: t.runtime === 'opencode' ? 'OpenCode' : 'Claude Code', arm: id, setup: arm(id).setup,
          features: t.score?.features_passed ?? null, robustness: t.score?.robustness_passed ?? null,
          featuresOf: Object.keys(t.score?.features || {}).length || null, robustnessOf: Object.keys(t.score?.robustness || {}).length || null,
          minutes: Math.round((t.wall_seconds ?? 0) / 60), overall: r?.overall ?? null,
          protocol: t.method?.protocol ?? null, criteria: Object.keys(r?.scores || {}).length || null,
          final: (round === 'round-1' && finals.get(id)) || null, mutation: t.score?.mutation?.score ?? null, drawings: drawingReview(json(join(dir, 'drawing-review.json'))),
          brownfield: brownfield.get(`${round}/${id}`) ?? null,
          notes: r ? { verdict: r.verdict ?? null, strengths: r.strengths ?? [], issues: r.issues ?? [] } : null,
          screenshots: existsSync(shots) ? readdirSync(shots).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort() : [],
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

// Per brief, the trials of all its runs (models) that have a final score, ranked by total, then fewer minutes: the top 10,
// and plain Claude Code (arm A) of each model with its place when it is not in the top 10.
export function topByBrief(trials) {
  return [...new Set(trials.filter((t) => t.final).map((t) => t.brief))].map((brief) => {
    const ranked = trials.filter((t) => t.brief === brief && t.final).sort((a, b) => b.final.total - a.final.total || a.minutes - b.minutes);
    const top = ranked.slice(0, 10);
    const baselines = ranked.filter((t) => t.arm === 'A' && t.runtime === 'Claude Code' && !top.includes(t)).map((t) => ({ ...t, place: ranked.indexOf(t) + 1 }));
    return { brief, of: ranked.length, top, baselines };
  });
}

const median = (v) => {
  const s = v.filter((x) => x != null).sort((a, b) => a - b), m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};

// The trials of one run, one row per arm with its rounds, ranked by the run's score: the final score where the run has one
// (round 1 only), else the brownfield score, else the review overall. An arm's score is the median over its rounds;
// equal scores share a rank and are ordered by fewer minutes. Review ratings of different runtimes use other criteria:
// with the review as score, each runtime is ranked apart (groups); otherwise one group with runtime null.
export function rankArms(trials) {
  const kind = trials.some((t) => t.final) ? 'final' : trials.some((t) => t.brownfield != null) ? 'brownfield' : 'review';
  const value = (t) => (kind === 'final' ? t.final?.total ?? null : kind === 'brownfield' ? t.brownfield : t.overall);
  const rank = (ts) => {
    const rows = [...new Set(ts.map((t) => t.arm))].map((id) => {
      const rounds = ts.filter((t) => t.arm === id).sort((a, b) => a.round - b.round);
      return { arm: id, setup: rounds[0].setup, runtime: rounds[0].runtime, score: median(rounds.map(value)), minutes: median(rounds.map((t) => t.minutes)), rounds };
    }).sort((a, b) => desc(a.score, b.score) || a.minutes - b.minutes);
    rows.forEach((r, i) => { r.rank = i && rows[i - 1].score === r.score ? rows[i - 1].rank : i + 1; });
    return rows;
  };
  const groups = kind === 'review'
    ? [...new Set(trials.map((t) => t.runtime))].sort().map((runtime) => ({ runtime, rows: rank(trials.filter((t) => t.runtime === runtime)) }))
    : [{ runtime: null, rows: rank(trials) }];
  return { kind, groups };
}
