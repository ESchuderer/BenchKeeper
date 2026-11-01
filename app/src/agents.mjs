// Agent registry (agents.json) and the renderers for each file format it names.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as tomlStringify } from 'smol-toml';
import { mergeJson, setBlock } from './merge.mjs';

export const registry = JSON.parse(readFileSync(new URL('./agents.json', import.meta.url), 'utf8')).agents;
export const agent = (id) => registry.find((a) => a.id === id) ?? (() => { throw new Error(`unknown agent ${id}`); })();

// Features that exist for some agents only; a missing one is reported, never skipped silently.
export const FEATURES = { plugins: 'plugin install', usage: 'the usage feed', accounts: 'accounts', tier: 'the tier strip' };
const has = (a, feature) => (feature === 'plugins' ? a.plugins : a.features[feature]);
export const notAvailable = (feature, id) => `${FEATURES[feature]} is not available for ${agent(id).name}`;
export const unavailable = (id) => Object.keys(FEATURES).filter((f) => !has(agent(id), f)).map((f) => notAvailable(f, id));
export const supports = (id, feature) => has(agent(id), feature);

// Installed agents with their versions. The app never installs an agent.
export function detect(ctx) {
  return registry.map((a) => {
    const r = ctx.run([a.bin, '--version']);
    const version = r.code === 0 ? (r.stdout.match(/\d{1,9}\.\d{1,9}\.\d{1,9}[\w.-]*/) ?? [r.stdout.trim()])[0] : null;
    return { id: a.id, name: a.name, tested: a.tested, installed: r.code === 0, version };
  });
}

// Skill folders for a set of agents, one entry per folder: agents that read the same folder share one copy.
export function skillDirs(ids, scope, base) {
  const dirs = new Map();
  for (const id of ids) {
    const dir = join(base, agent(id)[scope].skills);
    dirs.set(dir, [...(dirs.get(dir) ?? []), id]);
  }
  return [...dirs].map(([dir, agents]) => ({ dir, agents }));
}

// Agents without plugins know BenchKeeper's skills by their bare names.
export const forAgent = (text, id) => (agent(id).plugins ? text : text.replaceAll('benchkeeper:', ''));

// Instructions: 'file' owns the whole file, 'block' merges a marked block, 'import' is CLAUDE.md pointing at AGENTS.md.
export function renderRules(format, current, rules) {
  if (format === 'file') return rules;
  if (format === 'block') return setBlock(current, 'rules', rules);
  if (format === 'import') return current?.trim() ? (current.includes('@AGENTS.md') ? current : `@AGENTS.md\n\n${current}`) : '@AGENTS.md\n';
  throw new Error(`no renderer for rules format ${format}`);
}

// Subagent definition { name, description, prompt, tools? } in the agent's own format.
export function renderSubagent(format, s) {
  if (format === 'toml') return `${tomlStringify({ name: s.name, description: s.description, developer_instructions: s.prompt }).trimEnd()}\n`;
  const fm = [`name: ${s.name}`, `description: ${JSON.stringify(s.description)}`];
  if (s.tools) fm.push(`tools: ${format === 'copilot-agent' ? JSON.stringify(s.tools) : s.tools.join(', ')}`);
  if (format === 'markdown' || format === 'copilot-agent') return `---\n${fm.join('\n')}\n---\n\n${s.prompt.trimEnd()}\n`;
  throw new Error(`no renderer for subagent format ${format}`);
}
export const subagentFile = (format, name) => `${name}${format === 'toml' ? '.toml' : format === 'copilot-agent' ? '.agent.md' : '.md'}`;

// Settings edits [{ path, value | append }] for JSON and JSONC (comments kept); TOML takes [{ table, key, value }].
export { mergeJson as renderJsonSettings };
