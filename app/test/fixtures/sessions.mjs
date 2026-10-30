// Small Claude Code and Codex transcripts in a fixture home, shaped like the real ones (only the fields the scan reads).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const jsonl = (file, lines) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`); };
let work = '/work';
// The fixture dates are written as if now were REF; `now` moves them all by the same offset.
const REF = Date.parse('2026-10-24T00:00:00.000Z');
let shift = 0;
const stamp = (t) => (shift ? new Date(Date.parse(t) + shift).toISOString() : t);
const common = (t, cwd = `${work}/shop`) => ({ cwd, gitBranch: 'feat/cart', version: '2.1.300', sessionId: 's1', timestamp: stamp(t) });
const USAGE = { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 5 };
const assistant = (t, id, content, usage = USAGE) => ({ ...common(t), type: 'assistant', message: { id, model: 'claude-sonnet-5-5', content, usage } });
const human = (t, content, extra = {}) => ({ ...common(t), type: 'user', origin: { kind: 'human' }, message: { role: 'user', content }, ...extra });
const result = (t, id, text, isError) => ({ ...common(t), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } });

export const TITLE = 'Cart </script><img src=x onerror=alert(1)> fix';

// `root` holds the projects shop and blog; `title` names the first Claude Code session; `now` (ms) dates the sessions
// relative to it, the default keeps the fixed dates.
export function writeSessions(home, { root = '/work', title = TITLE, now = REF } = {}) {
  work = root;
  shift = now - REF;
  const dir = join(home, '.claude/projects', `${root}/shop`.replaceAll('/', '-'));
  jsonl(join(dir, 's1.jsonl'), [
    { type: 'mode', mode: 'normal', sessionId: 's1' },
    human('2026-10-20T10:00:00.000Z', 'fix the cart total'),
    { ...common('2026-10-20T10:00:01.000Z'), type: 'attachment', attachment: { type: 'skill_listing', names: ['old-skill'] } },
    { ...common('2026-10-20T10:00:02.000Z'), type: 'attachment', attachment: { type: 'skill_listing', names: ['mattpocock-skills:tdd', 'ponytail:ponytail', 'benchkeeper:workflow', 'frontend-design', 'designing-technical-uis', 'accessibility'] } },
    assistant('2026-10-20T10:00:03.000Z', 'm1', [{ type: 'text', text: 'Reading the code.\nTier: standard (bug, known cause)\nNext the test.' }, { type: 'tool_use', id: 'k1', name: 'Skill', input: { skill: 'mattpocock-skills:tdd' } }]),
    // One message streams as several lines with the same usage: counted once.
    assistant('2026-10-20T10:00:04.000Z', 'm1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cd app && npm test' } }]),
    result('2026-10-20T10:00:05.000Z', 't1', 'Exit code 1\nnot ok 1', true),
    human('2026-10-20T10:01:00.000Z', '<command-name>/ponytail:ponytail-review</command-name>', { isMeta: true }),
    { ...common('2026-10-20T10:01:01.000Z'), type: 'attachment', attachment: { type: 'queued_command', prompt: 'it touches checkout too', origin: { kind: 'human' }, humanTurn: true } },
    assistant('2026-10-20T10:02:00.000Z', 'm2', [{ type: 'text', text: 'Tier: full (feature)' }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npx playwright test' } }]),
    result('2026-10-20T10:02:30.000Z', 't2', '3 passed', false),
    { ...assistant('2026-10-20T10:03:00.000Z', 'm3', [{ type: 'text', text: 'Done.' }]), attributionSkill: 'designing-technical-uis' },
    { type: 'ai-title', aiTitle: 'Cart work', sessionId: 's1' },
    { type: 'ai-title', aiTitle: title, sessionId: 's1' },
    { type: 'pr-link', prUrl: 'https://github.com/acme/shop/pull/7', sessionId: 's1' },
    { type: 'pr-link', prUrl: 'https://github.com/acme/shop/pull/7', sessionId: 's1' },
    { type: 'cost-state', totalCostUSD: 0.5, totalAPIDuration: 1000, totalToolDuration: 500, modelUsage: {} },
    { type: 'cost-state', totalCostUSD: 1.25, totalAPIDuration: 60000, totalToolDuration: 30000, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 10 } } },
  ]);
  jsonl(join(dir, 's1/subagents/agent-a1.jsonl'), [
    assistant('2026-10-20T10:00:30.000Z', 'a1', [{ type: 'tool_use', id: 'k2', name: 'Skill', input: { skill: 'mattpocock-skills:diagnosing-bugs' } }]),
  ]);
  // A running session: no cost-state yet, tokens from the usage of each message once.
  jsonl(join(home, '.claude/projects', `${root}/blog`.replaceAll('/', '-'), 's2.jsonl'), [
    { ...human('2026-10-21T09:00:00.000Z', 'typo in the README'), cwd: `${root}/blog`, sessionId: 's2' },
    // A tier set with /benchkeeper:tier carries no change type; the next line names it.
    { ...assistant('2026-10-21T09:00:04.000Z', 'n1', [{ type: 'text', text: 'Tier: quick (override)' }]), cwd: `${root}/blog`, sessionId: 's2' },
    { ...assistant('2026-10-21T09:00:05.000Z', 'n1', [{ type: 'text', text: 'Tier: quick (docs, typo)' }]), cwd: `${root}/blog`, sessionId: 's2' },
    { ...assistant('2026-10-21T09:00:06.000Z', 'n1', [{ type: 'text', text: 'Fixed.' }]), cwd: `${root}/blog`, sessionId: 's2' },
  ]);
  const codex = join(home, '.codex/sessions/2026/10/21');
  const ev = (t, type, payload) => ({ timestamp: stamp(t), type, payload });
  const cmd = (t, command, code) => ev(t, 'event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['/usr/bin/bash', '-lc', command], exit_code: String(code) } });
  jsonl(join(codex, 'rollout-2026-10-21T11-00-00-c1.jsonl'), [
    ev('2026-10-21T11:00:00.000Z', 'session_meta', { id: 'c1', timestamp: stamp('2026-10-21T11:00:00.000Z'), cwd: `${root}/shop`, cli_version: '0.162.1', source: 'cli', git: { branch: 'main' } }),
    ev('2026-10-21T11:00:00.100Z', 'response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<skills_instructions>\n## Skills\n### Available skills\n- ponytail:ponytail: Lazy mode. (file: r6/ponytail/SKILL.md)\n- tdd: Test first. (file: r0/tdd/SKILL.md)\n### How to use skills\n- not-a-skill: text\n</skills_instructions>' }] }),
    ev('2026-10-21T11:00:00.200Z', 'turn_context', { model: 'gpt-6-astra' }),
    ev('2026-10-21T11:00:00.300Z', 'event_msg', { type: 'task_started', turn_attribution: { turn_trigger: 'user' } }),
    ev('2026-10-21T11:00:01.000Z', 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tier: quick. Looking at it.' }] }),
    cmd('2026-10-21T11:00:02.000Z', 'sed -n 1,80p /home/u/.agents/skills/tdd/SKILL.md', 0),
    cmd('2026-10-21T11:00:03.000Z', 'npm test', 1),
    // A test run inside a quoted shell argument.
    cmd('2026-10-21T11:00:03.200Z', "devcontainer exec --workspace-folder . sh -lc 'cd app && npm test'", 0),
    // No exit code recorded: the last known result stays.
    ev('2026-10-21T11:00:03.500Z', 'event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['/usr/bin/bash', '-lc', 'npm test'] } }),
    ev('2026-10-21T11:00:04.000Z', 'event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 500 } } }),
    ev('2026-10-21T11:00:05.000Z', 'compacted', { replacement_history: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tier: research' }] }] }),
    ev('2026-10-21T11:00:06.000Z', 'event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 1000 } } }),
    ev('2026-10-21T11:00:07.000Z', 'event_msg', { type: 'task_complete', duration_ms: 7000 }),
  ]);
  jsonl(join(codex, 'rollout-2026-10-21T11-00-03-c2.jsonl'), [
    ev('2026-10-21T11:00:03.000Z', 'session_meta', { id: 'c2', parent_thread_id: 'c1', cwd: `${root}/shop`, source: { subagent: { other: 'review' } } }),
    // A skill in a nested folder.
    cmd('2026-10-21T11:00:03.500Z', 'cat /x/skills/engineering/diagnosing-bugs/SKILL.md', 0),
    ev('2026-10-21T11:00:04.000Z', 'event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 200 } } }),
  ]);
  // A subagent of the subagent: it counts toward the root session too.
  jsonl(join(codex, 'rollout-2026-10-21T11-00-04-c3.jsonl'), [
    ev('2026-10-21T11:00:04.000Z', 'session_meta', { id: 'c3', parent_thread_id: 'c2', cwd: `${root}/shop`, source: { subagent: { other: 'review' } } }),
    cmd('2026-10-21T11:00:04.500Z', 'cat /x/skills/grilling/SKILL.md', 0),
    ev('2026-10-21T11:00:05.000Z', 'event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 100 } } }),
  ]);
  shift = 0;
}

const LINE = 'You are working inside Orca, a multi-agent IDE. You are a dispatched worker.';
const PREAMBLE = `${LINE}\nYour coordinator's terminal handle is: term_1\nYour task ID is: task_1`;
const wakeup = (t, id) => assistant(t, id, [{ type: 'tool_use', id: `w${id}`, name: 'ScheduleWakeup', input: { delaySeconds: 1200, prompt: 'check', reason: 'wait' } }]);
// Sessions of each pattern in the project `app`, kept apart from writeSessions so the counts of the other tests stay.
// One short Claude Code session in each folder; `now` as in writeSessions.
export function writeTreeSessions(home, dirs, { now = REF } = {}) {
  shift = now - REF;
  for (const [i, cwd] of dirs.entries()) {
    const at = (l) => ({ ...l, cwd, sessionId: `w${i}` });
    jsonl(join(home, '.claude/projects', cwd.replaceAll('/', '-'), `w${i}.jsonl`), [
      at(human(`2026-10-22T0${i}:00:00.000Z`, 'rename a variable')),
      at(assistant(`2026-10-22T0${i}:00:05.000Z`, `w${i}`, [{ type: 'text', text: 'Renamed.' }])),
    ]);
  }
  shift = 0;
}

export function writePatternSessions(home, { root = '/work' } = {}) {
  work = root;
  const dir = join(home, '.claude/projects', `${root}/app`.replaceAll('/', '-'));
  const at = (id, lines) => jsonl(join(dir, `${id}.jsonl`), lines.map((l) => ({ ...l, cwd: `${root}/app`, sessionId: id })));
  at('p1', [human('2026-10-22T09:00:00.000Z', 'keep going until green'), wakeup('2026-10-22T09:00:01.000Z', 'x1')]);
  at('p2', [human('2026-10-22T10:00:00.000Z', 'x', { isMeta: true }), human('2026-10-22T10:00:01.000Z', '<command-name>/goal</command-name>', { isMeta: true }), human('2026-10-22T10:00:02.000Z', 'the tests pass')]);
  // A worker that also loops: the worker wins, the run line names the run.
  at('p3', [human('2026-10-22T11:00:00.000Z', `${PREAMBLE}\n\n=== TASK ===\nTarget: x\nOrca run: r-1.a\n`), wakeup('2026-10-22T11:00:01.000Z', 'x3')]);
  // The user's own words can come first.
  at('p4', [human('2026-10-22T12:00:00.000Z', [{ type: 'text', text: `Please carry out this task:\n\n${PREAMBLE}` }])]);
  // The text quoted later, in a prompt and in a tool result, or one line of it in the first prompt, marks no worker.
  at('p7', [human('2026-10-22T15:00:00.000Z', `Explain this example:\n${LINE}`)]);
  at('p5', [
    human('2026-10-22T13:00:00.000Z', 'what does a worker prompt look like?'),
    human('2026-10-22T13:00:01.000Z', `${PREAMBLE}\nOrca run: r-2`),
    result('2026-10-22T13:00:02.000Z', 'q1', `${PREAMBLE}\nOrca run: r-3`, false),
  ]);
  // Two subagents and a loop: the loop wins over the group; the count stays.
  at('p6', [human('2026-10-22T14:00:00.000Z', '<command-name>/loop</command-name>', { isMeta: true }), human('2026-10-22T14:00:01.000Z', 'x')]);
  for (const n of [1, 2]) jsonl(join(dir, `p6/subagents/agent-${n}.jsonl`), [assistant('2026-10-22T14:00:30.000Z', `a${n}`, [{ type: 'text', text: 'x' }])]);
}

// Three dispatched workers of run r-9 in `dir`: tasks task_a (two sessions) and task_b, each with a cost. `mark` stands in
// for worker text: it is in each prompt, an answer and a tool result, and must reach no view.
export function writeRunSessions(home, dir, mark, { title } = {}) {
  const at = (id, lines) => jsonl(join(home, '.claude/projects', dir.replaceAll(/[\\/]/g, '-'), `${id}.jsonl`), lines.map((l) => ({ ...l, cwd: dir, sessionId: id })));
  for (const [id, task, usd, t] of [['r1', 'task_a', 1.5, '09'], ['r2', 'task_a', 0.5, '10'], ['r3', 'task_b', 0.25, '11']]) {
    at(id, [
      human(`2026-10-23T${t}:00:00.000Z`, `${PREAMBLE.replace('task_1', task)}\n\n=== TASK ===\n${mark}\nOrca run: r-9\n`),
      assistant(`2026-10-23T${t}:00:01.000Z`, `m${id}`, [{ type: 'text', text: `Working on ${mark}` }]),
      result(`2026-10-23T${t}:00:02.000Z`, `q${id}`, mark, false),
      { type: 'cost-state', totalCostUSD: usd, totalAPIDuration: 1000, totalToolDuration: 0, modelUsage: {} },
      ...(title ? [{ type: 'ai-title', aiTitle: title }] : []),
    ]);
  }
}

const turn = (t, durationMs) => ({ ...common(t), type: 'system', subtype: 'turn_duration', durationMs });
const limited = (t, resetsAt) => ({ ...assistant(t, `e${t}`, [{ type: 'text', text: 'Limit reached' }]), isApiErrorMessage: true, error: 'rate_limit', ...(resetsAt ? { quotaLimits: { resetsAt } } : {}) });
const sec = (t) => Date.parse(t) / 1000;
// Turns and usage limit waits in the project `act`: t1 with turn lines and limit waits, t2 with timestamps only, a Codex
// rollout with task_complete, and a subagent of t1 whose turn is left out.
export function writeActivitySessions(home) {
  const dir = join(home, '.claude/projects', '-work-act');
  const at = (id, lines) => jsonl(join(dir, `${id}.jsonl`), lines.map((l) => ({ ...l, cwd: '/work/act', sessionId: id })));
  at('t1', [
    human('2026-10-22T09:00:00.000Z', 'go'),
    // Two turns back to back merge; the third stands apart.
    turn('2026-10-22T09:10:00.000Z', 600e3), turn('2026-10-22T09:20:00.000Z', 600e3),
    // Two errors before the answer are one wait; the reset time of the last one stays.
    limited('2026-10-22T09:30:00.000Z', sec('2026-10-22T11:00:00.000Z')), limited('2026-10-22T09:31:00.000Z', sec('2026-10-22T10:00:00.000Z')),
    assistant('2026-10-22T09:45:00.000Z', 'm9', [{ type: 'text', text: 'Back.' }]),
    turn('2026-10-22T10:00:00.000Z', 300e3),
    // Never resumed: the wait lasts until its reset time.
    limited('2026-10-22T10:30:00.000Z', sec('2026-10-22T10:40:00.000Z')),
  ]);
  at('t2', [
    human('2026-10-22T09:00:00.000Z', 'go'),
    assistant('2026-10-22T09:05:00.000Z', 'n9', [{ type: 'text', text: 'x' }]),
    // A gap over 15 minutes starts a new run; a lone timestamp counts no time.
    assistant('2026-10-22T09:25:00.000Z', 'n9', [{ type: 'text', text: 'x' }]), assistant('2026-10-22T09:35:00.000Z', 'n9', [{ type: 'text', text: 'x' }]),
    // Never resumed and no reset time: a wait without time.
    limited('2026-10-22T10:00:00.000Z'),
  ]);
  jsonl(join(dir, 't1/subagents/agent-s.jsonl'), [{ ...turn('2026-10-22T09:05:00.000Z', 60e3), cwd: '/work/act' }]);
  const ev = (t, type, payload) => ({ timestamp: t, type, payload });
  jsonl(join(home, '.codex/sessions/2026/10/22/rollout-2026-10-22T09-00-00-x1.jsonl'), [
    ev('2026-10-22T09:00:00.000Z', 'session_meta', { id: 'x1', cwd: '/work/act' }),
    ev('2026-10-22T09:05:00.000Z', 'event_msg', { type: 'task_complete', duration_ms: 240e3 }),
    ev('2026-10-22T09:15:00.000Z', 'event_msg', { type: 'task_complete', duration_ms: 60e3 }),
  ]);
}
