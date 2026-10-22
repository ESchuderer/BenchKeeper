// Project setup: where the agent runs, AGENTS.md and CLAUDE.md, packs and library skills, the project state file.
// Steps that need judgement (stack skills, AGENTS.md commands, the dev container, Matt Pocock's repository setup)
// run in an agent session the app records (session.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agent, skillDirs } from '../agents.mjs';
import { appVersion, contentDir, library } from '../content.mjs';
import { exists, listFiles, readText } from '../fsx.mjs';
import { getBlock, mergeJson, parseJson, setBlock } from '../merge.mjs';
import { PLUGINS, SKILLS_CLI } from './global.mjs';

export const STATE = '.benchkeeper/state.json';
export const ENVS = {
  container: 'The agent runs inside the dev container (`.devcontainer/`): start it with `devcontainer exec --workspace-folder . <agent>`. Installs, builds, lint, tests and local MCP or browser tools run there too.',
  'host-agent': "The agent, Git and file edits run on the host. Installs, builds, lint, tests and local MCP or browser tools run in the dev container: prefix `devcontainer exec --workspace-folder .`, compound commands as `devcontainer exec --workspace-folder . sh -lc '...'`. If the container cannot start, report it and stop that command.",
  sandbox: 'The agent runs in a Docker Sandboxes microVM (`sbx`) with its own container engine. Installs, builds and tests run inside it.',
  host: null,
};
const SKILLS_FLAG = { claude: 'claude-code', codex: 'codex', gemini: 'gemini-cli', copilot: 'github-copilot' };
const TIERS = ['quick', 'standard', 'full', 'research'];

export function readState(dir) {
  const text = readText(join(dir, STATE));
  return text ? JSON.parse(text) : null;
}

