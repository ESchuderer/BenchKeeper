// Writes the README blocks generated from src/data/facts.json. `--check` fails when the README is out of date.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const facts = JSON.parse(readFileSync(new URL('web/src/data/facts.json', root), 'utf8'));
const readmeUrl = new URL('README.md', root);
const readme = readFileSync(readmeUrl, 'utf8');

const blocks = {
  prerequisites: [
    '| Tool | Needed for |',
    '|---|---|',
    ...facts.prerequisites.map((p) => `| [${p.name}](${p.url}) | ${p.for} |`),
  ],
  tools: [
    '| Tool | Platforms | Gives you | Choose it when |',
    '|---|---|---|---|',
    ...facts.parallelTools.map((t) => `| [${t.name}](${t.url}) | ${t.platforms} | ${t.points.join('; ')} | ${t.when} |`),
  ],
  openhands: facts.openhands.points.map((p) => `- ${p}`),
};

let out = readme;
for (const [name, lines] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- generated:${name} -->\\n)[\\s\\S]*?(\\n<!-- /generated:${name} -->)`);
  if (!re.test(out)) throw new Error(`README marker missing: ${name}`);
  out = out.replace(re, `$1${lines.join('\n')}$2`);
}

if (process.argv.includes('--check')) {
  if (out !== readme) {
    console.error('README.md is out of date: run `node web/scripts/readme.mjs`');
    process.exit(1);
  }
} else {
  writeFileSync(readmeUrl, out);
}
