import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audit, outcome, workflow } from './trial.mjs';

// Fixtures: init and SessionStart events recorded from the five arm images (hook output reduced to its markers).
const fixture = (arm) => readFileSync(new URL(`fixtures/init-${arm}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const ARMS = ['A', 'B', 'C', 'D', 'E'];

test('each arm passes its own delivery audit and fails every other arm\'s', () => {
  for (const real of ARMS) {
    for (const claimed of ARMS) {
      const r = audit(fixture(real), claimed);
      assert.equal(r.ok, real === claimed, `${real} audited as ${claimed}: ${r.problems.join('; ')}`);
    }
  }
});

const use = (name, input, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', name, input }] } });

test('workflow trace: skills, agents, plan files, tests first, review', () => {
  const w = workflow([
    use('Skill', { skill: 'superpowers:brainstorming' }),
    use('Write', { file_path: '/work/docs/plan.md' }),
    use('Write', { file_path: '/work/playwright.config.mjs' }),
    use('Write', { file_path: '/work/test/app.test.mjs' }),
    use('Write', { file_path: '/work/server.mjs' }, 'toolu_1'),
    use('Agent', { subagent_type: 'code-reviewer' }),
  ]);
  assert.deepEqual(w.skills, ['superpowers:brainstorming']);
  assert.deepEqual(w.agents, ['code-reviewer']);
  assert.deepEqual(w.plan_or_spec_files, ['/work/docs/plan.md']);
  assert.equal(w.tests_first, true);
  assert.equal(w.review, true);
  assert.equal(w.subagent_tool_calls, 1);
  assert.equal(workflow([use('Write', { file_path: '/work/server.mjs' }), use('Write', { file_path: '/work/server.test.mjs' })]).tests_first, false);
});

test('outcome flags usage-limit stops as infrastructure errors and trailing questions', () => {
  assert.equal(outcome([{ type: 'result', is_error: true, result: 'Claude usage limit reached' }]).infra_error, true);
  assert.equal(outcome([{ type: 'result', is_error: false, result: 'Which database do you want?' }]).ends_with_question, true);
  assert.equal(outcome([]).finished, false);
});

test('summary table counts invalid trials and takes medians over valid ones', async () => {
  const { table } = await import('./summary.mjs');
  const t = (ok, f) => ({ arm: 'B', audit: { ok }, outcome: { duration_ms: 60000, cost_usd_api_equivalent: 1 }, workflow: {}, score: { features_passed: f }, lines: {} });
  assert.match(table([t(true, 6), t(true, 4), t(false, 0)]), /\| B \| 3 \| 1 \| 5 \(4 to 6\) \|/);
});
