// Static checks of skill collections against Anthropic's skill authoring guide
// (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
// Usage: node bench/scripts/skill-lint.mjs [--md] <collection>=<dir> ...   prints JSON, or a Markdown summary with --md.
// Each SKILL.md under <dir> is one skill (copies for other agents under `.openclaw/`, `.opencode/`, `.codex/`, and
// `node_modules/` are skipped).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHECKS = ['name-valid', 'desc-length', 'desc-xml', 'desc-third-person', 'desc-when', 'body-lines', 'nested-refs',
  'ref-toc', 'dated-text', 'mcp-qualified', 'windows-paths'];
const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December)';
const DATED = new RegExp(`\\b20\\d\\d-\\d\\d-\\d\\d\\b|\\b${MONTH} 20\\d\\d\\b|\\b(as of|before|after|since|until) (20\\d\\d|${MONTH})\\b`, 'i');
// shortcut: these three are heuristics (first or second person, a trigger clause, an MCP tool named without its server);
// the Opus review in the results document judges the same points by reading.
const FIRST_PERSON = /^\s*(I|I'm|I'll|You|We)\b|\bI (can|will)\b|\byou can use this\b/i;
const WHEN = /\b(use|used|invoke|invoked|trigger|triggers|run|load|apply)\b[^.]{0,60}\b(when|whenever|before|after|if|for|on|during)\b|\bwhen (the user|you|working|asked|a|an|the)\b/i;

function walk(dir, out = []) {
  // Symlinks are skipped: a link into the image's filesystem dangles here, and one to a parent would loop.
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink() || ['node_modules', '.git', '.openclaw', '.opencode', '.codex'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
}

// Front matter with plain, quoted and block (`>`, `|`) values; enough for name and description.
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { fields: {}, body: text };
  const fields = {}; const ls = m[1].split(/\r?\n/);
  for (let i = 0; i < ls.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(ls[i]); if (!kv) continue;
    let v = kv[2].trim();
    if (/^[>|][-+]?$/.test(v)) { const block = []; while (i + 1 < ls.length && /^(\s+|$)/.test(ls[i + 1])) block.push(ls[++i].trim()); v = block.join(v[0] === '>' ? ' ' : '\n').trim(); }
    else { while (i + 1 < ls.length && /^\s+\S/.test(ls[i + 1])) v += ` ${ls[++i].trim()}`; v = v.replace(/^(["'])([\s\S]*)\1$/, '$2'); }
    fields[kv[1]] = v;
  }
  return { fields, body: m[2] };
}

const localLinks = (text, from) => [...text.matchAll(/\]\(([^)#\s]+\.md)(#[^)]*)?\)/g)].map((x) => x[1])
  .filter((l) => !/^[a-z]+:/i.test(l)).map((l) => resolve(dirname(from), l)).filter((p) => existsSync(p) && statSync(p).isFile());
const hasToc = (text) => { const head = text.split('\n').slice(0, 40).join('\n');
  return /^#+\s*(contents|table of contents)\b/im.test(head) || (head.match(/^\s*[-*] \[[^\]]+\]\(#/gm) || []).length >= 3; };

export function lintSkill(file) {
  const text = readFileSync(file, 'utf8'); const dir = dirname(file);
  const { fields, body: raw } = frontMatter(text);
  const body = raw.replace(/\n+$/, '');
  const name = fields.name || dir.split('/').pop(); const desc = fields.description || '';
  const refs = walk(dir).filter((p) => p.endsWith('.md') && p !== file);
  const failed = [];
  if (!/^[a-z0-9-]{1,64}$/.test(name) || /anthropic|claude/.test(name)) failed.push('name-valid');
  if (!desc || desc.length > 1024) failed.push('desc-length');
  if (/<[A-Za-z/][^>]*>/.test(desc)) failed.push('desc-xml');
  if (FIRST_PERSON.test(desc)) failed.push('desc-third-person');
  // A skill only the user invokes is never picked by its description, so it needs no trigger clause.
  if (fields['disable-model-invocation'] !== 'true' && !WHEN.test(desc)) failed.push('desc-when');
  if (body.split('\n').length > 500) failed.push('body-lines');
  // Nested: a reference that sends the reader to a further file SKILL.md does not link itself.
  const direct = new Set([file, ...localLinks(body, file)]);
  if ([...direct].slice(1).some((r) => localLinks(readFileSync(r, 'utf8'), r).some((n) => !direct.has(n)))) failed.push('nested-refs');
  if (refs.some((r) => { const t = readFileSync(r, 'utf8'); return t.split('\n').length > 100 && !hasToc(t); })) failed.push('ref-toc');
  // Dates inside fenced code are sample data, not time-sensitive instructions.
  if (DATED.test(body.replace(/^```[\s\S]*?^```/gm, ''))) failed.push('dated-text');
  if (body.split('\n').some((l) => /\bMCP\b/.test(l) && /`(?!mcp__)[a-z]+(_[a-z]+)+`/.test(l))) failed.push('mcp-qualified');
  if (/\b[\w.-]+\\[\w.-]+\.[A-Za-z]{1,4}\b/.test(body)) failed.push('windows-paths');
  return { dir: dir.split('/').pop(), name, desc_chars: desc.length, body_lines: body.split('\n').length, failed };
}

export function lintCollection(collection, root) {
  const files = walk(root);
  const skills = files.filter((p) => p.endsWith('/SKILL.md')).sort().map((f) => ({ ...lintSkill(f), path: relative(root, f) }));
  const gerund = skills.filter((s) => /^[a-z]+ing(-|$)/.test(s.name)).length;
  return { collection, skills, naming: `gerund ${gerund} of ${skills.length}`,
    evals: files.some((p) => /(^|\/)(evals?|evaluations?)(\/|\.json$)/.test(relative(root, p))) };
}

export function summary(cols) {
  const head = ['| Collection | Skills | Checks passed | Naming | Evaluations | Failures per check |', '|---|---|---|---|---|---|'];
  return [...head, ...cols.map((c) => {
    const n = c.skills.length * CHECKS.length; const f = c.skills.reduce((a, s) => a + s.failed.length, 0);
    const per = CHECKS.map((k) => [k, c.skills.filter((s) => s.failed.includes(k)).length]).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
    return `| ${c.collection} | ${c.skills.length} | ${n ? Math.round(100 * (n - f) / n) : 0}% | ${c.naming} | ${c.evals ? 'yes' : 'no'} | ${per || 'none'} |`;
  })].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2); const md = args[0] === '--md';
  const cols = args.slice(md ? 1 : 0).map((a) => { const i = a.indexOf('='); return lintCollection(a.slice(0, i), a.slice(i + 1)); });
  console.log(md ? summary(cols) : JSON.stringify(cols, null, 2));
}
