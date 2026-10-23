// Small Claude Code and Codex transcripts in a fixture home, shaped like the real ones (only the fields the scan reads).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const jsonl = (file, lines) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`); };
const common = (t, cwd = '/work/shop') => ({ cwd, gitBranch: 'feat/cart', version: '2.1.300', sessionId: 's1', timestamp: t });
const assistant = (t, id, content, usage = { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 5 }) => ({ ...common(t), type: 'assistant', message: { id, model: 'claude-sonnet-5-5', content, usage } });
const human = (t, content, extra = {}) => ({ ...common(t), type: 'user', origin: { kind: 'human' }, message: { role: 'user', content }, ...extra });
const result = (t, id, text, isError) => ({ ...common(t), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }] } });

export const TITLE = 'Cart </script><img src=x onerror=alert(1)> fix';

export function writeSessions(home) {
  const dir = join(home, '.claude/projects/-work-shop');
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
    { type: 'ai-title', aiTitle: TITLE, sessionId: 's1' },
    { type: 'pr-link', prUrl: 'https://github.com/acme/shop/pull/7', sessionId: 's1' },
    { type: 'pr-link', prUrl: 'https://github.com/acme/shop/pull/7', sessionId: 's1' },
    { type: 'cost-state', totalCostUSD: 0.5, totalAPIDuration: 1000, totalToolDuration: 500, modelUsage: {} },
    { type: 'cost-state', totalCostUSD: 1.25, totalAPIDuration: 60000, totalToolDuration: 30000, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 10 } } },
  ]);
  jsonl(join(dir, 's1/subagents/agent-a1.jsonl'), [
    assistant('2026-10-20T10:00:30.000Z', 'a1', [{ type: 'tool_use', id: 'k2', name: 'Skill', input: { skill: 'mattpocock-skills:diagnosing-bugs' } }]),
  ]);
  // A running session: no cost-state yet, tokens from the usage of each message once.
  jsonl(join(home, '.claude/projects/-work-blog/s2.jsonl'), [
    { ...human('2026-10-21T09:00:00.000Z', 'typo in the README'), cwd: '/work/blog', sessionId: 's2' },
    // A tier set with /benchkeeper:tier carries no change type; the next line names it.
    { ...assistant('2026-10-21T09:00:04.000Z', 'n1', [{ type: 'text', text: 'Tier: quick (override)' }]), cwd: '/work/blog', sessionId: 's2' },
    { ...assistant('2026-10-21T09:00:05.000Z', 'n1', [{ type: 'text', text: 'Tier: quick (docs, typo)' }]), cwd: '/work/blog', sessionId: 's2' },
    { ...assistant('2026-10-21T09:00:06.000Z', 'n1', [{ type: 'text', text: 'Fixed.' }]), cwd: '/work/blog', sessionId: 's2' },
  ]);
  const codex = join(home, '.codex/sessions/2026/10/21');
  const ev = (t, type, payload) => ({ timestamp: t, type, payload });
  const cmd = (t, command, code) => ev(t, 'event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['/usr/bin/bash', '-lc', command], exit_code: String(code) } });
  jsonl(join(codex, 'rollout-2026-10-21T11-00-00-c1.jsonl'), [
    ev('2026-10-21T11:00:00.000Z', 'session_meta', { id: 'c1', timestamp: '2026-10-21T11:00:00.000Z', cwd: '/work/shop', cli_version: '0.162.1', source: 'cli', git: { branch: 'main' } }),
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
    ev('2026-10-21T11:00:03.000Z', 'session_meta', { id: 'c2', parent_thread_id: 'c1', cwd: '/work/shop', source: { subagent: { other: 'review' } } }),
    // A skill in a nested folder.
    cmd('2026-10-21T11:00:03.500Z', 'cat /x/skills/engineering/diagnosing-bugs/SKILL.md', 0),
    ev('2026-10-21T11:00:04.000Z', 'event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 200 } } }),
  ]);
  // A subagent of the subagent: it counts toward the root session too.
  jsonl(join(codex, 'rollout-2026-10-21T11-00-04-c3.jsonl'), [
    ev('2026-10-21T11:00:04.000Z', 'session_meta', { id: 'c3', parent_thread_id: 'c2', cwd: '/work/shop', source: { subagent: { other: 'review' } } }),
    cmd('2026-10-21T11:00:04.500Z', 'cat /x/skills/grilling/SKILL.md', 0),
    ev('2026-10-21T11:00:05.000Z', 'event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: 100 } } }),
  ]);
}
