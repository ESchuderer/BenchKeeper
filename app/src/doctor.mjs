// Setup problems with a fix each; changes nothing. Values of environment variables are never read into the report.
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { accountChecks } from './accounts.mjs';
import { allowChecks } from './allow.mjs';
import { baselineIssues } from './baseline.mjs';
import { appVersion, contentDir, contentRefusal, contentVersion, library } from './content.mjs';
import { frameworkChecks } from './frameworks.mjs';
import { guardChecks } from './guards.mjs';
import { instructionChecks, pluginSkills, skillDescription, skillOverlap } from './instructions.mjs';
import { integrity } from './integrity.mjs';
import { levelFor } from './level.mjs';
import { exists, readText } from './fsx.mjs';
import { warnings } from './packs.mjs';
import { paramChecks } from './params.mjs';
import { bandChecks } from './ponytail.mjs';
import { rulesChecks } from './rules.mjs';
import { pick } from './sandbox.mjs';
import { preview } from './runner.mjs';
import { settingsChecks } from './settings.mjs';
import { skillFiles } from './skills.mjs';
import { globalPlan, installedRefusal, pluginState } from './steps/global.mjs';
import { readState, tracksState, tryState, upToDate } from './steps/project.mjs';

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
export function globalDrift(ctx, agents, devcontainerCli, level) {
  let plan;
  try { plan = preview(globalPlan({ ctx, agents, devcontainerCli, options: { level } })); } catch (e) { return [issue('error', 'global', `global setup cannot be read: ${e.message}`, 'fix the file named above, then run benchkeeper plan')]; }
  // Below full, the fix names the level: a plain apply would grow the setup.
  const apply = level && level !== 'full' ? `benchkeeper apply --level ${level}` : 'benchkeeper apply';
  // An optional step left off is not drift.
  const found = plan.filter((c) => !c.optional).map((c) => {
    if (c.error) return issue('error', 'global', `${c.title}: ${c.error}`, 'edit the file by hand; the app does not merge this form');
    if (c.destructive) return issue('warning', 'unexpected', c.title.replace(/^(remove|move) /, 'not part of the setup: '), 'benchkeeper apply --all offers its removal');
    // An older version is drift, not a missing part.
    // A warning shown as outdated: the version change says the rest.
    if (c.outdated) return { ...issue('warning', c.step.split(':')[0], c.title, apply), tag: 'outdated' };
    // Rules the user edited are a warning, a missing rules file an error.
    if (/^rules:/.test(c.step) && readText(c.path) != null) return issue('warning', 'rules', `${c.title} differs from setup ${appVersion}`, `benchkeeper apply restores them; the optional "keep your edits" change of benchkeeper plan stops this warning`);
    const error = /^rules:/.test(c.step) || /^plugin:\w+:benchkeeper@/.test(c.step);
    return issue(error ? 'error' : 'warning', c.step.split(':')[0], c.kind === 'command' ? `not installed: ${c.title}` : `${c.title} differs from setup ${appVersion}`, apply);
  });
  // A step of several commands (marketplace refresh, then update) is one finding.
  return found.filter((f, i) => found.findIndex((g) => g.check === f.check && g.message === f.message) === i);
}

const description = (text) => skillDescription(text).text;

// A pack whose own setup skill writes files and AGENTS.md sections: BenchKeeper does not run it, so what is still missing is named.
// The files are checked, not a recorded flag: Doctor is quiet once they exist, however they were written.
function packSetupChecks(dir, state, lib = library()) {
  const text = ['AGENTS.md', 'CLAUDE.md'].map((f) => readText(join(dir, f)) ?? '').join('\n');
  const codex = !(state?.agents ?? []).includes('claude') && (state?.agents ?? []).includes('codex');
  return (state?.packs ?? []).flatMap((id) => (lib.packs.find((p) => p.id === id)?.prompts ?? []).flatMap((x) => {
    const fix = `run ${codex ? x.codex : x.claude} once in this project: it ${x.why}`;
    if (x.writes && !exists(join(dir, x.writes))) return [issue('warning', 'packs', `pack ${id} is on, but ${x.writes}/ does not exist`, fix)];
    return x.sections?.some((h) => !text.split('\n').some((l) => l.trim() === h)) ? [issue('info', 'packs', `pack ${id} is on, but ${x.sections.join(', ')} are not all in AGENTS.md`, fix)] : [];
  }));
}

