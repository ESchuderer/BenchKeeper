// Project setup: where the agent runs, AGENTS.md and CLAUDE.md, packs and library skills, the project state file.
// Steps that need judgement (stack skills, AGENTS.md commands, the dev container, Matt Pocock's repository setup)
// run in an agent session the app records (session.mjs).
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { agent, skillDirs } from '../agents.mjs';
import { appVersion, contentDir, library } from '../content.mjs';
import { exists, listFiles, readText } from '../fsx.mjs';
import { getBlock, mergeJson, parseJson, setBlock } from '../merge.mjs';
import { libraryWith, warnings } from '../packs.mjs';
import { PLUGINS, SKILLS_SPEC, pin } from './global.mjs';

export const STATE = '.benchkeeper/state.json';
// The skills CLI's lockfile: its commands change it next to the skill folders.
const LOCK = 'skills-lock.json';
export const ENVS = {
  container: 'The agent runs inside the dev container (`.devcontainer/`): start it with `devcontainer exec --workspace-folder . <agent>`. Installs, builds, lint, tests and local MCP or browser tools run there too.',
  'host-agent': "The agent, Git and file edits run on the host. Installs, builds, lint, tests and local MCP or browser tools run in the dev container: prefix `devcontainer exec --workspace-folder .`, compound commands as `devcontainer exec --workspace-folder . sh -lc '...'`. If the container cannot start, report it and stop that command.",
  sandbox: 'The agent runs in a Docker Sandboxes microVM (`sbx`) with its own container engine. Installs, builds and tests run inside it.',
  host: null,
};
const SKILLS_FLAG = { claude: 'claude-code', codex: 'codex', gemini: 'gemini-cli', copilot: 'github-copilot' };
export const TIERS = ['quick', 'standard', 'full', 'research'];
// Own keys only: "constructor" or ["container"] must not pass as an environment.
export const isEnv = (id) => typeof id === 'string' && Object.hasOwn(ENVS, id);
// The skills CLI runs in the project: a project .npmrc must not choose where it comes from.
const NPX_ENV = { DO_NOT_TRACK: '1', npm_config_registry: 'https://registry.npmjs.org/' };

const tryJson = (t) => { try { return t == null ? null : parseJson(t); } catch { return null; } };

export function readState(dir) {
  const text = readText(join(dir, STATE));
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { throw new Error(`${join(dir, STATE)}: ${e.message}`); }
}
// For listings: an unreadable state file counts as none, so one broken project does not hide the others.
export const tryState = (dir) => { try { return readState(dir); } catch { return null; } };

