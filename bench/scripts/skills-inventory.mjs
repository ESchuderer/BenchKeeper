// Skills inventory (#36): the skills each framework adds (the arm's init skills minus the plain arm's), with phase, size
// and description from the installed SKILL.md, and in how many saved trials each skill fired (workflow.skills).
// Usage: node bench/scripts/skills-inventory.mjs <skill-files.json from skills-inventory.sh> <results-dir>   prints Markdown
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { phaseOfSkill } from './phases.mjs';

// Framework, its arm, and the arm whose skills are subtracted besides the plain arm A.
export const FRAMEWORKS = [
  ['agent-skills', 'F'], ['Superpowers', 'G'], ['ECC', 'H'], ['Matt Pocock', 'V'], ['Ponytail', 'B'],
  ['OpenSpec', 'AB'], ['Spec Kit', 'AC'], ['BenchKeeper layer (with agent-skills)', 'L', 'F'],
];

const fixture = (dir, arm) => readFileSync(join(dir, `init-${arm}.jsonl`), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).find((e) => e.subtype === 'init')?.skills || [];
const short = (name) => String(name).split(':').pop();
const firstSentence = (s) => { const t = String(s).replace(/\s*—\s*/g, ', ').split(/(?<=\.)\s/)[0]; return t.length > 140 ? `${t.slice(0, 137)}...` : t; };

export function inventory(files, fixtures) {
  const base = new Set(fixture(fixtures, 'A'));
  return FRAMEWORKS.flatMap(([framework, arm, minus]) => {
    const drop = new Set([...base, ...(minus ? fixture(fixtures, minus) : [])]);
    const names = [...new Set(fixture(fixtures, arm).filter((n) => !drop.has(n)))].sort();
    return names.map((name) => {
      const f = (files[arm] || []).find((x) => x.dir === short(name) || x.name === short(name));
      return { framework, skill: name, phase: phaseOfSkill(name) || 'other', tokens: f ? Math.round(f.bytes / 4) : null, description: f ? firstSentence(f.description) : '' };
    });
  });
}

// Skills available per arm (short names): Claude Code init fixtures, OpenCode resolved skills.
export function available(fixtures) {
  const out = {};
  for (const f of readdirSync(fixtures)) {
    const cc = /^init-([A-Z]+)\.jsonl$/.exec(f), oc = /^opencode-([A-Z]+)$/.exec(f);
    if (cc) out[cc[1]] = new Set(fixture(fixtures, cc[1]).map(short));
    if (oc && existsSync(join(fixtures, f, 'opencode-skills.json'))) out[oc[1]] = new Set(JSON.parse(readFileSync(join(fixtures, f, 'opencode-skills.json'), 'utf8')).map((s) => s.name));
  }
  return out;
}

// The skills that fired in each saved trial, by short name (trials name skills with or without the plugin prefix).
export function usage(results) {
  const fired = [];
  if (!existsSync(results)) return fired;
  for (const run of readdirSync(results)) {
    for (const round of existsSync(join(results, run, 'manifest.txt')) ? readdirSync(join(results, run)).filter((d) => /^round-/.test(d)) : []) {
      for (const arm of readdirSync(join(results, run, round))) {
        const f = join(results, run, round, arm, 'trial.json');
        if (!existsSync(f)) continue;
        fired.push({ arm, skills: new Set((JSON.parse(readFileSync(f, 'utf8')).workflow?.skills || []).map(short)) });
      }
    }
  }
  return fired;
}

// Fired: trials whose arm had the skill and in which it fired, of the trials whose arm had it.
export function table(rows, trials, avail) {
  const count = (s) => { const has = trials.filter((t) => avail[t.arm]?.has(short(s))); return `${has.filter((t) => t.skills.has(short(s))).length} of ${has.length}`; };
  return ['| Framework | Skill | Phase | Tokens | Fired in trials | Description |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.framework} | \`${r.skill}\` | ${r.phase} | ${r.tokens ?? 'n/a'} | ${count(r.skill)} | ${r.description.replace(/\|/g, '\\|')} |`)].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filesPath, results] = process.argv.slice(2);
  const rows = inventory(JSON.parse(readFileSync(filesPath, 'utf8')), new URL('./fixtures/', import.meta.url).pathname);
  const trials = usage(results), avail = available(new URL('./fixtures/', import.meta.url).pathname);
  // Per framework: skills, total tokens, skills that fired in at least one trial of an arm that had them.
  const sum = FRAMEWORKS.map(([fw]) => { const rs = rows.filter((r) => r.framework === fw);
    const used = rs.filter((r) => trials.some((t) => avail[t.arm]?.has(short(r.skill)) && t.skills.has(short(r.skill)))).length;
    return `| ${fw} | ${rs.length} | ${rs.reduce((n, r) => n + (r.tokens || 0), 0)} | ${used} |`; });
  console.log(['| Framework | Skills | Tokens (all SKILL.md files) | Fired at least once |', '|---|---|---|---|', ...sum].join('\n'));
  console.log(`\n${table(rows, trials, avail)}`);
}
