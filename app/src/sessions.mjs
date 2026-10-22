// Agent sessions on this machine, read from the Claude Code and Codex transcripts: tier, setup, skills, tests, cost
// and pull requests per session, for the board. Reads only the transcripts, the ledger and gh; writes only its caches.
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { library } from './content.mjs';
import { readText, writeAtomic } from './fsx.mjs';

const SCHEMA = 1;
const cacheDir = (ctx) => join(ctx.home, '.cache/benchkeeper');
const TIERS = ['quick', 'standard', 'full'];
const TIER = /^Tier: (quick|standard|full|research)(?: \(([^)]+)\))?/gm;
const TEST = /(?:^|[\s;&|(])(npm (?:run )?test|node --test|npx playwright test|pytest|go test|cargo test|vitest|jest)(?=$|[\s;&|):])/;
const SKILL_READ = /skills\/([\w.-]+)\/SKILL\.md/g;
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const bare = (name) => name.split(':').pop();

async function lines(file, each) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) each(line);
}
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const texts = (content) => (typeof content === 'string' ? [content] : Array.isArray(content) ? content.map((c) => c.text ?? (typeof c.content === 'string' ? c.content : '')) : []);
const tiers = (data, text) => { for (const m of text.matchAll(TIER)) data.tiers.push([m[1], m[2] ?? null]); };

// One Claude Code transcript (or a subagent's, of which only the skills count).
async function claudeFile(file) {
  const d = { tiers: [], skills: new Set(), usage: {}, prs: new Set(), turns: 0, tests: null, models: new Set() };
  const pending = new Map();
  await lines(file, (line) => {
    const ts = line.match(/"timestamp":"([^"]+)"/)?.[1];
    if (ts) { d.start ??= ts; d.end = ts; }
    // Only lines of the kinds read below are parsed; their type is checked after, as tool output can quote such text.
    if (!/"type":"(assistant|user|cost-state|ai-title|agent-name|pr-link)"|"skill_listing"|"humanTurn":true/.test(line)) return;
    const e = parse(line);
    if (!e) return;
    if (e.cwd && !d.cwd) Object.assign(d, { cwd: e.cwd, branch: e.gitBranch ?? null, agentVersion: e.version ?? null });
    if (e.type === 'cost-state') d.cost = { usd: e.totalCostUSD, busy: (e.totalAPIDuration ?? 0) + (e.totalToolDuration ?? 0), models: e.modelUsage ?? {} };
    else if (e.type === 'ai-title') d.title = e.aiTitle;
    else if (e.type === 'agent-name') d.title ??= e.agentName;
    else if (e.type === 'pr-link' && e.prUrl) d.prs.add(e.prUrl);
    else if (e.type === 'attachment' && e.attachment?.type === 'skill_listing' && Array.isArray(e.attachment.names)) d.installed = e.attachment.names;
    // A prompt typed while the agent works arrives as a queued command.
    else if (e.type === 'attachment' && e.attachment?.humanTurn === true) d.turns++;
    else if (e.type === 'assistant') {
      const m = e.message ?? {};
      if (m.id && m.usage) d.usage[m.id] = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].reduce((n, k) => n + (m.usage[k] ?? 0), 0);
      if (m.model && !m.model.startsWith('<')) d.models.add(m.model);
      if (e.attributionSkill) d.skills.add(e.attributionSkill);
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type === 'text') tiers(d, c.text ?? '');
        else if (c.type === 'tool_use' && c.name === 'Skill' && typeof c.input?.skill === 'string') d.skills.add(c.input.skill);
        else if (c.type === 'tool_use' && c.name === 'Bash' && TEST.test(c.input?.command ?? '')) pending.set(c.id, true);
      }
    } else if (e.type === 'user') {
      const content = e.message?.content;
      // A typed prompt, or the approved plan that starts a session after plan mode.
      if ((e.origin?.kind === 'human' && !e.isMeta) || e.planContent) d.turns++;
      for (const t of texts(content)) for (const m of t.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) d.skills.add(m[1]);
      // The last test run decides: an error with an exit code failed, a result without error passed.
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type !== 'tool_result' || !pending.has(c.tool_use_id)) continue;
        pending.delete(c.tool_use_id);
        if (!c.is_error) d.tests = 'pass';
        else if (/Exit code [1-9]/.test(texts(c.content).join('\n'))) d.tests = 'fail';
      }
    }
  });
  return d;
}

