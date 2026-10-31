// Agent sessions on this machine, read from the Claude Code and Codex transcripts: tier, setup, skills, tests, cost
// and pull request links per session, for the board. Reads only the transcripts and the ledger; writes only its caches.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { library } from './content.mjs';
import { move, readText, walkDir, writeAtomic } from './fsx.mjs';
import { repoEnv } from './git.mjs';
import { readLedger } from './ponytail.mjs';
import * as orca from './orca/index.mjs';

// Converters from each older cache schema to the next; the schema is their count plus one, so a bump adds one here. The cache holds
// the only copy of summaries whose transcripts the agent has deleted: a bump converts it, never drops it.
export const MIGRATE = {};
const schema = () => Object.keys(MIGRATE).length + 1;
const MAX_DAYS = 3650;
const cacheDir = (ctx) => join(ctx.home, '.cache/benchkeeper');
const TIERS = ['quick', 'standard', 'full'];
const TIER = /^Tier: (quick|standard|full|research)(?: \(([^)]+)\))?/gm;
// In command position only: at the start of a chain part, after variables or a runner (npx playwright test), also as the
// start of a sh -c script (devcontainer exec ... sh -lc 'npm test'), not in quoted or echoed text.
// A variable's value is quoted or stops at the next separator or quote, so a long chain of a=b parts is matched in linear time.
export const TEST = /(?:^|[;&|(\n]|\b(?:ba)?sh -[a-z]*c\s+['"]?)\s*(?:\w+=(?:"[^"]*"|'[^']*'|[^\s;&|'"]*)\s+)*(?:(?:npx|pnpm(?: exec)?|yarn|bunx|uv run|python3? -m)\s+)?((?:npm|pnpm|yarn|bun) (?:run )?test(?::\S+)?|node --test|playwright test|pytest|go test|cargo test|vitest|jest)(?=$|[\s;&|):'"])/;
// The folder that holds SKILL.md, also nested (skills/engineering/tdd/SKILL.md).
const SKILL_READ = /skills[\\/](?:[\w.-]+[\\/])*?([\w.-]+)[\\/]SKILL\.md/g;
const LOOP_COMMANDS = ['goal', 'loop'];
// Part of every file's cache key: a change to what a transcript summary holds reads the transcripts again, and the summary of one the agent has deleted stays as it was.
const PARSE = 4;
const bare = (name) => name.split(':').pop();

async function lines(file, each) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) each(line);
}
const parse = (line) => { try { return JSON.parse(line); } catch { return null; } };
const texts = (content) => (typeof content === 'string' ? [content] : Array.isArray(content) ? content.map((c) => c.text ?? (typeof c.content === 'string' ? c.content : '')) : []);
// `(override)` marks a tier set with /benchkeeper:tier: no change type.
const tiers = (data, text) => { for (const m of text.matchAll(TIER)) data.tiers.push([m[1], m[2] && m[2] !== 'override' ? m[2] : null]); };
const sec = (iso) => Math.round(Date.parse(iso) / 1000);
// [start, end] pairs in epoch seconds, sorted, overlapping or adjacent ones merged.
const merged = (spans) => spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]).reduce((out, [a, b]) => {
  const last = out.at(-1);
  if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  return out;
}, []);
// When the file was active: its turns, or without a turn line its timestamp runs split at gaps over 15 minutes.
function activity() {
  const turns = [], runs = [];
  return {
    // The line's timestamp, also kept as the file's start and end.
    at(line, d) {
      const ts = line.match(/"timestamp":"([^"]+)"/)?.[1];
      if (!ts) return ts;
      d.start ??= ts; d.end = ts;
      const t = sec(ts), last = runs.at(-1);
      if (last && t >= last[0] && t - last[1] <= 900) last[1] = Math.max(last[1], t); else runs.push([t, t]);
      return ts;
    },
    turn(ts, ms) { const end = sec(ts); turns.push([end - Math.round(ms / 1000), end]); },
    spans: () => merged(turns.length ? turns : runs),
  };
}

