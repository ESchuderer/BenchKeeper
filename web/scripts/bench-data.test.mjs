import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arm, loadTrials, summarizeBriefs } from './bench-data.mjs';

test('arm descriptors: setup label, framework, spec tool, BenchKeeper layer with Ponytail', () => {
  assert.deepEqual(arm('A'), { framework: 'none', spec: 'none', bk: false, ponytail: false, setup: 'plain' });
  assert.equal(arm('O').setup, 'Ponytail + OpenSpec');
  assert.deepEqual(arm('E'), { framework: 'ECC', spec: 'OpenSpec', bk: true, ponytail: true, setup: 'BK + ECC + OpenSpec' });
  assert.equal(arm('S').setup, 'OpenSpec + Superpowers (oso)');
  assert.throws(() => arm('ZZ'));
});

test('trials: one per arm directory, model from the manifest, review scores, no cost, no em dash', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-'));
  const t = join(root, 'run-1', 'round-1', 'B');
  mkdirSync(join(t, 'screenshots'), { recursive: true });
  writeFileSync(join(root, 'run-1', 'manifest.txt'), 'brief=winery-react model=claude-sonnet-5-5 effort=high k=1 seed=41\nimage B x\n');
  writeFileSync(join(t, 'trial.json'), JSON.stringify({
    arm: 'B', runtime: 'claude-code', followups: 1, wall_seconds: 610, outcome: { cost_usd_api_equivalent: 1.23 },
    score: { features_passed: 6, robustness_passed: 12 }, workflow: { tests_first: true, review: false },
  }));
  writeFileSync(join(t, 'review.json'), JSON.stringify({ cost_usd_api_equivalent: 0.4, review: {
    overall: 8, scores: { requirements: 5, tests: { score: 4 } }, verdict: 'Ships \u2014 mostly.', strengths: ['a'], issues: [],
  } }));
  writeFileSync(join(t, 'screenshots', 'start.jpg'), '');
  mkdirSync(join(root, 'run-1', 'round-1', 'C'));
  const [x, ...rest] = loadTrials(root);
  assert.equal(rest.length, 0);
  assert.equal(x.model, 'Sonnet 5.5');
  assert.equal(x.brief, 'winery-react');
  assert.equal(x.minutes, 10);
  assert.deepEqual(x.scores, { requirements: 5, tests: 4 });
  assert.equal(x.verdict, 'Ships, mostly.');
  assert.deepEqual(x.screenshots, [{ page: 'start', file: 'run-1/round-1/B/screenshots/start.jpg' }]);
  assert.doesNotMatch(JSON.stringify(x), /cost|1\.23|0\.4/);
});

test('briefs: one entry per brief with trials, first paragraph, counts, dates, report', () => {
  const root = mkdtempSync(join(tmpdir(), 'briefs-'));
  mkdirSync(join(root, 'briefs', 'b1'), { recursive: true });
  writeFileSync(join(root, 'briefs', 'b1', 'brief.md'), 'Build a small app \u2014 quickly.\nSecond line.\n\nDetails.\n');
  mkdirSync(join(root, 'results'));
  writeFileSync(join(root, 'results', '2026-10-15-b1.md'), '# report');
  const t = (arm, model, run) => ({ brief: 'b1', arm, model, runtime: 'Claude Code', run });
  const [b, ...rest] = summarizeBriefs([t('A', 'Haiku 5.5', '2026-10-15-b1-haiku'), t('A', 'Sonnet 5.5', '2026-10-16-b1-sonnet'), t('B', 'Sonnet 5.5', '2026-10-16-b1-sonnet')], join(root, 'briefs'), join(root, 'results'));
  assert.equal(rest.length, 0);
  assert.deepEqual(b, { id: 'b1', summary: 'Build a small app, quickly.\nSecond line.', trials: 3, arms: 2, runtimes: ['Claude Code'], models: ['Haiku 5.5', 'Sonnet 5.5'], dates: ['2026-10-15', '2026-10-16'], reports: ['2026-10-15-b1.md'] });
});