// One Codex rollout. Compacted lines repeat earlier history and are skipped.
// shortcut: skills used and tests come from CommandExecution items, which older rollouts lack; read exec inputs if those matter.
async function codexFile(file) {
  const d = { tiers: [], skills: new Set(), prs: new Set(), turns: 0, tests: null, models: new Set(), busy: 0, tokens: 0 };
  await lines(file, (line) => {
    const ts = line.match(/"timestamp":"([^"]+)"/)?.[1];
    if (ts) { d.start ??= ts; d.end = ts; }
    if (!/"(session_meta|turn_context|token_count|task_started|task_complete|CommandExecution)"|"role":"assistant"|<skills_instructions>/.test(line)) return;
    const e = parse(line);
    const p = e?.payload;
    if (!p || e.type === 'compacted') return;
    if (e.type === 'session_meta') Object.assign(d, { id: p.id, parent: p.parent_thread_id ?? null, cwd: p.cwd, branch: p.git?.branch ?? null, agentVersion: p.cli_version ?? null, start: p.timestamp ?? d.start });
    else if (e.type === 'turn_context' && p.model) d.models.add(p.model);
    else if (p.type === 'token_count' && p.info?.total_token_usage) d.tokens = p.info.total_token_usage.total_tokens ?? d.tokens;
    else if (p.type === 'task_started' && p.turn_attribution?.turn_trigger === 'user') d.turns++;
    else if (p.type === 'task_complete') d.busy += p.duration_ms ?? 0;
    else if (p.type === 'item_completed' && p.item?.type === 'CommandExecution') {
      const cmd = [p.item.command ?? []].flat().join(' ');
      for (const m of cmd.matchAll(SKILL_READ)) d.skills.add(m[1]);
      if (TEST.test(cmd)) d.tests = Number(p.item.exit_code) === 0 ? 'pass' : 'fail';
    } else if (p.type === 'message') {
      for (const t of texts(p.content)) {
        if (p.role === 'assistant') tiers(d, t);
        const list = t.match(/### Available skills\n([\s\S]*?)(?:\n###|<\/skills_instructions>|$)/)?.[1];
        if (list && !d.installed) d.installed = [...list.matchAll(/^- ([\w.:-]+): /gm)].map((m) => m[1]);
      }
    }
  });
  return { ...d, cost: null };
}

const files = (dir, pick, depth) => {
  const out = [];
  const walk = (d, n) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory() && n > 0) walk(p, n - 1);
      else if (e.isFile() && pick(p)) out.push(p);
    }
  };
  walk(dir, depth);
  return out;
};

// Sets keep their order as lists in the cache.
const plain = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v instanceof Set ? [...v] : v]));

// Every transcript, parsed once per size and mtime (cache: ~/.cache/benchkeeper/sessions.json).
async function parsed(ctx, onFile) {
  const cacheFile = join(cacheDir(ctx), 'sessions.json');
  const old = parse(readText(cacheFile) ?? '{}');
  const cache = old?.schema === SCHEMA ? old.files : {};
  const next = {};
  const claude = join(ctx.home, '.claude/projects'), codex = join(ctx.home, '.codex/sessions');
  const list = [
    ...files(claude, (p) => p.endsWith('.jsonl'), 3).map((p) => [p, p.includes('/subagents/') ? 'sub' : 'claude']),
    ...files(codex, (p) => /\/rollout-[^/]+\.jsonl$/.test(p), 3).map((p) => [p, 'codex']),
  ];
  for (const [n, [file, kind]] of list.entries()) {
    onFile?.({ done: n, total: list.length });
    let st;
    try { st = statSync(file); } catch { continue; }
    const key = `${st.size}:${st.mtimeMs}`;
    if (cache[file]?.key === key) { next[file] = cache[file]; continue; }
    const d = plain(kind === 'codex' ? await codexFile(file) : await claudeFile(file));
    next[file] = { key, kind, d };
  }
  // Titles and paths of the user's sessions: this user only.
  writeAtomic(cacheFile, JSON.stringify({ schema: SCHEMA, files: next }), 0o600);
  return next;
}

// Labels of the installed skills (null when the transcript lists none): the plugins BenchKeeper sets up and the library packs whose skills are all there.
function setupLabels(names = []) {
  const has = new Set(names.map(bare));
  const labels = [['benchkeeper:', 'BenchKeeper'], ['mattpocock-skills:', 'Matt Pocock'], ['ponytail:', 'Ponytail']].filter(([p]) => names.some((n) => n.startsWith(p))).map(([, l]) => l);
  for (const p of library().packs) if (p.skills?.length && p.skills.every((s) => has.has(s))) labels.push(p.id);
  return labels;
}

