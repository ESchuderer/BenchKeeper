// Writes the README blocks generated from src/data/facts.json. `--check` fails when the README is out of date.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const facts = JSON.parse(readFileSync(new URL('web/src/data/facts.json', root), 'utf8'));
const readmeUrl = new URL('README.md', root);
const readme = readFileSync(readmeUrl, 'utf8');
const nl = readme.includes('\r\n') ? '\r\n' : '\n';

// `|` would end a table cell.
const cell = (s) => s.replace(/\|/g, '\\|');
const link = (name, url) => `[${cell(name)}](${url.replace(/\|/g, '%7C')})`;

const blocks = {
  description: [facts.description],
  core: [`**Optional: [${facts.core.name}](${facts.core.url}) by ${facts.core.by}:** ${facts.core.role}.`],
  prerequisites: [
    '| Tool | Needed for |',
    '|---|---|',
    ...facts.prerequisites.map((p) => `| ${link(p.name, p.url)} | ${cell(p.for)} |`),
  ],
  tools: [
    '| Tool | Platforms | Gives you | Choose it when |',
    '|---|---|---|---|',
    ...facts.parallelTools.map((t) => `| ${link(t.name, t.url)} | ${cell(t.platforms)} | ${cell(t.points.join('; '))} | ${cell(t.when)} |`),
  ],
  openhands: [
    `**Unattended or isolated runs: [${facts.openhands.name}](${facts.openhands.url}).** ${facts.openhands.summary}`,
    '',
    ...facts.openhands.points.map((p) => `- ${p}`),
  ],
};

let out = readme;
for (const [name, lines] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- generated:${name} -->\\r?\\n)[\\s\\S]*?(\\r?\\n<!-- /generated:${name} -->)`);
  if (!re.test(out)) throw new Error(`README marker missing: ${name}`);
  // A function replacement keeps `$` in facts literal.
  out = out.replace(re, (_, start, end) => `${start}${lines.join(nl)}${end}`);
}

if (process.argv.includes('--check')) {
  if (out !== readme) {
    console.error('README.md is out of date: run `node web/scripts/readme.mjs`');
    process.exit(1);
  }
} else {
  writeFileSync(readmeUrl, out);
}
