// Agent sessions on this machine, read from the Claude Code and Codex transcripts: tier, setup, skills, tests, cost
// and pull requests per session, for the board. Reads only the transcripts, the ledger and gh; writes only its caches.
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { library } from './content.mjs';
import { readText, writeAtomic } from './fsx.mjs';

const SCHEMA = 1;
const MAX_DAYS = 3650;
const cacheDir = (ctx) => join(ctx.home, '.cache/benchkeeper');
const TIERS = ['quick', 'standard', 'full'];
const TIER = /^Tier: (quick|standard|full|research)(?: \(([^)]+)\))?/gm;
// Also inside a quoted shell argument (devcontainer exec ... sh -lc 'npm test').
const TEST = /(?:^|[\s;&|('"])(npm (?:run )?test|node --test|npx playwright test|pytest|go test|cargo test|vitest|jest)(?=$|[\s;&|):'"])/;
// The folder that holds SKILL.md, also nested (skills/engineering/tdd/SKILL.md).
const SKILL_READ = /skills[\\/](?:[\w.-]+[\\/])*?([\w.-]+)[\\/]SKILL\.md/g;
const PR = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const bare = (name) => name.split(':').pop();

async function lines(file, each) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) each(line);
}
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const texts = (content) => (typeof content === 'string' ? [content] : Array.isArray(content) ? content.map((c) => c.text ?? (typeof c.content === 'string' ? c.content : '')) : []);
// `(override)` marks a tier set with /benchkeeper:tier: no change type.
const tiers = (data, text) => { for (const m of text.matchAll(TIER)) data.tiers.push([m[1], m[2] && m[2] !== 'override' ? m[2] : null]); };

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
    else if (e.type === 'pr-link' && typeof e.prUrl === 'string') d.prs.add(e.prUrl);
    else if (e.type === 'attachment' && e.attachment?.type === 'skill_listing' && Array.isArray(e.attachment.names)) d.installed = e.attachment.names.filter((n) => typeof n === 'string');
    // A prompt typed while the agent works arrives as a queued command.
    else if (e.type === 'attachment' && e.attachment?.humanTurn === true) d.turns++;
    else if (e.type === 'assistant') {
      const m = e.message ?? {};
      if (m.id && m.usage) d.usage[m.id] = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].reduce((n, k) => n + (m.usage[k] ?? 0), 0);
      if (typeof m.model === 'string' && !m.model.startsWith('<')) d.models.add(m.model);
      if (typeof e.attributionSkill === 'string') d.skills.add(e.attributionSkill);
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
  // Each message's usage counted once (a message streams as several lines), kept as the sum.
  return { ...d, usage: Object.values(d.usage).reduce((n, x) => n + x, 0) };
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
      // No exit code recorded: the result is unknown, the last known one stays.
      const code = p.item.exit_code;
      if (TEST.test(cmd) && code != null && code !== '' && Number.isInteger(Number(code))) d.tests = Number(code) === 0 ? 'pass' : 'fail';
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

// The cache file: parsed summaries by transcript path, and the retention (days; null keeps them for good). A summary
// outlives its transcript, which the agent deletes after its cleanup period. Message text is never in it.
const cachePath = (ctx) => join(cacheDir(ctx), 'sessions.json');
const readCache = (ctx) => {
  const old = parse(readText(cachePath(ctx)) ?? '{}');
  return { files: old?.schema === SCHEMA && old.files && typeof old.files === 'object' ? old.files : {}, keepDays: Number.isInteger(old?.keepDays) && old.keepDays >= 1 && old.keepDays <= MAX_DAYS ? old.keepDays : null };
};
const writeCache = (ctx, files, keepDays) => {
  // Titles and paths of the user's sessions: this user only.
  writeAtomic(cachePath(ctx), JSON.stringify({ schema: SCHEMA, keepDays, files }), 0o600);
};
// sessions: the rows the board shows. A Codex subagent rollout counts only while its parent is cached; without it the board shows it as a session.
export const sessionCache = (ctx) => {
  const { files, keepDays } = readCache(ctx);
  const all = Object.values(files);
  const codex = new Set(all.filter((x) => x.kind === 'codex').map((x) => x.d?.id));
  return { keepDays, sessions: all.filter((x) => x.kind !== 'sub' && x.d?.start && !(x.d?.parent && codex.has(x.d.parent))).length };
};
// days: a whole number from 1 to 3650, or null to keep summaries for good. The next scan drops what is older.
export function keepSessionsFor(ctx, days) {
  if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= MAX_DAYS)) throw new Error(`days must be a whole number from 1 to ${MAX_DAYS}, or none`);
  writeCache(ctx, readCache(ctx).files, days);
}
// The summaries go, and so does the history of transcripts the agent has deleted; the next scan rebuilds the rest.
export const clearSessionCache = (ctx) => writeCache(ctx, {}, readCache(ctx).keepDays);
const expire = (files, keepDays, now = Date.now()) => {
  const horizon = keepDays ? new Date(now - keepDays * 864e5).toISOString() : '';
  return Object.fromEntries(Object.entries(files).filter(([, x]) => { const t = x.d?.end ?? x.d?.start; return !t || t >= horizon; }));
};

