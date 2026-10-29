// A machine's setup as one file: agents, global packs, own packs, and the registered projects with their answers.
// It holds choices only, no file contents, environment values or tokens: rule files are listed by path and state.
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { agent } from './agents.mjs';
import { appVersion } from './content.mjs';
import { ownPacks, savePack } from './packs.mjs';
import { addProject, listProjects } from './projects.mjs';
import { ruleStates } from './rules.mjs';
import { unfit } from './roots.mjs';
import { preview } from './runner.mjs';
import { PLUGINS, globalPlan, installedPlugins } from './steps/global.mjs';
import { projectCtx, projectPlan, readState } from './steps/project.mjs';

const PROFILE_SCHEMA = 1;
const ANSWERS = ['agents', 'env', 'sandbox', 'share', 'packs', 'singles', 'tier', 'paths', 'disabled'];

// The optional packs whose plugin is installed: the profile's global packs.
export function installedPacks(ctx) {
  const installed = installedPlugins(ctx);
  return [...new Set(Object.entries(PLUGINS).flatMap(([a, list]) => list.filter((p) => p.pack && installed[a]?.includes(p.id)).map((p) => p.pack)))];
}

// origins: projectOrigins' result; a project with an address of it carries `origin` (a profile has none otherwise).
// warn gets the message of each project exported without answers because its state file cannot be read.
export function exportProfile(ctx, { agents, packs = [], origins = [], warn = () => {} }) {
  const projects = listProjects(ctx).map(({ path }) => {
    let s = null;
    try { s = readState(path); } catch (e) { warn(`exported without answers: ${e.message}`); }
    const origin = origins.find((o) => o.path === path)?.url;
    return { path, ...(origin ? { origin } : {}), ...(s ? { answers: Object.fromEntries(ANSWERS.filter((k) => k in s).map((k) => [k, s[k]])) } : {}), ...(existsSync(path) ? { rules: ruleStates(ctx, { agents, dir: path }) } : {}) };
  });
  const own = ownPacks(ctx).map(({ id, title, skills }) => ({ id, title, skills }));
  return `${JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: PROFILE_SCHEMA, appVersion, global: { agents, packs, rules: ruleStates(ctx, { agents }) }, packs: own, projects }, null, 2)}\n`;
}

export function readProfile(text) {
  let p;
  try { p = JSON.parse(text); } catch (e) { throw new Error(`profile: ${e.message}`); }
  if (p?.kind !== 'benchkeeper-profile') throw new Error('not a BenchKeeper profile');
  if (p.schemaVersion !== PROFILE_SCHEMA) throw new Error(`profile schemaVersion ${p.schemaVersion}, this app reads ${PROFILE_SCHEMA}`);
  if (!Array.isArray(p.global?.agents)) throw new Error('profile: global.agents missing');
  for (const a of p.global.agents) agent(a);
  for (const x of p.projects ?? []) {
    if (typeof x.path !== 'string' || !isAbsolute(x.path)) throw new Error(`profile: project path ${x.path} is not absolute`);
    // Whether the address may be cloned is decided per project at import (checkOrigin), so one bad entry does not stop the file.
    if ('origin' in x && typeof x.origin !== 'string') throw new Error(`profile: origin of ${x.path} is not text`);
  }
  return p;
}

// The import plan: the global changes for the profile's agents and packs, plus the project setup of registered
// paths that exist here and have no state file yet. Paths missing here are listed and skipped, and so are projects
// whose plan fails (a state file this app cannot read): skipped holds their messages.
export function importPlan(ctx, p, { devcontainerCli } = {}) {
  const global = preview(globalPlan({ ctx, agents: p.global.agents, options: { packs: p.global.packs ?? [] }, devcontainerCli }));
  const projects = [], missing = [], skipped = [];
  for (const x of p.projects ?? []) {
    if (!existsSync(x.path)) { missing.push(x.path); continue; }
    // A folder that cannot be a project (a drive root, the home folder) is not given a plan, whatever the file says.
    if (unfit(ctx, x.path)) continue;
    try {
      const pctx = projectCtx(ctx, x.path);
      const changes = readState(x.path) || !x.answers ? [] : preview(projectPlan({ ctx: pctx, dir: x.path, answers: { ...x.answers, skills: x.answers.singles, singles: undefined } }).changes);
      projects.push({ path: x.path, ctx: pctx, changes });
    } catch (e) { skipped.push(`${x.path}: ${e.message}`); }
  }
  return { global, projects, missing, skipped };
}

// Own packs and the project registry; the plans apply through the step engine like any other run.
export function importChoices(ctx, p) {
  const packs = [], skippedPacks = [], projects = [], refused = [];
  for (const x of p.packs ?? []) {
    try { packs.push(savePack(ctx, x).id); } catch (e) { skippedPacks.push(`pack ${x.id}: ${e.message}`); }
  }
  for (const x of (p.projects ?? []).filter((y) => existsSync(y.path))) {
    try { projects.push(addProject(ctx, x.path, { worktree: true })); } catch (e) { refused.push(e.message); }
  }
  return { packs, skippedPacks, projects, refused };
}
