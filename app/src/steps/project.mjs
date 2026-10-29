// Project setup: where the agent runs, AGENTS.md and CLAUDE.md, packs and library skills, the project state file.
// Steps that need judgement (stack skills, AGENTS.md commands, the dev container) run in an agent session the app
// records (session.mjs).
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { listAccounts } from '../accounts.mjs';
import { agent, forAgent, skillDirs } from '../agents.mjs';
import { appVersion, contentDir, contentVersion, library } from '../content.mjs';
import { BASELINE_REPO, CALLERS, callerFile } from '../baseline.mjs';
import { cooldownEnv } from '../cooldown.mjs';
import { exists, hashPath, isLink, listFiles, readText, realish } from '../fsx.mjs';
import { frameworkChanges, frameworkNotices, frameworkPaths, frameworkRemovals, frameworkState, keptFrom, resolveFrameworks } from '../frameworks.mjs';
import { git } from '../git.mjs';
import { GUARD_PATH, guardScript, guardsOff, guardsOn } from '../guards.mjs';
import { getBlock, mergeJson, parseJson, setBlock } from '../merge.mjs';
import { libraryWith, packScope, scopeText, warnings } from '../packs.mjs';
import { unfit } from '../roots.mjs';
import { itemState } from '../runner.mjs';
import { PLUGINS, localPlugins, marketSource, pluginScope, pluginUnit, skillsSpec, skillsVerify } from './global.mjs';
import { headCommit } from '../remote.mjs';
import { checkPlan, unit } from '../units.mjs';
import { workerRepos } from '../sessions.mjs';
import * as orca from '../orca/index.mjs';

export const STATE = '.benchkeeper/state.json';
// A local setup's files: Claude Code's personal instructions and settings, and Codex's override of AGENTS.md.
export const LOCAL_CLAUDE = 'CLAUDE.local.md';
const OVERRIDE = 'AGENTS.override.md', LOCAL_SETTINGS = '.claude/settings.local.json';
// The skills CLI's lockfile: its commands change it next to the skill folders.
const LOCK = 'skills-lock.json';
export const ENVS = {
  container: 'The agent runs inside the dev container (`.devcontainer/`): start it with `devcontainer exec --workspace-folder . <agent>`. Installs, builds, lint, tests and local MCP or browser tools run there too.',
  'host-agent': "The agent, Git and file edits run on the host. Installs, builds, lint, tests and local MCP or browser tools run in the dev container: prefix `devcontainer exec --workspace-folder .`, compound commands as `devcontainer exec --workspace-folder . sh -lc '...'`. If the container cannot start, report it and stop that command.",
  sandbox: 'The agent runs in a Docker Sandboxes microVM (`sbx`) with its own container engine. Installs, builds and tests run inside it.',
  host: null,
};
// The dev container command in one word, offered when the project has .devcontainer/. It finds the checkout from its own path.
const DC_PATH = 'scripts/dc';
const DC = `#!/bin/sh
# Runs one command in the dev container from any folder of the checkout: scripts/dc npm test
# The arguments pass on as they are; a compound command goes through a shell: scripts/dc sh -lc 'npm ci && npm test'
# scripts/dc up starts the container.
dir="$(cd "$(dirname "$0")/.." && pwd)"
# Compose names a project after the folder, so two checkouts with the same folder name would share containers. A name set
# in the environment or in a .env file is kept. The checksum first: a name starts with a letter or digit.
if [ -z "$COMPOSE_PROJECT_NAME" ] && ! grep -qs '^COMPOSE_PROJECT_NAME=' "$dir/.env" "$dir/.devcontainer/.env"; then
  COMPOSE_PROJECT_NAME="$(printf %s "$dir" | cksum | cut -d ' ' -f 1)-$(basename "$dir" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-')"
  export COMPOSE_PROJECT_NAME
fi
[ "$1" = up ] && shift && exec devcontainer up --workspace-folder "$dir" "$@"
exec devcontainer exec --workspace-folder "$dir" "$@"
`;
const DC_LINE = `\`${DC_PATH} <command>\` runs a command in the dev container (\`devcontainer exec --workspace-folder .\`, the arguments as given): \`${DC_PATH} npm test\`, compound commands as \`${DC_PATH} sh -lc '...'\`; \`${DC_PATH} up\` starts the container.`;
// The install command of the one lockfile at the project root, strict so a stale lockfile fails instead of changing:
// { file, command }, or null with none or several (a line to fill in then). Yarn 2 and later have .yarnrc.yml.
const INSTALLS = { 'package-lock.json': 'npm ci', 'pnpm-lock.yaml': 'pnpm install --frozen-lockfile', 'yarn.lock': null, 'uv.lock': 'uv sync --locked' };
const installCommand = (dir) => {
  const found = Object.keys(INSTALLS).filter((f) => exists(join(dir, f)));
  if (found.length !== 1) return null;
  const [file] = found;
  return { file, command: INSTALLS[file] ?? `yarn install ${exists(join(dir, '.yarnrc.yml')) ? '--immutable' : '--frozen-lockfile'}` };
};
// The offered files the setup wrote, known by their first two lines (a worktree file's list and install command vary).
const offeredFiles = (dir) => [{ path: DC_PATH, text: DC }, ...orca.worktreeFiles(null, [])]
  .filter((f) => readText(join(dir, f.path))?.startsWith(f.text.split('\n').slice(0, 2).join('\n'))).map((f) => f.path);
const SKILLS_FLAG = { claude: 'claude-code', codex: 'codex', gemini: 'gemini-cli', copilot: 'github-copilot' };
export const TIERS = ['quick', 'standard', 'full', 'research'];
// Own keys only: "constructor" or ["container"] must not pass as an environment.
export const isEnv = (id) => typeof id === 'string' && Object.hasOwn(ENVS, id);
// The skills CLI runs in the project: a project .npmrc must not choose where it comes from.
// Per call: the cooldown date moves with the clock, and a server runs for days.
const npxEnv = () => ({ DO_NOT_TRACK: '1', npm_config_registry: 'https://registry.npmjs.org/', npm_config_ignore_scripts: 'true', ...cooldownEnv() });

