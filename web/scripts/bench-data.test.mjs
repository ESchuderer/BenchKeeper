import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arm, loadTrials, rankArms, summarizeRuns, topByBrief } from './bench-data.mjs';

test('invalid trials remain inspectable but never enter rankings or medians', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-validity-'));
  const run = join(root, '2026-10-21-scb');
  mkdirSync(run);
  writeFileSync(join(run, 'manifest.txt'), 'brief=scb-xjq model=claude-sonnet-5-5 effort=high k=3 seed=1\n');
  const trials = [
    { audit: { ok: true } },
    { audit: { ok: false } },
    { audit: { ok: true }, steps: [{ k: 1, scoring_error: 'evaluator failed' }] },
  ];
  trials.forEach((trial, i) => {
    const dir = join(run, `round-${i + 1}`, 'A');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'trial.json'), JSON.stringify({ arm: 'A', ...trial }));
    writeFileSync(join(dir, 'review.json'), JSON.stringify({ review: { overall: i === 0 ? 5 : 10 } }));
  });
  const loaded = loadTrials(root);
  assert.equal(loaded.length, 3);
  assert.deepEqual(loaded.map((t) => t.validity.ok), [true, false, false]);
  assert.equal(rankArms(loaded).groups[0].rows[0].score, 5);
  assert.equal(summarizeRuns(loaded)[0].groups[0].rows.length, 1);
  const withScores = loaded.map((t, i) => ({ ...t, final: { total: i === 0 ? 50 : 100 } }));
  assert.equal(topByBrief(withScores)[0].of, 1);
  assert.deepEqual(topByBrief(withScores.slice(1)), []);
});

test('arm descriptors: setup label, framework, spec tool, BenchKeeper layer with Ponytail', () => {
  assert.deepEqual(arm('A'), { framework: 'none', spec: 'none', bk: false, ponytail: false, setup: 'plain' });
  assert.equal(arm('O').setup, 'Ponytail + OpenSpec');
  assert.deepEqual(arm('E'), { framework: 'ECC', spec: 'OpenSpec', bk: true, ponytail: true, setup: 'BK + ECC + OpenSpec' });
  assert.equal(arm('S').setup, 'OpenSpec + Superpowers (oso)');
  assert.equal(arm('AD').setup, 'BK v3 + Matt Pocock');
  assert.equal(arm('AE').setup, 'BK v3 + Matt Pocock + OpenSpec');
  assert.notEqual(arm('AD').setup, arm('X').setup);
  assert.throws(() => arm('ZZ'));
});

test('trials: one per arm directory, model, effort and k from the manifest, review overall and criteria, the trial API cost but not the review cost', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-'));
  const t = join(root, 'run-1', 'round-1', 'B');
  mkdirSync(t, { recursive: true });
  writeFileSync(join(root, 'run-1', 'manifest.txt'), 'brief=winery-react model=claude-sonnet-5-5 effort=high k=1 seed=41\nimage B x\n');
  writeFileSync(join(t, 'trial.json'), JSON.stringify({
    arm: 'B', runtime: 'claude-code', followups: 1, wall_seconds: 610, outcome: { cost_usd_api_equivalent: 1.23 },
    score: { features: { F1: true, F2: false }, features_passed: 1, robustness: null, robustness_passed: null }, method: { protocol: '1.10' },
  }));
  writeFileSync(join(t, 'review.json'), JSON.stringify({ cost_usd_api_equivalent: 0.4, review: { overall: 8, scores: { requirements: 5, tests: { score: 4 } } } }));
  mkdirSync(join(root, 'run-1', 'round-1', 'C'));
  const [x, ...rest] = loadTrials(root);
  assert.equal(rest.length, 0);
  assert.deepEqual(x, {
    validity: { ok: false, problems: ['delivery audit missing or failed'] },
    key: 'run-1/round-1/B', run: 'run-1', round: 1, brief: 'winery-react', model: 'Sonnet 5.5', effort: 'high', k: '1', runtime: 'Claude Code', arm: 'B',
    setup: 'Ponytail', features: 1, robustness: null, featuresOf: 2, robustnessOf: null, minutes: 10, cost: 1.23, overall: 8, protocol: '1.10', criteria: 2,
    final: null, mutation: null, drawings: null, brownfield: null, notes: { verdict: null, strengths: [], issues: [] }, screenshots: [],
  });
  assert.doesNotMatch(JSON.stringify(x), /0\.4/);
});

