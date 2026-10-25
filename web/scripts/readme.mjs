// Writes the README blocks generated from src/data/facts.json. `--check` fails when the README is out of date.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const facts = JSON.parse(readFileSync(new URL('web/src/data/facts.json', root), 'utf8'));

// `|` would end a table cell.
const cell = (s) => s.replace(/\|/g, '\\|');
const link = (name, url) => `[${cell(name)}](${url.replace(/\|/g, '%7C')})`;

// Install paths as headed blocks (GitHub Markdown has no tabs). `readme` is the prefix of links into the root README.
const quickstart = (readme) => {
  const q = facts.quickstart;
  return [
    `${q.needs.replace(/\.$/, '')} ([full list](${readme}#prerequisites)). ${q.choose}`,
    '',
    ...q.paths.flatMap((p) => [
      `### ${p.name}`,
      '',
      ...p.steps.flatMap((s) => ['```sh', s.command, '```', '', s.text, '']),
    ]),
    `${q.next} ${q.changes}`,
    '',
    q.links.map((l) => `[${l.label}](${readme}#${l.anchor})`).join('. ') + '.',
  ];
};

const blocks = {
  quickstart: quickstart(''),
  description: [facts.description],
  core: [`**Optional: [${facts.core.name}](${facts.core.url}) by ${facts.core.by}:** ${facts.core.role}.`],
  levels: [
    '| Level | Contains | Writes | Command |',
    '|---|---|---|---|',
    ...facts.levels.map((l) => `| ${l.name} | ${cell(l.contains)} | ${cell(l.writes)} | \`${cell(l.command)}\` |`),
  ],
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
  frameworks: [
    facts.frameworks.rule,
    '',
    '| Framework | Role | Installs | Evaluation |',
    '|---|---|---|---|',
    ...facts.frameworks.items.map((f) => `| ${link(f.name, f.url)} | ${cell(f.role)} | ${cell(f.installs)} | [${cell(f.evaluation.split('/').pop())}](${f.evaluation}) |`),
  ],
  openhands: [
    `**Unattended or isolated runs: [${facts.openhands.name}](${facts.openhands.url}).** ${facts.openhands.summary}`,
    '',
    ...facts.openhands.points.map((p) => `- ${p}`),
  ],
};

// The root README holds every block, app/README.md only the quickstart.
const targets = [
  ['README.md', blocks],
  ['app/README.md', { quickstart: quickstart('../README.md') }],
];
let stale = false;
for (const [file, wanted] of targets) {
  const url = new URL(file, root);
  const readme = readFileSync(url, 'utf8');
  const nl = readme.includes('\r\n') ? '\r\n' : '\n';
  let out = readme;
  for (const [name, lines] of Object.entries(wanted)) {
    const re = new RegExp(`(<!-- generated:${name} -->\\r?\\n)[\\s\\S]*?(\\r?\\n<!-- /generated:${name} -->)`);
    if (!re.test(out)) throw new Error(`${file} marker missing: ${name}`);
    // A function replacement keeps `$` in facts literal.
    out = out.replace(re, (_, start, end) => `${start}${lines.join(nl)}${end}`);
  }
  if (out === readme) continue;
  if (process.argv.includes('--check')) {
    console.error(`${file} is out of date: run \`node web/scripts/readme.mjs\``);
    stale = true;
  } else writeFileSync(url, out);
}
if (stale) process.exit(1);
