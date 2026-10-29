// Writes the skill tables of docs/skills.md from the SKILL.md front matter of the plugin's skills and from library.json.
// Usage: node .github/scripts/skills-doc.mjs [--check]   (--check: exit 1 when the page differs)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frontMatter } from './skill-lint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const START = '<!-- generated:skills -->';
const END = '<!-- /generated:skills -->';

const row = (cells) => `| ${cells.join(' | ')} |`;
const unquote = (v) => (v ?? '').replace(/^"(.*)"$/, '$1');

// One skill's row fields; the "when" comes from the field of that name, else from the description after its first sentence.
export function skillEntry(text) {
  const fm = frontMatter(text);
  const name = fm?.name;
  const writes = unquote(fm?.writes);
  if (!name || !fm.description || !writes) throw new Error(`${name ?? 'a skill'}: front matter needs name, description and writes`);
  // The first sentence ends at the first period followed by white space or the end.
  const description = unquote(fm.description), end = /\.(?:\s+|$)/.exec(description);
  if (!end) throw new Error(`${name}: the description needs a sentence that ends with a period`);
  const purpose = description.slice(0, end.index + 1), rest = description.slice(end.index + end[0].length);
  const when = unquote(fm.when) || rest;
  if (!when) throw new Error(`${name}: needs a when field or a second sentence in the description`);
  const user = fm['disable-model-invocation'] === 'true';
  const start = user ? `you: \`/benchkeeper:${name}\` (Codex \`$benchkeeper:${name}\`)` : `the agent, or you with \`/benchkeeper:${name}\``;
  return { name, purpose, start, when, writes };
}

export function render(skills, manifest) {
  const out = [row(['Skill', 'What it is for', 'Started by', 'When it runs', 'What it writes']), row(['---', '---', '---', '---', '---'])];
  for (const s of skills) out.push(row([`[${s.name}](../plugins/benchkeeper/skills/${s.name}/SKILL.md)`, s.purpose, s.start, s.when, s.writes]));
  const pack = manifest.packs.find((p) => p.pluginSkills);
  const { version, skills: theirs } = pack.pluginSkills;
  out.push('', `## ${pack.title}`, '', `The \`${pack.id}\` pack installs his plugin (skill list of version ${version}). Skills you start run as \`/mattpocock-skills:<name>\` (Codex \`$mattpocock-skills:<name>\`); the agent starts the others on its own, and you can start them too.`, '');
  out.push(row(['Skill', 'Started by', 'What it does']), row(['---', '---', '---']));
  for (const s of theirs) out.push(row([`\`${s.name}\``, s.user ? 'you' : 'the agent or you', s.does]));
  return out.join('\n');
}

export function update(page, skills, manifest) {
  const a = page.indexOf(START);
  const b = page.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/skills.md needs ${START} and ${END}`);
  return `${page.slice(0, a + START.length)}\n${render(skills, manifest)}\n${page.slice(b)}`;
}

export function sources() {
  const dir = `${root}/plugins/benchkeeper/skills`;
  const skills = readdirSync(dir).sort().map((n) => skillEntry(readFileSync(`${dir}/${n}/SKILL.md`, 'utf8')));
  return [skills, JSON.parse(readFileSync(`${root}/plugins/benchkeeper/library/library.json`, 'utf8'))];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = `${root}/docs/skills.md`;
  const page = readFileSync(file, 'utf8');
  const next = update(page, ...sources());
  if (process.argv[2] === '--check') {
    if (next !== page) {
      console.log('::error::docs/skills.md differs from the skill front matter or library.json: run node .github/scripts/skills-doc.mjs');
      process.exit(1);
    }
  } else writeFileSync(file, next);
}
