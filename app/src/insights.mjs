// Insights: findings about this machine's agent setup, each with a stable id, a severity, the evidence and a fix. Read only.
// Decisions (#273): Insights is a view of its own, not a Dashboard section. A signal that needs sessions needs at least
// MIN_SAMPLES of them and reports nothing below that, so a thin history never produces a ranked finding.
// Four signals: unused skills (sessions against the installed skills), friction (a project whose sessions ended on a failed
// test run without a pull request), hygiene (the doctor's findings) and freshness (pins behind the newest release and the
// doctor's outdated items). Skills behind their source need the network: `skills list --check`.
// insights() is pure: the state in, the findings out. collectInsights() reads the state from the machine.
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { doctor, skillFiles } from './doctor.mjs';
import { frontMatter, pluginSkills } from './instructions.mjs';
import { scanSessions } from './sessions.mjs';

export const MIN_SAMPLES = 20;
const WINDOW_DAYS = 90;
const SEVERITY = ['error', 'warning', 'info'];
const hash = (...parts) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 8);
// A doctor finding that says a pin or a version is behind belongs to freshness, not to hygiene.
const isFreshness = (f) => f.check === 'pins' || f.tag === 'outdated';
const KEYS = ['check', 'message', 'dir', 'file', 'line', 'scope', 'rule', 'repos'];
// A skill's front matter (name and description, also a block scalar) is what every turn carries; about 4 characters a token.
const tokensOf = (text) => Math.ceil(frontMatter(text.replaceAll('\r\n', '\n')).length / 4);
// The project's folder name; the full path never leaves the scan.
const folderOf = (path) => path.split(/[\\/]/).filter(Boolean).at(-1);
const evidenceOf = (f) => Object.fromEntries(KEYS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));

// state: { sessions: rows of scanSessions, skills: [{ name, scope, tokens }] installed, doctorFindings }. Only Claude Code sessions count: the installed skills are Claude Code's.
// shortcut: a skill installed after the window starts counts as unused, sessions name a skill without its plugin (a
// same-named skill of another plugin counts as used) and the skill list is not capped; upgrade when a finding is wrong for one.
export function insights({ sessions = [], skills = [], doctorFindings = [] }, { minSamples = MIN_SAMPLES } = {}) {
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
  // sessions without Orca workers and research tier; Claude Code and Codex both count. Nothing below minSamples of them.
  const byFolder = new Map();
  for (const s of sessions) {
    if (!s.project || s.pattern === 'Orca worker' || s.tier?.last === 'research') continue;
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
  for (const f of doctorFindings) {
    const signal = isFreshness(f) ? 'freshness' : 'hygiene';
    found.push({ id: `${signal}:${f.check}:${hash(...KEYS.map((k) => JSON.stringify(f[k] ?? null)))}`, signal, severity: f.level, message: f.message, evidence: evidenceOf(f), fix: f.fix });
  }
  const rank = (f) => (f.severity === 'error' ? 0 : 1);
  found.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const summary = Object.fromEntries(SEVERITY.map((s) => [s, found.filter((f) => f.severity === s).length]));
  return { samples: { sessions: claude.length, minSamples }, findings: found, summary };
}

// The state from this machine: transcripts through the sessions scan, the installed skills (global folders and enabled
// plugins), the doctor (dir adds a project's checks).
export async function collectInsights(ctx, { agents, dir, days = WINDOW_DAYS, now = Date.now() } = {}) {
  const sessions = await scanSessions(ctx, { since: new Date(now - days * 864e5).toISOString() });
  // Claude Code reads ~/.claude/skills only; the other agents' folders are not its skills.
  const claudeDir = join(ctx.home, '.claude/skills');
  const installed = [...skillFiles(ctx.home).filter((f) => f.file.startsWith(`${claudeDir}${sep}`)).map((f) => ({ ...f, scope: 'global' })), ...pluginSkills(ctx, dir)];
  const skills = installed.filter((s, i) => installed.findIndex((x) => x.name === s.name && x.scope === s.scope) === i)
    .map((s) => ({ name: s.name, scope: s.scope, tokens: tokensOf(s.text) }));
  return insights({ sessions, skills, doctorFindings: doctor(ctx, { agents, dir, now }) });
}
