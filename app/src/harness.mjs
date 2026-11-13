// benchkeeper verify: deterministic checks of an installed setup, no agent session.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { agent } from './agents.mjs';
import { contentDir } from './content.mjs';
import { exists, readText } from './fsx.mjs';
import { rootOf } from './git.mjs';
import { drift, newerPaths } from './integrity.mjs';
import { errorLine, policyCheck } from './params.mjs';
import { copied } from './packs.mjs';
import { PLUGINS, pluginState } from './steps/global.mjs';
import { COORDINATOR_FILES, readState } from './steps/project.mjs';

const check = (name, problems) => ({ name, ok: problems.length === 0, problems });

// Each path's newest recorded change still holds: written files have the recorded hash, removed ones are gone.
function ledgerCheck(ctx) {
  const seen = newerPaths(), problems = [];
  for (const run of ctx.ledger.list()) {
    if (run.scope !== 'global' && !exists(run.scope)) continue;
    for (const e of [...run.entries].reverse()) {
      for (const d of drift(e, seen)) problems.push(d.error ? `${d.path} cannot be read (${d.error})` : d.removed ? `${d.path} is back after run ${run.id} removed it` : `${d.path} changed since run ${run.id}`);
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

// At the repository root, where the coordinator reads it; a project without a setup can have one too.
function coordinatorPolicy(ctx, dir) {
  const root = rootOf(ctx, dir), text = readText(join(root, COORDINATOR_FILES[0]));
  if (text == null) return [];
  let problems;
  try { problems = policyCheck(text).errors.map(errorLine); } catch (e) { problems = [e.message]; }
  return [check(`the coordinator policy is valid (${root})`, problems)];
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
    if (copied(s)) {
      for (const a of state.agents) if (!exists(join(dir, agent(a).project.skills, s.name, 'SKILL.md'))) problems.push(`${s.name} missing in ${agent(a).project.skills}`);
    } else if (!lock[s.name]) problems.push(`${s.name} not in skills-lock.json`);
    else if (!JSON.stringify(lock[s.name]).includes(s.source)) problems.push(`${s.name} in skills-lock.json is not from ${s.source}`);
  }
  return [check(`project skills are installed (${dir})`, problems)];
}

export function harnessTest(ctx, { agents, dir } = {}) {
  return [ledgerCheck(ctx), pluginCheck(ctx, agents), ...(dir ? [...coordinatorPolicy(ctx, dir), ...projectCheck(dir)] : [])];
}
