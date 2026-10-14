// OpenCode trials (arms Q to U): delivery audit from the resolved skills and config, tool uses in the shape the
// Claude Code trace uses, and cost and tokens summed over every exported session (the stream holds only the main one).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const OPENCODE_ARMS = ['Q', 'R', 'S', 'T', 'U', 'Z', 'AA'];

// Skills each arm must resolve (need) and must not (deny), chosen so every pair of arms differs; plus its plugin.
const EXPECT = {
  // OpenSpec + targeted skills: no agent-skills beyond the four targeted ones, no Superpowers.
  Q: { need: ['openspec-propose', 'openspec-verify-change', 'test-driven-development', 'security-and-hardening', 'code-review-and-quality', 'debugging-and-error-recovery', 'vercel-react-best-practices'],
    deny: ['api-and-interface-design', 'spec-driven-development', 'brainstorming'], plugin: null },
  // Superpowers v7.0.0 (diagnosing-superpowers is new in v7), no OpenSpec.
  R: { need: ['brainstorming', 'writing-plans', 'subagent-driven-development', 'diagnosing-superpowers'], deny: ['openspec-propose', 'spec-driven-development'], plugin: 'file:///' },
  // oso: Superpowers v6.1.1 through OpenCode's plugin manager.
  S: { need: ['brainstorming', 'writing-plans', 'subagent-driven-development'], deny: ['diagnosing-superpowers', 'spec-driven-development', 'vercel-react-best-practices'], plugin: 'superpowers.git#v6.1.1' },
  // agent-skills, all skills, no OpenSpec.
  T: { need: ['spec-driven-development', 'planning-and-task-breakdown', 'api-and-interface-design', 'test-driven-development'], deny: ['openspec-propose', 'brainstorming', 'vercel-react-best-practices'], plugin: null },
  // agent-skills without its lifecycle skills, with OpenSpec.
  U: { need: ['openspec-propose', 'openspec-verify-change', 'api-and-interface-design', 'test-driven-development'], deny: ['spec-driven-development', 'planning-and-task-breakdown', 'brainstorming', 'vercel-react-best-practices'], plugin: null },
  // Matt Pocock's skills v1.3.1, without and with OpenSpec.
  Z: { need: ['tdd', 'code-review', 'grilling', 'to-spec', 'to-tickets'], deny: ['openspec-propose', 'brainstorming', 'spec-driven-development'], plugin: null },
  AA: { need: ['tdd', 'code-review', 'to-spec', 'openspec-propose', 'openspec-verify-change'], deny: ['brainstorming', 'spec-driven-development', 'vercel-react-best-practices'], plugin: null },
};

const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

export function ocAudit(log, arm) {
  const skills = json(join(log, 'opencode-skills.json'));
  const config = json(join(log, 'opencode-config.json'));
  if (!skills || !config) return { ok: false, problems: ['no OpenCode audit files'] };
  const want = EXPECT[arm];
  const have = new Set(skills.map((s) => s.name));
  const plugins = (config.plugin || []).map(String);
  const problems = [];
  for (const m of want.need) if (!have.has(m)) problems.push(`missing ${m}`);
  for (const m of want.deny) if (have.has(m)) problems.push(`unexpected ${m}`);
  if (want.plugin ? !(plugins.length === 1 && plugins[0].includes(want.plugin)) : plugins.length) problems.push(`plugins ${plugins.join(',') || 'none'}`);
  return { ok: problems.length === 0, problems, runtime: 'opencode', plugins, skills: skills.length };
}

// Exported sessions (`opencode export`): { info: { id, parentID }, messages: [{ info: { role, cost, tokens }, parts }] }.
export function sessions(log) {
  if (!existsSync(log)) return [];
  return readdirSync(log).filter((f) => /^session-.*\.json$/.test(f)).map((f) => json(join(log, f))).filter(Boolean);
}

const NAMES = { write: 'Write', edit: 'Edit', multiedit: 'MultiEdit', skill: 'Skill', task: 'Agent', bash: 'Bash' };
const use = (tool, input = {}, sub = false) => ({
  name: NAMES[tool] || tool,
  input: { file_path: input.filePath, skill: input.name, subagent_type: input.subagent_type, command: input.command },
  sub,
});

// Tool uses of every session: the main session from the exports when present, else from the stream.
export function ocUses(events, all) {
  if (all.length) {
    return all.flatMap((s) => (s.messages || []).flatMap((m) => (m.parts || []).filter((p) => p.type === 'tool')
      .map((p) => use(p.tool, p.state?.input, Boolean(s.info?.parentID)))));
  }
  return events.filter((e) => e.type === 'tool_use').map((e) => use(e.part?.tool, e.part?.state?.input));
}

export function ocOutcome(events, all) {
  const msgs = all.flatMap((s) => (s.messages || []).map((m) => ({ ...m.info, sub: Boolean(s.info?.parentID) }))).filter((m) => m.role === 'assistant');
  const steps = events.filter((e) => e.type === 'step_finish').map((e) => e.part || {});
  // Exports cover subagent sessions too; the stream is the fallback.
  const src = msgs.length ? msgs : steps;
  const sum = (f) => src.reduce((n, m) => n + (f(m.tokens || {}) || 0), 0);
  const errors = events.filter((e) => e.type === 'error').map((e) => JSON.stringify(e.error || e));
  const texts = events.filter((e) => e.type === 'text').map((e) => e.part?.text || '');
  const last = (texts.at(-1) || '').trim();
  return {
    finished: steps.length > 0,
    runtime: 'opencode',
    sessions: all.length || null,
    is_error: errors.length > 0,
    infra_error: errors.some((e) => /rate.?limit|overloaded|\b429\b|\b529\b|\b401\b|credit balance|authenticat|api key/i.test(e)),
    ends_with_question: /\?\s*$/.test(last),
    turns: msgs.length ? msgs.filter((m) => !m.sub).length : steps.length,
    cost_usd_api_equivalent: src.reduce((n, m) => n + (m.cost || 0), 0),
    usage: {
      input: sum((t) => t.input), cache_creation: sum((t) => t.cache?.write), cache_read: sum((t) => t.cache?.read),
      output: sum((t) => t.output), thinking: sum((t) => t.reasoning),
    },
  };
}
