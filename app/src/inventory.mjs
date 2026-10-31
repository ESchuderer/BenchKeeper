// Global items with their install state, for the Dashboard. preview() drops items that already match, so this walks
// the raw global plan; plugins and host tools appear there only when missing, so an expected one absent from it is current.
import { agent } from './agents.mjs';
import { hashPath, readText } from './fsx.mjs';
import { containerProjects } from './level.mjs';
import { itemState } from './runner.mjs';
import { RANK } from './states.mjs';
import { PLUGINS, globalPlan } from './steps/global.mjs';

// The state of each change of a plan against the files as they are, given to put(step, title, state); also for a project's plan.
export function classify(ctx, plan, put) {
  // An optional step left off is not drift.
  for (const c of plan.filter((x) => !x.optional)) {
    if (c.kind === 'command' || c.kind === 'remove' || c.destructive) { put(c.step, c.title, c.outdated ? 'outdated' : c.kind === 'command' && !c.destructive ? 'missing' : 'foreign'); continue; }
    // Each edit against the file as it is, so one pending edit of settings.json does not mark the others.
    let after;
    try { after = c.edit ? c.edit(readText(c.path)) : c.after; } catch { put(c.step, c.title, 'error'); continue; }
    put(c.step, c.title, itemState(c.path, c.from ? hashPath(c.from) : after, ctx));
  }
}

export function inventory(ctx, agents, { devcontainerCli, level = 'full' } = {}) {
  const items = new Map();
  const agentOf = (step) => (agents.includes(step.split(':')[1]) ? step.split(':')[1] : 'machine');
  // A step can hold several changes with one title (a skill copy per file): the worst state counts.
  const put = (step, title, state) => {
    const key = `${step}|${title}`;
    if (!items.has(key) || RANK.indexOf(state) > RANK.indexOf(items.get(key).state)) items.set(key, { step, agent: agentOf(step), title, state });
  };
  const containers = containerProjects(ctx);
  const plan = globalPlan({ ctx, agents, devcontainerCli, options: { level, containers } });
  classify(ctx, plan, put);
  const planned = new Set(plan.map((c) => c.step));
  for (const a of ['claude', 'codex'].filter((x) => agents.includes(x))) {
    for (const p of PLUGINS[a].filter((x) => !x.pack && (level === 'full' || x.id.startsWith('benchkeeper@')))) if (!planned.has(`plugin:${a}:${p.id}`)) put(`plugin:${a}:${p.id}`, `${agent(a).name} plugin ${p.id}`, 'current');
  }
  if (level !== 'full') return [...items.values()];
  if (containers && !planned.has('tools:devcontainer')) put('tools:devcontainer', 'Dev Containers CLI', ctx.run(['devcontainer', '--version']).code === 0 ? 'current' : 'missing');
  if (!planned.has('tools:skill:find-skills')) put('tools:skill:find-skills', 'global skill find-skills from vercel-labs/skills', 'current');
  return [...items.values()];
}