const tryJson = (t) => { try { return t == null ? null : parseJson(t); } catch { return null; } };
// Whether edit changes the settings text (a file that does not parse is left alone).
const editsJson = (edit, text) => { try { return text != null && JSON.stringify(tryJson(edit(text))) !== JSON.stringify(tryJson(text)); } catch { return false; } };
const SANDBOX_OUT = ['devcontainer exec *', 'podman *'];
// Takes out what the sandbox step set, and the sandbox object when nothing else is left in it.
const sandboxOff = (t) => mergeJson(t, [{ path: ['sandbox', 'enabled'], remove: true }, { path: ['sandbox', 'excludedCommands'], pull: SANDBOX_OUT }, { path: ['sandbox'], prune: true }]);
// Takes out what the setup recorded in state wrote into a settings file: the sandbox keys and the guard rules and hook.
const ownOff = (state) => (t) => [state?.sandbox && sandboxOff, state?.guards && guardsOff].filter(Boolean).reduce((o, f) => f(o), t);
const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/;
// Skills the skills CLI installed in the project, by its lockfile.
export const lockedSkills = (dir) => Object.keys(tryJson(readText(join(dir, LOCK)))?.skills ?? {}).filter((n) => SKILL_NAME.test(n));

// The skills BenchKeeper or the skills CLI installed (recorded in the state file or locked), the lockfile and the state
// folder, as removals: what both kinds of setup leave in a project.
function installedFiles(dir, state, add, skip = () => false) {
  const names = [...new Set([...(state?.skills ?? []).map((s) => s.name), ...lockedSkills(dir)])].filter((n) => SKILL_NAME.test(n ?? ''));
  for (const { dir: d } of skillDirs(['claude', 'codex', 'gemini', 'copilot'], 'project', dir)) {
    for (const n of names) if (exists(join(d, n)) && !skip(join(d, n))) add(`skill:${n}`, `remove ${relative(dir, join(d, n))}`, { kind: 'remove', path: join(d, n) });
  }
  if (exists(join(dir, LOCK)) && !skip(join(dir, LOCK))) add('lock', `remove ${LOCK}`, { kind: 'remove', path: join(dir, LOCK) });
  if (exists(join(dir, '.benchkeeper')) && !skip(join(dir, '.benchkeeper'))) add('state', 'remove .benchkeeper/', { kind: 'remove', path: join(dir, '.benchkeeper') });
}

// The committed setup of a repository (dir: a checkout of it), as changes that take it out: the BenchKeeper block in
// AGENTS.md, a CLAUDE.md that only imports AGENTS.md, the sandbox keys BenchKeeper set in .claude/settings.json, the
// state folder, the offered files it wrote, and the skills BenchKeeper or the skills CLI installed, with the lockfile. What the project wrote itself
// (its own AGENTS.md text, own skills, docs/agents/, the dev container) stays.
export function committedSetup(dir) {
  const at = (p) => join(dir, p);
  const state = tryState(dir);
  const changes = [];
  const add = (step, title, c) => changes.push({ id: `${step}:${changes.length}`, step, title, selected: true, ...c });
  const agentsMd = readText(at('AGENTS.md'));
  if (getBlock(agentsMd, 'project') != null) {
    if (setBlock(agentsMd, 'project', null).trim()) add('agents-md', 'AGENTS.md without the BenchKeeper block', { kind: 'write', path: at('AGENTS.md'), edit: (t) => setBlock(t, 'project', null) });
    else add('agents-md', 'remove AGENTS.md (only the BenchKeeper block)', { kind: 'remove', path: at('AGENTS.md') });
  }
  if (readText(at('CLAUDE.md'))?.trim() === '@AGENTS.md') add('claude-md', 'remove CLAUDE.md (only the AGENTS.md import; Claude Code reads AGENTS.md)', { kind: 'remove', path: at('CLAUDE.md') });
  const shared = readText(at('.claude/settings.json'));
  if ((state?.sandbox || state?.guards) && editsJson(ownOff(state), shared)) {
    // A settings file that held only the keys BenchKeeper set was BenchKeeper's.
    if (Object.keys(tryJson(ownOff(state)(shared)) ?? {}).length) add('sandbox', '.claude/settings.json without the sandbox keys and guards BenchKeeper set', { kind: 'write', path: at('.claude/settings.json'), edit: ownOff(state) });
    else add('sandbox', 'remove .claude/settings.json (only the keys BenchKeeper set)', { kind: 'remove', path: at('.claude/settings.json') });
  }
  if (state?.guards && exists(at(GUARD_PATH))) add('guards', `remove ${GUARD_PATH}`, { kind: 'remove', path: at(GUARD_PATH), selected: readText(at(GUARD_PATH)) === guardScript() });
  for (const c of frameworkRemovals(dir, state)) add(c.step, c.title, c);
  for (const p of offeredFiles(dir)) add('offered', `remove ${p}`, { kind: 'remove', path: at(p) });
  installedFiles(dir, state, add);
  return changes;
}

// A local setup as changes that take it out, for "Remove BenchKeeper setup": the BenchKeeper block in CLAUDE.local.md
// (the file when nothing else is in it), AGENTS.override.md when it is BenchKeeper's, the sandbox keys in
// .claude/settings.local.json, Gemini's AGENTS.md setting, this project's block in the git exclude list, the offered files, and the
// installed files, except what git tracks (the project's own commits). Everything else of the project stays, its own
// AGENTS.md text, docs/agents/ and .devcontainer/ included. keepExclude: another registered folder of the repository
// shares the exclude list, so its block stays for it.
export function localSetup(ctx, dir, { keepExclude = false } = {}) {
  const at = (p) => join(dir, p);
  const state = tryState(dir);
  const changes = [];
  const add = (step, title, c) => changes.push({ id: `${step}:${changes.length}`, step, title, selected: true, ...c });
  const claude = readText(at(LOCAL_CLAUDE));
  if (getBlock(claude, 'project') != null) {
    const strip = (t) => setBlock(t, 'project', null).replace(/^@AGENTS\.md\n*/, '');
    if (strip(claude).trim()) add('local-claude', `${LOCAL_CLAUDE} without the BenchKeeper block`, { kind: 'write', path: at(LOCAL_CLAUDE), edit: strip });
    else add('local-claude', `remove ${LOCAL_CLAUDE} (only BenchKeeper's block)`, { kind: 'remove', path: at(LOCAL_CLAUDE) });
  }
  if (getBlock(readText(at(OVERRIDE)), 'project') != null) add('local-codex', `remove ${OVERRIDE} (BenchKeeper's)`, { kind: 'remove', path: at(OVERRIDE) });
  const settings = readText(at(LOCAL_SETTINGS));
  if ((state?.sandbox || state?.guards) && editsJson(ownOff(state), settings)) {
    // A settings file that held only the keys BenchKeeper set was BenchKeeper's.
    if (Object.keys(tryJson(ownOff(state)(settings)) ?? {}).length) add('sandbox', `${LOCAL_SETTINGS} without the sandbox keys and guards BenchKeeper set`, { kind: 'write', path: at(LOCAL_SETTINGS), edit: ownOff(state) });
    else add('sandbox', `remove ${LOCAL_SETTINGS} (only the keys BenchKeeper set)`, { kind: 'remove', path: at(LOCAL_SETTINGS) });
  }
  if (state?.guards && exists(at(GUARD_PATH)) && git(ctx, dir, ['ls-files', '--', GUARD_PATH]).stdout.trim() === '') add('guards', `remove ${GUARD_PATH}`, { kind: 'remove', path: at(GUARD_PATH), selected: readText(at(GUARD_PATH)) === guardScript() });
  if (state?.agents?.includes('gemini')) {
    const g = agent('gemini').project.rules.setting;
    const v = g.key.reduce((o, k) => o?.[k], tryJson(readText(at(g.path))));
    if (JSON.stringify(v) === JSON.stringify(g.value)) add('gemini-context', 'Gemini CLI no longer reads AGENTS.md', { kind: 'write', path: at(g.path), edit: (t) => mergeJson(t, [{ path: g.key, remove: true }, { path: g.key.slice(0, -1), prune: true }]) });
  }
  const tracked = (p) => git(ctx, dir, ['ls-files', '--', p]).stdout.trim() !== '';
  for (const c of frameworkRemovals(dir, state).filter((x) => !tracked(x.path))) add(c.step, c.title, c);
  for (const p of offeredFiles(dir).filter((x) => !tracked(x))) add('offered', `remove ${p}`, { kind: 'remove', path: at(p) });
  installedFiles(dir, state, add, tracked);
  const exclude = keepExclude ? null : excludeFile(ctx, dir);
  const id = `local:/${git(ctx, dir, ['rev-parse', '--show-prefix']).stdout.trim()}`;
  if (exclude && getBlock(readText(exclude), id, '#') != null) add('exclude', 'git ignores the local setup no longer (.git/info/exclude)', { kind: 'write', path: exclude, edit: (t) => setBlock(t, id, null, '#') });
  return changes;
}

