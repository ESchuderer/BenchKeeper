// Final score of cartridges trials: six category scores and a total of 100 from the weights in final-score.weights.json.
// Reads per trial: trial.json and review.json in the run folder, score/static-scan.json there, and the measures types,
// coverage, print, html and docs (bench/scorer/*.mjs) from <measures>/<run>/round-1/<ARM>/score/ (default: the run folders).
// Published runs (bench/results) keep these files next to trial.json; they are read there when the score/ copy is missing.
// Usage: node bench/scripts/final-score.mjs --out <file.json> [--weights <file>] [--measures <dir>] <run-dir>...
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const mean = (xs) => (xs.some((x) => typeof x !== 'number') ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
const per1000 = (n, lines) => (num(n) !== undefined && lines ? (1000 * n) / lines : undefined);
const zero = (reason) => ({ raw: null, reason });

// One extractor per weights input: (trial data d, input config) => { raw } | { raw: null, reason } | undefined (missing).
export const extractors = {
  hidden_features: ({ trial }) => { const f = trial?.score?.features; return f && Object.keys(f).length ? { raw: (100 * Object.values(f).filter(Boolean).length) / Object.values(f).length } : undefined; },
  print_pass: ({ print }) => print && num(print.pass) !== undefined && print.total ? { raw: (100 * print.pass) / print.total } : undefined,
  review_requirements_correctness: ({ review }) => rv(review, ['requirements', 'correctness']),
  review_quality: ({ review }) => rv(review, ['code_quality', 'simplicity', 'maintainability']),
  erosion: ({ trial }) => rw(trial?.score?.code?.erosion),
  type_errors: ({ types }) => rw(types?.per_1000_lines),
  sonar_bugs: ({ scan }) => rw(scan?.sonar_bugs?.per_1000_lines),
  lint: ({ scan }) => rw(scan?.lint?.per_1000_lines),
  duplication: ({ trial }) => rw(trial?.score?.code?.duplication),
  line_coverage: ({ coverage }) => (coverage ? (num(coverage.line) !== undefined ? { raw: coverage.line } : zero(coverage.reason ?? 'no coverage')) : undefined),
  review_tests: ({ review }) => rv(review, ['tests']),
  security_findings: ({ scan }, cfg) => {
    const rules = scan?.security?.rules, lines = scan?.totals?.lines;
    if (!rules || !lines) return undefined;
    const n = Object.entries(rules).filter(([r]) => !cfg.excluded_rules.includes(r)).reduce((a, [, c]) => a + c, 0);
    return { raw: per1000(n, lines) };
  },
  review_security: ({ review }) => rv(review, ['security']),
  review_ux: ({ review }) => rv(review, ['ux_design', 'visual_design', 'layout', 'usability', 'reception']),
  axe_violations: ({ trial }) => { const a = trial?.score?.axe; return a ? rw(Object.values(a).reduce((x, y) => x + y, 0)) : undefined; },
  lighthouse_accessibility: ({ trial }) => rw(trial?.score?.lighthouse?.accessibility),
  lighthouse_performance: ({ trial }) => rw(trial?.score?.lighthouse?.performance),
  html_errors: ({ html }) => rw(html?.errors),
  readme_coverage: ({ docs }) => docs && (docs.readme ? { raw: (100 * Object.values(docs.readme.coverage).filter(Boolean).length) / Object.values(docs.readme.coverage).length } : zero('no README')),
  readme_accuracy: ({ docs }) => docs && (docs.readme ? { raw: docs.readme.accuracy.share ?? 100 } : zero('no README')),
  doc_functions: ({ docs }) => (docs?.code && num(docs.code.documented_share) !== undefined ? { raw: docs.code.documented_share } : docs ? zero('no functions') : undefined),
  doc_exports: ({ docs }) => { const c = docs?.code; return c && (num(c.exported_share) !== undefined ? { raw: c.exported_share } : num(c.documented_share) !== undefined ? { raw: c.documented_share } : zero('no functions')); },
  comment_density: ({ docs }) => rw(docs?.code?.comments_per_100_code_lines),
  decision_records: ({ docs }) => (docs?.decisions ? { raw: (100 * docs.decisions.count) / 3 } : undefined),
  maintenance_flags: ({ trial }) => {
    const m = trial?.maintenance;
    if (!m) return undefined;
    const keys = ['readme', 'readme_setup', 'test_script', 'lint_or_typecheck', 'ci', 'changelog', 'docs'];
    return { raw: (100 * keys.filter((k) => m[k] === true).length) / keys.length };
  },
};
function rw(x) { return num(x) === undefined ? undefined : { raw: x }; }
function rv(review, keys) { const s = review?.review?.scores; const m = s && mean(keys.map((k) => s[k])); return m === undefined ? undefined : { raw: m }; }

export function normalize(kind, raw, cap) {
  const clamp = (x) => Math.max(0, Math.min(100, x));
  if (kind === 'pct') return clamp(raw);
  if (kind === 'likert') return clamp(((raw - 1) / 4) * 100);
  if (kind === 'unit') return clamp(raw * 100);
  if (kind === 'lower') return clamp(100 * (1 - raw / cap));
  if (kind === 'upto') return clamp((100 * raw) / cap);
  throw new Error(`unknown normalization ${kind}`);
}

export function score(data, weights) {
  const categories = {}, inputs = {}, missing = [], zero_reasons = {};
  let total = 0;
  for (const [cat, c] of Object.entries(weights.categories)) {
    let sum = 0;
    for (const [id, cfg] of Object.entries(c.inputs)) {
      const r = extractors[id](data, cfg);
      let normalized = 0, raw = null;
      if (!r) missing.push(id);
      else if (r.raw === null) zero_reasons[id] = r.reason;
      else { raw = r.raw; normalized = normalize(cfg.normalize, raw, cfg.cap); }
      const points = (cfg.weight * normalized) / 100;
      inputs[id] = { category: cat, weight: cfg.weight, raw, normalized: Math.round(normalized * 10) / 10, points: Math.round(points * 100) / 100, ...(r?.reason ? { reason: r.reason } : {}) };
      sum += points;
    }
    categories[cat] = { score: Math.round(sum * 100) / 100, max: c.weight };
    total += sum;
  }
  return { total: Math.round(total * 100) / 100, categories, inputs, missing, zero_reasons };
}

const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; } };

