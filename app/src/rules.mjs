// The instruction files Claude Code and Codex load: where they are, who wrote them, whether they load, what they cost in
// context, and the switch that turns one off. Reads only; a switch is a plan for the step engine (settings edit or move),
// so every change shows a diff and History undoes it. A file is never deleted: Claude Code files are left out through
// claudeMdExcludes (https://code.claude.com/docs/en/memory#exclude-specific-claude-md-files, patterns match absolute
// paths and cover rules folders), Codex has no such setting and a global file moves to a folder of the app's own.
// The text of a file is returned only by ruleText, for a file the view lists.
import { readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { agent } from './agents.mjs';
import { exists, isDir, readText, real, realish } from './fsx.mjs';
import { git } from './git.mjs';
import { display, frontMatter, markdownIn, pluginSkills, skillDescription, walkInstructions } from './instructions.mjs';
import { allowed } from './runner.mjs';
import { readSettings, settingsChanges } from './settings.mjs';
import { projectCtx } from './steps/project.mjs';

export const RULE_AGENTS = ['claude', 'codex'];
// BenchKeeper's own threshold, not an agent limit: instruction text and skill descriptions sit in the context of every turn.
export const BUDGET_TOKENS = 10000;
// A token is counted as four bytes: an estimate, the agents do not publish their tokenizers.
export const tokensOf = (bytes) => Math.ceil(bytes / 4);
const MEMORY_LINES = 200;
const MEMORY_BYTES = 25 * 1024;
// Codex stops adding AGENTS.md files once their combined size reaches project_doc_max_bytes, 32 KiB by default
// (https://developers.openai.com/codex/guides/agents-md).
const CODEX_BYTES = 32 * 1024;
const TEXT_LIMIT = 200_000;
const GLOB_CHARS = /[*?[\]{}!]/;
const SWITCH = 'rule-switch';
// autoMemoryDirectory is an absolute path or one that starts with this and a slash.
const TILDE = '~';
const MARKER = /benchkeeper:[\w.-]+ start/;

const sizeOf = (text) => Buffer.byteLength(text);

// A claudeMdExcludes pattern as a regular expression: ** crosses folders, * and ? stay inside one, [..] and {a,b} as usual.
// shortcut: no extglobs and no ! negation; a pattern that is not valid matches nothing, upgrade when one is in use.
const charClass = (t) => {
  const negated = /^\[[!^]/.test(t);
  return `[${negated ? '^' : ''}${t.slice(negated ? 2 : 1, -1).replaceAll('\\', '\\\\')}]`;
};
export function globRegex(glob) {
  let depth = 0;
  const body = glob.replace(/\[[^\]]+\]|\*\*\/|\*\*|[*?{},.+^$()|\\]/g, (t) => {
    if (t.length > 1 && t[0] === '[') return charClass(t);
    if (t === '**/') return '(?:.*/)?';
    if (t === '**') return '.*';
    if (t === '*') return '[^/]*';
    if (t === '?') return '[^/]';
    if (t === '{') { depth++; return '(?:'; }
    if (t === '}' && depth) { depth--; return ')'; }
    if (t === ',' && depth) return '|';
    return `\\${t}`;
  });
  try { return new RegExp(`^${body}$`); } catch { return /$^/; }
}
// A file or its link target matches: Claude Code takes either (Before v2.1.239 only the target).
const matches = (path, patterns) => [...new Set([path, realish(path)])].some((p) => patterns.some((g) => globRegex(g).test(p)));

// claudeMdExcludes per settings layer, for the user and, with dir, the project and its local file.
function excludesOf(ctx, dir) {
  return readSettings(ctx, 'claude', { dir }).map((l) => ({ layer: l.layer, patterns: [l.data.claudeMdExcludes].flat().filter((x) => typeof x === 'string') })).filter((l) => l.patterns.length);
}

// Where a global file goes while it is off: the app's own folder, the path below the home folder kept.
export const parkedPath = (ctx, file) => join(ctx.config, 'disabled-rules', relative(ctx.home, file));

// Paths BenchKeeper wrote and has not undone, from the ledger.
// The moves of a switch are not BenchKeeper writing the file: the file stays the user's.
const writtenPaths = (ctx) => new Set(ctx.ledger.list().flatMap((r) => r.entries.filter((e) => e.path && e.status === 'done' && !e.undone && !e.step.startsWith(SWITCH)).map((e) => e.path)));

// The files an agent reads as instructions, in the order it loads them, that exist; dir adds that project's.
function candidates(ctx, id, dir) {
  const rulesOf = (base, scope) => markdownIn(join(base, '.claude/rules')).map((path) => ({ path, scope }));
  const file = (path, scope) => ({ path, scope });
  if (id === 'codex') {
    const home = join(ctx.home, '.codex');
    return [file(join(home, 'AGENTS.override.md'), 'global'), file(join(home, 'AGENTS.md'), 'global'), ...(dir ? [file(join(dir, 'AGENTS.override.md'), 'project'), file(join(dir, 'AGENTS.md'), 'project')] : [])].filter((c) => exists(c.path));
  }
  const list = [file(join(ctx.home, '.claude/CLAUDE.md'), 'global'), ...rulesOf(ctx.home, 'global')];
  if (dir) {
    const own = [file(join(dir, 'CLAUDE.md'), 'project'), file(join(dir, '.claude/CLAUDE.md'), 'project'), file(join(dir, 'CLAUDE.local.md'), 'local')];
    // Claude Code reads AGENTS.md on its own only where none of the CLAUDE.md files exists.
    const alone = !own.some((c) => exists(c.path));
    list.push(own[0], own[1], ...rulesOf(dir, 'project'), own[2], ...(alone ? [file(join(dir, 'AGENTS.md'), 'project')] : []));
  }
  return list.filter((c) => exists(c.path));
}

function ownerOf(row, text, written) {
  if (written.has(real(row.path)) || MARKER.test(text ?? '')) return 'BenchKeeper';
  return row.scope === 'project' ? 'project' : 'yours';
}

// How the file loads: always, only for matching files (path-scoped rules), off (with where it was turned off), or
// shadowed (a Codex file the override of its folder replaces).
function loadOf(id, row, text, { excludes, empty }) {
  if (id === 'claude') {
    const hit = excludes.find((e) => matches(row.path, e.patterns));
    if (hit) return { load: 'off', by: `${hit.layer} settings` };
    return { load: /^paths:/m.test(frontMatter(text)) ? 'path-scoped' : 'always' };
  }
  const override = join(dirname(row.path), 'AGENTS.override.md');
  return row.path !== override && !empty.has(override) && exists(override) ? { load: 'shadowed', by: 'AGENTS.override.md in the same folder' } : { load: 'always' };
}

// The switch of a row: { by: 'settings', layer } | { by: 'move' } | { why } when there is none.
function switchOf(id, row, dir) {
  if (row.owner === 'BenchKeeper') return { why: 'BenchKeeper wrote it: apply, Doctor and Update all keep it current' };
  if (id === 'claude') {
    const layer = dir ? 'local' : 'user';
    if (GLOB_CHARS.test(real(row.path))) return { why: 'the path holds glob characters (* ? [ ] { } !): edit claudeMdExcludes by hand' };
    if (row.load === 'off' && row.by !== `${layer} settings`) return { why: `turned off in the ${row.by}: turn it on there` };
    return { by: 'settings', layer };
  }
  if (row.scope !== 'global') return { why: 'shared with the repository: Codex has no setting to leave it out' };
  if (dir) return { why: 'Codex has no per-project setting: turn it off in the global view' };
  return { by: 'move' };
}

// Global Codex files in the app's disabled folder, for the original paths that are gone.
function parkedRows(ctx, id, dir) {
  // Global files only: a project's plan cannot write below the home folder.
  if (id !== 'codex' || dir) return [];
  return ['AGENTS.override.md', 'AGENTS.md'].map((n) => join(ctx.home, '.codex', n)).filter((p) => !exists(p) && exists(parkedPath(ctx, p)))
    .map((path) => {
      const text = readText(parkedPath(ctx, path)) ?? '';
      const row = { agent: id, scope: 'global', path, shown: display(ctx, dir, path), owner: 'yours', exists: false, bytes: sizeOf(text), tokens: tokensOf(sizeOf(text)), load: 'off', by: 'moved to the disabled folder' };
      return { ...row, switch: { by: 'move' } };
    });
}

// Skill descriptions an agent keeps in context: name and description of each skill it can use, per folder.
function skillRows(ctx, id, dir) {
  const groups = [['global', join(ctx.home, agent(id).global.skills)], ...(dir ? [['project', join(dir, agent(id).project.skills)]] : [])]
    .map(([scope, folder]) => [scope, isDir(folder) ? readdirSync(folder).map((name) => ({ name, text: readText(join(folder, name, 'SKILL.md')) })) : []]);
  if (id === 'claude') {
    for (const s of pluginSkills(ctx, dir)) groups.push([s.scope, [{ name: s.name, text: s.text }]]);
  }
  const merged = new Map();
  for (const [scope, skills] of groups) merged.set(scope, [...(merged.get(scope) ?? []), ...skills]);
  return [...merged].map(([scope, skills]) => {
    // shortcut: a description on one line; a folded block (description: >) counts its first line only.
    const offered = skills.filter((s) => s.text != null && !/^disable-model-invocation:\s*true/m.test(frontMatter(s.text)));
    const bytes = offered.reduce((n, s) => n + sizeOf(s.name) + sizeOf(skillDescription(s.text).text), 0);
    return { kind: 'skills', label: `Skill descriptions, ${scope} (${offered.length})`, bytes, tokens: tokensOf(bytes) };
  }).filter((r) => r.bytes);
}

// The folder name Claude Code gives a project's auto memory: the main worktree's path with every character outside
// letters and digits as a dash. shortcut: the encoding is not documented, it is the form seen on disk; a project whose
// memory is not found there shows no memory row.
const memoryFolder = (root) => root.replace(/[^A-Za-z0-9]/g, '-');

function memoryRow(ctx, dir) {
  const layers = readSettings(ctx, 'claude', { dir });
  if (layers.some((l) => l.data.autoMemoryEnabled === false)) return null;
  // Only the user's own layers name another folder: a repository's settings must not point this read elsewhere.
  const custom = layers.filter((l) => ['user', 'local'].includes(l.layer)).map((l) => l.data.autoMemoryDirectory).filter((x) => typeof x === 'string').at(-1);
  const common = git(ctx, dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
  const root = isAbsolute(common) && common.endsWith(`${sep}.git`) ? dirname(common) : dir;
  const folder = custom ? (custom.startsWith(`${TILDE}/`) ? join(ctx.home, custom.slice(2)) : custom) : join(ctx.home, '.claude/projects', memoryFolder(root), 'memory');
  if (!isAbsolute(folder)) return null;
  const text = readText(join(folder, 'MEMORY.md'));
  if (text == null) return null;
  const head = text.split('\n').slice(0, MEMORY_LINES).join('\n');
  const bytes = Math.min(sizeOf(head), MEMORY_BYTES);
  return { kind: 'memory', label: `Auto memory (first ${MEMORY_LINES} lines or ${MEMORY_BYTES / 1024} KB of MEMORY.md)`, bytes, tokens: tokensOf(bytes) };
}

// What an agent loads at the start of a session, with its size: the files that load, their @imports, skill descriptions,
// auto memory. onDemand: path-scoped rules, which load when matching files are used.
function budgetOf(ctx, id, rows, dir) {
  const loaded = rows.filter((r) => r.load === 'always' && r.exists !== false);
  const items = loaded.map((r) => ({ kind: 'rules', label: r.shown, bytes: r.bytes, tokens: r.tokens }));
  if (id === 'claude') {
    const roots = new Set(loaded.map((r) => r.path));
    walkInstructions(ctx, dir, [...roots], { file: (path, text, hops) => { if (hops > 0 && !roots.has(path)) items.push({ kind: 'imports', label: `${display(ctx, dir, path)} (imported)`, bytes: sizeOf(text), tokens: tokensOf(sizeOf(text)) }); } });
    const memory = dir ? memoryRow(ctx, dir) : null;
    if (memory) items.push(memory);
  }
  items.push(...skillRows(ctx, id, dir));
  const notes = [];
  const files = items.filter((i) => i.kind !== 'skills' && i.kind !== 'memory').reduce((n, i) => n + i.bytes, 0);
  const lost = id === 'codex' && files > CODEX_BYTES ? files - CODEX_BYTES : 0;
  if (lost) notes.push(`Codex stops adding files at ${CODEX_BYTES / 1024} KiB (project_doc_max_bytes): about ${tokensOf(lost)} tokens beyond that may not load`);
  const total = items.reduce((n, i) => n + i.tokens, 0) - tokensOf(lost);
  const largest = items.reduce((m, i) => (!m || i.tokens > m.tokens ? i : m), null);
  const byKind = {};
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + i.tokens;
  return { items, total, byKind, largest: largest && { label: largest.label, tokens: largest.tokens }, threshold: BUDGET_TOKENS, over: total > BUDGET_TOKENS, onDemand: rows.filter((r) => r.load === 'path-scoped').reduce((n, r) => n + r.tokens, 0), notes };
}

function agentView(ctx, id, dir, written, excludes, budget = true) {
  const found = candidates(ctx, id, dir).map((c) => ({ c, text: readText(c.path) ?? '' }));
  const empty = new Set(found.filter((f) => !f.text.trim()).map((f) => f.c.path));
  const rows = found.map(({ c, text }, i) => {
    const row = { agent: id, scope: c.scope, path: c.path, shown: display(ctx, dir, c.path), exists: true, bytes: sizeOf(text), lines: text ? text.replace(/\n$/, '').split('\n').length : 0, tokens: tokensOf(sizeOf(text)), order: i + 1 };
    row.owner = ownerOf(row, text, written);
    Object.assign(row, loadOf(id, row, text, { excludes, empty }));
    return { ...row, switch: switchOf(id, row, dir) };
  });
  rows.push(...parkedRows(ctx, id, dir));
  return { id, name: agent(id).name, rows, ...(budget ? { budget: budgetOf(ctx, id, rows, dir) } : {}) };
}

// agents: ids of RULE_AGENTS; dir: a project folder, without it the global files; budget false: the rows only.
// shortcut: only the project folder's own files, not the CLAUDE.md files of folders above it that Claude Code also loads;
// add them when a registered project sits inside another one.
export function rulesView(ctx, { agents = RULE_AGENTS, dir, budget = true } = {}) {
  const written = writtenPaths(ctx);
  const excludes = excludesOf(ctx, dir);
  return { dir: dir ?? null, agents: agents.filter((a) => RULE_AGENTS.includes(a)).map((id) => agentView(ctx, id, dir, written, excludes, budget)) };
}

// The row of file in an agent's view; without an agent, the first agent that lists it. Throws for any other path.
function find(ctx, { agent: id, file, dir }) {
  const path = resolve(String(file ?? ''));
  for (const a of rulesView(ctx, { agents: id ? [id] : RULE_AGENTS, dir, budget: false }).agents) {
    const row = a.rows.find((r) => r.path === path);
    if (row) return row;
  }
  throw new Error(`${path} is not an instruction file ${id ? agent(id).name : 'Claude Code or Codex'} loads${dir ? ` in ${dir}` : ''}`);
}

// The text of a listed file, for the app on this machine: never for a log, a run record or an export.
export function ruleText(ctx, { agent: id, file, dir }) {
  const row = find(ctx, { agent: id, file, dir });
  const text = readText(row.exists === false ? parkedPath(ctx, row.path) : row.path) ?? '';
  return { path: row.path, text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
}

const title = (row, on, dir) => `${on ? 'turn on' : 'turn off'} ${row.shown} for ${agent(row.agent).name}${dir && row.scope === 'global' ? ' in this project' : ''}`;

// Changes that turn a file on or off: an edit of claudeMdExcludes (user settings, or the project's local settings for one
// project), or for a global Codex file a copy into the disabled folder and the removal of the original, which go together.
export function ruleChanges(ctx, { agent: id, file, dir, on }) {
  const row = find(ctx, { agent: id, file, dir });
  if (!row.switch.by) throw new Error(row.switch.why);
  if (on === (row.load !== 'off')) return [];
  if (row.switch.by === 'settings') {
    const { layer } = row.switch;
    const own = excludesOf(ctx, dir).find((l) => l.layer === layer)?.patterns ?? [];
    const pattern = real(row.path);
    const next = on ? own.filter((p) => p !== pattern && p !== row.path) : [...own, pattern];
    const rest = excludesOf(ctx, dir).map((l) => (l.layer === layer ? { ...l, patterns: next } : l)).find((l) => matches(row.path, l.patterns));
    if (on && rest) throw new Error(`${row.shown} is also left out by a pattern of the ${rest.layer} settings that is not its own path: edit claudeMdExcludes there`);
    const sctx = dir ? projectCtx(ctx, dir) : ctx;
    return settingsChanges(sctx, 'claude', { layer, dir, edits: { claudeMdExcludes: next.length ? next : null } }).map((c) => ({ ...c, title: title(row, on, dir) }));
  }
  const parked = parkedPath(ctx, row.path);
  const [from, to] = on ? [parked, row.path] : [row.path, parked];
  if (!allowed(to, ctx)) throw new Error(`${to} is outside ${ctx.roots.join(', ')}: this run may not write there`);
  const unit = `rule:${row.path}`;
  const step = `${SWITCH}:${row.agent}`;
  return [
    { id: `${step}:copy`, step, title: `${title(row, on, dir)}: copy to ${on ? row.shown : 'the disabled folder'}`, kind: 'write', path: to, from, unit },
    { id: `${step}:remove`, step, title: `${title(row, on, dir)}: remove ${on ? 'the disabled copy' : row.shown} (copied)`, kind: 'remove', path: from, selected: true, unit },
  ];
}

// Paths and states of the rule files, for the profile: no text, no sizes.
export function ruleStates(ctx, { agents, dir }) {
  return rulesView(ctx, { agents, dir, budget: false }).agents.flatMap((a) => a.rows.filter((r) => !dir || r.scope !== 'global' || r.load === 'off').map((r) => ({ agent: a.id, scope: r.scope, path: r.shown, owner: r.owner, state: r.load })));
}

// Doctor: a Codex override in the home folder is read instead of the AGENTS.md that holds BenchKeeper's rules. Any other
// rule file of the user is information in the Rules view, not a finding.
export function rulesChecks(ctx, agents) {
  if (!agents?.includes('codex')) return [];
  return agentView(ctx, 'codex', undefined, writtenPaths(ctx), [], false).rows.filter((r) => r.load === 'shadowed' && r.owner === 'BenchKeeper')
    .map((r) => ({ level: 'warning', check: 'rules', message: `${r.shown} is not read: ${r.by} replaces it, so BenchKeeper's Codex rules do not load`, fix: 'move your notes into the AGENTS.md beside the override, outside the BenchKeeper block, or turn the override off in the Rules view (benchkeeper rules disable)' }));
}
