// Writes the catalog tables of plugins/benchkeeper/library/README.md from library.json.
// Usage: node .github/scripts/library-readme.mjs [--check]   (--check: exit 1 when the README differs)
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const lib = resolve(dirname(fileURLToPath(import.meta.url)), '../../plugins/benchkeeper/library');
const START = '<!-- generated:catalog -->';
const END = '<!-- /generated:catalog -->';

const code = (names) => names.map((n) => `\`${n}\``).join(', ');
const agents = (a) => (a === 'codex' ? 'Codex only' : 'both');
const row = (cells) => `| ${cells.join(' | ')} |`;

export function render(manifest) {
  const out = [];
  for (const section of manifest.sections) {
    const skills = manifest.skills.filter((s) => s.section === section.id);
    out.push(`## ${section.title}`, '');
    if (section.note) out.push(section.note, '');
    if (section.id === 'own') {
      out.push(row(['Skill', 'Pick when', '`paths`', 'Pointer line']), row(['---', '---', '---', '---']));
      for (const s of skills) out.push(row([`[${s.name}](${s.name}/SKILL.md)`, s.pickWhen, s.paths, s.pointer]));
    } else {
      // Skills with the same source, agents and pick-when text share one row.
      const groups = new Map();
      for (const s of skills) {
        const key = [s.set, s.source, s.agents, s.pickWhen].join('\0');
        groups.set(key, [...(groups.get(key) ?? []), s]);
      }
      out.push(row(['Skills', 'Source (license)', 'Agents', 'Pick when']), row(['---', '---', '---', '---']));
      for (const g of groups.values()) {
        const s = g[0];
        const label = (s.set ? `${s.set}: ` : '') + code(g.map((x) => x.name));
        out.push(row([label, `\`${s.source}\`${s.license ? ` (${s.license})` : ''}`, agents(s.agents), s.pickWhen]));
      }
    }
    out.push('');
  }
  out.push('## Packs', '', 'Named selections that project setup proposes when "Pick when" matches. A pack with a plugin installs through the agent\'s plugin command; its prompts are the steps the user starts after installing.', '');
  out.push(row(['Pack', 'Contents', 'Pick when']), row(['---', '---', '---']));
  for (const p of manifest.packs) {
    const parts = [];
    if (p.skills) parts.push(code(p.skills));
    if (p.plugins) parts.push(`plugins ${code(Object.values(p.plugins).map((x) => x.id))}`);
    if (p.prompts) parts.push(`then ${p.prompts.map((x) => `\`${x.claude}\`${x.codex ? ` (Codex \`${x.codex}\`)` : ''}`).join(', ')}`);
    out.push(row([`\`${p.id}\`${p.role ? ` (${p.role})` : ''}`, parts.join('; '), p.pickWhen]));
  }
  out.push('', '## Sources', '', 'Agent files a project picks one by one (`--agent-file <path>`), fetched at a pinned commit.', '');
  out.push(row(['Source', 'Agent files', 'Evaluation']), row(['---', '---', '---']));
  for (const f of manifest.sources ?? []) {
    const i = f.install;
    out.push(row([`\`${f.id}\``, `\`${i.source}\` at \`${i.ref.slice(0, 12)}\`: ${code(i.files.map((x) => x.path.split('/').pop().replace(/\.md$/, '')))}${f.limits ? `. ${f.limits}` : ''}`, `[${f.evaluation.split('/').pop()}](${f.evaluation})`]));
  }
  return out.join('\n');
}

export function update(readme, manifest) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error(`README needs ${START} and ${END}`);
  return `${readme.slice(0, a + START.length)}\n${render(manifest)}\n${readme.slice(b)}`;
}

// Node runs the main module from its real path but leaves process.argv[1] as given (macOS /var is /private/var).
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const manifest = JSON.parse(readFileSync(`${lib}/library.json`, 'utf8'));
  const readme = readFileSync(`${lib}/README.md`, 'utf8');
  const next = update(readme, manifest);
  if (process.argv[2] === '--check') {
    if (next !== readme) {
      console.log('::error::plugins/benchkeeper/library/README.md differs from library.json: run node .github/scripts/library-readme.mjs');
      process.exit(1);
    }
  } else writeFileSync(`${lib}/README.md`, next);
}
