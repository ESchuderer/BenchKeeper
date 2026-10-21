import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('score commands retain excluded trial reasons outside ranked scores', () => {
  const run = mkdtempSync('/tmp/score-validity-');
  try {
    writeFileSync(`${run}/manifest.txt`, 'brief=openballistics model=claude-sonnet-5-5\n');
    const cases = { A: { audit: { ok: true } }, B: { audit: { ok: false } }, C: { audit: { ok: true }, steps: [{ k: 1, scoring_error: 'evaluator failed' }] } };
    for (const [arm, trial] of Object.entries(cases)) {
      mkdirSync(`${run}/round-1/${arm}`, { recursive: true });
      writeFileSync(`${run}/round-1/${arm}/trial.json`, JSON.stringify(trial));
    }
    for (const script of ['brownfield-score', 'final-score']) {
      const output = `${run}/${script}.json`;
      const args = script === 'final-score' ? ['--out', output, run] : [run];
      const r = spawnSync(process.execPath, [new URL(`${script}.mjs`, import.meta.url).pathname, ...args], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const result = JSON.parse(readFileSync(output, 'utf8'));
      assert.deepEqual(result.trials.map((t) => t.arm), ['A']);
      assert.deepEqual(result.excluded.map((t) => t.arm), ['B', 'C']);
      assert.ok(result.excluded.every((t) => t.problems.length));
    }
  } finally { rmSync(run, { recursive: true, force: true }); }
});