export function projectChecks(ctx, dir, agents) {
  const out = [];
  const agentsMd = readText(join(dir, 'AGENTS.md'));
  const heading = agentsMd?.match(SUMMARY)?.[0];
  if (heading) out.push(issue('warning', 'agents-md', `AGENTS.md has a summary or layout section (${heading.trim()})`, 'remove it: agents read the code, and the section goes stale'));
  const skills = new Map();
  for (const { name, file, text } of skillFiles(dir)) {
    skills.set(name, description(text));
    for (const [, target] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
      if (!exists(resolve(dirname(file), decodeURI(target)))) out.push(issue('error', 'skills', `skill ${name} in ${dir}: ${file.slice(dir.length + 1)} links ${target}, which does not exist`, 'restore the file or fix the link'));
    }
  }
  for (const w of warnings([...skills.keys()], { skills: [...skills].map(([name, pickWhen]) => ({ name, pickWhen })) })) out.push(issue('warning', 'skills', w, 'turn skills off with benchkeeper skills disable <name>'));
  let state = null;
  try { state = readState(dir); } catch (e) { out.push(issue('error', 'project', e.message, 'fix or delete the file, then run benchkeeper projects apply (a newer schemaVersion needs a newer benchkeeper)')); }
  if (state && state.share !== true && tracksState(ctx, dir)) out.push(issue('warning', 'project', 'the setup is local, but the repository still has it committed', 'benchkeeper projects unshare: a pull request removes the committed copies'));
  if (state && !upToDate(state)) out.push(issue('warning', 'project', `project setup: app ${state.appVersion}, content ${state.contentVersion}; this app ${appVersion}, content ${contentVersion}`, 'benchkeeper projects update, or benchkeeper projects apply in the project'));
  if (state && ['container', 'host-agent'].includes(state.env) && ctx.run(['devcontainer', '--version']).code !== 0) out.push(issue('error', 'tools', `env ${state.env} needs the Dev Containers CLI`, 'benchkeeper apply installs it'));
  let userPlugins = [];
  try { userPlugins = !agents || agents.includes('claude') ? pluginState(ctx, 'claude').listed.filter((p) => p.enabled) : []; } catch { /* the global plan reports unreadable plugin files */ }
  out.push(...frameworkChecks({ dir, state, userPlugins }), ...packSetupChecks(dir, state), ...guardChecks(dir, state));
  out.push(...settingsChecks(ctx, { agents, dir }), ...allowChecks(ctx, { agents, dir }), ...instructionChecks(ctx, { dir }), ...paramChecks(ctx, dir));
  // Pairs inside the project are reported above; these are the project's skills against the global and plugin ones.
  const scoped = (scope, own, list) => list.map((f) => ({ ...f, scope, own }));
  out.push(...skillOverlap(ctx, dir, [...scoped('project', true, skillFiles(dir)), ...scoped('global', false, skillFiles(ctx.home)), ...pluginSkills(ctx, dir)], true));
  return out;
}

// baseline: { profile, ref } adds the drift of dir's GitHub settings and caller workflows against a repo-baseline profile (reads only).
export function doctor(ctx, { agents, dir, env = process.env, devcontainerCli, now, baseline } = {}) {
  // Below full, the global plan is the plugin alone: rules, settings and host tools are not expected.
  const level = levelFor(ctx, agents, dir);
  const tooNew = contentRefusal(contentDir, appVersion) ?? installedRefusal(ctx, agents);
  const out = [...(tooNew ? [issue('error', 'content', tooNew, 'run the newer benchkeeper command named, or update the plugin to the version this app sets up')] : []), ...featureVars(ctx, env), ...globalDrift(ctx, agents, devcontainerCli, level), ...settingsChecks(ctx, { agents, env }), ...allowChecks(ctx, { agents }), ...instructionChecks(ctx), ...integrity(ctx).map((i) => issue('warning', 'ledger', i.message, i.fix))];
  out.push(...skillOverlap(ctx, undefined, [...skillFiles(ctx.home).map((f) => ({ ...f, scope: 'global' })), ...pluginSkills(ctx)]));
  out.push(...accountChecks(ctx, { dir, now }));
  if (!agents || agents.includes('claude')) out.push(...bandChecks(ctx));
  if (level === 'full') {
    out.push(...rulesChecks(ctx, agents));
    if (!['podman', 'docker'].some((e) => ctx.run([e, '--version']).code === 0)) out.push(issue('warning', 'tools', 'no container engine (podman or docker)', 'install Podman or Docker for dev containers'));
    // The skill install preview runs in an OS sandbox; read from the programs on the PATH, nothing is started.
    const sandbox = pick(ctx.sandbox);
    if (!sandbox.tool) out.push(issue('info', 'sandbox', `the skill install preview is off: ${sandbox.why}`, 'install the programs named (Windows has none), or use "Rehearse anyway without a sandbox" in the preview'));
    else if (sandbox.tool !== 'srt') out.push(issue('info', 'sandbox', `the skill install preview confines writes only: ${sandbox.note}`, sandbox.fix));
  }
  if (dir && resolve(dir) !== ctx.home && (tryState(dir) || ['.benchkeeper', 'AGENTS.md', 'CLAUDE.md', 'CLAUDE.local.md', '.claude', '.codex', '.agents', '.github/skills', '.gemini', 'docs/agents/orchestration.json'].some((f) => exists(join(dir, f))))) out.push(...projectChecks(ctx, dir, agents));
  if (dir && baseline) out.push(...baselineIssues(ctx, dir, baseline));
  return out;
}