// State schema 2 holds appVersion and contentVersion. A version 1 file (setupVersion) is read with that value as both; the next apply writes version 2.
const STATE_SCHEMA = 2;
export const parseState = (text) => normalizeState(JSON.parse(text));
// Also for a state the registry kept as an object.
export function normalizeState(s) {
  if (s?.schemaVersion > STATE_SCHEMA) throw new Error(`schemaVersion ${s.schemaVersion}, this benchkeeper reads up to ${STATE_SCHEMA}: update it with npx benchkeeper@${appVersion.split('.')[0]}`);
  if (s && s.schemaVersion !== STATE_SCHEMA) { const { setupVersion, ...rest } = s; return { ...rest, schemaVersion: STATE_SCHEMA, appVersion: rest.appVersion ?? setupVersion, contentVersion: rest.contentVersion ?? setupVersion }; }
  return s;
}
// Both versions equal this app's and its content's: a project is behind when either differs.
export const upToDate = (s) => s?.appVersion === appVersion && s?.contentVersion === contentVersion;
export function readState(dir) {
  const text = readText(join(dir, STATE));
  if (!text) return null;
  try { return parseState(text); } catch (e) { throw new Error(`${join(dir, STATE)}: ${e.message}`); }
}
// For listings: an unreadable state file counts as none, so one broken project does not hide the others.
export const tryState = (dir) => { try { return readState(dir); } catch { return null; } };

// answers: { agents, env, sandbox, packs, agentFiles (picked agent files of a source), skills (single skills besides the packs'), disable, enable, packOn, packOff (packs
// switched on or off), fileOn, fileOff (agent files switched on or off), pick, drop (single skills added or taken out), reset (skills taken back to the library's), update (community skills added again from
// the default branch of their source), partial
// (a change of some skills only: the state file keeps its setup version), tier,
// paths: { skill: 'glob, glob' }, share, guards (default true: the deny rules and the guard hook, Claude Code only), callers (repo-baseline caller workflows to write, never kept in the state file) }; missing answers come from the state file. share: the setup is committed to the
// repository; otherwise (the default) it stays on this machine, in files git ignores.
export function resolveAnswers(dir, { disable = [], enable = [], packOn = [], packOff = [], fileOn = [], fileOff = [], pick = [], drop = [], reset = [], update = [], partial = false, ...answers } = {}) {
  const prev = readState(dir) ?? {};
  const a = { agents: prev.agents ?? [], env: prev.env ?? suggest(dir).env?.id ?? 'container', sandbox: prev.sandbox ?? false, packs: prev.packs ?? [], skills: prev.singles ?? [], disabled: prev.disabled ?? [], tier: prev.tier ?? null, paths: prev.paths ?? {}, share: prev.share ?? false, guards: prev.guards ?? true, ...keptFrom(prev), callers: [], ...Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) };
  a.disabled = [...new Set([...a.disabled, ...disable])].filter((n) => !enable.includes(n));
  // Packs and single skills switched on top of the saved choice; an order kept, so on then off restores the file.
  a.packs = [...new Set([...a.packs, ...packOn])].filter((p) => !packOff.includes(p));
  a.skills = [...new Set([...a.skills, ...pick])].filter((n) => !drop.includes(n));
  a.reset = reset;
  a.update = update;
  a.pick = pick;
  a.partial = partial;
  a.share = a.share === true;
  a.guards = a.guards !== false;
  a.agentFiles = [...new Set([...[a.agentFiles].flat(), ...fileOn])].filter((p) => !fileOff.includes(p));
  for (const m of a.callers) if (!CALLERS.includes(m)) throw new Error(`caller must be one of ${CALLERS.join(', ')}`);
  if (!a.agents.length) throw new Error('choose the agents for this project (--agents)');
  if (!isEnv(a.env)) throw new Error(`env must be one of ${Object.keys(ENVS).join(', ')}`);
  if (a.tier && !TIERS.includes(a.tier)) throw new Error(`tier must be one of ${TIERS.join(', ')}`);
  Object.assign(a, resolveFrameworks(a));
  // paths values go into SKILL.md front matter.
  for (const [k, v] of Object.entries(a.paths)) if (typeof v !== 'string' || /[\r\n]/.test(v)) throw new Error(`paths for ${k}: one line of globs`);
  return a;
}

