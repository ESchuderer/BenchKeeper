import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const report = (value, k = 1) => {
  const r = spawnSync('jq', ['--argjson', 'k', String(k), '-f', new URL('report.jq', import.meta.url).pathname], { input: JSON.stringify(value), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const evaluated = (passed = 2) => ({ evaluation_exit: 0, eval: { infrastructure_failure: false, pytest_exit_code: passed === 2 ? 0 : 1, pass_counts: { Core: passed }, total_counts: { Core: 2 } } });

test('completed evaluations preserve passes, solution failures and absent groups', () => {
  assert.deepEqual(report(evaluated()), { infrastructure_error: null, checks: [{ id: 'C1-core', ok: true }, { id: 'C1-functionality', ok: null }, { id: 'C1-error', ok: null }] });
  assert.equal(report(evaluated(0)).checks[0].ok, false);
  assert.equal(report(evaluated(), 6).checks.at(-1).ok, null);
});

test('infrastructure failures and malformed counts cannot become scores', () => {
  for (const value of [
    {}, { evaluation_exit: 125, eval: null },
    { ...evaluated(), eval: { ...evaluated().eval, infrastructure_failure: true } },
    { ...evaluated(), eval: { ...evaluated().eval, pytest_exit_code: 3 } },
    { ...evaluated(), eval: { ...evaluated().eval, total_counts: {} } },
    { ...evaluated(), eval: { ...evaluated().eval, total_counts: { Core: -1 } } },
    { ...evaluated(), eval: { ...evaluated().eval, total_counts: { Core: "2" } } },
    { ...evaluated(), eval: { ...evaluated().eval, pass_counts: { Core: "2" } } },
    { ...evaluated(), eval: { ...evaluated().eval, total_counts: { Unknown: 2 }, pass_counts: { Unknown: 2 } } },
    evaluated(3),
  ]) {
    const r = report(value);
    assert.ok(r.infrastructure_error);
    assert.ok(r.checks.every((c) => c.ok === null));
  }
});