// One Claude Code transcript (or a subagent's, of which only the skills count).
async function claudeFile(file) {
  const d = { tiers: [], skills: new Set(), usage: {}, prs: new Set(), turns: 0, tests: null, models: new Set(), loop: false, orca: false, run: null, task: null, limits: [] };
  const pending = new Map(), active = activity();
  // The usage limit wait still open: [hit, resumed, resetsAt] in epoch seconds, from its first error to the next answer.
  let wait = null;
  await lines(file, (line) => {
    const ts = active.at(line, d);
    // Only lines of the kinds read below are parsed; their type is checked after, as tool output can quote such text.
    if (!/"type":"(assistant|user|cost-state|ai-title|agent-name|pr-link)"|"skill_listing"|"humanTurn":true|"turn_duration"/.test(line)) return;
    const e = parse(line);
    if (!e) return;
    if (e.type === 'system' && e.subtype === 'turn_duration' && ts && Number.isFinite(e.durationMs)) active.turn(ts, e.durationMs);
    if (e.type === 'assistant' && ts) {
      const resets = Number.isFinite(e.quotaLimits?.resetsAt) ? e.quotaLimits.resetsAt : null;
      if (e.isApiErrorMessage && e.error === 'rate_limit') { if (wait) wait[2] = resets ?? wait[2]; else d.limits.push(wait = [sec(ts), null, resets]); }
      else if (wait && !e.isApiErrorMessage) { wait[1] = sec(ts); wait = null; }
    }
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
        else if (c.type === 'tool_use' && c.name === 'Skill' && typeof c.input?.skill === 'string') { d.skills.add(c.input.skill); if (LOOP_COMMANDS.includes(bare(c.input.skill))) d.loop = true; }
        else if (c.type === 'tool_use' && c.name === 'ScheduleWakeup') d.loop = true;
        else if (c.type === 'tool_use' && c.name === 'Bash' && TEST.test(c.input?.command ?? '')) pending.set(c.id, true);
      }
    } else if (e.type === 'user') {
      const content = e.message?.content;
      // A typed prompt, or the approved plan that starts a session after plan mode.
      if ((e.origin?.kind === 'human' && !e.isMeta) || e.planContent) {
        // Only the first typed prompt: a later one, or tool output, can quote the text.
        if (!d.turns) for (const t of texts(content)) { d.run ??= orca.runOf(t); d.task ??= orca.taskOf(t); d.orca ||= !!d.run || orca.isWorkerPrompt(t); }
        d.turns++;
      }
      for (const t of texts(content)) for (const m of t.matchAll(/<command-name>\/?([^<\s]+)<\/command-name>/g)) { d.skills.add(m[1]); if (LOOP_COMMANDS.includes(bare(m[1]))) d.loop = true; }
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
  return { ...d, usage: Object.values(d.usage).reduce((n, x) => n + x, 0), active: active.spans() };
}

// One Codex rollout. Compacted lines repeat earlier history and are skipped.
// shortcut: skills used and tests come from CommandExecution items, which older rollouts lack; read exec inputs if those matter.
async function codexFile(file) {
  // shortcut: no loop or worker detection: the rollout signature of /goal and of a dispatched prompt is not documented; read user messages if that is verified.
  const d = { tiers: [], skills: new Set(), prs: new Set(), turns: 0, tests: null, models: new Set(), busy: 0, tokens: 0, loop: false, orca: false, run: null };
  const active = activity();
  await lines(file, (line) => {
    const ts = active.at(line, d);
    if (!/"(session_meta|turn_context|token_count|task_started|task_complete|CommandExecution)"|"role":"assistant"|<skills_instructions>/.test(line)) return;
    const e = parse(line);
    const p = e?.payload;
    if (!p || e.type === 'compacted') return;
    if (e.type === 'session_meta') Object.assign(d, { id: p.id, parent: p.parent_thread_id ?? null, cwd: p.cwd, branch: p.git?.branch ?? null, agentVersion: p.cli_version ?? null, start: p.timestamp ?? d.start });
    else if (e.type === 'turn_context' && p.model) d.models.add(p.model);
    else if (p.type === 'token_count' && p.info?.total_token_usage) d.tokens = p.info.total_token_usage.total_tokens ?? d.tokens;
    else if (p.type === 'task_started' && p.turn_attribution?.turn_trigger === 'user') d.turns++;
    else if (p.type === 'task_complete') { d.busy += p.duration_ms ?? 0; if (ts && Number.isFinite(p.duration_ms)) active.turn(ts, p.duration_ms); }
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
  return { ...d, cost: null, active: active.spans() };
}

const files = (dir, pick, depth) => {
  const out = [];
  walkDir(dir, depth, (e, p) => { if (e.isFile() && pick(p)) out.push(p); });
  return out;
};

// Sets keep their order as lists in the cache.
const plain = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v instanceof Set ? [...v] : v]));

