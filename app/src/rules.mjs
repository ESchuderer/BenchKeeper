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
  const body = glob.replace(/\[[^\][]+\]|\*\*\/|\*\*|[*?{},.+^$()|\\]/g, (t) => {
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
const parkedPath = (ctx, file) => join(ctx.config, 'disabled-rules', relative(ctx.home, file));

// Paths BenchKeeper wrote and has not undone, from the ledger.
// The moves of a switch are not BenchKeeper writing the file: the file stays the user's.
export const writtenPaths = (ctx) => new Set(ctx.ledger.list().flatMap((r) => r.entries.filter((e) => e.path && e.status === 'done' && !e.undone && !e.step.startsWith(SWITCH)).map((e) => e.path)));

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
  return { kind: 'memory', label: `Auto memory (first ${MEMORY_LINES} lines or ${MEMORY_BYTES / 1024} KB of MEMORY.md)`, bytes, tokens: tokensOf(bytes), path: join(folder, 'MEMORY.md'), lines: text.replace(/\n$/, '').split('\n').length, size: sizeOf(text) };
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
  // The limits shown as bars: value, limit and who sets it.
  const memory = items.find((i) => i.kind === 'memory');
  const limits = [
    { label: 'At the start of a session', value: total, max: BUDGET_TOKENS, unit: 'tokens', by: 'BenchKeeper' },
    ...(id === 'codex' ? [{ label: 'AGENTS.md files together', value: files, max: CODEX_BYTES, unit: 'bytes', by: 'Codex' }] : []),
    ...(memory ? [{ label: 'MEMORY.md', value: memory.lines, max: MEMORY_LINES, unit: 'lines', by: 'Claude Code' }] : []),
  ];
  return { items, total, byKind, largest: largest && { label: largest.label, tokens: largest.tokens }, threshold: BUDGET_TOKENS, over: total > BUDGET_TOKENS, onDemand: rows.filter((r) => r.load === 'path-scoped').reduce((n, r) => n + r.tokens, 0), notes, limits };
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

// agents: ids of RULE_AGENTS; dir: a project folder, without it the global files; budget false: the rows only, else also
// the findings, with limit as the size limit of one file in tokens.
// shortcut: only the project folder's own files, not the CLAUDE.md files of folders above it that Claude Code also loads;
// add them when a registered project sits inside another one.
export function rulesView(ctx, { agents = RULE_AGENTS, dir, budget = true, limit = BUDGET_TOKENS } = {}) {
  const written = writtenPaths(ctx);
  const excludes = excludesOf(ctx, dir);
  const views = agents.filter((a) => RULE_AGENTS.includes(a)).map((id) => agentView(ctx, id, dir, written, excludes, budget));
  return { dir: dir ?? null, agents: views, ...(budget ? { limit, findings: findingsOf(ctx, views, dir, limit) } : {}) };
}

// ---- Checks: deterministic and local. A finding names the file and line, never the text of a file.

const finding = (level, kind, message, fix, where) => ({ level, check: 'rules', kind, message, fix, ...where });
const FENCE = /^\s*(`{3,}|~{3,})/;
// Lines of prose and code, without front matter, each with its number and whether it sits in a fenced block.
function linesOf(text) {
  const out = [];
  const front = text.match(/^---\n[\s\S]*?\n---\n/)?.[0].split('\n').length - 1 || 0;
  let fence = null;
  text.split('\n').forEach((raw, i) => {
    if (i < front) return;
    const mark = raw.match(FENCE)?.[1];
    if (mark && (!fence || mark[0] === fence[0])) { fence = fence ? null : mark; return; }
    out.push({ line: i + 1, raw, code: !!fence });
  });
  return out;
}

// The globs of a path-scoped rule and the line of paths: (a YAML list below it, or globs on the same line).
function pathsOf(text) {
  const lines = frontMatter(text).split('\n'), at = lines.findIndex((l) => /^paths:/.test(l));
  if (at < 0) return null;
  const inline = lines[at].slice('paths:'.length).trim();
  const list = [];
  for (let i = at + 1; !inline && /^\s*-\s/.test(lines[i] ?? ''); i++) list.push(lines[i].replace(/^\s*-\s/, ''));
  const globs = (inline ? inline.replace(/^\[|\]$/g, '').split(',') : list).map((g) => g.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  return { line: at + 2, globs };
}

// The files of a project, relative with forward slashes, without .git and node_modules, at most FILES_MAX.
// shortcut: ignored build output counts too, so a glob that matches only that is not reported; read .gitignore when that misleads.
const FILES_MAX = 100_000;
function projectFiles(dir) {
  const out = [], todo = [''];
  while (todo.length && out.length < FILES_MAX) {
    const rel = todo.pop();
    let entries = [];
    try { entries = readdirSync(join(dir, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== '.git' && e.name !== 'node_modules') todo.push(p); } else out.push(p);
    }
  }
  return out;
}

// A line that says something: no heading, list marker or case, long enough not to repeat by chance.
const DUPLICATE_MIN = 40;
const normal = (raw) => raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

// The files an agent reads in one session, with owner: its loaded rows, then the files they import (Claude Code).
function loadedOf(ctx, a, dir, out) {
  const files = a.rows.filter((r) => r.exists !== false && ['always', 'path-scoped'].includes(r.load)).map((r) => ({ path: r.path, shown: r.shown, owner: r.owner, scope: r.scope, row: r }));
  if (a.id !== 'claude') return files;
  const roots = new Set(files.map((f) => f.path));
  walkInstructions(ctx, dir, [...roots], {
    file: (path, text, hops) => { if (hops > 0 && !roots.has(path)) files.push({ path, shown: display(ctx, dir, path), owner: MARKER.test(text) ? 'BenchKeeper' : 'yours', scope: dir && path.startsWith(`${dir}${sep}`) ? 'project' : 'global' }); },
    missing: (path, line, target) => out.push(finding('error', 'import', `${display(ctx, dir, path)}:${line} imports ${target}, which does not exist`, 'fix the path or remove the import', { file: display(ctx, dir, path), line, scope: files.find((f) => f.path === path)?.scope ?? 'global' })),
  });
  return files;
}

function findingsOf(ctx, views, dir, limit) {
  const out = [];
  let files, scripts;
  const allFiles = () => (files ??= dir ? projectFiles(dir) : []);
  // npm scripts of every package.json of the project; null when it has none.
  const scriptsOf = () => {
    if (scripts !== undefined) return scripts;
    const found = allFiles().filter((f) => f === 'package.json' || f.endsWith('/package.json'));
    scripts = found.length ? new Set(found.flatMap((f) => { try { return Object.keys(JSON.parse(readText(join(dir, f))).scripts ?? {}); } catch { return []; } })) : null;
    return scripts;
  };
  const accounted = new Set();
  for (const a of views) {
    const loaded = loadedOf(ctx, a, dir, out);
    for (const r of a.rows) if (r.load !== 'shadowed') accounted.add(r.path);
    for (const f of loaded) accounted.add(f.path);
    const seen = new Map();
    for (const f of loaded) {
      const where = (line) => ({ file: f.shown, line, scope: f.scope });
      const text = readText(f.path);
      const off = f.row?.switch.by ? { action: { agent: a.id, file: f.path } } : {};
      // A BenchKeeper file that is gone, empty or a dangling link is the global setup's finding: apply restores it.
      if (f.owner === 'BenchKeeper' && !text?.trim()) continue;
      if (text == null) { out.push(finding('error', 'unreadable', `${f.shown} cannot be read`, 'check its permissions, or turn it off', { ...where(1), ...off })); continue; }
      if (!text.trim()) { out.push(finding('warning', 'empty', `${f.shown} is empty: it loads nothing`, 'write the rules into it, or turn it off', { ...where(1), ...off })); continue; }
      const tokens = tokensOf(sizeOf(text));
      if (tokens > limit) out.push(finding('warning', 'size', `${f.shown} has about ${tokens} tokens, over the limit of ${limit} per file (BenchKeeper's own, not the agent's)`, 'split it into path-scoped rules or skills, or turn it off', { ...where(1), ...off }));
      const scoped = a.id === 'claude' && f.row?.load === 'path-scoped' && dir ? pathsOf(text) : null;
      if (scoped?.globs.length && !allFiles().some((p) => scoped.globs.some((g) => globRegex(g).test(p)))) out.push(finding('warning', 'glob', `${f.shown}:${scoped.line}: no file of the project matches its paths (${scoped.globs.join(', ')}), so it never loads`, 'fix the globs, or remove the rule if its files are gone', where(scoped.line)));
      const lines = linesOf(text);
      // BenchKeeper's own files are kept current by apply: their links and wording are not the user's to fix.
      if (f.owner !== 'BenchKeeper') {
        for (const { line, raw, code } of lines) {
          if (!code) {
            for (const [, target] of raw.replace(/`[^`]*`/g, '').matchAll(/\]\((?!https?:|#|mailto:|<)([^)#\s]+)/g)) {
              let to;
              try { to = resolve(dirname(f.path), decodeURI(target)); } catch { continue; }
              if (!exists(to)) out.push(finding('error', 'link', `${f.shown}:${line} links ${target}, which does not exist`, 'restore the file or fix the link', where(line)));
            }
          }
          // shortcut: only npm run scripts are checked; other commands need a lookup on the PATH, add them when one is asked for.
          for (const [, name] of raw.matchAll(/\bnpm run ([\w:.-]+)/g)) {
            if (scriptsOf() && !scriptsOf().has(name)) out.push(finding('warning', 'command', `${f.shown}:${line} runs npm run ${name}, which no package.json of the project defines`, 'fix the script name or add the script', where(line)));
          }
        }
      }
      // Each pair of files once, at the first repeated line, with the number of lines they share.
      const pairs = new Map();
      for (const { line, raw } of lines) {
        const key = normal(raw);
        if (key.length < DUPLICATE_MIN || raw.trim().startsWith('#')) continue;
        const first = seen.get(key);
        if (!first) { seen.set(key, { f, line }); continue; }
        if (first.f === f || (first.f.owner === 'BenchKeeper' && f.owner === 'BenchKeeper')) continue;
        const pair = pairs.get(first.f.path) ?? { first, line, n: 0 };
        pair.n++;
        pairs.set(first.f.path, pair);
      }
      for (const { first, line, n } of pairs.values()) out.push(finding('warning', 'duplicate', `${f.shown}:${line} repeats ${first.f.shown}:${first.line}${n > 1 ? ` (${n} lines in all)` : ''}: both load in the same ${a.name} session`, 'keep the instruction in one file', where(line)));
    }
    const { budget } = a;
    if (budget.over) out.push(finding('warning', 'budget', `${a.name} loads about ${budget.total} tokens at the start of a session, over the ${budget.threshold} BenchKeeper sets`, 'turn off a file, split a long one into path-scoped rules, or shorten the largest source', { scope: dir ? 'project' : 'global' }));
    for (const n of budget.notes) out.push(finding('warning', 'budget', n, 'shorten the AGENTS.md files or raise project_doc_max_bytes in the Codex config', { scope: dir ? 'project' : 'global' }));
    const memory = budget.items.find((i) => i.kind === 'memory');
    if (memory && (memory.lines > MEMORY_LINES || memory.size > MEMORY_BYTES)) {
      out.push(finding('warning', 'memory', `${display(ctx, dir, memory.path)} has ${memory.lines} lines and ${memory.size} bytes: Claude Code loads only the first ${MEMORY_LINES} lines or ${MEMORY_BYTES / 1024} KB`, 'move details from MEMORY.md into topic files it links', { file: display(ctx, dir, memory.path), line: memory.lines > MEMORY_LINES ? MEMORY_LINES + 1 : 1, scope: 'project' }));
    }
  }
  out.push(...unloaded(ctx, views, dir, accounted));
  return out.filter((f, i) => out.findIndex((g) => g.message === f.message) === i);
}