// Where hand-written AGENTS.md text (outside the BenchKeeper block) says the agent runs: host, sandbox, container or null.
const AGENT_RUNS = /\bagents?\b([^.\n;]{0,40})\bruns? (on the host|(?:inside|in) (?:the|a) (?:[\w-]+ ){0,2}(dev ?container|container|sandbox(?:es)?|microVM))/gi;
// The first statement that is not negated ("does not run on the host").
const agentPlace = (text) => {
  const m = [...text.matchAll(AGENT_RUNS)].find((x) => !/\b(not|never|cannot)\b|n't\b/i.test(x[1]));
  return !m ? null : /host$/i.test(m[2]) ? 'host' : /container/i.test(m[3]) ? 'container' : 'sandbox';
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

// True when git tracks the state file: a setup committed in the repository.
export const tracksState = (ctx, dir) => git(ctx, dir, ['ls-files', '--', STATE]).stdout.trim().endsWith(STATE);

// A project run writes inside the project, plus the git exclude list, which a linked worktree or a project in a
// subfolder keeps outside it. Never into the project's own .git (hooks, config): a committed link must not aim a write there.
export function projectCtx(ctx, dir) {
  // Not for a folder that would make the whole home a write root (a ledger file or a typed path may name one).
  const why = unfit(ctx, dir);
  if (why) throw new Error(`${resolve(dir)} is ${why}: a project is its own folder`);
  const exclude = excludeFile(ctx, dir);
  return { ...ctx, roots: [resolve(dir), ...(exclude ? [exclude] : [])], deny: [resolve(dir, '.git')] };
}

// The context to undo a run of this scope: global, or a folder that could be a project (a ledger file names the scope, and
// a changed one must not widen the write roots). A global run may have tracked a host account whose folder lies outside the
// home folder: the folders come from the registry, not from the ledger file.
export function scopeCtx(ctx, scope) {
  if (scope === 'global') {
    let dirs = [];
    try { dirs = listAccounts(ctx).filter((a) => a.mode === 'host').map((a) => a.dir); } catch { /* an unreadable registry adds no root */ }
    return { ...ctx, roots: [...ctx.roots, ...dirs] };
  }
  if (typeof scope !== 'string' || !exists(scope)) throw new Error(`the scope of this run is not a folder here: ${scope}`);
  return projectCtx(ctx, scope);
}

// The exclude file of the repository dir is in, shared by all its worktrees; null outside a git repository.
function excludeFile(ctx, dir) {
  if (redirectedElsewhere(dir)) return null;
  const r = git(ctx, dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const common = r.code === 0 ? r.stdout.trim() : '';
  return isAbsolute(common) && exists(common) ? join(common, 'info', 'exclude') : null;
}

// A .git file sends git to another folder. Its info/exclude is a write root only when that folder points back at dir (a
// worktree's gitdir file, a submodule's core.worktree), never when it is another repository's. A .git symlink is not
// followed: it can aim at any repository's .git, and a project that links its .git simply gets no exclude root.
function redirectedElsewhere(dir) {
  const link = join(dir, '.git');
  if (isLink(link)) return true;
  const text = readText(link);
  if (text == null) return false;
  const target = resolve(dir, text.match(/^gitdir:[ \t]*(\S.*)$/m)?.[1]?.trim() ?? '\0');
  const back = readText(join(target, 'gitdir'))?.trim();
  if (back && realish(resolve(target, back)) === realish(link)) return false;
  const worktree = readText(join(target, 'config'))?.match(/^[ \t]*worktree[ \t]*=[ \t]*(\S.*)$/m)?.[1]?.trim();
  return !(worktree && realish(resolve(target, worktree)) === realish(dir));
}

// Skills a project gets: the chosen packs' skills plus single skills, minus those the catalog limits to other agents.
export function chosenSkills(a, lib = library()) {
  const names = new Set([...a.packs.flatMap((p) => lib.packs.find((x) => x.id === p)?.skills ?? []), ...a.skills]);
  return lib.skills.filter((s) => names.has(s.name) && (s.agents !== 'codex' || a.agents.includes('codex')));
}

// A library skill's own files as a project gets them: with the path globs of the setup in the front matter.
export function ownSkillFiles(name, paths) {
  const src = join(contentDir, 'library', name);
  return listFiles(src).map((file) => {
    const text = readFileSync(join(src, file), 'utf8');
    return { file, text: file === 'SKILL.md' && paths ? text.replace(/^(description: .*)$/m, `$1\npaths: ${paths}`) : text };
  });
}

// A community skill's folder no longer matches the hash recorded when its install ran (no hash: not known).
export const editedHere = (skillsDir, name, hash) => !!hash && exists(join(skillsDir, name)) && hashPath(join(skillsDir, name)) !== hash;

export function projectPlan({ ctx, dir, answers, plugins = {} }) {
  const a = resolveAnswers(dir, answers);
  const lib = libraryWith(ctx);
  for (const p of a.packs) if (!lib.packs.some((x) => x.id === p)) throw new Error(`unknown pack ${p}`);
  const at = (p) => join(dir, p);
  const changes = [];
  const add = (step, title, c) => changes.push({ id: `${step}:${changes.length}`, step, title, ...c });
  // A skill pack for all projects is in the global skill folders: the project keeps it selected without copies.
  const skills = chosenSkills({ ...a, packs: a.packs.filter((id) => packScope(ctx, lib.packs.find((x) => x.id === id)) !== 'global') }, lib);
  const rel = (p) => relative(dir, p);

  // Files offered beside the setup. One is named in the block and the exclude list only once it is written: in this run, or as
  // an earlier run left it; the preview, which has no run, counts the preselected ones.
  const offered = [];
  const offer = (step, title, path, text, { off = false, mode } = {}) => {
    const have = readText(at(path)), selected = !off && (have == null || have === text);
    add(step, `${path}: ${title}${have != null && have !== text ? ' (replaces your own file)' : ''}`, { kind: 'write', path: at(path), after: text, selected, ...(mode ? { mode } : {}) });
    offered.push({ id: changes.at(-1).id, path, text, selected });
  };
  const written = (f, run) => (run ? run.entries.some((e) => e.id === f.id && e.status === 'done') : f.selected) || readText(at(f.path)) === f.text;
  const devcontainer = exists(at('.devcontainer'));
  if (devcontainer) offer('dc', 'the dev container command in one word', DC_PATH, DC, { mode: 0o755 });
  const dc = offered[0];

  // One block with the repository rules (rules/project.md), where commands run, the default tier, and the pointer lines of own skills. Shared: in AGENTS.md, with
  // a CLAUDE.md that imports it. Local: CLAUDE.local.md for Claude Code (it imports AGENTS.md, since a CLAUDE.local.md
  // stops Claude Code reading AGENTS.md on its own) and AGENTS.override.md for Codex (read instead of AGENTS.md, so it
  // carries AGENTS.md's text too and is rebuilt from it on every apply).
  const rules = forAgent(readFileSync(join(contentDir, 'rules/project.md'), 'utf8'), a.agents.find((id) => !agent(id).plugins) ?? a.agents[0]);
  const ruleLines = rules.split('\n').map((l) => l.replace(/^- /, ''));
  const packLines = a.packs.map((id) => lib.packs.find((p) => p.id === id)?.pointer).filter(Boolean);
  const lines = (run) => [...ruleLines, ENVS[a.env], dc && written(dc, run) && DC_LINE, a.tier && `Default tier: ${a.tier}`, ...packLines, ...skills.filter((s) => s.source === 'own' && !a.disabled.includes(s.name)).map((s) => s.pointer?.match(/^`([^`]+)`/)?.[1])].filter(Boolean);
  const blockText = (run) => { const l = lines(run); return l.length ? l.map((x) => `- ${x}`).join('\n') : null; };
  const overrideOurs = (t) => t == null || getBlock(t, 'project') != null;
  const rulesUnit = unit({ id: 'rules:project', kind: 'rules', source: { type: 'library' }, agents: a.agents, scope: 'project', removal: 'block' });
  if (a.share) {
    add('agents-md', 'AGENTS.md: rules, where commands run, default tier, skill pointers', { kind: 'write', path: at('AGENTS.md'), edit: (t, run) => setBlock(t, 'project', blockText(run)), installUnit: rulesUnit });
    if (a.agents.includes('claude')) add('claude-md', 'CLAUDE.md imports AGENTS.md', { kind: 'write', path: at('CLAUDE.md'), edit: (t) => (t?.includes('@AGENTS.md') ? t : t?.trim() ? `@AGENTS.md\n\n${t}` : '@AGENTS.md\n'), installUnit: rulesUnit });
  } else {
    // A committed setup stays until a pull request removes it (projects unshare): a local one beside it would load
    // the block twice and change tracked files.
    if (tracksState(ctx, dir)) throw new Error(`the setup of ${dir} is committed: benchkeeper projects unshare moves it to this machine (a pull request), --share keeps it in the repository`);
    const agentsMd = setBlock(readText(at('AGENTS.md')) ?? '', 'project', null);
    if (a.agents.includes('claude')) {
      const imports = /^@AGENTS\.md$/m.test(readText(at('CLAUDE.md')) ?? '') || !agentsMd.trim();
      add('local-claude', `${LOCAL_CLAUDE}: rules, where commands run, default tier, skill pointers`, { kind: 'write', path: at(LOCAL_CLAUDE), installUnit: rulesUnit,
        edit: (t, run) => { const s = setBlock(t, 'project', blockText(run)); return imports || /^@AGENTS\.md$/m.test(s) ? s : `@AGENTS.md\n\n${s}`; } });
    }
    if (a.agents.includes('codex')) {
      // A hand-written override is the user's: replacing it is offered, not preselected.
      const ours = overrideOurs(readText(at(OVERRIDE)));
      add('local-codex', `${OVERRIDE}: AGENTS.md plus rules, where commands run, default tier, skill pointers${ours ? '' : ' (replaces your own file)'}`, { kind: 'write', path: at(OVERRIDE), selected: ours, installUnit: rulesUnit,
        edit: (_, run) => setBlock(agentsMd, 'project', blockText(run)) });
    }
  }
  // What a local setup wrote for an agent no longer chosen, or before the setup was shared.
  const gone = (id) => (a.share ? 'now in AGENTS.md' : `${agent(id).name} is no longer chosen`);
  const localClaude = readText(at(LOCAL_CLAUDE));
  if ((a.share || !a.agents.includes('claude')) && getBlock(localClaude, 'project') != null) {
    if (setBlock(localClaude, 'project', null).replace(/^@AGENTS\.md\n*/, '').trim()) add('local-claude', `remove the BenchKeeper block from ${LOCAL_CLAUDE} (${gone('claude')})`, { kind: 'write', path: at(LOCAL_CLAUDE), edit: (t) => setBlock(t, 'project', null).replace(/^@AGENTS\.md\n*/, '') });
    else add('local-claude', `remove ${LOCAL_CLAUDE} (only BenchKeeper's block; ${gone('claude')})`, { kind: 'remove', path: at(LOCAL_CLAUDE), selected: true });
  }
  if ((a.share || !a.agents.includes('codex')) && exists(at(OVERRIDE)) && overrideOurs(readText(at(OVERRIDE)))) {
    // Preselected only when the file is AGENTS.md plus BenchKeeper's block, as the setup wrote it: text added by hand is offered, not preselected.
    const asWritten = setBlock(readText(at(OVERRIDE)), 'project', null).trim() === (readText(at('AGENTS.md')) ?? '').trim();
    add('local-codex', `remove ${OVERRIDE} (${asWritten ? "BenchKeeper's" : 'BenchKeeper block plus text of your own'}; ${gone('codex')})`, { kind: 'remove', path: at(OVERRIDE), selected: asWritten });
  }
  if (a.agents.includes('gemini')) {
    const s = agent('gemini').project.rules.setting;
    add('gemini-context', 'Gemini CLI reads AGENTS.md', { kind: 'write', path: at(s.path), edit: (t) => mergeJson(t, [{ path: s.key, value: s.value }]), installUnit: rulesUnit });
  }
  // repo-baseline's caller workflows, on request: files in the checkout. One that differs from the bundled caller is the project's own: offered, not preselected.
  for (const m of a.callers) {
    const f = callerFile(m), have = readText(at(f.path));
    add(`caller:${m}`, `${f.path}: ${BASELINE_REPO} ${m} caller${have != null && have !== f.text ? ' (replaces your own file)' : ''}`, { kind: 'write', path: at(f.path), after: f.text, selected: have == null || have === f.text });
  }
  const prev = readState(dir);
  const dropped = (prev?.agents ?? []).filter((x) => !a.agents.includes(x));
  // Shared: the project's settings file; local: Claude Code's personal one, which wins over it.
  const settings = a.share ? '.claude/settings.json' : LOCAL_SETTINGS;
  if (a.sandbox && a.agents.includes('claude')) {
    add('sandbox', 'Claude Code sandbox on; devcontainer and podman run outside it (they cannot start inside)', { kind: 'write', path: at(settings), edit: (t) => mergeJson(t, [{ path: ['sandbox', 'enabled'], value: true }, { path: ['sandbox', 'excludedCommands'], append: SANDBOX_OUT }]) });
  } else if (tryJson(readText(at(settings)))?.sandbox?.enabled === true) {
    // Preselected only when the state file shows this setup turned it on.
    add('sandbox', `Claude Code sandbox off${prev?.sandbox ? '' : ' (not turned on by BenchKeeper)'}`, { kind: 'write', path: at(settings), selected: !!prev?.sandbox,
      edit: sandboxOff });
  }
  // An agent no longer chosen: what this setup wrote for it alone comes out.
  if (dropped.includes('claude') && readText(at('CLAUDE.md'))?.trim() === '@AGENTS.md') add('drop:claude', 'remove CLAUDE.md (only the AGENTS.md import; Claude Code is no longer chosen)', { kind: 'remove', path: at('CLAUDE.md'), selected: true });
  if (dropped.includes('gemini')) {
    const g = agent('gemini').project.rules.setting;
    const v = g.key.reduce((o, k) => o?.[k], tryJson(readText(at(g.path))));
    if (JSON.stringify(v) === JSON.stringify(g.value)) add('drop:gemini', 'Gemini CLI no longer reads AGENTS.md (not chosen)', { kind: 'write', path: at(g.path), edit: (t) => mergeJson(t, [{ path: g.key, remove: true }, { path: g.key.slice(0, -1), prune: true }]) });
  }

  // Packs with a plugin: installed when missing, for the user (all projects) or, for selected projects, at Claude Code's local
  // scope in this folder (a machine change: Update all leaves it out); their prompts are listed for the user.
  for (const id of a.packs) {
    const pack = lib.packs.find((x) => x.id === id);
    for (const ag of Object.keys(pack.plugins ?? {}).filter((x) => a.agents.includes(x))) {
      const p = PLUGINS[ag].find((x) => x.pack === id);
      const scope = p && pluginScope(ctx, p, ag), local = scope === 'projects';
      if (p && !(local ? localPlugins(ctx, dir) : plugins[ag] ?? []).includes(p.id)) {
        const installUnit = pluginUnit(p, scope), where = local ? { cwd: dir, machine: true } : {};
        if (p.source) add(`pack:${id}:${ag}`, `${agent(ag).name} marketplace ${p.marketplace}`, { kind: 'command', argv: [ag, 'plugin', 'marketplace', 'add', marketSource(p, ag)], undoArgv: [ag, 'plugin', 'marketplace', 'remove', p.marketplace], unit: `pack:${id}:${ag}`, installUnit, ...where });
        add(`pack:${id}:${ag}`, `${agent(ag).name} plugin ${p.id} (${scopeText(scope)})`, { unit: `pack:${id}:${ag}`, installUnit, ...where, ...(ag === 'claude' ? { kind: 'command', argv: ['claude', 'plugin', 'install', ...(local ? ['--scope', 'local'] : []), p.id], undoArgv: ['claude', 'plugin', 'uninstall', ...(local ? ['--scope', 'local'] : []), p.id] } : { kind: 'command', argv: ['codex', 'plugin', 'add', p.id], undoArgv: ['codex', 'plugin', 'remove', p.id] }) });
      }
    }
  }

  // Agent files fetched at a pinned commit.
  const fwIds = new Map();
  for (const { step, title, key, ...c } of frameworkChanges({ a, dir, prev })) { add(step, title, c); if (key) fwIds.set(key, changes.at(-1).id); }
  // Whether an agent-file fetch ran in the run that writes the state file (null: none planned).
  const ranFw = (run) => (key) => (!fwIds.has(key) ? null : !run || run.entries.some((e) => e.id === fwIds.get(key) && e.status === 'done'));

  // Guards: deny rules and the PreToolUse hook for the rules without exceptions, in the settings file of the sandbox step.
  const hook = at(GUARD_PATH), guarded = a.guards && a.agents.includes('claude');
  if (guarded) {
    add('guards', 'Claude Code deny rules (--no-verify, force push, sudo, terraform apply, kubectl apply, helm upgrade) and the guard hook', { kind: 'write', path: at(settings), edit: guardsOn });
    // Sharing moved the setup to the other settings file: the rules this setup wrote there come out.
    const was = a.share ? LOCAL_SETTINGS : '.claude/settings.json';
    if (prev?.guards === true && Boolean(prev.share) !== a.share && editsJson(guardsOff, readText(at(was)))) add('guards', `Claude Code deny rules and guard hook removed from ${was} (setup moved to ${settings})`, { kind: 'write', path: at(was), edit: guardsOff });
    const have = readText(hook), ours = guardScript();
    add('guards', `${GUARD_PATH}: the PreToolUse hook script${have != null && have !== ours ? ' (replaces your own file)' : ''}`, { kind: 'write', path: hook, after: ours, selected: have == null || have === ours });
  } else {
    // Preselected only when the state file shows this setup wrote them.
    const mine = prev?.guards === true, note = `${a.agents.includes('claude') ? 'guards off' : 'Claude Code is no longer chosen'}${mine ? '' : '; not written by BenchKeeper'}`;
    // The settings file the setup left when sharing changed holds the rules too.
    for (const f of [settings, a.share ? LOCAL_SETTINGS : '.claude/settings.json']) {
      if (editsJson(guardsOff, readText(at(f)))) add('guards', `Claude Code deny rules and guard hook removed${f === settings ? '' : ` from ${f}`} (${note})`, { kind: 'write', path: at(f), selected: mine && (f === settings || Boolean(prev.share) !== a.share), edit: guardsOff });
    }
    if (exists(hook)) add('guards', `remove ${GUARD_PATH} (${note})`, { kind: 'remove', path: hook, selected: mine && readText(hook) === guardScript() });
  }

  // A skill turned off moves to .benchkeeper/disabled/<skill folder>/<name>; turned on, it moves back.
  const parked = (d, name) => join(dir, '.benchkeeper/disabled', rel(d), name);
  const moveDir = (step, from, to, installUnit) => {
    add(step, `copy ${rel(from)} to ${rel(to)}`, { kind: 'write', path: to, from, unit: `move:${from}`, installUnit });
    add(step, `remove ${rel(from)} (copied to ${rel(to)})`, { kind: 'remove', path: from, selected: true, unit: `move:${from}`, installUnit });
  };
  // An own skill is copied from the library, a community skill comes through the skills CLI from its source's default branch.
  const skillUnit = (s, ids) => unit({ id: `skill:${s.name}`, kind: 'skill', source: s.source === 'own' ? { type: 'library' } : { type: 'git', repo: s.source }, agents: ids, scope: 'project',
    files: skillDirs(ids, 'project', dir).map(({ dir: d }) => join(d, s.name)), removal: s.source === 'own' ? 'files' : 'skills-cli' });

  // Library skills: own skills copied into each skill folder, community skills through the skills CLI from the default branch of their source
// (undo puts back the copies of their folders and the lockfile taken before the command).
  // The state file comes with the repository: only commit ids count.
  // The install command of each community skill: the state file records its new commit only once that ran.
  const installs = new Map();
  const installedRefs = new Map((readState(dir)?.skills ?? []).filter((x) => /^[0-9a-f]{40}$/.test(x.ref ?? '')).map((x) => [x.name, x.ref]));
  // Own skills adopted over a folder nobody installed: kept as it is until reset, also by the plans that follow.
  const adoptedBefore = new Set((readState(dir)?.skills ?? []).filter((x) => x.adopted === true).map((x) => x.name));
  const adoptedOwn = new Set();
  const installedHashes = new Map((readState(dir)?.skills ?? []).filter((x) => /^[0-9a-f]{64}$/.test(x.hash ?? '')).map((x) => [x.name, x.hash]));
  for (const s of skills) {
    const ids = a.agents.filter((x) => s.agents !== 'codex' || x === 'codex');
    const dirs = skillDirs(ids, 'project', dir), installUnit = skillUnit(s, ids);
    if (a.disabled.includes(s.name)) {
      for (const { dir: d } of dirs) if (exists(join(d, s.name))) moveDir(`off:${s.name}`, join(d, s.name), parked(d, s.name), installUnit);
      continue;
    }
    const back = dirs.filter(({ dir: d }) => exists(parked(d, s.name)) && !exists(join(d, s.name)));
    for (const { dir: d } of back) moveDir(`on:${s.name}`, parked(d, s.name), join(d, s.name), installUnit);
    const rest = dirs.filter((x) => !back.includes(x));
    // A copy edited here (it differs from what a run of this machine left), or a folder of that name being adopted, is replaced only
    // when asked for (reset): the plan shows its diff.
    const reseat = a.reset.includes(s.name);
    if (s.source === 'own') {
      for (const { dir: d } of rest) {
        for (const { file, text } of ownSkillFiles(s.name, a.paths[s.name])) {
          const path = join(d, s.name, file);
          const found = itemState(path, text, ctx), held = found === 'modified' || (found === 'foreign' && (a.pick.includes(s.name) || adoptedBefore.has(s.name)));
          if (found === 'foreign' && held && !reseat) adoptedOwn.add(s.name);
          add(`skill:${s.name}`, `skill ${s.name} (own) in ${d.slice(dir.length + 1)}${held ? ` (${file} differs from the library: reset the skill to replace it)` : ''}`, { kind: 'write', path, after: text, installUnit, ...(held && !reseat ? { selected: false, held: true } : {}) });
        }
      }
    } else {
      // A community skill comes from the default branch of its source; an update (asked for) adds it again.
      const was = installedRefs.get(s.name);
      const refresh = a.update.includes(s.name);
      const targets = rest.filter(({ dir: d }) => refresh || reseat || !exists(join(d, s.name)));
      const missing = targets.flatMap((x) => x.agents);
      if (!missing.length) continue;
      const flags = [...new Set(missing.map((x) => SKILLS_FLAG[x]))].flatMap((f) => ['-a', f]);
      installs.set(s.name, `skill:${s.name}:${changes.length}`);
      // The folder differs from what the install left: its edits are backed up by the snapshot, and kept unless reset.
      const held = !reseat && targets.some(({ dir: d }) => editedHere(d, s.name, installedHashes.get(s.name)));
      add(`skill:${s.name}`, `skill ${s.name} from ${s.source}${refresh && was ? ` (installed ${was.slice(0, 12)})` : ''}${held ? ' (edited here: reset the skill to replace it)' : ''}`, {
        kind: 'command', installUnit, outdated: refresh && !!was, cwd: dir, env: npxEnv(), verify: skillsVerify(ctx), snapshot: [...targets.map((x) => join(x.dir, s.name)), at(LOCK)], ...(held ? { selected: false, held: true } : {}),
        argv: ['npx', '-y', skillsSpec(ctx), 'add', `https://github.com/${s.source}`, '-s', s.name, ...flags, '--copy', '-y'],
      });
    }
  }

  // Skills of a pack or single skill no longer chosen: own copies and parked copies are removed, community skills through the skills CLI.
  // Names from the state file become paths: only skill-folder names count.
  const before = (readState(dir)?.skills ?? []).map((s) => s.name).filter((n) => /^[a-z0-9][a-z0-9-]*$/.test(n ?? ''));
  const removed = before.filter((n) => !skills.some((s) => s.name === n));
  const removeSkill = (name, dirs, why = '') => {
    const s = lib.skills.find((x) => x.name === name);
    // A name the library does not know is no unit of BenchKeeper's.
    const installUnit = s && skillUnit(s, dirs.flatMap((x) => x.agents));
    for (const { dir: d } of dirs) if (exists(parked(d, name))) add(`remove:${name}`, `remove ${rel(parked(d, name))}${why}`, { kind: 'remove', path: parked(d, name), selected: true, installUnit });
    const present = dirs.filter(({ dir: d }) => exists(join(d, name)));
    if (s && s.source !== 'own' && present.length) {
      const flags = [...new Set(present.flatMap((x) => x.agents).map((x) => SKILLS_FLAG[x]))].flatMap((f) => ['-a', f]);
      add(`remove:${name}`, `remove skill ${name}${why}`, { kind: 'command', installUnit, cwd: dir, env: npxEnv(), verify: skillsVerify(ctx), selected: true, snapshot: [...present.map((x) => join(x.dir, name)), join(dir, LOCK)],
        argv: ['npx', '-y', skillsSpec(ctx), 'remove', name, ...flags, '-y'] });
    // A name the library does not know is not one BenchKeeper installed: offered, not preselected.
    } else for (const { dir: d } of present) add(`remove:${name}`, `remove ${rel(join(d, name))}${why}`, { kind: 'remove', path: join(d, name), selected: !!s, installUnit });
  };
  for (const name of removed) removeSkill(name, skillDirs(a.agents, 'project', dir));
  // Skill folders only dropped agents read (agents can share one folder).
  const kept = skillDirs(a.agents, 'project', dir).map((x) => x.dir);
  const orphan = skillDirs(dropped, 'project', dir).filter((x) => !kept.includes(x.dir));
  if (orphan.length) for (const name of before) removeSkill(name, orphan, ` (${orphan.flatMap((x) => x.agents).map((x) => agent(x).name).join(', ')} no longer chosen)`);

  // The state file, read by Update all and by setting-up-projects.
  // A community skill keeps its earlier commit while it is turned off (the parked copy is that one), and when its
  // install was not chosen or failed in the run that writes this file (apply passes the run to edit).
  // Its hash is the folder as the install left it (a later edit shows as a difference); kept while no install ran.
  const recorded = (s, run, runCtx) => {
    if (s.source === 'own') return {};
    const id = installs.get(s.name);
    const ran = !id || !run || run.entries.some((e) => e.id === id && e.status === 'done');
    const fresh = id && run && ran && !a.disabled.includes(s.name);
    // A skill adopted with its folder as it is has no commit to claim; an update records the commit of the default branch.
    const adopted = !id && a.pick.includes(s.name) && !installedRefs.has(s.name);
    const ref = a.disabled.includes(s.name) || !ran || adopted || !fresh ? installedRefs.get(s.name) : headCommit(runCtx, s.source) ?? installedRefs.get(s.name);
    const at1 = fresh && skillDirs(a.agents.filter((x) => s.agents !== 'codex' || x === 'codex'), 'project', dir).map((x) => join(x.dir, s.name)).find(exists);
    const hash = at1 ? hashPath(at1) : installedHashes.get(s.name);
    return { ...(ref ? { ref } : {}), ...(hash ? { hash } : {}) };
  };
  const state = (run, runCtx) => ({ schemaVersion: STATE_SCHEMA, appVersion: a.partial && prev?.appVersion ? prev.appVersion : appVersion, contentVersion: a.partial && prev?.contentVersion ? prev.contentVersion : contentVersion, agents: a.agents, env: a.env, sandbox: a.sandbox, share: a.share, guards: a.guards, packs: a.packs, singles: a.skills, tier: a.tier, paths: a.paths, disabled: a.disabled, ...frameworkState({ a, dir, prev, ran: ranFw(run) }),
    skills: skills.map((s) => ({ name: s.name, source: s.source, ...recorded(s, run, runCtx), ...(adoptedOwn.has(s.name) ? { adopted: true } : {}) })) });
  // always: the commit of an install is only known once it ran, so the preview of the file may look unchanged.
  add('state', `${STATE}: setup version ${contentVersion}${installs.size ? ', commits of the installed skills' : ''}`, { kind: 'write', path: at(STATE), always: installs.size > 0, edit: (_, run, runCtx) => `${JSON.stringify(state(run, runCtx), null, 2)}\n` });

  // What a local setup leaves in the project, relative to it.
  const local = [...new Set([STATE.split('/')[0] + '/', LOCK, ...(a.agents.includes('claude') ? [LOCAL_CLAUDE] : []), ...(a.agents.includes('codex') ? [OVERRIDE] : []), ...(a.sandbox || guarded ? [LOCAL_SETTINGS] : []), ...(guarded ? [GUARD_PATH] : []),
    ...skills.flatMap((s) => skillDirs(a.agents.filter((x) => s.agents !== 'codex' || x === 'codex'), 'project', dir).map(({ dir: d }) => `${rel(join(d, s.name))}/`)), ...frameworkPaths(a, dir),
    // Stack skills the setup session installed with the skills CLI (its lockfile names them).
    ...lockedSkills(dir).flatMap((n) => skillDirs(a.agents, 'project', dir).map(({ dir: d }) => `${rel(join(d, n))}/`))])];

  // Workers ran in worktrees of this repository: the per-worktree setup files, at its root, off by default. A new worktree
  // gets the local files listed (local: the whole local setup with the offered files; shared: the personal files only).
  if (workerRepos(ctx).has(resolve(dir))) {
    const include = a.share ? [LOCAL_CLAUDE, OVERRIDE] : [...local.map((p) => p.replace(/\/$/, '')), ...offered.map((f) => f.path), ...orca.worktreeFiles(null, []).map((f) => f.path)];
    const install = installCommand(dir);
    // A new worktree has no container running: the line starts it. Plan steps have no dependencies, so without scripts/dc
    // the line fails in the setup terminal (the setup script stops there) and changes nothing.
    const line = install && (devcontainer ? `${DC_PATH} up && ${DC_PATH} ${install.command}` : install.command);
    const hook = install ? `setup hook: ${install.command} (${install.file})${devcontainer ? `, through ${DC_PATH} in the dev container it starts (fails without ${DC_PATH})` : ''}` : 'setup hook: none found, fill in the comment line';
    const [yaml, inc] = orca.worktreeFiles(line, include);
    offer('worktrees', `${orca.NAME} worktree setup, ${hook}`, yaml.path, yaml.text, { off: true });
    offer('worktrees', `${orca.NAME} worktree setup, the local files each new worktree gets`, inc.path, inc.text, { off: true });
  }

  // Local: everything above goes to the repository's exclude list ($GIT_COMMON_DIR/info/exclude, shared by its
  // worktrees), so git status stays clean. Files git already tracks stay tracked until a pull request removes them
  // (projects unshare). Shared: the list comes out again.
  const exclude = excludeFile(ctx, dir);
  if (exclude) {
    const prefix = git(ctx, dir, ['rev-parse', '--show-prefix']).stdout.trim();
    const list = (run) => (a.share ? null : `# BenchKeeper's local agent setup (benchkeeper projects apply)\n${[...local, ...offered.filter((f) => written(f, run)).map((f) => f.path)].map((p) => `/${prefix}${p}`).join('\n')}`);
    // One block per project folder: several projects in one repository keep their own lists.
    const id = `local:/${prefix}`;
    if (a.share ? getBlock(readText(exclude), id, '#') != null : true) add('exclude', a.share ? 'git ignores the setup no longer (it is committed)' : 'git ignores the local setup (.git/info/exclude)', { kind: 'write', path: exclude, edit: (t, run) => setBlock(t, id, list(run), '#') });
  }
  const names = skills.map((s) => s.name);
  // Where the agent runs, written by hand outside the block, may contradict the chosen environment; prose is not removed.
  const said = agentPlace(handWritten(dir));
  const envWarning = said && said !== placeOf(a.env) ? [`AGENTS.md also says where commands run outside the BenchKeeper block: check that it agrees with the chosen environment (${a.env}) or remove it.`] : [];
  return { changes: checkPlan(changes), answers: a, prompts: promptsFor(a, dir, lib), skills: { added: names.filter((n) => !before.includes(n)), removed }, warnings: [...warnings(names.filter((n) => !a.disabled.includes(n)), lib), ...envWarning, ...frameworkNotices({ a, dir, prev })] };
}

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
// The line the user pastes in their own terminal: the app shows it and never runs it.
export const recordCommand = (dir, agent, prompt) => `benchkeeper sessions record --project ${quote(dir)} -- ${agent} ${quote(prompt)}`;
// The agent a user-started step names: Claude Code when chosen, else the first agent.
export const promptAgent = (agents) => (agents.includes('claude') ? 'claude' : agents[0]);

// What the user starts after the deterministic steps: the setup skill session, and the packs' own prompts.
function promptsFor(a, dir, lib = library()) {
  const first = promptAgent(a.agents);
  const p = [{ agent: first, prompt: first === 'codex' ? '$benchkeeper:setting-up-projects' : first === 'claude' ? '/benchkeeper:setting-up-projects' : 'Load the setting-up-projects skill and run it.', why: 'stack skills, AGENTS.md commands, the dev container' }];
  for (const id of a.packs) for (const x of lib.packs.find((y) => y.id === id)?.prompts ?? []) p.push({ agent: first, prompt: first === 'codex' ? x.codex : x.claude, why: x.why });
  return p.map((x) => ({ ...x, dir, command: recordCommand(dir, x.agent, x.prompt) }));
}