const tierOf = (list) => {
  if (!list.length) return null;
  const [[first, changeType]] = list, last = list.at(-1)[0];
  const rank = (t) => TIERS.indexOf(t);
  return { first, last, changeType, movedUp: rank(first) >= 0 && list.some(([t]) => rank(t) > rank(first)) };
};

// Pull request states from gh: merged and closed kept for good, open asked again after 6 hours (like newest() in
// steps/global.mjs). Without gh, a login or a GitHub pull request URL: unknown, and asked again next time.
export function prStates(ctx, urls, now = Date.now()) {
  const file = join(cacheDir(ctx), 'prs.json');
  const cache = parse(readText(file) ?? '{}') ?? {};
  const out = {};
  let changed = false;
  for (const url of new Set(urls)) {
    const hit = cache[url];
    if (hit && (hit.state !== 'open' || now - hit.at < 6 * 3600e3)) { out[url] = hit.state; continue; }
    out[url] = 'unknown';
    if (!PR.test(url)) continue;
    const r = ctx.run(['gh', 'pr', 'view', url, '--json', 'state'], { timeout: 15e3 });
    const state = r.code === 0 ? parse(r.stdout)?.state?.toLowerCase() : null;
    if (!['open', 'merged', 'closed'].includes(state)) continue;
    out[url] = state;
    cache[url] = { state, at: now };
    changed = true;
  }
  if (changed) writeAtomic(file, `${JSON.stringify(cache)}\n`, 0o600);
  return out;
}

// One row per session, newest first. since: an ISO time; older sessions are left out. onFile gets { done, total } files.
export async function scanSessions(ctx, { since, onFile } = {}) {
  const all = await parsed(ctx, onFile);
  const entries = Object.entries(all);
  // Claude subagents add their skills to the session they belong to (<session>/subagents/agent-*.jsonl).
  const subSkills = new Map();
  for (const [file, { kind, d }] of entries) if (kind === 'sub') {
    const parent = file.replace(/\/subagents\/[^/]+$/, '.jsonl');
    subSkills.set(parent, [...(subSkills.get(parent) ?? []), ...d.skills]);
  }
  const codex = new Map(entries.filter(([, x]) => x.kind === 'codex').map(([, x]) => [x.d.id, x.d]));
  const applies = ctx.ledger.list().filter((r) => r.scope === 'global' && r.kind === 'apply' && r.status === 'done').sort((a, b) => (a.time < b.time ? 1 : -1));
  const rows = [];
  for (const [file, { kind, d }] of entries) {
    if (kind === 'sub' || !d.start || (since && d.start < since)) continue;
    let skills = d.skills, tokens, models = d.models;
    if (kind === 'codex') {
      // A Codex subagent rollout adds its tokens and skills to its parent's row.
      if (d.parent && codex.has(d.parent)) continue;
      const children = [...codex.values()].filter((c) => c.parent === d.id);
      tokens = d.tokens + children.reduce((n, c) => n + c.tokens, 0);
      skills = [...skills, ...children.flatMap((c) => c.skills)];
    } else {
      skills = [...skills, ...(subSkills.get(file) ?? [])];
      const usage = d.cost && Object.values(d.cost.models);
      tokens = usage?.length ? usage.reduce((n, u) => n + (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0) : Object.values(d.usage).reduce((n, x) => n + x, 0);
      if (usage?.length) models = Object.keys(d.cost.models);
    }
    rows.push({
      agent: kind, id: kind === 'codex' ? d.id : file.split('/').pop().replace(/\.jsonl$/, ''), project: d.cwd ?? null, branch: d.branch ?? null,
      agentVersion: d.agentVersion ?? null, title: d.title ?? null, start: d.start, end: d.end, turns: d.turns, models,
      costUSD: d.cost?.usd ?? null, busyMs: kind === 'codex' ? d.busy : d.cost?.busy ?? null, tokens,
      tier: tierOf(d.tiers), skills: [...new Set(skills.map(bare))].sort(), tests: d.tests, setup: d.installed ? setupLabels(d.installed) : null,
      setupVersion: applies.find((r) => r.time < d.start)?.appVersion ?? null, prs: d.prs,
    });
  }
  const states = prStates(ctx, rows.flatMap((r) => r.prs));
  for (const r of rows) r.prs = r.prs.map((url) => ({ url, state: states[url] }));
  return rows.sort((a, b) => (a.start < b.start ? 1 : -1));
}