// Every transcript, parsed once per size and mtime (cache: sessions.json in the benchkeeper cache folder). The summary of a
// transcript that is gone stays, until the retention drops it.
async function parsed(ctx, onFile) {
  const { files: cache } = readCache(ctx);
  const next = {};
  const claude = join(ctx.home, '.claude/projects'), codex = join(ctx.home, '.codex/sessions');
  const list = [
    ...files(claude, (p) => p.endsWith('.jsonl'), 3).map((p) => [p, /[\\/]subagents[\\/]/.test(p) ? 'sub' : 'claude']),
    ...files(codex, (p) => /^rollout-.+\.jsonl$/.test(basename(p)), 3).map((p) => [p, 'codex']),
  ];
  for (const [n, [file, kind]] of list.entries()) {
    onFile?.({ done: n, total: list.length });
    let st;
    try { st = statSync(file); } catch { continue; }
    const key = `${st.size}:${st.mtimeMs}`;
    if (cache[file]?.key === key) { next[file] = cache[file]; continue; }
    // A file removed or unreadable since the walk is left out; the others still count and are cached.
    try { next[file] = { key, kind, d: plain(kind === 'codex' ? await codexFile(file) : await claudeFile(file)) }; } catch { /* skipped */ }
  }
  // The retention is read again here: a change made during the scan stays.
  const { keepDays } = readCache(ctx);
  const kept = expire(Object.fromEntries(Object.entries(cache).filter(([f]) => !(f in next))), keepDays);
  writeCache(ctx, { ...kept, ...next }, keepDays);
  return { ...kept, ...next };
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
  const [[first]] = list, last = list.at(-1)[0];
  const changeType = list.find(([, c]) => c)?.[1] ?? null;
  const rank = (t) => TIERS.indexOf(t);
  return { first, last, changeType, movedUp: rank(first) >= 0 && list.some(([t]) => rank(t) > rank(first)) };
};

// Pull request states from gh: merged kept for good, open asked again after 6 hours (like newest() in
// steps/global.mjs) and closed after a day (it can be reopened), a failed lookup (no gh, no login, offline) after 10 minutes. Not a GitHub pull request URL:
// unknown, never asked. Four lookups at a time, off the server's event loop.
const AGAIN = { open: 6 * 3600e3, closed: 24 * 3600e3, unknown: 600e3 };
export async function prStates(ctx, urls, now = Date.now()) {
  const file = join(cacheDir(ctx), 'prs.json');
  const cache = parse(readText(file) ?? '{}') ?? {};
  const run = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
  const out = {};
  const ask = [];
  for (const url of new Set(urls)) {
    const hit = cache[url];
    out[url] = hit && !(now - hit.at >= (AGAIN[hit.state] ?? Infinity)) ? hit.state : 'unknown';
    if (PR.test(url) && out[url] === 'unknown' && !(hit?.state === 'unknown' && now - hit.at < AGAIN.unknown)) ask.push(url);
  }
  const work = async () => {
    for (let url; (url = ask.shift());) {
      const r = await run(['gh', 'pr', 'view', url, '--json', 'state'], { timeout: 15e3 });
      const state = r.code === 0 ? parse(r.stdout)?.state?.toLowerCase() : null;
      cache[url] = { state: ['open', 'merged', 'closed'].includes(state) ? state : 'unknown', at: now };
      out[url] = cache[url].state;
    }
  };
  const asked = ask.length;
  await Promise.all([1, 2, 3, 4].map(work));
  if (asked) writeAtomic(file, `${JSON.stringify(cache)}\n`, 0o600);
  return out;
}

