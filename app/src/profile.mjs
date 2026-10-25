// A machine's setup as one file: agents, global packs, own packs, and the registered projects with their answers.
// It holds choices only, no file contents, environment values or tokens.
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { agent } from './agents.mjs';
import { appVersion } from './content.mjs';
import { ownPacks, savePack } from './packs.mjs';
import { addProject, listProjects } from './projects.mjs';
import { unfit } from './roots.mjs';
import { preview } from './runner.mjs';
import { PLUGINS, globalPlan, installedPlugins } from './steps/global.mjs';
import { projectCtx, projectPlan, readState, tryState } from './steps/project.mjs';

export const PROFILE_SCHEMA = 1;
const ANSWERS = ['agents', 'env', 'sandbox', 'share', 'packs', 'singles', 'tier', 'paths', 'disabled'];

// The optional packs whose plugin is installed: the profile's global packs.
export function installedPacks(ctx) {
  const installed = installedPlugins(ctx);
  return [...new Set(Object.entries(PLUGINS).flatMap(([a, list]) => list.filter((p) => p.pack && installed[a]?.includes(p.id)).map((p) => p.pack)))];
}

export function exportProfile(ctx, { agents, packs = [] }) {
  const projects = listProjects(ctx).map(({ path }) => {
    const s = tryState(path);
    return { path, ...(s ? { answers: Object.fromEntries(ANSWERS.filter((k) => k in s).map((k) => [k, s[k]])) } : {}) };
  });
  const own = ownPacks(ctx).map(({ id, title, skills }) => ({ id, title, skills }));
  return `${JSON.stringify({ kind: 'benchkeeper-profile', schemaVersion: PROFILE_SCHEMA, appVersion, global: { agents, packs }, packs: own, projects }, null, 2)}\n`;
}

export function readProfile(text) {
  let p;
  try { p = JSON.parse(text); } catch (e) { throw new Error(`profile: ${e.message}`); }
  if (p?.kind !== 'benchkeeper-profile') throw new Error('not a BenchKeeper profile');
  if (p.schemaVersion !== PROFILE_SCHEMA) throw new Error(`profile schemaVersion ${p.schemaVersion}, this app reads ${PROFILE_SCHEMA}`);
  if (!Array.isArray(p.global?.agents)) throw new Error('profile: global.agents missing');
  for (const a of p.global.agents) agent(a);
  for (const x of p.projects ?? []) if (typeof x.path !== 'string' || !isAbsolute(x.path)) throw new Error(`profile: project path ${x.path} is not absolute`);
  return p;
}

// The import plan: the global changes for the profile's agents and packs, plus the project setup of registered
// paths that exist here and have no state file yet. Paths missing here are listed and skipped.
export function importPlan(ctx, p, { devcontainerCli } = {}) {
  const global = preview(globalPlan({ ctx, agents: p.global.agents, options: { packs: p.global.packs ?? [] }, devcontainerCli }));
  const projects = [], missing = [];
  for (const x of p.projects ?? []) {
    if (!existsSync(x.path)) { missing.push(x.path); continue; }
    // A folder that cannot be a project (a drive root, the home folder) is not given a plan, whatever the file says.
    if (unfit(ctx, x.path)) continue;
    const pctx = projectCtx(ctx, x.path);
    const changes = readState(x.path) || !x.answers ? [] : preview(projectPlan({ ctx: pctx, dir: x.path, answers: { ...x.answers, skills: x.answers.singles, singles: undefined } }).changes);
    projects.push({ path: x.path, ctx: pctx, changes });
  }
  return { global, projects, missing };
}

// Own packs and the project registry; the plans apply through the step engine like any other run.
export function importChoices(ctx, p) {
  const packs = (p.packs ?? []).map((x) => savePack(ctx, x).id);
  const projects = [], refused = [];
  for (const x of (p.projects ?? []).filter((y) => existsSync(y.path))) {
    try { projects.push(addProject(ctx, x.path, { worktree: true })); } catch (e) { refused.push(e.message); }
  }
  return { packs, projects, refused };
}
