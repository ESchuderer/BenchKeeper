import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arm, loadTrials, summarizeRuns } from './bench-data.mjs';

test('arm descriptors: setup label, framework, spec tool, BenchKeeper layer with Ponytail', () => {
  assert.deepEqual(arm('A'), { framework: 'none', spec: 'none', bk: false, ponytail: false, setup: 'plain' });
  assert.equal(arm('O').setup, 'Ponytail + OpenSpec');
  assert.deepEqual(arm('E'), { framework: 'ECC', spec: 'OpenSpec', bk: true, ponytail: true, setup: 'BK + ECC + OpenSpec' });
  assert.equal(arm('S').setup, 'OpenSpec + Superpowers (oso)');
  assert.throws(() => arm('ZZ'));
});

test('trials: one per arm directory, model, effort and k from the manifest, review overall and criteria, no cost', () => {
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
    key: 'run-1/round-1/B', run: 'run-1', brief: 'winery-react', model: 'Sonnet 5.5', effort: 'high', k: '1', runtime: 'Claude Code', arm: 'B',
    setup: 'Ponytail', features: 1, robustness: null, featuresOf: 2, robustnessOf: null, minutes: 10, overall: 8, protocol: '1.10', criteria: 2,
  });
  assert.doesNotMatch(JSON.stringify(x), /cost|1\.23|0\.4/);
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