// One row per session, newest first. since: an ISO time; older sessions are left out. onFile gets { done, total } files.
export async function scanSessions(ctx, { since, onFile } = {}) {
  const all = await parsed(ctx, onFile);
  const entries = Object.entries(all);
  // Claude subagents add their skills to the session they belong to (<session>/subagents/agent-*.jsonl).
  const subSkills = new Map();
  for (const [file, { kind, d }] of entries) if (kind === 'sub') {
    const parent = file.replace(/[\\/]subagents[\\/][^\\/]+$/, '.jsonl');
    subSkills.set(parent, [...(subSkills.get(parent) ?? []), ...d.skills]);
  }
  const codex = new Map(entries.filter(([, x]) => x.kind === 'codex').map(([, x]) => [x.d.id, x.d]));
  const rootOf = (c) => { let x = c; for (let n = 0; x.parent && codex.has(x.parent) && n < 50; n++) x = codex.get(x.parent); return x.id; };
  const applies = ctx.ledger.list().filter((r) => r.scope === 'global' && r.kind === 'apply' && r.status === 'done').sort((a, b) => (a.time < b.time ? 1 : -1));
  const rows = [];
  for (const [file, { kind, d }] of entries) {
    if (kind === 'sub' || !d.start || (since && d.start < since)) continue;
    let skills = d.skills, tokens, models = d.models;
    if (kind === 'codex') {
      // A Codex subagent rollout, at any depth, adds its tokens and skills to its root session's row.
      if (d.parent && codex.has(d.parent)) continue;
      const children = [...codex.values()].filter((c) => c !== d && rootOf(c) === d.id);
      tokens = d.tokens + children.reduce((n, c) => n + c.tokens, 0);
      skills = [...skills, ...children.flatMap((c) => c.skills)];
    } else {
      skills = [...skills, ...(subSkills.get(file) ?? [])];
      const usage = d.cost && Object.values(d.cost.models);
      tokens = usage?.length ? usage.reduce((n, u) => n + (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0) : (typeof d.usage === 'number' ? d.usage : Object.values(d.usage).reduce((n, x) => n + x, 0));
      if (usage?.length) models = Object.keys(d.cost.models);
    }
    rows.push({
      agent: kind, id: kind === 'codex' ? d.id : basename(file, '.jsonl'), project: d.cwd ?? null, branch: d.branch ?? null,
      agentVersion: d.agentVersion ?? null, title: d.title ?? null, start: d.start, end: d.end, turns: d.turns, models,
      costUSD: d.cost?.usd ?? null, busyMs: kind === 'codex' ? d.busy : d.cost?.busy ?? null, tokens,
      tier: tierOf(d.tiers), skills: [...new Set(skills.map(bare))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), tests: d.tests, setup: d.installed ? setupLabels(d.installed) : null,
      setupVersion: applies.find((r) => r.time < d.start)?.appVersion ?? null, prs: d.prs,
    });
  }
  const states = await prStates(ctx, rows.flatMap((r) => r.prs));
  for (const r of rows) r.prs = r.prs.map((url) => ({ url, state: states[url] }));
  return rows.sort((a, b) => (a.start < b.start ? 1 : -1));
}