export function loadTrial(runDir, arm, measuresRoot) {
  const t = join(runDir, 'round-1', arm), m = join(measuresRoot, basename(runDir), 'round-1', arm, 'score');
  const either = (dir, f) => json(join(dir, f)) ?? json(join(t, f));
  return { trial: json(join(t, 'trial.json')), review: json(join(t, 'review.json')), scan: either(join(t, 'score'), 'static-scan.json'),
    types: either(m, 'types.json'), coverage: either(m, 'coverage.json'), print: either(m, 'print.json'),
    html: either(m, 'html.json'), docs: either(m, 'docs.json') };
}

export function table(rows, weights) {
  const cats = Object.keys(weights.categories);
  const head = ['#', 'model', 'arm', 'total', ...cats.map((c) => `${c}/${weights.categories[c].weight}`), 'missing'];
  const body = rows.map((r, i) => [i + 1, r.model, r.arm, r.total.toFixed(1), ...cats.map((c) => r.categories[c].score.toFixed(1)), r.missing.length]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => String(b[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padStart(w[i])).join('  ');
  return [line(head), ...body.map(line)].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), opt = {}, runs = [];
  for (let i = 0; i < args.length; i++) (args[i].startsWith('--') ? (opt[args[i].slice(2)] = args[++i]) : runs.push(args[i]));
  const weights = JSON.parse(readFileSync(opt.weights ?? new URL('final-score.weights.json', import.meta.url), 'utf8'));
  const rows = [];
  for (const run of runs) {
    const model = /haiku|sonnet|opus/.exec(basename(run))?.[0] ?? basename(run);
    for (const arm of readdirSync(join(run, 'round-1')).sort()) {
      if (!existsSync(join(run, 'round-1', arm, 'trial.json'))) continue;
      rows.push({ model, arm, ...score(loadTrial(run, arm, opt.measures ?? join(run, '..')), weights) });
    }
  }
  rows.sort((a, b) => b.total - a.total);
  writeFileSync(opt.out, JSON.stringify({ weights, trials: rows }, null, 2));
  console.log(table(rows, weights));
}
