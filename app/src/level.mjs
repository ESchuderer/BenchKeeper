// The install level found on this machine: lite (the BenchKeeper plugin), standard (plus a project setup), full (plus the
// global rules). The highest one present counts; null when nothing is installed.
import { join } from 'node:path';
import { agent } from './agents.mjs';
import { exists, readText } from './fsx.mjs';
import { listProjects } from './projects.mjs';
import { pluginState } from './steps/global.mjs';
import { tryState } from './steps/project.mjs';

// A line of the global rules that every version of the file carries: the file is the app's, so its text says it is there.
const ID = 'benchkeeper@benchkeeper';
const GLOBAL_RULES_MARK = 'Keep secrets out of output';

export const ADDS = {
  lite: 'standard adds the local project block (benchkeeper projects apply in each repository); full adds the global rules, settings, packs and the app setup (benchkeeper apply --level full)',
  standard: 'full adds the global rules, settings, packs and the app setup (benchkeeper apply --level full)',
};

export function detectLevel(ctx, agents, dir) {
  const rules = agents.some((id) => readText(join(ctx.home, agent(id).global.rules.path))?.includes(GLOBAL_RULES_MARK));
  const project = [dir, ...listProjects(ctx).map((p) => p.path)].some((d) => d && tryState(d));
  const plugin = agents.some((id) => { try { return agent(id).plugins && pluginState(ctx, id).listed.some((p) => p.id === ID && p.enabled); } catch { return false; } });
  const level = rules ? 'full' : project ? 'standard' : plugin ? 'lite' : null;
  return { level, adds: ADDS[level] ?? null };
}

// The level a plan or fix uses when none is named: the one found, so a lite machine is not grown to full by accident.
export const levelFor = (ctx, agents, dir) => detectLevel(ctx, agents, dir).level ?? 'full';
