// Insights: findings about this machine's agent setup, each with a stable id, a severity, the evidence and a fix. Read only.
// Decisions (#273): Insights is a view of its own, not a Dashboard section. A signal that needs sessions needs at least
// MIN_SAMPLES of them and reports nothing below that, so a thin history never produces a ranked finding.
// Five signals: unused skills (sessions against the installed skills), friction (a project whose sessions ended on a failed
// test run without a pull request), hygiene (the doctor's findings), freshness (the doctor's outdated items) and skills
// (proposals per project to turn off, add or update its skills, #480). Skills behind their source need the network: `skills list --check`.
// insights() is pure: the state in, the findings out. collectInsights() reads the state from the machine.
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { doctor } from './doctor.mjs';
import { frontMatter, pluginSkills } from './instructions.mjs';
import * as orca from './orca/index.mjs';
import { libraryWith } from './packs.mjs';
import { canon, listProjects } from './projects.mjs';
import { scanSessions } from './sessions.mjs';
import { projectSkills, skillFiles } from './skills.mjs';
import { suggest, tryState } from './steps/project.mjs';

export const MIN_SAMPLES = 20;
export const WINDOW_DAYS = 90;
const SEVERITY = ['error', 'warning', 'info'];
const hash = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 8);
// A doctor finding that says a version is behind belongs to freshness, not to hygiene.
const isFreshness = (f) => f.tag === 'outdated';
const KEYS = ['check', 'message', 'dir', 'file', 'line', 'scope', 'rule', 'repos'];
// A skill's front matter (name and description, also a block scalar) is what every turn carries; about 4 characters a token.
const tokensOf = (text) => Math.ceil(frontMatter(text.replaceAll('\r\n', '\n')).length / 4);
// The project's folder name; the full path never leaves the scan.
const folderOf = (path) => path.split(/[\\/]/).filter(Boolean).at(-1);
// What a triage entry is tied to: the finding id and a digest of the set its evidence names (the failed sessions, the unused
// skills, a doctor finding's keys), not the counters that change with every session. A changed set is a new key.
export const findingKey = (f) => `${f.id}@${hash(JSON.stringify(f.evidence.sessionIds ?? f.evidence.skills?.map((s) => `${s.scope}:${s.name}`).sort() ?? f.evidence))}`;
const evidenceOf = (f) => Object.fromEntries(KEYS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// The command a skill proposal runs and the switch of the project plan (app) that does the same.
const VERBS = { disable: 'disable', pick: 'add', update: 'update' };
// A path with a space or a quote stays one argument of the fix command.
const shellArg = (p) => (/^[\w./:\\-]+$/.test(p) ? p : JSON.stringify(p));

// state: { sessions: rows of scanSessions, skills: [{ name, scope, tokens }] installed, doctorFindings, projects: [{ dir, skills:
// [{ name, state }], keep, add, packs }] as projectInput reads them }. Only Claude Code sessions count: the installed skills are Claude Code's.
// shortcut: a skill installed after the window starts counts as unused, sessions name a skill without its plugin (a
// same-named skill of another plugin counts as used) and the skill list is not capped; upgrade when a finding is wrong for one.
export function insights({ sessions = [], skills = [], doctorFindings = [], projects = [] }, { minSamples = MIN_SAMPLES } = {}) {
  const found = [];
  const claude = sessions.filter((s) => s.agent === 'claude');
  if (claude.length >= minSamples) {
    const used = new Set(claude.flatMap((s) => s.skills));
    const unused = skills.filter((s) => !used.has(s.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (unused.length) {
      const descriptionTokens = unused.reduce((n, s) => n + s.tokens, 0);
      found.push({
        id: 'unused-skills', signal: 'unused-skills', severity: 'info',
        message: `${unused.length} installed ${unused.length === 1 ? 'skill was' : 'skills were'} not used in any of the last ${claude.length} sessions; their descriptions cost about ${descriptionTokens} tokens per turn`,
        evidence: { sessions: claude.length, skills: unused, descriptionTokens },
        fix: 'turn them off: move the folder of a global skill out of the skills folder, or disable the plugin that ships a plugin skill',
      });
    }
  }
  // Friction (#322): one proxy, a session whose last test run failed and that opened no pull request. Per project, among its
  // sessions without dispatched workers and research tier; Claude Code and Codex both count. Nothing below minSamples of them.
  const byFolder = new Map();
  for (const s of sessions) {
    if (!s.project || s.pattern === orca.WORKER_PATTERN || s.tier?.last === 'research') continue;
    const folder = folderOf(s.project);
    if (!folder) continue;
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(s);
  }
  for (const [folder, list] of byFolder) {
    const failed = list.filter((s) => s.tests === 'fail' && !s.prs?.length);
    if (list.length < minSamples || !failed.length) continue;
    const rate = Math.round((failed.length / list.length) * 100);
    found.push({
      id: `friction:${hash(folder)}`, signal: 'friction', severity: 'info',
      message: `${failed.length} of ${list.length} sessions in ${folder} (${rate}%) ended on a failed test run and opened no pull request`,
      evidence: { project: folder, sessions: list.length, failed: failed.length, rate, sessionIds: failed.map((s) => s.id).sort() },
      fix: 'open the listed sessions in the sessions board and look at why the tests failed: a missing check in the project, a rule the agent skipped or a task too large for one session',
    });
  }
  // Skill proposals (#480): each one a fix command whose plan, diff and undo are those of the skills command; Insights only lists them.
  // dir is the project path the fix needs; the narrative carries only the folder name.
  for (const p of projects) {
    const folder = folderOf(p.dir);
    const propose = (action, names, message, extra = {}) => names.length && found.push({
      id: `skill-${VERBS[action]}:${hash(p.dir)}`, signal: 'skills', severity: 'info', message: `${message}: ${names.join(', ')}`,
      evidence: { project: folder, dir: p.dir, action, skills: names.map((name) => ({ name, scope: folder })), ...extra },
      fix: `benchkeeper skills ${VERBS[action]} ${names.join(' ')} --project ${shellArg(p.dir)}`,
    });
    const mine = claude.filter((s) => s.dir === p.dir || s.dir?.startsWith(`${p.dir}${sep}`));
    if (mine.length >= minSamples) {
      const used = new Set(mine.flatMap((s) => s.skills));
      const unused = p.skills.filter((s) => !['disabled', 'removed'].includes(s.state) && !used.has(s.name) && !p.keep.includes(s.name)).map((s) => s.name);
      propose('disable', unused, `${plural(unused.length, 'skill', 'skills')} of ${folder} not used in any of its last ${mine.length} sessions`, { sessions: mine.length });
    }
    propose('pick', p.add, `${folder} matches the library ${p.packs.length === 1 ? 'pack' : 'packs'} ${p.packs.join(', ')}, whose ${p.add.length === 1 ? 'skill it lacks' : 'skills it lacks'}`, { packs: p.packs });
    const behind = p.skills.filter((s) => s.state === 'outdated').map((s) => s.name);
    propose('update', behind, `${plural(behind.length, 'skill', 'skills')} of ${folder} behind the library's copy`);
  }
  for (const f of doctorFindings) {
    const signal = isFreshness(f) ? 'freshness' : 'hygiene';
    found.push({ id: `${signal}:${f.check}:${hash(...KEYS.map((k) => JSON.stringify(f[k] ?? null)))}`, signal, severity: f.level, message: f.message, evidence: evidenceOf(f), fix: f.fix, ...(f.settings ? { settings: f.settings } : {}) });
  }
  const rank = (f) => (f.severity === 'error' ? 0 : 1);
  found.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const summary = Object.fromEntries(SEVERITY.map((s) => [s, found.filter((f) => f.severity === s).length]));
  return { samples: { sessions: claude.length, minSamples }, findings: found, summary };
}

// What the skill proposals of one project need; nothing for a folder without a setup. add: the skills of the library packs
// the repository matches (as the setup suggests them) that the project has in no form. keep: skills never proposed for
// removal because another skill the project sees (its own, global or plugin) names them or links their folder. An overlap
// of descriptions blocks nothing: its own fix is to turn one of the pair off.
function projectInput(ctx, dir, lib) {
  const rows = projectSkills(ctx, dir);
  if (!rows) return [];
  const have = new Set([...rows.skills.map((s) => s.name), ...(tryState(dir).disabled ?? []), ...rows.untracked.map((u) => u.name)]);
  const packs = suggest(dir).packs.map((h) => lib.packs.find((p) => p.id === h.id))
    .map((p) => ({ id: p?.id, add: (p?.skills ?? []).filter((n) => !have.has(n) && lib.skills.some((s) => s.name === n)) })).filter((p) => p.add.length);
  const texts = [...skillFiles(dir), ...skillFiles(ctx.home), ...pluginSkills(ctx, dir)];
  const keep = rows.skills.map((s) => s.name).filter((n) => texts.some((t) => t.name !== n && new RegExp(`(^|[^a-z0-9-])${n}($|[^a-z0-9-])`).test(t.text)));
  return [{ dir, skills: rows.skills.map(({ name, state }) => ({ name, state })), keep, add: [...new Set(packs.flatMap((p) => p.add))].sort(), packs: packs.map((p) => p.id) }];
}

// The state from this machine: transcripts through the sessions scan, the installed skills (global folders and enabled
// plugins), the doctor (dir adds a project's checks), the skill proposals of dir or else of every registered project.
// shortcut: a session counts for a project by its folder, sessions of another worktree of the same repository do not; upgrade when that hides a used skill.
export async function collectInsights(ctx, { agents, dir, days = WINDOW_DAYS, now = Date.now() } = {}) {
  const sessions = (await scanSessions(ctx, { since: new Date(now - days * 864e5).toISOString() })).map((s) => (s.project ? { ...s, dir: canon(s.project) } : s));
  // Claude Code reads ~/.claude/skills only; the other agents' folders are not its skills.
  const claudeDir = join(ctx.home, '.claude/skills');
  const installed = [...skillFiles(ctx.home).filter((f) => f.file.startsWith(`${claudeDir}${sep}`)).map((f) => ({ ...f, scope: 'global' })), ...pluginSkills(ctx, dir)];
  const skills = installed.filter((s, i) => installed.findIndex((x) => x.name === s.name && x.scope === s.scope) === i)
    .map((s) => ({ name: s.name, scope: s.scope, tokens: tokensOf(s.text) }));
  const lib = libraryWith(ctx);
  const projects = (dir ? [canon(dir)] : listProjects(ctx).map((p) => p.path)).flatMap((d) => projectInput(ctx, d, lib));
  return insights({ sessions, skills, doctorFindings: doctor(ctx, { agents, dir, now }), projects });
}