// The cache file: parsed summaries by transcript path, and the retention (days; null keeps them for good). A summary
// outlives its transcript, which the agent deletes after its cleanup period. Message text is never in it.
const cachePath = (ctx) => join(cacheDir(ctx), 'sessions.json');
// The files of the schema in use, converted step by step from an older one; null when that is not possible (an unreadable
// file, or a newer or unknown schema).
const migrate = (old) => {
  let x = old;
  while (x?.schema !== schema()) {
    if (!(x?.schema < schema()) || !MIGRATE[x.schema]) return null;
    try { x = { ...MIGRATE[x.schema](x), schema: x.schema + 1 }; } catch { return null; }
  }
  return x.files && typeof x.files === 'object' && !Array.isArray(x.files) ? x.files : null;
};
// lost: a cache file that cannot be converted. Its summaries read as none, and the next write moves it aside, never over it.
const readCache = (ctx) => {
  const text = readText(cachePath(ctx));
  const old = parse(text ?? '{}');
  const files = text == null ? {} : migrate(old);
  return { files: files ?? {}, keepDays: Number.isInteger(old?.keepDays) && old.keepDays >= 1 && old.keepDays <= MAX_DAYS ? old.keepDays : null, lost: !files };
};
const asideOf = (ctx) => `${cachePath(ctx)}.${Date.now()}`;
const writeCache = (ctx, files, keepDays) => {
  if (readCache(ctx).lost) move(cachePath(ctx), asideOf(ctx));
  // Titles and paths of the user's sessions: this user only.
  writeAtomic(cachePath(ctx), JSON.stringify({ schema: schema(), keepDays, files }), 0o600);
};
// sessions: the rows the board shows. A Codex subagent rollout counts only while its parent is cached; without it the board shows it as a session.
export const sessionCache = (ctx) => {
  const { files, keepDays } = readCache(ctx);
  const all = Object.values(files);
  const codex = new Set(all.filter((x) => x.kind === 'codex').map((x) => x.d?.id));
  return { keepDays, sessions: all.filter((x) => x.kind !== 'sub' && x.d?.start && !(x.d?.parent && codex.has(x.d.parent))).length };
};
// The repositories (main worktrees) dispatched workers ran in, by the summaries the last scan cached.
export const workerRepos = (ctx) => new Set(Object.values(readCache(ctx).files).filter((x) => x.d?.orca && typeof x.d.repo === 'string').map((x) => x.d.repo));
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
async function parsed(ctx, onFile, onNote) {
  const { files: cache, lost } = readCache(ctx);
  if (lost) onNote?.(`The session cache ${cachePath(ctx)} is unreadable or of an unknown version: it is kept beside it with a time suffix, and the sessions whose transcripts are gone are not listed.`);
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
    const key = `${st.size}:${st.mtimeMs}:${PARSE}`;
    if (cache[file]?.key === key) { next[file] = cache[file]; continue; }
    // A file removed or unreadable since the walk is left out; the others still count and are cached.
    // A transcript read again keeps the repository found before: its worktree may be gone by now.
    try { next[file] = { key, kind, d: { ...plain(kind === 'codex' ? await codexFile(file) : await claudeFile(file)), repo: cache[file]?.d?.repo } }; } catch { /* skipped */ }
  }
  // The retention is read again here: a change made during the scan stays.
  const { keepDays } = readCache(ctx);
  const kept = expire(Object.fromEntries(Object.entries(cache).filter(([f]) => !(f in next))), keepDays);
  const all = { ...kept, ...next };
  await withRepos(ctx, Object.values(all));
  writeCache(ctx, all, keepDays);
  return all;
}

// The repository a session's folder is a worktree of (its main worktree), found once per folder and kept in the cache,
// as a worktree removed later cannot be asked. null: not in a repository, or the folder was gone at the first scan.
// undefined only on a summary cached before this was read.
async function withRepos(ctx, entries) {
  const run = ctx.runAsync ?? (async (argv, o) => ctx.run(argv, o));
  const found = new Map();
  const repoOf = async (dir) => {
    if (!existsSync(dir)) return null;
    const r = await run(['git', '-C', dir, 'worktree', 'list', '--porcelain'], { env: repoEnv(), timeout: 15e3 });
    const main = r.code === 0 ? r.stdout.split('\n').find((l) => l.startsWith('worktree '))?.slice(9) : null;
    return main ? resolve(main) : null;
  };
  for (const x of entries) {
    if (x.kind === 'sub' || x.d?.repo !== undefined || typeof x.d?.cwd !== 'string') continue;
    if (!found.has(x.d.cwd)) found.set(x.d.cwd, repoOf(x.d.cwd));
    x.d.repo = await found.get(x.d.cwd);
  }
}