// answers: { agents, env, sandbox, packs, skills (single skills besides the packs'), disable, enable, tier,
// paths: { skill: 'glob, glob' } }; missing answers come from the state file.
export function resolveAnswers(dir, { disable = [], enable = [], ...answers } = {}) {
  const prev = readState(dir) ?? {};
  const a = { agents: prev.agents ?? [], env: prev.env ?? suggest(dir).env?.id ?? 'container', sandbox: prev.sandbox ?? false, packs: prev.packs ?? [], skills: prev.singles ?? [], disabled: prev.disabled ?? [], tier: prev.tier ?? null, paths: prev.paths ?? {}, ...Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) };
  a.disabled = [...new Set([...a.disabled, ...disable])].filter((n) => !enable.includes(n));
  if (!a.agents.length) throw new Error('choose the agents for this project (--agents)');
  if (!isEnv(a.env)) throw new Error(`env must be one of ${Object.keys(ENVS).join(', ')}`);
  if (a.tier && !TIERS.includes(a.tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
  // paths values go into SKILL.md front matter.
  for (const [k, v] of Object.entries(a.paths)) if (typeof v !== 'string' || /[\r\n]/.test(v)) throw new Error(`paths for ${k}: one line of globs`);
  return a;
}

// Where hand-written AGENTS.md text (outside the BenchKeeper block) says the agent runs: host, sandbox, container or null.
const AGENT_RUNS = /\bagents?\b([^.\n;]{0,40})\bruns? (on the host|(?:inside|in) (?:the|a) (?:[\w-]+ ){0,2}(dev ?container|container|sandbox(?:es)?|microVM))/gi;
// The first statement that is not negated ("does not run on the host").
const agentPlace = (text) => {
  const m = [...text.matchAll(AGENT_RUNS)].find((x) => !/\b(not|never|cannot)\b|n't\b/i.test(x[1]));
  return !m ? null : m[2].endsWith('host') ? 'host' : /container/i.test(m[3]) ? 'container' : 'sandbox';
};
// The project's commands go through the dev container: the text names it (devcontainer exec, dev container).
const COMMANDS_IN_CONTAINER = /devcontainer exec|dev ?container/i;
const placeOf = (env) => (['host-agent', 'host'].includes(env) ? 'host' : env);
const handWritten = (dir) => setBlock(readText(join(dir, 'AGENTS.md')) ?? '', 'project', null);

// Packs a project's files point to, each with its reason; the setup step offers them chosen.

export function suggest(dir) {
  const has = (p) => exists(join(dir, p));
  let pkg = {};
  try { pkg = JSON.parse(readText(join(dir, 'package.json')) ?? '{}'); } catch { /* no hints from a broken package.json */ }
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const dep = (re) => deps.find((d) => re.test(d));
  const py = ['pyproject.toml', 'requirements.txt', 'environment.yml'].map((f) => readText(join(dir, f)) ?? '').join('\n');
  const pyDep = (re) => py.match(re)?.[1];
  const hints = [
    ['frontend', dep(/^(react|vue|svelte|astro|next|preact|solid-js|@angular\/core)$/) && `package.json uses ${dep(/^(react|vue|svelte|astro|next|preact|solid-js|@angular\/core)$/)}`],
    ['testing', (dep(/^(@playwright\/test|playwright|cypress)$/) && `package.json uses ${dep(/^(@playwright\/test|playwright|cypress)$/)}`) || (['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'].some(has) && 'a Playwright config')],
    ['security', has('.github/workflows') && 'CI workflows in .github/workflows'],
    ['docs', (has('docs') && 'a docs folder') || (has('mkdocs.yml') && 'mkdocs.yml')],
    ['science', pyDep(/\b(numpy|scipy|jupyter|matplotlib|sympy)\b/) && `Python uses ${pyDep(/\b(numpy|scipy|jupyter|matplotlib|sympy)\b/)}`],
    ['data', pyDep(/\b(pandas|polars|duckdb|pyarrow)\b/) && `Python uses ${pyDep(/\b(pandas|polars|duckdb|pyarrow)\b/)}`],
    ['operations', ['compose.yaml', 'docker-compose.yml', 'k8s', 'helm', 'terraform'].find(has) && `${['compose.yaml', 'docker-compose.yml', 'k8s', 'helm', 'terraform'].find(has)} in the repository`],
  ];
  const own = handWritten(dir);
  const place = agentPlace(own);
  const env = !place ? null : { id: place === 'host' ? (has('.devcontainer') && COMMANDS_IN_CONTAINER.test(own) ? 'host-agent' : 'host') : place, reason: `AGENTS.md says the agent runs ${{ host: 'on the host', container: 'inside the dev container', sandbox: 'in a sandbox' }[place]}` };
  return { packs: hints.filter(([, r]) => r).map(([id, reason]) => ({ id, reason })), devcontainer: has('.devcontainer'), env };
}

// Skills a project gets: the chosen packs' skills plus single skills, minus those the catalog limits to other agents.
export function chosenSkills(a, lib = library()) {
  const names = new Set([...a.packs.flatMap((p) => lib.packs.find((x) => x.id === p)?.skills ?? []), ...a.skills]);
  return lib.skills.filter((s) => names.has(s.name) && (s.agents !== 'codex' || a.agents.includes('codex')));
}

export function projectPlan({ ctx, dir, answers, plugins = {} }) {
  const a = resolveAnswers(dir, answers);
  const lib = libraryWith(ctx);
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
    add('agent-skills-block', 'move the ## Agent skills block from CLAUDE.md to AGENTS.md (Codex reads AGENTS.md)', { kind: 'write', path: at('AGENTS.md'), edit: (t) => `${(t ?? '').trimEnd()}\n\n${moved}\n`, unit: 'agent-skills-block' });
    add('agent-skills-block', 'remove the moved block from CLAUDE.md', { kind: 'write', path: at('CLAUDE.md'), edit: (t) => `${t.replace(block, '').trimEnd()}\n`, unit: 'agent-skills-block' });
  }
  const prev = readState(dir);
  const dropped = (prev?.agents ?? []).filter((x) => !a.agents.includes(x));
  const SANDBOX_OUT = ['devcontainer exec *', 'podman *'];
  if (a.sandbox && a.agents.includes('claude')) {
    add('sandbox', 'Claude Code sandbox on; devcontainer and podman run outside it (they cannot start inside)', { kind: 'write', path: at('.claude/settings.json'), edit: (t) => mergeJson(t, [{ path: ['sandbox', 'enabled'], value: true }, { path: ['sandbox', 'excludedCommands'], append: SANDBOX_OUT }]) });
  } else if (tryJson(readText(at('.claude/settings.json')))?.sandbox?.enabled === true) {
    // Preselected only when the state file shows this setup turned it on.
    add('sandbox', `Claude Code sandbox off${prev?.sandbox ? '' : ' (not turned on by BenchKeeper)'}`, { kind: 'write', path: at('.claude/settings.json'), selected: !!prev?.sandbox,
      edit: (t) => mergeJson(t, [{ path: ['sandbox', 'enabled'], remove: true }, { path: ['sandbox', 'excludedCommands'], pull: SANDBOX_OUT }, { path: ['sandbox'], prune: true }]) });
  }
  // An agent no longer chosen: what this setup wrote for it alone comes out.
  if (dropped.includes('claude') && readText(at('CLAUDE.md'))?.trim() === '@AGENTS.md') add('drop:claude', 'remove CLAUDE.md (only the AGENTS.md import; Claude Code is no longer chosen)', { kind: 'remove', path: at('CLAUDE.md'), selected: true });
  if (dropped.includes('gemini')) {
    const g = agent('gemini').project.rules.setting;
    const v = g.key.reduce((o, k) => o?.[k], tryJson(readText(at(g.path))));
    if (JSON.stringify(v) === JSON.stringify(g.value)) add('drop:gemini', 'Gemini CLI no longer reads AGENTS.md (not chosen)', { kind: 'write', path: at(g.path), edit: (t) => mergeJson(t, [{ path: g.key, remove: true }, { path: g.key.slice(0, -1), prune: true }]) });
  }

  // Packs with a plugin: installed globally when missing; their prompts are listed for the user.
  for (const id of a.packs) {
    const pack = lib.packs.find((x) => x.id === id);
    for (const ag of Object.keys(pack.plugins ?? {}).filter((x) => a.agents.includes(x))) {
      const p = PLUGINS[ag].find((x) => x.pack === id);
      if (p && !(plugins[ag] ?? []).includes(p.id)) {
        if (p.source) add(`pack:${id}:${ag}`, `${agent(ag).name} marketplace ${p.marketplace}`, { kind: 'command', argv: [ag, 'plugin', 'marketplace', 'add', `${p.source}${ag === 'claude' ? '#' : '@'}${pin(p, appVersion).ref}`], undoArgv: [ag, 'plugin', 'marketplace', 'remove', p.marketplace], unit: `pack:${id}:${ag}` });
        add(`pack:${id}:${ag}`, `${agent(ag).name} plugin ${p.id}`, { unit: `pack:${id}:${ag}`, ...(ag === 'claude' ? { kind: 'command', argv: ['claude', 'plugin', 'install', p.id], undoArgv: ['claude', 'plugin', 'uninstall', p.id] } : { kind: 'command', argv: ['codex', 'plugin', 'add', p.id], undoArgv: ['codex', 'plugin', 'remove', p.id] }) });
      }
    }
  }

  // A skill turned off moves to .benchkeeper/disabled/<skill folder>/<name>; turned on, it moves back.
  const rel = (p) => relative(dir, p);
  const parked = (d, name) => join(dir, '.benchkeeper/disabled', rel(d), name);
  const moveDir = (step, from, to) => {
    add(step, `copy ${rel(from)} to ${rel(to)}`, { kind: 'write', path: to, from, unit: `move:${from}` });
    add(step, `remove ${rel(from)} (copied to ${rel(to)})`, { kind: 'remove', path: from, selected: true, unit: `move:${from}` });
  };

  // Library skills: own skills copied into each skill folder, community skills through the skills CLI at the pinned commit
// (undo puts back the copies of their folders and the lockfile taken before the command).
  // The state file comes with the repository: only commit ids count.
  // The install command of each community skill: the state file records its new commit only once that ran.
  const installs = new Map();
  const installedRefs = new Map((readState(dir)?.skills ?? []).filter((x) => /^[0-9a-f]{40}$/.test(x.ref ?? '')).map((x) => [x.name, x.ref]));
  for (const s of skills) {
    const ids = a.agents.filter((x) => s.agents !== 'codex' || x === 'codex');
    const dirs = skillDirs(ids, 'project', dir);
    if (a.disabled.includes(s.name)) {
      for (const { dir: d } of dirs) if (exists(join(d, s.name))) moveDir(`off:${s.name}`, join(d, s.name), parked(d, s.name));
      continue;
    }
    const back = dirs.filter(({ dir: d }) => exists(parked(d, s.name)) && !exists(join(d, s.name)));
    for (const { dir: d } of back) moveDir(`on:${s.name}`, parked(d, s.name), join(d, s.name));
    const rest = dirs.filter((x) => !back.includes(x));
    if (s.source === 'own') {
      const src = join(contentDir, 'library', s.name);
      for (const { dir: d } of rest) {
        for (const f of listFiles(src)) {
          let text = readFileSync(join(src, f), 'utf8');
          if (f === 'SKILL.md' && a.paths[s.name]) text = text.replace(/^(description: .*)$/m, `$1\npaths: ${a.paths[s.name]}`);
          add(`skill:${s.name}`, `skill ${s.name} (own) in ${d.slice(dir.length + 1)}`, { kind: 'write', path: join(d, s.name, f), after: text });
        }
      }
    } else {
      // A skill the state file records at another commit is added again at the library's pin.
      const was = installedRefs.get(s.name);
      const targets = rest.filter(({ dir: d }) => (was && was !== s.ref) || !exists(join(d, s.name)));
      const missing = targets.flatMap((x) => x.agents);
      if (!missing.length) continue;
      const flags = [...new Set(missing.map((x) => SKILLS_FLAG[x]))].flatMap((f) => ['-a', f]);
      installs.set(s.name, `skill:${s.name}:${changes.length}`);
      add(`skill:${s.name}`, `skill ${s.name} from ${s.source} at ${s.ref.slice(0, 12)}${was && was !== s.ref ? ` (was ${was.slice(0, 12)})` : ''}`, {
        kind: 'command', cwd: dir, env: NPX_ENV, snapshot: [...targets.map((x) => join(x.dir, s.name)), at(LOCK)],
        argv: ['npx', '-y', SKILLS_SPEC, 'add', `https://github.com/${s.source}/tree/${s.ref}`, '-s', s.name, ...flags, '--copy', '-y'],
      });
    }
  }

  // Skills of a pack or single skill no longer chosen: own copies and parked copies are removed, community skills through the skills CLI.
  // Names from the state file become paths: only skill-folder names count.
  const before = (readState(dir)?.skills ?? []).map((s) => s.name).filter((n) => /^[a-z0-9][a-z0-9-]*$/.test(n ?? ''));
  const removed = before.filter((n) => !skills.some((s) => s.name === n));
  const removeSkill = (name, dirs, why = '') => {
    const s = lib.skills.find((x) => x.name === name);
    for (const { dir: d } of dirs) if (exists(parked(d, name))) add(`remove:${name}`, `remove ${rel(parked(d, name))}${why}`, { kind: 'remove', path: parked(d, name), selected: true });
    const present = dirs.filter(({ dir: d }) => exists(join(d, name)));
    if (s && s.source !== 'own' && present.length) {
      const flags = [...new Set(present.flatMap((x) => x.agents).map((x) => SKILLS_FLAG[x]))].flatMap((f) => ['-a', f]);
      add(`remove:${name}`, `remove skill ${name}${why}`, { kind: 'command', cwd: dir, env: NPX_ENV, selected: true, snapshot: [...present.map((x) => join(x.dir, name)), join(dir, LOCK)],
        argv: ['npx', '-y', SKILLS_SPEC, 'remove', name, ...flags, '-y'] });
    // A name the library does not know is not one BenchKeeper installed: offered, not preselected.
    } else for (const { dir: d } of present) add(`remove:${name}`, `remove ${rel(join(d, name))}${why}`, { kind: 'remove', path: join(d, name), selected: !!s });
  };
  for (const name of removed) removeSkill(name, skillDirs(a.agents, 'project', dir));
  // Skill folders only dropped agents read (agents can share one folder).
  const kept = skillDirs(a.agents, 'project', dir).map((x) => x.dir);
  const orphan = skillDirs(dropped, 'project', dir).filter((x) => !kept.includes(x.dir));
  if (orphan.length) for (const name of before) removeSkill(name, orphan, ` (${orphan.flatMap((x) => x.agents).map((x) => agent(x).name).join(', ')} no longer chosen)`);

  // The state file, read by Update all and by setting-up-projects.
  // A community skill keeps its earlier commit while it is turned off (the parked copy is that one), and when its
  // install was not chosen or failed in the run that writes this file (apply passes the run to edit).
  const recorded = (s, run) => {
    if (s.source === 'own' || !s.ref) return {};
    const id = installs.get(s.name);
    const ran = !id || !run || run.entries.some((e) => e.id === id && e.status === 'done');
    const ref = a.disabled.includes(s.name) || !ran ? installedRefs.get(s.name) : s.ref;
    return ref ? { ref } : {};
  };
  const state = (run) => ({ schemaVersion: 1, setupVersion: appVersion, agents: a.agents, env: a.env, sandbox: a.sandbox, packs: a.packs, singles: a.skills, tier: a.tier, paths: a.paths, disabled: a.disabled,
    skills: skills.map((s) => ({ name: s.name, source: s.source, ...recorded(s, run) })) });
  add('state', `${STATE}: setup version ${appVersion}`, { kind: 'write', path: at(STATE), edit: (_, run) => `${JSON.stringify(state(run), null, 2)}\n` });
  const names = skills.map((s) => s.name);
  // Where the agent runs, written by hand outside the block, may contradict the chosen environment; prose is not removed.
  const said = agentPlace(handWritten(dir));
  const envWarning = said && said !== placeOf(a.env) ? [`AGENTS.md also says where commands run outside the BenchKeeper block: check that it agrees with the chosen environment (${a.env}) or remove it.`] : [];
  return { changes, answers: a, prompts: promptsFor(a, lib), skills: { added: names.filter((n) => !before.includes(n)), removed }, warnings: [...warnings(names.filter((n) => !a.disabled.includes(n)), lib), ...envWarning] };
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