// Rule files no chosen agent reads: one an override shadows, AGENTS.md or CLAUDE.md of a project no chosen agent reads
// (an off file was turned off on purpose and counts as read), a file in a Claude Code rules folder that is not Markdown.
function unloaded(ctx, views, dir, accounted) {
  const out = [];
  const ids = views.map((a) => a.id);
  const where = (path) => ({ file: display(ctx, dir, path), line: 1, scope: dir && path.startsWith(`${dir}${sep}`) ? 'project' : 'global' });
  for (const r of views.flatMap((a) => a.rows).filter((x) => x.load === 'shadowed' && !accounted.has(x.path))) {
    out.push(r.owner === 'BenchKeeper'
      ? finding('warning', 'unloaded', `${r.shown} is not read: ${r.by} replaces it, so BenchKeeper's Codex rules do not load`, 'move your notes into the AGENTS.md beside the override, outside the BenchKeeper block, or turn the override off in the Rules view (benchkeeper rules disable)', where(r.path))
      : finding('warning', 'unloaded', `${r.shown} is not read: ${r.by} replaces it`, 'move what you need into the override, or remove the override', where(r.path)));
  }
  if (dir) {
    for (const path of ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'].map((f) => join(dir, f)).filter((p) => exists(p) && !accounted.has(p))) {
      out.push(finding('warning', 'unloaded', `${display(ctx, dir, path)} is read by none of ${views.map((a) => a.name).join(', ')}`, /AGENTS\.md$/.test(path) && ids.includes('claude') ? 'import it from CLAUDE.md with a line @AGENTS.md, unless an agent of the team that is not set up here reads it' : 'leave it when an agent of the team that is not set up here reads it, else remove it', where(path)));
    }
  }
  if (ids.includes('claude')) {
    for (const base of [ctx.home, ...(dir ? [dir] : [])]) {
      const folder = join(base, '.claude/rules');
      if (!isDir(folder)) continue;
      for (const f of readdirSync(folder, { recursive: true }).map(String).filter((n) => !n.endsWith('.md') && !isDir(join(folder, n)))) {
        out.push(finding('warning', 'unloaded', `${display(ctx, dir, join(folder, f))} is not a .md file: Claude Code does not load it`, 'rename it to .md, or move it out of the rules folder', where(join(folder, f))));
      }
    }
  }
  return out;
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

// The findings of the Rules view for Doctor and `rules check`: the global files, or with dir also that project's.
export const rulesChecks = (ctx, { agents, dir, limit } = {}) => rulesView(ctx, { agents, dir, limit }).findings;
