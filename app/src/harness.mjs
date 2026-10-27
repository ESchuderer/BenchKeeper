// benchkeeper test: deterministic checks of an installed setup, no agent session.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { agent } from './agents.mjs';
import { contentDir, library } from './content.mjs';
import { globalDrift } from './doctor.mjs';
import { exists, hashPath, readText } from './fsx.mjs';
import { PLUGINS, pluginState } from './steps/global.mjs';
import { readState } from './steps/project.mjs';

const check = (name, problems) => ({ name, ok: problems.length === 0, problems });

// Each path's newest recorded change still holds: written files have the recorded hash, removed ones are gone.
function ledgerCheck(ctx) {
  const seen = new Set(), problems = [];
  for (const run of ctx.ledger.list()) {
    if (run.scope !== 'global' && !exists(run.scope)) continue;
    for (const e of [...run.entries].reverse()) {
      if (!e.path || e.status !== 'done' || e.undone || seen.has(e.path)) continue;
      seen.add(e.path);
      if (e.kind === 'write' && hashPath(e.path) !== e.hashAfter) problems.push(`${e.path} changed since run ${run.id}`);
      if (e.kind === 'remove' && exists(e.path)) problems.push(`${e.path} is back after run ${run.id} removed it`);
    }
  }
  return check('installed files match the ledger', problems);
}

function pluginCheck(ctx, agents) {
  const problems = [];
  for (const a of agents.filter((x) => agent(x).plugins)) {
    const enabled = pluginState(ctx, a).listed.filter((p) => p.enabled).map((p) => p.id);
    for (const p of PLUGINS[a].filter((x) => !x.pack)) if (!enabled.includes(p.id)) problems.push(`${agent(a).name}: plugin ${p.id} not enabled`);
  }
  for (const a of agents.filter((x) => !agent(x).plugins)) {
    for (const s of readdirSync(join(contentDir, 'skills'))) if (!exists(join(ctx.home, agent(a).global.skills, s, 'SKILL.md'))) problems.push(`${agent(a).name}: skill ${s} missing`);
  }
  return check('each agent has the expected skills', problems);
}

// Library skills of the project: own copies present, community skills in skills-lock.json.
function projectCheck(dir) {
  const state = readState(dir);
  if (!state) return [];
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  let file;
  try { file = JSON.parse(readText(join(dir, 'skills-lock.json')) ?? '{}'); } catch { file = null; }
  const lock = plain(file) ? (Object.hasOwn(file, 'skills') ? file.skills : {}) : null;
  if (!plain(lock)) return [check(`project skills are installed (${dir})`, ['skills-lock.json is not a valid lock file'])];
  const problems = [];
  for (const s of state.skills.filter((x) => !(state.disabled ?? []).includes(x.name))) {
    if (s.source === 'own') {
      for (const a of state.agents) if (!exists(join(dir, agent(a).project.skills, s.name, 'SKILL.md'))) problems.push(`${s.name} missing in ${agent(a).project.skills}`);
    } else if (!lock[s.name]) problems.push(`${s.name} not in skills-lock.json`);
    else if (!JSON.stringify(lock[s.name]).includes(s.source)) problems.push(`${s.name} in skills-lock.json is not from ${s.source}`);
  }
  return [check(`project skills are installed (${dir})`, problems)];
}

export function harnessTest(ctx, { agents, dir } = {}) {
  // A fixed Dev Containers CLI version skips the npm lookup; host tools are not part of this check.
  const unexpected = globalDrift(ctx, agents, 'skip').filter((i) => i.check === 'unexpected').map((i) => i.message);
  return [ledgerCheck(ctx), pluginCheck(ctx, agents), check('nothing unexpected installed (skills, plugins, MCP servers, hooks)', unexpected), ...(dir ? projectCheck(dir) : [])];
}
