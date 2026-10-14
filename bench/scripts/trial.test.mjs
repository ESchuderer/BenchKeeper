import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audit, outcome, workflow } from './trial.mjs';

// Fixtures: init and SessionStart events recorded from the arm images (hook output reduced to its markers).
const fixture = (arm) => readFileSync(new URL(`fixtures/init-${arm}.jsonl`, import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
import { ARMS as ARM_TABLE } from './trial.mjs';
const ARMS = Object.keys(ARM_TABLE);

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

test('outcome counts main-thread messages once and takes tokens from the cumulative model usage', () => {
  const mu = { 'claude-haiku-5-5': { inputTokens: 30, outputTokens: 500, cacheReadInputTokens: 7, cacheCreationInputTokens: 9, thinkingTokens: 100 } };
  const msg = (id, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { id, content: [] } });
  const o = outcome([msg('m1'), msg('m1'), msg('m2'), msg('s1', 'toolu_1'), { type: 'result', num_turns: 9, usage: { output_tokens: 300 } },
    { type: 'result', num_turns: 7, total_cost_usd: 0.05, usage: { output_tokens: 50 }, modelUsage: mu }]);
  assert.equal(o.turns, 2);
  assert.equal(o.result_events, 2);
  assert.deepEqual(o.usage, { input: 30, cache_creation: 9, cache_read: 7, output: 500, thinking: 100 });
});

test('outcome takes cumulative cost and usage from the last result per session', () => {
  const res = (s, cost, out) => ({ type: 'result', session_id: s, num_turns: 3, total_cost_usd: cost, modelUsage: { m: { outputTokens: out } } });
  const init = { type: 'system', subtype: 'init' };
  // A follow-up turn continues session s1, so its result already includes the first turn.
  const o = outcome([init, res('s1', 0.02, 20), init, res('s1', 0.05, 27), init, res('s2', 0.01, 5)]);
  assert.equal(o.sessions, 2);
  assert.ok(Math.abs(o.cost_usd_api_equivalent - 0.06) < 1e-9);
  assert.equal(o.usage.output, 32);
});

test('audit checks every agent process', () => {
  const events = fixture('B');
  const init = events.find((e) => e.subtype === 'init');
  assert.equal(audit(events, 'B').ok, true);
  assert.equal(audit([...events, { ...init, plugins: [] }], 'B').ok, false);
  // A follow-up resumes the session: its init needs no new SessionStart output.
  assert.equal(audit([...events, init], 'B').ok, true);
});

test('outcome flags usage-limit stops as infrastructure errors and trailing questions', () => {
  assert.equal(outcome([{ type: 'result', is_error: true, result: 'Claude usage limit reached' }]).infra_error, true);
  assert.equal(outcome([{ type: 'result', is_error: true, result: "You've hit your session limit · resets 10pm (UTC)" }]).infra_error, true);
  assert.equal(outcome([{ type: 'result', is_error: false, result: 'Which database do you want?' }]).ends_with_question, true);
  assert.equal(outcome([]).finished, false);
});

test('summary table counts invalid trials and takes medians over valid ones', async () => {
  const { table } = await import('./summary.mjs');
  const t = (ok, f) => ({ arm: 'B', audit: { ok }, outcome: { duration_ms: 60000, cost_usd_api_equivalent: 1 }, workflow: {}, score: { features_passed: f }, lines: {} });
  assert.match(table([t(true, 6), t(true, 4), t(false, 0)]), /\| B \| 3 \| 1 \| 5 \(4 to 6\) \|/);
});

test('score counts a skipped feature as failed and needs all four axe pages', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { score } = await import('./trial.mjs');
  const dir = mkdtempSync('/tmp/score-');
  const spec = (title, status) => ({ title, ok: true, tests: [{ results: [{ status }] }] });
  writeFileSync(`${dir}/acceptance.json`, JSON.stringify({ suites: [{ specs: [spec('F1 a', 'passed'), spec('F2 b', 'failed'), spec('F3 c', 'skipped')] }] }));
  writeFileSync(`${dir}/axe.json`, JSON.stringify({ start: [], form: [] }));
  const s = score(dir);
  assert.equal(s.features_passed, 1);
  assert.deepEqual(s.features, { F1: true, F2: false, F3: false });
  assert.equal(s.axe, null);
  assert.equal(s.lighthouse, null);
});

test('audit and summary tolerate missing fields', async () => {
  const { table } = await import('./summary.mjs');
  assert.equal(audit([{ type: 'system', subtype: 'init' }], 'A').ok, true);
  const t = { arm: 'A', audit: { ok: true }, outcome: {}, workflow: {}, score: { lighthouse: null, axe: null }, lines: {} };
  assert.match(table([t]), /\| A \| 1 \| 0 \| n\/a \| n\/a \| n\/a \|/);
});

test('each OpenCode arm passes its own audit and fails every other OpenCode arm\'s', async () => {
  const { OPENCODE_ARMS, ocAudit } = await import('./opencode.mjs');
  for (const real of OPENCODE_ARMS) {
    for (const claimed of OPENCODE_ARMS) {
      const r = ocAudit(new URL(`fixtures/opencode-${real}`, import.meta.url).pathname, claimed);
      assert.equal(r.ok, real === claimed, `${real} audited as ${claimed}: ${r.problems.join('; ')}`);
    }
  }
});

test('OpenCode outcome sums every session and maps tool uses', async () => {
  const { ocOutcome, ocUses } = await import('./opencode.mjs');
  const msg = (role, cost, out, parts = []) => ({ info: { role, cost, tokens: { input: 1, output: out, reasoning: 0, cache: { read: 10, write: 2 } } }, parts });
  const all = [
    { info: { id: 's1' }, messages: [msg('user', 0, 0), msg('assistant', 0.02, 5, [{ type: 'tool', tool: 'skill', state: { input: { name: 'brainstorming' } } }])] },
    { info: { id: 's2', parentID: 's1' }, messages: [msg('assistant', 0.01, 3, [{ type: 'tool', tool: 'write', state: { input: { filePath: '/work/a.test.js' } } }])] },
  ];
  const o = ocOutcome([{ type: 'step_finish', part: {} }, { type: 'text', part: { text: 'Done.' } }], all);
  assert.ok(Math.abs(o.cost_usd_api_equivalent - 0.03) < 1e-9);
  assert.deepEqual(o.usage, { input: 2, cache_creation: 4, cache_read: 20, output: 8, thinking: 0 });
  assert.equal(o.turns, 1);
  const uses = ocUses([], all);
  assert.deepEqual(uses.map((u) => [u.name, u.input.skill || u.input.file_path, u.sub]), [['Skill', 'brainstorming', false], ['Write', '/work/a.test.js', true]]);
});