test('trials: final score, mutation score and the drawing review, a drawing faulted only for the alpha label counted apart', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-'));
  const t = join(root, 'run-1', 'round-1', 'W');
  mkdirSync(t, { recursive: true });
  writeFileSync(join(root, 'run-1', 'manifest.txt'), 'brief=cartridges model=claude-sonnet-5-5 effort=high k=1 seed=41\n');
  writeFileSync(join(t, 'trial.json'), JSON.stringify({ arm: 'W', runtime: 'claude-code', wall_seconds: 60,
    score: { features: { C1: true }, features_passed: 1, mutation: { score: 71.5 } } }));
  writeFileSync(join(root, 'run-1', 'final-score.json'), JSON.stringify({ trials: [{ arm: 'W', total: 80.5, categories: { tests: { score: 12, max: 15 } }, inputs: {} }] }));
  writeFileSync(join(t, 'drawing-review.json'), JSON.stringify({ counts: { correct: 1, partly: 2, wrong: 0 }, drawings: {
    a: { verdict: 'correct', issues: [] }, b: { verdict: 'partly', issues: ['shoulder angle α is a leader callout, not an angular dimension', 'values match record (L1 36.52)'] },
    c: { verdict: 'partly', issues: ['R label overlaps the section'] } } }));
  const [x] = loadTrials(root);
  assert.deepEqual([x.final, x.mutation], [{ total: 80.5, categories: { tests: { score: 12, max: 15 } } }, 71.5]);
  assert.deepEqual(x.drawings, { of: 3, correct: 1, partly: 2, wrong: 0, correctAlphaApart: 2, alphaOnly: 1 });
});

test('trials: brownfield score per round and arm, review notes, screenshots sorted and images only', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-'));
  const t = join(root, 'run-1', 'round-2', 'AD');
  mkdirSync(join(t, 'screenshots'), { recursive: true });
  writeFileSync(join(root, 'run-1', 'manifest.txt'), 'brief=openballistics model=claude-sonnet-5-5 effort=high k=3 seed=71\n');
  writeFileSync(join(root, 'run-1', 'brownfield-score.json'), JSON.stringify({ trials: [{ round: 'round-1', arm: 'AD', total: 1 }, { round: 'round-2', arm: 'AD', total: 85.21 }] }));
  writeFileSync(join(t, 'trial.json'), JSON.stringify({ arm: 'AD', runtime: 'claude-code', wall_seconds: 60 }));
  writeFileSync(join(t, 'review.json'), JSON.stringify({ review: { overall: 7, verdict: 'Good.', strengths: ['s'], issues: ['i'] } }));
  for (const f of ['step3-b.jpg', 'step2-a.jpg', 'notes.txt']) writeFileSync(join(t, 'screenshots', f), '');
  const [x] = loadTrials(root);
  assert.deepEqual([x.round, x.brownfield, x.notes, x.screenshots], [2, 85.21, { verdict: 'Good.', strengths: ['s'], issues: ['i'] }, ['step2-a.jpg', 'step3-b.jpg']]);
});

test('arms of a run: median over rounds of the final, brownfield or review score, shared ranks, fewer minutes first, review ranked per runtime', () => {
  const t = (arm, round, s, minutes = 10) => ({ arm, round, setup: arm, runtime: 'Claude Code', minutes, ...s });
  const bf = rankArms([t('A', 1, { brownfield: 90 }), t('A', 2, { brownfield: 80 }), t('A', 3, { brownfield: 85 }),
    t('V', 2, { brownfield: 85 }, 5), t('V', 1, { brownfield: 40 }, 5), t('V', 3, { brownfield: 86 }, 5), t('B', 1, { brownfield: null })]);
  assert.equal(bf.kind, 'brownfield');
  const [g] = bf.groups;
  assert.deepEqual([bf.groups.length, g.runtime], [1, null]);
  assert.deepEqual(g.rows.map((r) => `${r.arm} ${r.rank} ${r.score}`), ['V 1 85', 'A 1 85', 'B 3 null']);
  assert.deepEqual(g.rows[0].rounds.map((r) => r.round), [1, 2, 3]);
  assert.equal(rankArms([t('A', 1, { final: { total: 70 }, overall: 9 }), t('B', 1, { final: { total: 80 }, overall: 7 })]).groups[0].rows[0].arm, 'B');
  // review as the score: runtimes ranked apart
  const rv = rankArms([t('A', 1, { overall: 7 }), t('B', 1, { overall: 8 }), { ...t('Q', 1, { overall: 9 }), runtime: 'OpenCode' }]);
  assert.deepEqual([rv.kind, rv.groups.map((x) => `${x.runtime}: ${x.rows.map((r) => r.arm + r.rank).join(' ')}`)], ['review', ['Claude Code: B1 A2', 'OpenCode: Q1']]);
});

