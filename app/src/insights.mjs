// Insights: findings about this machine's agent setup, each with a stable id, a severity, the evidence and a fix. Read only.
// Decisions (#273): Insights is a view of its own, not a Dashboard section. A signal that needs sessions needs at least
// MIN_SAMPLES of them and reports nothing below that, so a thin history never produces a ranked finding.
// Three signals: unused skills (sessions against the installed skills), hygiene (the doctor's findings) and freshness
// (pins behind the newest release, the doctor's outdated items and the project skills behind the library).
// insights() is pure: the state in, the findings out. collectInsights() reads the state from the machine.
import { createHash } from 'node:crypto';
import { doctor, skillFiles } from './doctor.mjs';
import { pluginSkills, skillDescription } from './instructions.mjs';
import { listProjects } from './projects.mjs';
import { scanSessions } from './sessions.mjs';
import { projectSkills } from './skills.mjs';

export const MIN_SAMPLES = 20;
const WINDOW_DAYS = 90;
const SEVERITY = ['error', 'warning', 'info'];
const hash = (...parts) => createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 8);
// A doctor finding that says a pin or a version is behind belongs to freshness, not to hygiene.
const isFreshness = (f) => f.check === 'pins' || f.tag === 'outdated';
const KEYS = ['check', 'message', 'dir', 'file', 'line', 'scope', 'rule', 'repos'];
const evidenceOf = (f) => Object.fromEntries(KEYS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

// state: { sessions: rows of scanSessions, skills: [{ name, scope, tokens }] installed, doctorFindings, skillPins:
// [{ project, name, pinned, newest }] }. Only Claude Code sessions count: the installed skills are Claude Code's.
// shortcut: a skill installed after the window starts counts as unused, and a session in a worktree of the project is a
// session like any other; upgrade when a finding is wrong for one of them.
export function insights({ sessions = [], skills = [], doctorFindings = [], skillPins = [] }, { minSamples = MIN_SAMPLES } = {}) {
  const found = [];
  const claude = sessions.filter((s) => s.agent === 'claude');
  if (claude.length >= minSamples) {
    const used = new Set(claude.flatMap((s) => s.skills));
    const unused = skills.filter((s) => !used.has(s.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (unused.length) {
      const descriptionTokens = unused.reduce((n, s) => n + s.tokens, 0);
      found.push({
        id: 'unused-skills', signal: 'unused-skills', severity: 'info',
        message: `${unused.length} installed skills were not used in any of the last ${claude.length} sessions; their descriptions cost about ${descriptionTokens} tokens per turn`,
        evidence: { sessions: claude.length, skills: unused, descriptionTokens },
        fix: 'turn the skills off: benchkeeper project apply --disable <skill> for a project skill, or disable the plugin that ships it',
      });
    }
  }
  for (const f of doctorFindings) {
    const signal = isFreshness(f) ? 'freshness' : 'hygiene';
    found.push({ id: `${signal}:${f.check}:${hash(f.message, f.file ?? '', f.dir ?? '')}`, signal, severity: f.level, message: f.message, evidence: evidenceOf(f), fix: f.fix });
  }
  for (const p of skillPins.filter((x) => x.pinned && x.newest && x.pinned !== x.newest)) {
    found.push({
      id: `freshness:skill:${hash(p.project)}:${p.name}`, signal: 'freshness', severity: 'warning',
      message: `skill ${p.name} in ${p.project} is at ${p.pinned}, the library offers ${p.newest}`,
      evidence: { project: p.project, skill: p.name, pinned: p.pinned, newest: p.newest },
      fix: `benchkeeper skills update ${p.name} --project ${p.project}`,
    });
  }
  const rank = (f) => SEVERITY.indexOf(f.severity);
  found.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const summary = Object.fromEntries(SEVERITY.map((s) => [s, found.filter((f) => f.severity === s).length]));
  return { samples: { sessions: claude.length, minSamples }, findings: found, summary };
}

// The state from this machine: transcripts through the sessions scan, the installed skills (global folders and enabled
// plugins), the doctor (dir adds a project's checks) and the skills of the registered projects.
export async function collectInsights(ctx, { agents, dir, days = WINDOW_DAYS, now = Date.now() } = {}) {
  const sessions = await scanSessions(ctx, { since: new Date(now - days * 864e5).toISOString() });
  const installed = [...skillFiles(ctx.home).map((f) => ({ ...f, scope: 'global' })), ...pluginSkills(ctx)];
  const skills = installed.filter((s, i) => installed.findIndex((x) => x.name === s.name) === i)
    .map((s) => ({ name: s.name, scope: s.scope, tokens: Math.ceil(skillDescription(s.text).text.length / 4) }));
  const skillPins = listProjects(ctx).flatMap((p) => (projectSkills(ctx, p.path)?.skills ?? []).filter((s) => s.state === 'outdated').map((s) => ({ project: p.path, name: s.name, pinned: s.pinned, newest: s.newest })));
  return insights({ sessions, skills, doctorFindings: doctor(ctx, { agents, dir, now }), skillPins });
}
