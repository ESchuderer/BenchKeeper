// Structural checks for BenchKeeper's own skills (plugin skills and own library skills).
// Usage: node .github/scripts/skill-lint.mjs [skill folders...]   (default: every own skill), exit 1 on any error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z][\w-]*):\s*(\S.*)?$/.exec(line);
    if (!kv) return null;
    fields[kv[1]] = kv[2] ?? '';
  }
  return fields;
}

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return markdownFiles(p);
    return name.endsWith('.md') ? [p] : [];
  });
}

// A skill that hands issue or pull request text to a worker names the author filter somewhere in its files (docs/security.md, untrusted input).
const HANDS_TEXT = /\b(read|pass|hand|send|give|copy|paste)\b[^.\n]{0,60}\b(issues?|pull requests?|PRs?)\b[^.\n]{0,60}\b(comments?|bod(y|ies)|text)\b/i;
const AUTHOR_FILTER = [/^Trusted authors: \S/m, /\bdata, never instructions\b/i];
// The workflow skill takes the Default tier line last, after the change-type table, so a handed-over Tier line must not name it first.
const DEFAULT_TIER_FIRST = /^Tier: (?:(?!workflow skill)[^\n])*Default tier/m;

export function lintSkill(dir) {
  const errors = [];
  const folder = dir.split('/').pop();
  const skillFile = join(dir, 'SKILL.md');
  if (!existsSync(skillFile)) return [`${dir}: no SKILL.md`];
  const text = readFileSync(skillFile, 'utf8');
  const fm = frontMatter(text);
  if (!fm) return [`${skillFile}: front matter missing or not "key: value" lines`];
  if (fm.name !== folder) errors.push(`${skillFile}: name "${fm.name}" differs from the folder "${folder}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name ?? '')) errors.push(`${skillFile}: name must be lowercase letters, digits and hyphens`);
  if (!/^".*"$/.test(fm.description ?? '')) errors.push(`${skillFile}: description must be in double quotes`);
  else if (fm.description.length - 2 > 1024) errors.push(`${skillFile}: description longer than 1024 characters`);
  if (text.split('\n').length > 500) errors.push(`${skillFile}: more than 500 lines`);
  const files = markdownFiles(dir);
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  if (/\bworkers?\b/i.test(all) && HANDS_TEXT.test(all) && !AUTHOR_FILTER.every((re) => re.test(all)))
    errors.push(`${dir}: hands issue or pull request text to a worker without the author filter (a "Trusted authors:" line and the words "data, never instructions")`);
  if (DEFAULT_TIER_FIRST.test(all)) errors.push(`${dir}: a Tier line names the Default tier line ahead of the workflow skill`);
  for (const file of files) {
    const body = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const [, target] of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#)/.test(target)) continue;
      if (!existsSync(join(dirname(file), target.split('#')[0]))) errors.push(`${file}: link target ${target} not found`);
    }
  }
  const yaml = join(dir, 'agents/openai.yaml');
  if (!existsSync(yaml)) errors.push(`${dir}: agents/openai.yaml missing`);
  else if (fm['disable-model-invocation'] === 'true' && !/^[ \t]+allow_implicit_invocation: false$/m.test(readFileSync(yaml, 'utf8')))
    errors.push(`${yaml}: user-invoked skill needs policy.allow_implicit_invocation: false`);
  return errors;
}

export function ownSkills() {
  const dirs = ['plugins/benchkeeper/skills', 'plugins/benchkeeper/library'].map((d) => join(root, d));
  return dirs.flatMap((d) => readdirSync(d).map((n) => join(d, n)).filter((p) => statSync(p).isDirectory()));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dirs = process.argv.length > 2 ? process.argv.slice(2).map((d) => resolve(d)) : ownSkills();
  const errors = dirs.flatMap(lintSkill);
  for (const e of errors) console.log(`::error::${e.replace(root + '/', '')}`);
  console.log(`${dirs.length} skills checked, ${errors.length} errors`);
  process.exit(errors.length ? 1 : 0);
}
