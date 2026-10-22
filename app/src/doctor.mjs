// Setup problems with a fix each; changes nothing. Values of environment variables are never read into the report.
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { appVersion } from './content.mjs';
import { exists, readText } from './fsx.mjs';
import { warnings } from './packs.mjs';
import { preview } from './runner.mjs';
import { SKILLS_CLI, globalPlan, newest } from './steps/global.mjs';
import { readState, tryState } from './steps/project.mjs';

export const FEATURE_VARS = ['DISABLE_TELEMETRY', 'DO_NOT_TRACK', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_GROWTHBOOK', 'CLAUDE_CODE_DISABLE_ADVISOR_TOOL'];
const RC = ['.bashrc', '.bash_profile', '.profile', '.zshrc', '.zprofile', '.zshenv', '.config/fish/config.fish'];
const SUMMARY = /^#{1,6}\s*(overview|summary|about( this)?( project| repository)?|project (structure|layout|overview)|(repository|directory|folder|code) (structure|layout|map)|layout|structure|architecture)\s*$/im;

const issue = (level, check, message, fix) => ({ level, check, message, fix });

// Where FEATURE_VARS are set: the process environment, shell start files, agent settings. Names and places only.
function featureVars(ctx, env) {
  const out = [];
  for (const v of FEATURE_VARS) if (env[v] !== undefined) out.push(issue('warning', 'env', `${v} is set in the environment`, `unset it where it is exported, unless you turned that feature off on purpose`));
  const fish = join(ctx.home, '.config/fish/conf.d');
  const files = [...RC, ...(exists(fish) ? readdirSync(fish).filter((f) => f.endsWith('.fish')).map((f) => `.config/fish/conf.d/${f}`) : [])];
  for (const f of files) {
    const lines = (readText(join(ctx.home, f)) ?? '').split('\n');
    lines.forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      for (const v of FEATURE_VARS) if (new RegExp(`\\b${v}\\b`).test(l)) out.push(issue('warning', 'env', `${v} is set in ~/${f}:${i + 1}`, 'remove that line, unless you turned that feature off on purpose'));
    });
  }
  for (const f of ['.claude/settings.json', '.claude/settings.local.json']) {
    let keys = [];
    try { keys = Object.keys(JSON.parse(readText(join(ctx.home, f)) ?? '{}').env ?? {}); } catch { /* the global plan reports unreadable settings */ }
    for (const v of keys.filter((k) => FEATURE_VARS.includes(k))) out.push(issue('warning', 'env', `${v} is set in ~/${f} (env)`, 'remove the key, unless you turned that feature off on purpose'));
  }
  return out;
}

// The global plan's pending changes: rules or the workflow plugin missing are errors, other drift warnings.
export function globalDrift(ctx, agents, devcontainerCli) {
  let plan;
  try { plan = preview(globalPlan({ ctx, agents, devcontainerCli })); } catch (e) { return [issue('error', 'global', `global setup cannot be read: ${e.message}`, 'fix the file named above, then run benchkeeper plan')]; }
  return plan.map((c) => {
    if (c.error) return issue('error', 'global', `${c.title}: ${c.error}`, 'edit the file by hand; the app does not merge this form');
    if (c.destructive) return issue('warning', 'unexpected', c.title.replace(/^(remove|move) /, 'not part of the setup: '), 'benchkeeper apply --all offers its removal');
    const error = /^rules:/.test(c.step) || /^plugin:\w+:benchkeeper@/.test(c.step);
    return issue(error ? 'error' : 'warning', c.step.split(':')[0], c.kind === 'command' ? `not installed: ${c.title}` : `${c.title} differs from setup ${appVersion}`, 'benchkeeper apply');
  });
}

const frontMatter = (text) => text?.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
const description = (text) => frontMatter(text).match(/^description:\s*"?(.*?)"?\s*$/m)?.[1] ?? '';

// The SKILL.md files in a project's agent skill folders; a skill several agents read can appear once per folder.
// Turned-off skills sit in .benchkeeper/disabled/ and are not among them.
export function skillFiles(dir) {
  return ['.claude/skills', '.agents/skills', '.github/skills', '.gemini/skills'].map((x) => join(dir, x)).filter(exists)
    .flatMap((d) => readdirSync(d).map((name) => ({ name, file: join(d, name, 'SKILL.md') })))
    .flatMap((f) => { const text = readText(f.file); return text == null ? [] : [{ ...f, text }]; });
}

export function projectChecks(ctx, dir) {
  const out = [];
  const agentsMd = readText(join(dir, 'AGENTS.md'));
  const heading = agentsMd?.match(SUMMARY)?.[0];
  if (heading) out.push(issue('warning', 'agents-md', `AGENTS.md has a summary or layout section (${heading.trim()})`, 'remove it: agents read the code, and the section goes stale'));
  const skills = new Map();
  for (const { name, file, text } of skillFiles(dir)) {
    skills.set(name, description(text));
    for (const [, target] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      if (!exists(resolve(dirname(file), decodeURI(target)))) out.push(issue('error', 'skills', `${file.slice(dir.length + 1)} links ${target}, which does not exist`, 'restore the file or fix the link'));
    }
  }
  for (const w of warnings([...skills.keys()], { skills: [...skills].map(([name, pickWhen]) => ({ name, pickWhen })) })) out.push(issue('warning', 'skills', w, 'turn skills off with benchkeeper project apply --disable <skill>'));
  let state = null;
  try { state = readState(dir); } catch (e) { out.push(issue('error', 'project', e.message, 'fix or delete the file, then run benchkeeper project apply')); }
  if (state && state.setupVersion !== appVersion) out.push(issue('warning', 'project', `project setup ${state.setupVersion}, app ${appVersion}`, 'benchkeeper update-all, or benchkeeper project apply in the project'));
  if (state && ['container', 'host-agent'].includes(state.env) && ctx.run(['devcontainer', '--version']).code !== 0) out.push(issue('error', 'tools', `env ${state.env} needs the Dev Containers CLI`, 'benchkeeper apply installs it'));
  return out;
}

export function doctor(ctx, { agents, dir, env = process.env, devcontainerCli, now } = {}) {
  const out = [...featureVars(ctx, env), ...globalDrift(ctx, agents, devcontainerCli)];
  if (!['podman', 'docker'].some((e) => ctx.run([e, '--version']).code === 0)) out.push(issue('warning', 'tools', 'no container engine (podman or docker)', 'install Podman or Docker for dev containers'));
  const skillsCli = newest(ctx, 'skills', now);
  if (skillsCli && skillsCli !== SKILLS_CLI) out.push(issue('warning', 'pins', `skills CLI ${skillsCli} is out for 7 days, the app pins ${SKILLS_CLI}`, 'a newer app release updates the pin'));
  if (dir && (tryState(dir) || exists(join(dir, '.benchkeeper')) || exists(join(dir, 'AGENTS.md')))) out.push(...projectChecks(ctx, dir));
  return out;
}
