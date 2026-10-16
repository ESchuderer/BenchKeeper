// Skills inventory (#36): the skills each framework adds (the arm's init skills minus the plain arm's), with phase, size
// and description from the installed SKILL.md, and in how many saved trials each skill fired (workflow.skills).
// Usage: node bench/scripts/skills-inventory.mjs <skill-files.json from skills-inventory.sh> <results-dir>   prints Markdown
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { phaseOfSkill } from './phases.mjs';
import { arm as describe } from '../../web/scripts/bench-data.mjs';

// Framework, its arm, the arm whose skills are subtracted besides the plain arm A, and which arms belong to the
// framework (usage counts only those, so skills that share a name across frameworks are not merged).
export const FRAMEWORKS = [
  ['agent-skills', 'F', null, (a) => /agent-skills/.test(a.framework)], ['Superpowers', 'G', null, (a) => a.framework === 'Superpowers'],
  ['ECC', 'H', null, (a) => a.framework === 'ECC'], ['Matt Pocock', 'V', null, (a) => a.framework === 'Matt Pocock'],
  ['Ponytail', 'B', null, (a) => a.ponytail && !a.bk], ['OpenSpec', 'AB', null, (a) => a.spec === 'OpenSpec'],
  ['Spec Kit', 'AC', null, (a) => a.spec === 'Spec Kit'], ['BenchKeeper layer (with agent-skills)', 'L', 'F', (a) => a.bk],
];
const OPENCODE = new Set(['Q', 'R', 'S', 'T', 'U', 'Z', 'AA']);

const fixture = (dir, arm) => readFileSync(join(dir, `init-${arm}.jsonl`), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).find((e) => e.subtype === 'init')?.skills || [];
const short = (name) => String(name).split(':').pop();
const firstSentence = (s) => { const t = String(s).replace(/\s*\u2014\s*/g, ', ').split(/(?<=\.)\s/)[0]; return t.length > 140 ? `${t.slice(0, 137)}...` : t; };

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

// Skills available per arm: full names from the Claude Code init fixtures, short names from OpenCode's resolved skills.
export function available(fixtures) {
  const out = {};
  for (const f of readdirSync(fixtures)) {
    const cc = /^init-([A-Z]+)\.jsonl$/.exec(f), oc = /^opencode-([A-Z]+)$/.exec(f);
    if (cc) out[cc[1]] = new Set(fixture(fixtures, cc[1]));
    if (oc && existsSync(join(fixtures, f, 'opencode-skills.json'))) out[oc[1]] = new Set(JSON.parse(readFileSync(join(fixtures, f, 'opencode-skills.json'), 'utf8')).map((s) => s.name));
  }
  return out;
}

// The skills that fired in each saved trial, as recorded (Claude Code with the plugin prefix, OpenCode without).
export function usage(results) {
  const fired = [];
  if (!existsSync(results)) return fired;
  for (const run of readdirSync(results)) {
    for (const round of existsSync(join(results, run, 'manifest.txt')) ? readdirSync(join(results, run)).filter((d) => /^round-/.test(d)) : []) {
      for (const arm of readdirSync(join(results, run, round))) {
        const f = join(results, run, round, arm, 'trial.json');
        if (!existsSync(f)) continue;
        fired.push({ arm, skills: new Set(JSON.parse(readFileSync(f, 'utf8')).workflow?.skills || []) });
      }
    }
  }
  return fired;
}

// A skill's own name in an arm: full on Claude Code, short on OpenCode.
const nameIn = (arm, skill) => (OPENCODE.has(arm) ? short(skill) : skill);
// Trials of the framework's own arms that had the skill, and those in which it fired.
export function count(row, trials, avail) {
  const own = FRAMEWORKS.find(([fw]) => fw === row.framework)?.[3] || (() => true);
  const has = trials.filter((t) => own(describe(t.arm)) && avail[t.arm]?.has(nameIn(t.arm, row.skill)));
  return { fired: has.filter((t) => t.skills.has(nameIn(t.arm, row.skill))).length, of: has.length };
}

export function table(rows, trials, avail) {
  const cell = (r) => { const c = count(r, trials, avail); return `${c.fired} of ${c.of}`; };
  return ['| Framework | Skill | Phase | Tokens | Fired in trials | Description |', '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.framework} | \`${r.skill}\` | ${r.phase} | ${r.tokens ?? 'n/a'} | ${cell(r)} | ${r.description.replace(/\|/g, '\\|')} |`)].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [filesPath, results] = process.argv.slice(2);
  const rows = inventory(JSON.parse(readFileSync(filesPath, 'utf8')), new URL('./fixtures/', import.meta.url).pathname);
  const trials = usage(results), avail = available(new URL('./fixtures/', import.meta.url).pathname);
  // Per framework: skills, total tokens, skills that fired in at least one trial of an arm that had them.
  const sum = FRAMEWORKS.map(([fw]) => { const rs = rows.filter((r) => r.framework === fw);
    const used = rs.filter((r) => count(r, trials, avail).fired > 0).length;
    return `| ${fw} | ${rs.length} | ${rs.reduce((n, r) => n + (r.tokens || 0), 0)} | ${used} |`; });
  console.log(['| Framework | Skills | Tokens (all SKILL.md files) | Fired at least once |', '|---|---|---|---|', ...sum].join('\n'));
  console.log(`\n${table(rows, trials, avail)}`);
}