// Labels of the installed skills (null when the transcript lists none): the plugins BenchKeeper sets up, and the library packs
// whose skills are all there or whose plugin is (its skills carry the plugin's name).
function setupLabels(names = []) {
  const has = new Set(names.map(bare));
  const labels = [['benchkeeper:', 'BenchKeeper']].filter(([p]) => names.some((n) => n.startsWith(p))).map(([, l]) => l);
  const viaPlugin = (p) => Object.values(p.plugins ?? {}).some((x) => names.some((n) => n.startsWith(`${x.id.split('@')[0]}:`)));
  for (const p of library().packs) if ((p.skills?.length && p.skills.every((s) => has.has(s))) || viaPlugin(p)) labels.push(p.id);
  return labels;
}

const tierOf = (list) => {
  if (!list.length) return null;
  const [[first]] = list, last = list.at(-1)[0];
  const changeType = list.find(([, c]) => c)?.[1] ?? null;
  const rank = (t) => TIERS.indexOf(t);
  return { first, last, changeType, movedUp: rank(first) >= 0 && list.some(([t]) => rank(t) > rank(first)) };
};

// How the session was run. One value when several apply: a dispatched worker, else a loop (/goal, /loop or a scheduled wakeup), else
// a group (at least one subagent; the count is in `subagents`), else single. null for a summary cached before this was read
// and whose transcript the agent has since deleted: shown as not recorded, never as single.
const patternOf = (d, subagents) => (d.orca === undefined ? null : d.orca ? orca.WORKER_PATTERN : d.loop ? 'loop' : subagents ? 'group' : 'single');

// Ponytail's ledger beside the transcript rows (opt-in; the figures stay Ponytail's own, in `ponytail`). A Claude Code row
// whose session id starts like a ledger key is matched and counted once; a ledger row without a transcript here becomes a row
// of its own, named by `source`. A ledger row is its project's name, not a path, and has no tier, skills or pull requests.
function withLedger(ctx, rows, since, onNote) {
  const { rows: ledger, notes } = readLedger(ctx);
  notes.forEach((n) => onNote?.(n));
  const byId = new Map(ledger.map((l) => [l.id, l]));
  for (const r of rows) {
    const l = r.agent === 'claude' ? byId.get(r.id.slice(0, 8)) : undefined;
    if (l) byId.delete(l.id);
    r.source = l ? 'transcript and Ponytail ledger' : 'transcript';
    if (l) r.ponytail = { costUSD: l.costUSD, turns: l.turns, agentMinutes: l.agentMinutes, reusePct: l.reusePct, tests: l.tests, level: l.level };
  }
  for (const l of byId.values()) {
    const start = new Date(l.startedMs).toISOString();
    if (since && start < since) continue;
    rows.push({
      agent: 'claude', id: `${l.id}-${l.startedMs}`, project: l.project, branch: null, agentVersion: null, title: null, start, end: start, turns: l.turns, models: l.model ? [l.model] : [],
      costUSD: l.costUSD, busyMs: l.agentMinutes == null ? null : Math.round(l.agentMinutes * 60e3), tokens: l.tokens ?? 0, tier: null, skills: [], tests: l.tests, setup: null, pattern: null, subagents: 0, run: null, task: null,
      setupVersion: null, prs: [], repo: null, active: null, limits: null, source: 'Ponytail ledger only', ponytail: { costUSD: l.costUSD, turns: l.turns, agentMinutes: l.agentMinutes, reusePct: l.reusePct, tests: l.tests, level: l.level },
    });
  }
  return rows.sort((a, b) => (a.start < b.start ? 1 : -1));
}

