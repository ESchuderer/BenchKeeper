// Doctor checks for the files an agent loads as instructions: @imports that point nowhere, files over the size the
// memory documentation recommends, skills whose descriptions overlap across global, plugin and project scope.
// Reads only. A finding names the file and line, never the text of a file the user wrote.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { exists, readText } from './fsx.mjs';
import { overlap } from './packs.mjs';

export const MEMORY_DOC = 'https://code.claude.com/docs/en/memory';
const MAX_LINES = 200;
const MAX_HOPS = 4;
const issue = (level, check, message, fix, where) => ({ level, check, message, fix, ...where });

const frontMatter = (text) => text?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
// The description of a SKILL.md and the line it starts on.
export function skillDescription(text) {
  const front = frontMatter(text);
  const at = front.split('\n').findIndex((l) => /^description:/.test(l));
  return { text: front.match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? '', line: at + 2 };
}

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
      const target = path.replace(/[.,;:!?)\]]+$/, '');
      if (/^(?:\.{0,2}\/|~)|\.\w+$/.test(target)) out.push({ line: i + 1, target: target.replaceAll('\\ ', ' ') });
    }
  });
  return out;
}

// A path as the report shows it: relative to the project, or from the home folder.
const display = (ctx, dir, p) => (dir && p.startsWith(`${dir}${sep}`) ? relative(dir, p) : p.startsWith(`${ctx.home}${sep}`) ? join('~', relative(ctx.home, p)) : p);
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const markdownIn = (d) => (existsSync(d) ? readdirSync(d, { recursive: true }).filter((f) => f.endsWith('.md')).sort().map((f) => join(d, f)) : []);

// Instruction files, imports and size. dir: that project's files; without it the files of the home folder.
export function instructionChecks(ctx, { dir } = {}) {
  const claude = join(dir ?? ctx.home, '.claude');
  const roots = [join(claude, 'CLAUDE.md'), ...(dir ? [join(dir, 'CLAUDE.md'), join(dir, 'CLAUDE.local.md')] : []), ...markdownIn(join(claude, 'rules'))];
  const shown = (p) => display(ctx, dir, p);
  const out = [], seen = new Set();
  const visit = (file, hops) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readText(file);
    if (text == null) return;
    const lines = text.replace(/\n$/, '').split('\n').length;
    if (lines > MAX_LINES) out.push(issue('warning', 'instructions', `${shown(file)} has ${lines} lines, ${lines - MAX_LINES} over the ${MAX_LINES} the memory documentation recommends`, `split it into path-scoped rules or skills; imports do not reduce the context cost (${MEMORY_DOC})`, { file: shown(file), line: MAX_LINES + 1 }));
    for (const { line, target } of importsOf(text)) {
      const path = target.startsWith('~') ? join(ctx.home, target.slice(1)) : isAbsolute(target) ? target : resolve(dirname(file), target);
      if (!existsSync(path)) out.push(issue('error', 'instructions', `${shown(file)}:${line} imports ${target}, which does not exist`, `fix the path or remove the import (${MEMORY_DOC})`, { file: shown(file), line }));
      // An import that leaves the project and the home folder is Claude Code's to approve; it is not read here.
      else if (hops < MAX_HOPS && [dir, ctx.home].some((r) => r && path.startsWith(`${r}${sep}`)) && isFile(path)) visit(path, hops + 1);
    }
  };
  for (const f of roots) visit(f, 0);
  return out;
}

// Skills the enabled Claude Code plugins of the user ship, from the files the CLI keeps.
export function pluginSkills(ctx) {
  const at = (p) => join(ctx.home, p);
  let installed, enabled;
  try { installed = JSON.parse(readText(at('.claude/plugins/installed_plugins.json'))).plugins; enabled = JSON.parse(readText(at('.claude/settings.json')) ?? '{}').enabledPlugins ?? {}; } catch { return []; }
  const out = [];
  for (const [id, list] of Object.entries(installed ?? {})) {
    for (const p of enabled[id] === true && Array.isArray(list) ? list.filter((x) => x.scope === 'user') : []) {
      const root = join(String(p.installPath), 'skills');
      if (!resolve(root).startsWith(at('.claude/plugins') + sep) || !exists(root)) continue;
      for (const name of readdirSync(root)) {
        const file = join(root, name, 'SKILL.md'), text = readText(file);
        if (text != null) out.push({ name, scope: `plugin ${id.split('@')[0]}`, file, text });
      }
    }
  }
  return out;
}

// Pairs of skills of different scopes whose descriptions overlap, once each, with the file and line of both.
// skills: { name, scope, file, text }; focus: only pairs that involve this scope (a project's own pairs are left to
// the project check).
export function skillOverlap(ctx, dir, skills, focus) {
  const place = (s) => `${s.name} (${s.scope}, ${display(ctx, dir, s.file)}:${s.d.line})`;
  const list = skills.filter((s, i) => skills.findIndex((x) => x.scope === s.scope && x.name === s.name) === i).map((s) => ({ ...s, d: skillDescription(s.text) }));
  const out = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a, b] = [list[i], list[j]];
      if (a.scope === b.scope || a.name === b.name || (focus && a.scope !== focus && b.scope !== focus) || !overlap(a.d.text, b.d.text)) continue;
      out.push(issue('warning', 'skills', `${place(a)} and ${place(b)} have overlapping descriptions`, 'narrow one description so an agent can tell them apart, or turn one skill off', { file: display(ctx, dir, a.file), line: a.d.line }));
    }
  }
  return out;
}