// answers: { agents, env, sandbox, packs, skills, tier, paths: { skill: 'glob, glob' } }; missing answers come from the state file.
export function resolveAnswers(dir, answers = {}) {
  const prev = readState(dir) ?? {};
  const a = { agents: prev.agents ?? [], env: prev.env ?? 'container', sandbox: prev.sandbox ?? false, packs: prev.packs ?? [], skills: (prev.skills ?? []).map((s) => s.name), disabled: prev.disabled ?? [], tier: prev.tier ?? null, paths: prev.paths ?? {}, ...Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) };
  if (!a.agents.length) throw new Error('choose the agents for this project (--agents)');
  if (!(a.env in ENVS)) throw new Error(`env must be one of ${Object.keys(ENVS).join(', ')}`);
  if (a.tier && !TIERS.includes(a.tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
  return a;
}

// Skills a project gets: the chosen packs' skills plus single skills, minus those the catalog limits to other agents.
export function chosenSkills(a, lib = library()) {
  const names = new Set([...a.packs.flatMap((p) => lib.packs.find((x) => x.id === p)?.skills ?? []), ...a.skills]);
  return lib.skills.filter((s) => names.has(s.name) && (s.agents !== 'codex' || a.agents.includes('codex')));
}

export function projectPlan({ ctx, dir, answers, plugins = {} }) {
  const a = resolveAnswers(dir, answers);
  const lib = library();
  for (const p of a.packs) if (!lib.packs.some((x) => x.id === p)) throw new Error(`unknown pack ${p}`);
  const at = (p) => join(dir, p);
  const changes = [];
  const add = (step, title, c) => changes.push({ id: `${step}:${changes.length}`, step, title, ...c });
  const skills = chosenSkills(a, lib);

  // AGENTS.md: one block with where commands run, the default tier, and the pointer lines of own skills.
  const lines = [ENVS[a.env], a.tier && `Default tier: ${a.tier}`, ...skills.filter((s) => s.source === 'own' && !a.disabled.includes(s.name)).map((s) => s.pointer?.match(/^`([^`]+)`/)?.[1])].filter(Boolean);
  add('agents-md', 'AGENTS.md: where commands run, default tier, skill pointers', { kind: 'write', path: at('AGENTS.md'), edit: (t) => setBlock(t, 'project', lines.length ? lines.map((l) => `- ${l}`).join('\n') : null) });
  if (a.agents.includes('claude')) add('claude-md', 'CLAUDE.md imports AGENTS.md', { kind: 'write', path: at('CLAUDE.md'), edit: (t) => (t?.includes('@AGENTS.md') ? t : t?.trim() ? `@AGENTS.md\n\n${t}` : '@AGENTS.md\n') });
  if (a.agents.includes('gemini')) {
    const s = agent('gemini').project.rules.setting;
    add('gemini-context', 'Gemini CLI reads AGENTS.md', { kind: 'write', path: at(s.path), edit: (t) => mergeJson(t, [{ path: s.key, value: s.value }]) });
  }
  // Matt Pocock's setup writes its block into CLAUDE.md; Codex reads AGENTS.md, so it moves there.
  const block = /\n?## Agent skills\n[\s\S]*?(?=\n## |\s*$)/;
  if (a.agents.includes('codex') && a.agents.includes('claude') && block.test(readText(at('CLAUDE.md')) ?? '') && !/## Agent skills/.test(readText(at('AGENTS.md')) ?? '')) {
    const moved = readText(at('CLAUDE.md')).match(block)[0].trim();
    add('agent-skills-block', 'move the ## Agent skills block from CLAUDE.md to AGENTS.md (Codex reads AGENTS.md)', { kind: 'write', path: at('AGENTS.md'), edit: (t) => `${(t ?? '').trimEnd()}\n\n${moved}\n` });
    add('agent-skills-block', 'remove the moved block from CLAUDE.md', { kind: 'write', path: at('CLAUDE.md'), edit: (t) => `${t.replace(block, '').trimEnd()}\n` });
  }
  if (a.sandbox && a.agents.includes('claude')) {
    add('sandbox', 'Claude Code sandbox on; devcontainer and podman run outside it (they cannot start inside)', { kind: 'write', path: at('.claude/settings.json'), edit: (t) => mergeJson(t, [{ path: ['sandbox', 'enabled'], value: true }, { path: ['sandbox', 'excludedCommands'], append: ['devcontainer exec *', 'podman *'] }]) });
  }

  // Packs with a plugin: installed globally when missing; their prompts are listed for the user.
  for (const id of a.packs) {
    const pack = lib.packs.find((x) => x.id === id);
    for (const ag of Object.keys(pack.plugins ?? {}).filter((x) => a.agents.includes(x))) {
      const p = PLUGINS[ag].find((x) => x.pack === id);
      if (p && !(plugins[ag] ?? []).includes(p.id)) {
        if (p.source) add(`pack:${id}:${ag}`, `${agent(ag).name} marketplace ${p.marketplace}`, { kind: 'command', argv: [ag, 'plugin', 'marketplace', 'add', p.source], undoArgv: [ag, 'plugin', 'marketplace', 'remove', p.marketplace] });
        add(`pack:${id}:${ag}`, `${agent(ag).name} plugin ${p.id}`, ag === 'claude' ? { kind: 'command', argv: ['claude', 'plugin', 'install', p.id], undoArgv: ['claude', 'plugin', 'uninstall', p.id] } : { kind: 'command', argv: ['codex', 'plugin', 'add', p.id], undoArgv: ['codex', 'plugin', 'remove', p.id] });
      }
    }
  }

  // Library skills: own skills copied into each skill folder, community skills through the skills CLI at the pinned commit.
  for (const s of skills.filter((x) => !a.disabled.includes(x.name))) {
    const ids = a.agents.filter((x) => s.agents !== 'codex' || x === 'codex');
    if (s.source === 'own') {
      const src = join(contentDir, 'library', s.name);
      for (const { dir: d } of skillDirs(ids, 'project', dir)) {
        for (const f of listFiles(src)) {
          let text = readFileSync(join(src, f), 'utf8');
          if (f === 'SKILL.md' && a.paths[s.name]) text = text.replace(/^(description: .*)$/m, `$1\npaths: ${a.paths[s.name]}`);
          add(`skill:${s.name}`, `skill ${s.name} (own) in ${d.slice(dir.length + 1)}`, { kind: 'write', path: join(d, s.name, f), after: text });
        }
      }
    } else {
      const missing = skillDirs(ids, 'project', dir).filter(({ dir: d }) => !exists(join(d, s.name))).flatMap((x) => x.agents);
      if (!missing.length) continue;
      const flags = [...new Set(missing.map((x) => SKILLS_FLAG[x]))].flatMap((f) => ['-a', f]);
      add(`skill:${s.name}`, `skill ${s.name} from ${s.source} at ${s.ref.slice(0, 12)}`, {
        kind: 'command', cwd: dir, env: { DO_NOT_TRACK: '1' },
        argv: ['npx', '-y', `skills@${SKILLS_CLI}`, 'add', `https://github.com/${s.source}/tree/${s.ref}`, '-s', s.name, ...flags, '--copy', '-y'],
        undoArgv: ['npx', '-y', `skills@${SKILLS_CLI}`, 'remove', s.name, ...flags, '-y'],
      });
    }
  }

  // The state file, read by Update all and by setting-up-projects.
  const state = { schemaVersion: 1, setupVersion: appVersion, agents: a.agents, env: a.env, sandbox: a.sandbox, packs: a.packs, tier: a.tier, paths: a.paths, disabled: a.disabled,
    skills: skills.map((s) => ({ name: s.name, source: s.source, ...(s.ref ? { ref: s.ref } : {}) })) };
  add('state', `${STATE}: setup version ${appVersion}`, { kind: 'write', path: at(STATE), after: `${JSON.stringify(state, null, 2)}\n` });
  return { changes, answers: a, prompts: promptsFor(a, lib) };
}

// What the user starts after the deterministic steps: the setup skill session, and the packs' own prompts.
export function promptsFor(a, lib = library()) {
  const first = a.agents.includes('claude') ? 'claude' : a.agents[0];
  const p = [{ agent: first, prompt: first === 'codex' ? '$benchkeeper:setting-up-projects' : first === 'claude' ? '/benchkeeper:setting-up-projects' : 'Load the setting-up-projects skill and run it.', why: 'stack skills, AGENTS.md commands, the dev container' }];
  for (const id of a.packs) for (const x of lib.packs.find((y) => y.id === id)?.prompts ?? []) p.push({ agent: first, prompt: first === 'codex' ? x.codex : x.claude, why: x.why });
  return p;
}

export const blockOf = (dir) => getBlock(readText(join(dir, 'AGENTS.md')), 'project');
export { parseJson };