// One row per session, newest first. since: an ISO time; older sessions are left out. onFile gets { done, total } files.
// ledger: true adds Ponytail's ledger when it is there (see withLedger); onNote gets a line for each file or row it skipped,
// and one for a cache file it cannot convert.
export async function scanSessions(ctx, { since, onFile, ledger, onNote } = {}) {
  const all = await parsed(ctx, onFile, onNote);
  const entries = Object.entries(all);
  // Claude subagents add their skills to the session they belong to (<session>/subagents/agent-*.jsonl).
  const subSkills = new Map(), subCount = new Map();
  for (const [file, { kind, d }] of entries) if (kind === 'sub') {
    const parent = file.replace(/[\\/]subagents[\\/][^\\/]+$/, '.jsonl');
    subSkills.set(parent, [...(subSkills.get(parent) ?? []), ...d.skills]);
    subCount.set(parent, (subCount.get(parent) ?? 0) + 1);
  }
  const codex = new Map(entries.filter(([, x]) => x.kind === 'codex').map(([, x]) => [x.d.id, x.d]));
  const rootOf = (c) => { let x = c; for (let n = 0; x.parent && codex.has(x.parent) && n < 50; n++) x = codex.get(x.parent); return x.id; };
  const applies = ctx.ledger.list().filter((r) => r.scope === 'global' && r.kind === 'apply' && r.status === 'done').sort((a, b) => (a.time < b.time ? 1 : -1));
  const rows = [];
  for (const [file, { kind, d }] of entries) {
    if (kind === 'sub' || !d.start || (since && d.start < since)) continue;
    let skills = d.skills, tokens, models = d.models, subagents;
    if (kind === 'codex') {
      // A Codex subagent rollout, at any depth, adds its tokens and skills to its root session's row.
      if (d.parent && codex.has(d.parent)) continue;
      const children = [...codex.values()].filter((c) => c !== d && rootOf(c) === d.id);
      tokens = d.tokens + children.reduce((n, c) => n + c.tokens, 0);
      skills = [...skills, ...children.flatMap((c) => c.skills)];
      subagents = children.length;
    } else {
      skills = [...skills, ...(subSkills.get(file) ?? [])];
      subagents = subCount.get(file) ?? 0;
      const usage = d.cost && Object.values(d.cost.models);
      tokens = usage?.length ? usage.reduce((n, u) => n + (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0), 0) : (typeof d.usage === 'number' ? d.usage : Object.values(d.usage).reduce((n, x) => n + x, 0));
      if (usage?.length) models = Object.keys(d.cost.models);
    }
    rows.push({
      agent: kind, id: kind === 'codex' ? d.id : basename(file, '.jsonl'), project: d.cwd ?? null, branch: d.branch ?? null,
      agentVersion: d.agentVersion ?? null, title: d.title ?? null, start: d.start, end: d.end, turns: d.turns, models,
      costUSD: d.cost?.usd ?? null, busyMs: kind === 'codex' ? d.busy : d.cost?.busy ?? null, tokens,
      tier: tierOf(d.tiers), skills: [...new Set(skills.map(bare))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), tests: d.tests, setup: d.installed ? setupLabels(d.installed) : null,
      pattern: patternOf(d, subagents), subagents, run: d.run ?? null, task: d.task ?? null,
      setupVersion: applies.find((r) => r.time < d.start)?.appVersion ?? null, prs: d.prs, repo: d.repo ?? null,
      // Not recorded (null) on a summary cached before they were read; Codex records no limit waits.
      active: d.active ?? null, limits: d.limits ?? null,
    });
  }
  rows.sort((a, b) => (a.start < b.start ? 1 : -1));
  return ledger ? withLedger(ctx, rows, since, onNote) : rows;
}

// Cost and tokens per orchestrated run and per task, matched by the ids the scan took from the worker's first prompt; a
// worker without a run line counts under run null. A Codex row adds tokens only: cost stays null until a row has one.
export function byRun(rows) {
  const runs = new Map();
  const add = (x, r) => { x.sessions++; x.tokens += r.tokens ?? 0; if (r.costUSD != null) x.costUSD = (x.costUSD ?? 0) + r.costUSD; };
  const blank = (k, v) => ({ [k]: v, sessions: 0, costUSD: null, tokens: 0 });
  for (const r of rows) {
    if (!r.run && !r.task) continue;
    if (!runs.has(r.run)) runs.set(r.run, { ...blank('run', r.run), tasks: new Map() });
    const x = runs.get(r.run);
    if (!x.tasks.has(r.task)) x.tasks.set(r.task, blank('task', r.task));
    add(x, r);
    add(x.tasks.get(r.task), r);
  }
  return [...runs.values()].map((x) => ({ ...x, tasks: [...x.tasks.values()] }));
}
