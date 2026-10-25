// Doctor: allow rules that reach further than a person usually remembers. Information only: it reads settings and rule
// files, edits none and proposes no rule. BenchKeeper follows the agents' own defaults (auto mode) and adds no ask rules.
import { existsSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { readText } from './fsx.mjs';
import { listProjects } from './projects.mjs';
import { readSettings, redact } from './settings.mjs';

const DOC = 'https://code.claude.com/docs/en/permissions';
const CODEX_DOC = 'https://developers.openai.com/codex/rules';
const SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'python', 'python3', 'node', 'npx', 'perl', 'ruby', 'deno', 'bun', 'php']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
// Other tools whose bare name allows every path or domain; a bare Read or MCP tool is the usual way to allow them.
const WIDE_TOOLS = new Set(['Edit', 'Write', 'WebFetch']);
// Flags that take code as the argument: a rule that allows any such argument allows any code.
const CODE_FLAGS = new Set(['-c', '-e', '-p', '-lc', '-ic', '-ec', '--eval', '--command']);
const runsAnyCode = (words) => SHELLS.has(basename(words[0])) && words.includes('*') && words.slice(1, words.indexOf('*')).every((w) => CODE_FLAGS.has(w));

// null for a safe rule, else { level, why } for a Claude Code rule such as Bash(*) or Bash(python *).
export function classify(rule) {
  const m = typeof rule === 'string' ? rule.trim().match(/^([A-Za-z_][\w.-]*)(?:\((.*)\))?$/) : null;
  if (!m) return null;
  const [, tool, spec] = m;
  if (spec === undefined || spec.trim() === '*') return SHELL_TOOLS.has(tool) ? { level: 'warning', why: `every ${tool} call` } : WIDE_TOOLS.has(tool) ? { level: 'info', why: `every ${tool} call` } : null;
  if (!SHELL_TOOLS.has(tool)) return null;
  // The documented :* suffix is a trailing wildcard.
  const words = spec.replace(/:\*$/, ' *').trim().split(/\s+/);
  if (words[0].includes('*')) return { level: 'warning', why: 'any program' };
  if (runsAnyCode(words)) return { level: 'warning', why: `${words[0]} runs any code` };
  if (words.slice(1, -1).some((w) => w.includes('*'))) return { level: 'info', why: 'a wildcard before the rest of the command' };
  return null;
}

// Codex rules: prefix_rule(pattern = [...], decision = ...) with allow (the default) for a shell or interpreter and no argument but a code flag.
// shortcut: a regex over the file, not a Starlark parser; a pattern built from variables is not seen.
export function codexAllows(text) {
  const out = [];
  const code = text.replace(/^\s*#.*$/gm, '');
  for (const m of code.matchAll(/prefix_rule\s*\(([\s\S]*?)(?=prefix_rule\s*\(|$)/g)) {
    const pattern = m[1].match(/pattern\s*=\s*(\[(?:[^[\]]|\[[^\]]*\])*\])/)?.[1];
    const decision = m[1].match(/decision\s*=\s*["'](\w+)["']/)?.[1] ?? 'allow';
    if (!pattern || decision !== 'allow') continue;
    const first = pattern.match(/^\[\s*(?:\[([^\]]*)\]|(["'][^"']*["']))((?:\s*,\s*["'][^"']*["'])*)\s*,?\s*\]$/);
    const programs = (first?.[1] ?? first?.[2] ?? '').match(/[^"',\s]+/g) ?? [];
    const rest = (first?.[3] ?? '').match(/[^"',\s]+/g) ?? [];
    if (programs.some((p) => SHELLS.has(basename(p))) && rest.every((w) => CODE_FLAGS.has(w))) out.push({ rule: `pattern = ${pattern.replace(/\s+/g, ' ')}`, line: code.slice(0, m.index).split('\n').length, why: `${programs.join(' or ')} runs any code`, level: 'warning' });
  }
  return out;
}

// Allow rules of one file set: [{ scope, file, rule, line?, level, why, agent }].
function rulesIn(ctx, dir) {
  const shown = (p) => (dir ? relative(dir, p) : join('~', relative(ctx.home, p)));
  const out = [];
  const layers = readSettings(ctx, 'claude', { dir }).filter((l) => !l.error && l.layer !== 'managed' && (dir ? l.layer !== 'user' : l.layer === 'user'));
  for (const l of layers) {
    // autoMode.allow and autoMode.environment hold prose for the classifier, not tool patterns, so they are not read.
    for (const rule of Array.isArray(l.data.permissions?.allow) ? l.data.permissions.allow : []) {
      const c = classify(rule);
      if (c) out.push({ agent: 'Claude Code', scope: l.layer, file: shown(l.path), rule: redact(rule), ...c });
    }
  }
  const folder = join(dir ?? ctx.home, '.codex/rules');
  for (const f of existsSync(folder) ? readdirSync(folder).filter((n) => n.endsWith('.rules')).sort() : []) {
    for (const { rule, ...c } of codexAllows(readText(join(folder, f)) ?? '')) out.push({ agent: 'Codex', scope: dir ? 'project' : 'user', file: shown(join(folder, f)), rule: redact(rule), ...c });
  }
  return out;
}

// Findings for the allow rules of the user files, or with dir of that project's files; each says how many registered
// repositories carry the same rule in a project or local file.
export function allowChecks(ctx, { agents = ['claude', 'codex'], dir } = {}) {
  const keep = (r) => agents.includes(r.agent === 'Codex' ? 'codex' : 'claude');
  const carried = new Map();
  for (const p of listProjects(ctx)) for (const k of new Set(rulesIn(ctx, p.path).filter(keep).map((r) => `${r.agent}\n${r.rule}`))) carried.set(k, (carried.get(k) ?? 0) + 1);
  return rulesIn(ctx, dir).filter(keep).map((r) => {
    const repos = carried.get(`${r.agent}\n${r.rule}`) ?? 0;
    return { level: r.level, check: 'allow-rules', message: `${r.agent} allows ${r.rule} (${r.scope}, ${r.file}${r.line ? `:${r.line}` : ''}): ${r.why}${repos ? `; ${repos} registered ${repos === 1 ? 'repository carries' : 'repositories carry'} it` : ''}`,
      fix: `information only, nothing is changed: edit ${r.file} if the rule is wider than you want (${r.agent === 'Codex' ? CODEX_DOC : DOC})`, file: r.file, ...(r.line ? { line: r.line } : {}), scope: r.scope, rule: r.rule, repos };
  });
}
