// Doctor checks for the files an agent loads as instructions: @imports that point nowhere, files over the size the
// memory documentation recommends, skills whose descriptions overlap across global, plugin and project scope.
// Reads only. A finding names the file and line, never the text of a file the user wrote.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { exists, readText } from './fsx.mjs';
import { overlap } from './packs.mjs';

const MEMORY_DOC = 'https://code.claude.com/docs/en/memory';
const MAX_LINES = 200;
const MAX_HOPS = 4;
const issue = (level, check, message, fix, where) => ({ level, check, message, fix, ...where });

export const frontMatter = (text) => text?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
// The description of a SKILL.md and the line it starts on.
export function skillDescription(text) {
  const front = frontMatter(text);
  const lines = front.split('\n'), at = lines.findIndex((l) => l.startsWith('description:'));
  return { text: at < 0 ? '' : lines[at].slice('description:'.length).trim().replace(/^"|"$/g, ''), line: at + 2 };
}

// Sentence punctuation after a path in prose.
const trimPunctuation = (s) => { let n = s.length; while (n && '.,;:!?)]'.includes(s[n - 1])) n--; return s.slice(0, n); };

// @path imports of a memory file: not inside fenced code blocks or code spans, not in the middle of a word (an e-mail
// address). Claude Code reads a path up to the first space unless the space has a backslash.
// shortcut: only a target that looks like a file (an extension, or a start with ./ ../ / or ~) counts, so @scope/pkg and
// @handle in prose are not errors; an extensionless import is missed, upgrade when one is.
export function importsOf(text) {
  const out = [];
  let fence = null;
  text.split('\n').forEach((raw, i) => {
    const mark = raw.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (mark && (!fence || mark[0] === fence[0])) { fence = fence ? null : mark; return; }
    if (fence) return;
    for (const [, path] of raw.replace(/`[^`]*`/g, '').matchAll(/(?<![^\s])@((?:\\ |\S)+)/g)) {
      const target = trimPunctuation(path);
      if (/^(?:\.{0,2}\/|~)|\.\w+$/.test(target)) out.push({ line: i + 1, target: target.replaceAll('\\ ', ' ') });
    }
  });
  return out;
}

// A path as the report shows it: relative to the project, or from the home folder.
export const display = (ctx, dir, p) => (dir && p.startsWith(`${dir}${sep}`) ? relative(dir, p) : p.startsWith(`${ctx.home}${sep}`) ? join('~', relative(ctx.home, p)) : p);
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
export const markdownIn = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).filter((f) => f.endsWith('.md')).sort().map((f) => join(d, f)) : []);

// The text of a file, or of ctx.draft ({ path, text }) for that path: the checks of a rule file being edited.
export const textOf = (ctx, path) => (ctx.draft?.path === path ? ctx.draft.text : readText(path));

// Files and the files they @import (four hops, inside the project or the home folder), each once.
// file(path, text, hops) sees each readable file; missing(path, line, target) each import that points nowhere.
export function walkInstructions(ctx, dir, roots, { file = () => {}, missing = () => {} } = {}) {
  const seen = new Set();
  const visit = (path, hops) => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = textOf(ctx, path);
    if (text == null) return;
    file(path, text, hops);
    for (const { line, target } of importsOf(text)) {
      const to = target.startsWith('~') ? join(ctx.home, target.slice(1)) : isAbsolute(target) ? target : resolve(dirname(path), target);
      if (!existsSync(to)) missing(path, line, target);
      // An import that leaves the project and the home folder is Claude Code's to approve; it is not read here.
      else if (hops < MAX_HOPS && [dir, ctx.home].some((r) => r && to.startsWith(`${r}${sep}`)) && isFile(to)) visit(to, hops + 1);
    }
  };
  for (const f of roots) visit(f, 0);
}

// Instruction files, imports and size. dir: that project's files; without it the files of the home folder.
export function instructionChecks(ctx, { dir } = {}) {
  const claude = join(dir ?? ctx.home, '.claude');
  const roots = [join(claude, 'CLAUDE.md'), ...(dir ? [join(dir, 'CLAUDE.md'), join(dir, 'CLAUDE.local.md')] : []), ...markdownIn(join(claude, 'rules'))];
  const shown = (p) => display(ctx, dir, p);
  const out = [];
  walkInstructions(ctx, dir, roots, {
    file: (path, text) => {
      const lines = text.replace(/\n$/, '').split('\n').length;
      if (lines > MAX_LINES) out.push(issue('warning', 'instructions', `${shown(path)} has ${lines} lines, ${lines - MAX_LINES} over the ${MAX_LINES} the memory documentation recommends`, `split it into path-scoped rules or skills; imports do not reduce the context cost (${MEMORY_DOC})`, { file: shown(path), line: MAX_LINES + 1 }));
    },
    missing: (path, line, target) => out.push(issue('error', 'instructions', `${shown(path)}:${line} imports ${target}, which does not exist`, `fix the path or remove the import (${MEMORY_DOC})`, { file: shown(path), line })),
  });
  return out;
}

// The enabled Claude Code plugins of the user, from the files the CLI keeps: { id, scope, root, own }.
// With dir, also the plugins installed for that project (scope project or local) and enabled in its settings.
export function activePlugins(ctx, dir) {
  const at = (p) => join(ctx.home, p);
  const enabledIn = (file) => { try { return JSON.parse(readText(file) ?? '{}').enabledPlugins ?? {}; } catch { return {}; } };
  const enabled = { user: enabledIn(at('.claude/settings.json')), project: dir ? enabledIn(join(dir, '.claude/settings.json')) : {}, local: dir ? enabledIn(join(dir, '.claude/settings.local.json')) : {} };
  let installed;
  try { installed = JSON.parse(readText(at('.claude/plugins/installed_plugins.json'))).plugins; } catch { return []; }
  const out = [];
  for (const [id, list] of Object.entries(installed ?? {})) {
    for (const p of Array.isArray(list) ? list.filter((x) => enabled[x.scope]?.[id] === true && (x.scope === 'user' || (dir && x.projectPath && resolve(x.projectPath) === resolve(dir)))) : []) {
      const root = resolve(String(p.installPath));
      if (root.startsWith(at('.claude/plugins') + sep)) out.push({ id, scope: p.scope, root, own: p.scope !== 'user' });
    }
  }
  return out;
}

// Skills those plugins ship.
export function pluginSkills(ctx, dir) {
  const out = [];
  for (const p of activePlugins(ctx, dir)) {
    const root = join(p.root, 'skills');
    if (!exists(root)) continue;
    for (const name of readdirSync(root)) {
      const file = join(root, name, 'SKILL.md'), text = readText(file);
      if (text != null) out.push({ name, scope: `plugin ${p.id.split('@')[0]}`, file, text, own: p.own });
    }
  }
  return out;
}

// Pairs of skills of different scopes whose descriptions overlap, once each, with the file and line of both.
// skills: { name, scope, file, text, own? }; focus: only pairs that involve an own skill, one of the project or of a
// plugin installed for it (a project's pairs among themselves are left to the project check).
export function skillOverlap(ctx, dir, skills, focus) {
  const place = (s) => `${s.name} (${s.scope}, ${display(ctx, dir, s.file)}:${s.d.line})`;
  const list = skills.filter((s, i) => skills.findIndex((x) => x.scope === s.scope && x.name === s.name) === i).map((s) => ({ ...s, d: skillDescription(s.text) }));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (a.scope === b.scope || a.name === b.name || (focus && !a.own && !b.own) || !overlap(a.d.text, b.d.text)) continue;
      out.push(issue('warning', 'skills', `${place(a)} and ${place(b)} have overlapping descriptions`, 'narrow one description so an agent can tell them apart, or turn one skill off', { file: display(ctx, dir, a.file), line: a.d.line }));
    }
  }
  return out;
}
