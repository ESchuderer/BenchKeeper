// Per-phase and per-subagent measurements (protocol v1.3; trials whose log has a `phases` marker).
// A phase is assigned per model call from what the call does, so it does not depend on skill names:
//   spec: writes to spec, plan, design, proposal, tasks or ADR files (openspec/, .specify/, docs/superpowers, .scratch,
//         docs/adr); skills named like brainstorm, grill, spec, propose, plan, explore
//   test: writes to test files; skills named like tdd, test
//   build: writes to other files; install and build commands; skills named like apply, implement, execut
//   verify: test, lint, typecheck and browser commands; Playwright MCP; skills named like verif
//   review: review or security agents and skills
// A call that only reads, searches or answers keeps the phase of the call before it ("explore" before any phase).
// Claude Code: cost is the trial total split by each call's token weight (input 1, cache write 1.25, cache read 0.1,
// output 5 relative to input, from Anthropic's price ratios; output estimated as content characters / 4), time from
// the event timestamps. OpenCode: cost and time per message as OpenCode reports them.

const SPEC_FILE = /(?:(?:^|\/)(?:openspec|\.specify|\.scratch|docs\/superpowers|docs\/adr|specs?)\/)|(?:(?:spec|plan|design|proposal|tasks|requirements)[^/]*\.md$)/i;
const TEST_FILE = /(?:(?:^|\/)(?:tests?|__tests__|e2e)\/)|(?:\.(?:test|spec)\.[cm]?[jt]sx?$)/;
// Commands, not paths: `npm test`, `npm run lint`, `npx playwright test`, `tsc --noEmit`; `cat test/x` stays in its phase.
const VERIFY_CMD = /\b(npm (run )?(test|lint|typecheck|check|e2e)|npx (vitest|jest|playwright|tsc|eslint)|vitest|jest|tsc|eslint)\b/;
const BUILD_CMD = /\bnpm (i|install|ci|run build)\b/;

