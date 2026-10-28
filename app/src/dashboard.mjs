// The Dashboard's numbers in one read: what is installed (skills and packs, global and per project), the state of
// every item, which packs reach which agents, and the catalog by pack. The global items come from the inventory the
// server caches; a project's items from its own plan, classified like the global ones.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { agent, skillDirs } from './agents.mjs';
import { classify } from './inventory.mjs';
import { exists } from './fsx.mjs';
import { libraryWith } from './packs.mjs';
import { listProjects, projectItemPlan, projectState, skillCounts } from './projects.mjs';
import { RANK } from './states.mjs';
import { PLUGINS, globalSkills, pluginState } from './steps/global.mjs';
import { lockedSkills } from './steps/project.mjs';

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;

// Item states in the order the bar draws them; untracked is a skill folder BenchKeeper did not install.
export const STATES = [...RANK, 'untracked'];
const count = (items) => Object.fromEntries(STATES.map((s) => [s, items.filter((i) => i.state === s).length]));

// A project's items: the plan's, plus each community skill that is in place and needs no change (the plan holds no step for it).
function projectItems(ctx, path, state) {
  const plan = projectItemPlan(ctx, path);
  if (!plan) return [];
  const items = new Map();
  const put = (step, title, s) => {
    const key = `${step}|${title}`;
    if (!items.has(key) || RANK.indexOf(s) > RANK.indexOf(items.get(key).state)) items.set(key, { step, title, state: s });
  };
  classify(ctx, plan, put);
  const planned = new Set(plan.map((c) => c.step));
  const dirs = skillDirs(state.agents ?? [], 'project', path);
  for (const s of (state.skills ?? []).filter((x) => SKILL_NAME.test(x.name ?? '') && x.source !== 'own' && !(state.disabled ?? []).includes(x.name) && !planned.has(`skill:${x.name}`))) {
    if (dirs.some((d) => exists(join(d.dir, s.name)))) put(`skill:${s.name}`, `skill ${s.name}`, 'current');
  }
  return [...items.values()];
}

// Skill folders in a project's agent folders that its setup did not install: not in the state file, not in the skills CLI's lockfile.
function untracked(path, state) {
  const known = new Set([...(state.skills ?? []).map((s) => s.name), ...(state.disabled ?? []), ...lockedSkills(path)]);
  const found = new Set();
  for (const { dir } of skillDirs(state.agents ?? [], 'project', path)) {
    if (!exists(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => SKILL_NAME.test(n))) if (!known.has(name) && exists(join(dir, name, 'SKILL.md'))) found.add(name);
  }
  return found.size;
}

// The packs enabled as plugins, per agent (a pack that installs a plugin has no skill list).
const globalPacks = (ctx, agents) => Object.fromEntries(agents.map((a) => {
  const on = pluginState(ctx, a).listed.filter((p) => p.enabled).map((p) => p.id);
  return [a, (PLUGINS[a] ?? []).filter((p) => p.pack && on.includes(p.id)).map((p) => p.pack)];
}));

// agents: ids of the installed agents; items: the global inventory.
export function dashboard(ctx, agents, items) {
  const lib = libraryWith(ctx);
  // One project that cannot be read (a moved folder, an unfit one, a state file naming an unknown agent) shows as such, the others stay.
  // shortcut: every project is read in this request; move it to a job when 25 projects make it slow.
  const projects = listProjects(ctx).map((p) => {
    const row = { path: p.path, name: p.name ?? null, setup: false, agents: [], packs: [], skills: {}, states: null, untracked: 0, error: null };
    try {
      const state = projectState(ctx, p.path);
      if (!state) return row;
      const ids = (state.agents ?? []).filter((a) => { try { return !!agent(a); } catch { return false; } });
      // What the state file says stays when the plan cannot be built (a setup still committed to the repository).
      const base = { ...row, setup: true, agents: ids, packs: state.packs ?? [], skills: skillCounts(p.path, ids) };
      try {
        return { ...base, states: count(projectItems(ctx, p.path, { ...state, agents: ids })), untracked: untracked(p.path, { ...state, agents: ids }) };
      } catch (e) { return { ...base, error: e.message }; }
    } catch (e) { return { ...row, error: e.message }; }
  });
  const global = { skills: Object.fromEntries(agents.map((a) => [a, globalSkills(ctx, a)])), packs: globalPacks(ctx, agents), states: count(items) };
  const known = [...new Set([...agents, ...projects.flatMap((p) => p.agents)])];
  const codexOnly = (name) => lib.skills.find((s) => s.name === name)?.agents === 'codex';
  const packs = lib.packs.map((p) => ({
    id: p.id, title: p.title ?? p.id, own: !!p.own, skills: p.skills?.length ?? null,
    // A cell: the registered projects that chose the pack for that agent.
    cells: Object.fromEntries(known.map((a) => [a, projects.filter((x) => x.packs.includes(p.id) && x.agents.includes(a)).length])),
    // What exists for one agent only: skills that are Codex's, the agents a plugin pack has a plugin for.
    codexOnly: (p.skills ?? []).filter(codexOnly),
    plugin: Object.keys(p.plugins ?? {}),
  }));
  return {
    global, projects,
    coverage: { agents: known.map((a) => ({ id: a, name: agent(a).name })), packs },
    catalog: packs.filter((p) => p.skills !== null).map((p) => ({ id: p.id, title: p.title, skills: p.skills })).sort((a, b) => b.skills - a.skills || a.title.localeCompare(b.title)),
  };
}
