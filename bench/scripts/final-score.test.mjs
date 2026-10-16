import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractors, normalize, score } from './final-score.mjs';

const weights = JSON.parse(readFileSync(new URL('final-score.weights.json', import.meta.url), 'utf8'));
const inputs = Object.values(weights.categories).flatMap((c) => Object.entries(c.inputs));

test('weights: categories sum to their weight, the total to 100, every input has an extractor', () => {
  for (const c of Object.values(weights.categories)) assert.equal(Object.values(c.inputs).reduce((a, i) => a + i.weight, 0), c.weight);
  assert.equal(Object.values(weights.categories).reduce((a, c) => a + c.weight, 0), 100);
  assert.deepEqual(Object.keys(weights.categories).map((c) => weights.categories[c].weight), [35, 20, 15, 10, 10, 10]);
  for (const [id, cfg] of inputs) {
    assert.equal(typeof extractors[id], 'function', id);
    assert.ok(cfg.normalize in weights.normalize, id);
    assert.ok(['lower', 'upto'].includes(cfg.normalize) === (cfg.cap !== undefined), `${id} cap`);
  }
});

test('normalize', () => {
  assert.equal(normalize('likert', 1), 0);
  assert.equal(normalize('likert', 3), 50);
  assert.equal(normalize('unit', 0.99), 99);
  assert.equal(normalize('lower', 0, 10), 100);
  assert.equal(normalize('lower', 5, 10), 50);
  assert.equal(normalize('lower', 30, 10), 0);
  assert.equal(normalize('upto', 30, 20), 100);
});

const best = {
  trial: { score: { features: { C1: true, C2: true }, code: { erosion: 0, duplication: 0 }, axe: { list: 0, d: 0 }, lighthouse: { accessibility: 1, performance: 1 } },
    maintenance: { readme: true, readme_setup: true, test_script: true, lint_or_typecheck: true, ci: true, changelog: true, docs: true } },
  review: { review: { scores: Object.fromEntries(['requirements', 'correctness', 'security', 'code_quality', 'tests', 'ux_design', 'accessibility', 'simplicity', 'maintainability', 'visual_design', 'layout', 'usability', 'reception'].map((k) => [k, 5])) } },
  scan: { totals: { lines: 1000 }, lint: { per_1000_lines: 0 }, sonar_bugs: { per_1000_lines: 0 }, security: { rules: { 'security/detect-object-injection': 50 } } },
  types: { per_1000_lines: 0 }, coverage: { line: 100 }, print: { pass: 25, total: 25 }, html: { errors: 0 },
  docs: { readme: { coverage: { a: true, b: true }, accuracy: { share: 100 } }, code: { documented_share: 100, exported_share: null, comments_per_100_code_lines: 25 }, decisions: { count: 3 } },
};

test('score: a perfect trial gets 100, an empty one 0 with every input listed as missing', () => {
  const s = score(best, weights);
  assert.equal(s.total, 100);
  assert.deepEqual(s.missing, []);
  assert.deepEqual(Object.values(s.categories).map((c) => c.score), [35, 20, 15, 10, 10, 10]);
  const e = score({}, weights);
  assert.equal(e.total, 0);
  assert.equal(e.missing.length, inputs.length);
});

test('score: no unit suite scores 0 with a reason, not missing; excluded security rules do not count', () => {
  const s = score({ ...best, coverage: { line: null, reason: 'no unit test command' },
    scan: { ...best.scan, security: { rules: { 'security/detect-object-injection': 50, 'security/detect-eval-with-expression': 5 } } } }, weights);
  assert.equal(s.inputs.line_coverage.points, 0);
  assert.equal(s.zero_reasons.line_coverage, 'no unit test command');
  assert.deepEqual(s.missing, []);
  assert.equal(s.inputs.security_findings.raw, 5);
  assert.equal(s.inputs.security_findings.normalized, 0);
});

test('score: no hidden test result is a missing input', () => {
  const s = score({ ...best, trial: { ...best.trial, score: { ...best.trial.score, features: {}, axe: null } } }, weights);
  assert.deepEqual(s.missing, ['hidden_features', 'axe_violations']);
});