test('runs: newest first, report file, runtimes apart, ranked with shared ranks and missing values last', () => {
  const t = (run, arm, runtime, overall, features, robustness, minutes, criteria = 13) => ({
    run, brief: 'b1', model: 'Sonnet 5.5', effort: 'high', k: '1', runtime, arm, overall, features, robustness, minutes, protocol: null, criteria,
    featuresOf: features ? 6 : null, robustnessOf: robustness ? 12 : null,
  });
  const [b, a, ...rest] = summarizeRuns([
    t('2026-10-15-b1-haiku', 'A', 'Claude Code', 8, 6, 12, 5),
    t('2026-10-16-b1-sonnet', 'A', 'Claude Code', 8, 6, 12, 9), t('2026-10-16-b1-sonnet', 'B', 'Claude Code', 9, 6, 12, 20),
    t('2026-10-16-b1-sonnet', 'C', 'Claude Code', 8, 6, 12, 4), t('2026-10-16-b1-sonnet', 'D', 'Claude Code', null, 0, null, 3),
    t('2026-10-16-b1-sonnet', 'Q', 'OpenCode', 7, 6, 12, 30, 9),
  ], ['2026-10-14-b1.md', '2026-10-15-b1.md', '2026-10-16-other.md']);
  assert.equal(rest.length, 0);
  assert.equal(a.run, '2026-10-15-b1-haiku');
  assert.deepEqual({ ...b, groups: undefined }, {
    run: '2026-10-16-b1-sonnet', brief: 'b1', model: 'Sonnet 5.5', effort: 'high', k: '1', date: '2026-10-16', report: '2026-10-15-b1.md', featuresOf: 6, robustnessOf: 12, protocols: [], groups: undefined,
  });
  const [cc, oc] = b.groups;
  assert.deepEqual([cc.runtime, oc.runtime, cc.criteria, oc.criteria], ['Claude Code', 'OpenCode', [13], [9]]);
  assert.deepEqual(cc.rows.map((r) => `${r.arm}${r.rank}`), ['B1', 'C2', 'A2', 'D4']);
  assert.equal(summarizeRuns([t('2026-10-16-b1-sonnet', 'A', 'Claude Code', 8, 6, 12, 1)], ['2026-10-16-b1-sonnet.md', '2026-10-15-b1.md'])[0].report, '2026-10-16-b1-sonnet.md');
  // A brief whose name ends another brief's name does not take that report.
  assert.equal(summarizeRuns([t('2026-10-16-b1-sonnet', 'A', 'Claude Code', 8, 6, 12, 1)], ['2026-10-15-xb1.md'])[0].report, null);
});

test('top 10 per brief across models: final score, then fewer minutes; plain Claude Code of each model with its place as baseline', () => {
  const t = (model, arm, total, minutes, brief = 'b') => ({ run: `r-${model}`, brief, model, runtime: 'Claude Code', arm, minutes, final: total == null ? null : { total, categories: {} } });
  const ts = [t('Haiku', 'A', 90, 5), t('Sonnet', 'A', 40, 5), t('Sonnet', 'B', 80, 9), t('Sonnet', 'C', 80, 4), t('Haiku', 'N', null, 1), t('Sonnet', 'A', 99, 1, 'other')];
  for (let i = 0; i < 9; i++) ts.push(t('Sonnet', `X${i}`, 70 - i, 10));
  const [b, other, ...rest] = topByBrief(ts);
  assert.equal(rest.length, 0);
  assert.equal(b.of, 13);
  assert.deepEqual(b.top.map((x) => `${x.model} ${x.arm}`), ['Haiku A', 'Sonnet C', 'Sonnet B', ...[0, 1, 2, 3, 4, 5, 6].map((i) => `Sonnet X${i}`)]);
  assert.deepEqual(b.baselines.map((x) => `${x.model} ${x.arm} ${x.place}`), ['Sonnet A 13']);
  assert.deepEqual([other.top.length, other.baselines.length], [1, 0]);
});