// File a shell command writes with `cat > f`, `echo ... >> f`, `printf ... > f` or `tee [-a] f` (first line only), else null.
export function shellWriteTarget(command) {
  const c = String(command || '').split('\n')[0];
  return /(?:^|[;&|]\s*)(?:cat|printf|echo)\b[^|;&]*?>{1,2}\s*['"]?([^\s'"<>;&|]+)/.exec(c)?.[1]
    || /(?:^|[;&|]\s*)tee\s+(?:-a\s+)?['"]?([^\s'"<>;&|]+)/.exec(c)?.[1] || null;
}

// Heredoc bodies and their terminator line are file contents; only the `<<DELIM` header stays. As in the shell, `<<` ends
// at a line equal to the delimiter, `<<-` also after leading tabs; a header without a terminator swallows the rest of the
// command. A line scan instead of one regex with a lazy body.
function withoutHeredocBodies(text) {
  const header = /<<(-?)[ \t]*\\?(['"]?)([\w.-]+)\2[^\n]*/g;
  let out = '', pos = 0, m;
  while ((m = header.exec(text))) {
    const bodyStart = m.index + m[0].length;
    if (text[bodyStart] !== '\n') continue;
    let end = -1;
    for (let s = bodyStart + 1; s <= text.length && end < 0;) {
      const nl = text.indexOf('\n', s);
      const e = nl < 0 ? text.length : nl;
      const line = text.slice(s, e);
      if ((m[1] ? line.replace(/^\t+/, '') : line) === m[3]) end = e;
      s = e + 1;
    }
    out += text.slice(pos, bodyStart);
    if (end < 0) return out;
    pos = header.lastIndex = end;
  }
  return out + text.slice(pos);
}

// A shell command as it runs: without heredoc bodies (file contents), written file names and the packages an install
// command names, so `cat > vitest.config.ts`, `pip install pytest` and a README that mentions `npm test` are no checks.
export function commandText(command) {
  return withoutHeredocBodies(String(command || ''))
    .replace(/(?:>{1,2}\s*|\btee\s+(?:-a\s+)?)['"]?[^\s'"<>;&|]+/g, '')
    .replace(/\b(npm (?:i|install|add)|pnpm (?:i|install|add)|yarn add|pip3? install|uv (?:add|pip install|tool install)|python3? -m pip install)\b[^;&|\n]*/g, '$1');
}

export function phaseOfSkill(name) {
  const n = String(name).toLowerCase();
  if (/review|audit|secur/.test(n)) return 'review';
  if (/verif/.test(n)) return 'verify';
  if (/tdd|test/.test(n)) return 'test';
  if (/apply|implement|execut|develop/.test(n)) return 'build';
  if (/brainstorm|grill|spec|propose|plan|explore|domain|design/.test(n)) return 'spec';
  return null;
}

// tools: [{ name, input }] of one call, names as in the Claude Code trace (Write, Edit, Bash, Skill, Agent, mcp__...).
export function phaseOfCall(tools) {
  let p = null;
  const set = (x) => { if (x && (!p || x === 'review' || (x === 'verify' && p !== 'review'))) p = x; };
  for (const t of tools) {
    const path = String(t.input?.file_path || t.input?.filePath || '');
    if (['Write', 'Edit', 'MultiEdit'].includes(t.name)) set(SPEC_FILE.test(path) ? 'spec' : TEST_FILE.test(path) ? 'test' : 'build');
    else if (t.name === 'Bash') {
      // Only the first line counts, so phase splits stay comparable with the published ones (owner decision 2026-10-21;
      // reading later lines moved about 300 of 4800 calls to verify). A check stays verify when its output is also
      // written (`npm test | tee test.log`); `cat > f`, `tee f` write a file.
      const raw = String(t.input?.command || '').split('\n')[0], c = commandText(raw), w = shellWriteTarget(raw);
      if (VERIFY_CMD.test(c)) set('verify');
      else if (w) set(SPEC_FILE.test(w) ? 'spec' : TEST_FILE.test(w) ? 'test' : 'build');
      else set(BUILD_CMD.test(c) ? 'build' : null);
    }
    else if (t.name === 'Skill') set(phaseOfSkill(t.input?.skill || t.input?.name));
    else if (t.name === 'Agent' || t.name === 'Task') set(/review|audit|secur/i.test(t.input?.subagent_type || '') ? 'review' : null);
    else if (/^mcp__playwright/.test(t.name)) set('verify');
  }
  return p;
}

const weight = (u, outChars) => (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0) + 5 * outChars / 4;

function add(acc, key, w, s) { const a = (acc[key] ||= { weight: 0, seconds: 0, calls: 0 }); a.weight += w; a.seconds += s; a.calls += 1; }

function finish(acc, total, exact) {
  const sum = Object.values(acc).reduce((n, a) => n + a.weight, 0) || 1;
  return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, {
    calls: a.calls, minutes: Math.round(a.seconds / 6) / 10,
    usd: Math.round(1000 * (exact ? a.weight : total * a.weight / sum)) / 1000,
  }]));
}

// Claude Code stream-json events; total = the trial's cost.
export function claudePhases(events, total) {
  const calls = new Map(); // message id -> { tools, usage, chars, parent, start }
  const toolPhase = new Map(); // Agent tool_use id -> phase and subagent type
  for (const e of events) {
    if (e.type !== 'assistant' || !e.message?.id) continue;
    const c = calls.get(e.message.id) || { tools: [], usage: e.message.usage || {}, chars: 0, parent: e.parent_tool_use_id, start: Date.parse(e.timestamp) };
    for (const b of e.message.content || []) {
      if (b.type === 'tool_use') c.tools.push({ id: b.id, name: b.name, input: b.input || {} });
      c.chars += JSON.stringify(b.text ?? b.thinking ?? b.input ?? '').length;
    }
    calls.set(e.message.id, c);
  }
  const list = [...calls.values()].sort((a, b) => a.start - b.start);
  const phases = {}, subagents = {};
  let current = 'explore';
  list.forEach((c, i) => {
    const next = list.slice(i + 1).find((x) => !!x.parent === !!c.parent)?.start;
    const seconds = Number.isFinite(next - c.start) ? Math.max(0, (next - c.start) / 1000) : 0;
    const w = weight(c.usage, c.chars);
    if (c.parent) {
      const via = toolPhase.get(c.parent) || { phase: current, type: 'unknown' };
      add(phases, via.phase, w, 0);
      add(subagents, via.type, w, seconds);
      return;
    }
    current = phaseOfCall(c.tools) || current;
    for (const t of c.tools) if (t.name === 'Agent' || t.name === 'Task') toolPhase.set(t.id, { phase: current, type: t.input.subagent_type || 'general-purpose' });
    add(phases, current, w, seconds);
  });
  return { phases: finish(phases, total), subagents: finish(subagents, total * sumWeights(subagents) / (sumWeights(phases) || 1)), method: 'estimate' };
}
const sumWeights = (acc) => Object.values(acc).reduce((n, a) => n + a.weight, 0);

// OpenCode session exports (every session of the trial).
const OC_NAMES = { write: 'Write', edit: 'Edit', multiedit: 'MultiEdit', skill: 'Skill', task: 'Agent', bash: 'Bash' };
export function opencodePhases(all) {
  const main = all.find((s) => !s.info?.parentID);
  const phases = {}, subagents = {};
  const spawned = new Map(); // subagent session id -> phase of the task call that started it
  let current = 'explore';
  // Parents before children, so each subagent session takes the phase of the call that spawned it.
  const order = [main, ...all.filter((s) => s !== main)].filter(Boolean)
    .sort((a, b) => Boolean(a.info?.parentID) - Boolean(b.info?.parentID) || (a.info?.time?.created || 0) - (b.info?.time?.created || 0));
  for (const s of order) {
    const sub = Boolean(s.info?.parentID);
    const phase = spawned.get(s.info?.id) || current;
    for (const m of s.messages || []) {
      if (m.info?.role !== 'assistant') continue;
      const parts = (m.parts || []).filter((p) => p.type === 'tool');
      const tools = parts.map((p) => ({ name: OC_NAMES[p.tool] || p.tool, input: p.state?.input || {} }));
      const seconds = Math.max(0, ((m.info.time?.completed || 0) - (m.info.time?.created || 0)) / 1000);
      if (!sub) current = phaseOfCall(tools) || current;
      for (const p of parts) if (p.tool === 'task' && p.state?.metadata?.sessionId) spawned.set(p.state.metadata.sessionId, sub ? phase : current);
      if (sub) { add(phases, phase, m.info.cost || 0, 0); add(subagents, s.info?.title || 'subagent', m.info.cost || 0, seconds); continue; }
      add(phases, current, m.info.cost || 0, seconds);
    }
  }
  return main ? { phases: finish(phases, 0, true), subagents: finish(subagents, 0, true), method: 'reported' } : null;
}
