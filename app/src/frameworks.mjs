// Frameworks: the big agent frameworks a project can add inside its own folder (library.json, "frameworks"). A framework that
// owns the workflow (role owner) is a singleton per project; parts sit beside it. Three install kinds: pack (library skills
// through the skills CLI, so no plugin and no hooks), plugin (a Claude Code plugin enabled for this project only), agents
// (agent files fetched at a pinned commit). Ids and file paths come from the catalog, never from a project's files.
import { basename, join } from 'node:path';
import { agent } from './agents.mjs';
import { library } from './content.mjs';
import { exists, readText } from './fsx.mjs';
import { mergeJson, parseJson } from './merge.mjs';

export const catalog = (lib = library()) => lib.frameworks ?? [];
const stemOf = (path) => basename(path, '.md');
const tryJson = (t) => { try { return t == null ? null : parseJson(t); } catch { return null; } };

// A shared setup enables the plugin in the project's settings file (scope project), a local one in the personal file (scope local).
export const SETTINGS = { project: '.claude/settings.json', local: '.claude/settings.local.json' };
const scopeOf = (a) => (a.share ? 'project' : 'local');
const enabledIn = (dir, scope, id) => tryJson(readText(join(dir, SETTINGS[scope])))?.enabledPlugins?.[id] === true;

// Throws when more than one owner is among ids (catalog members only).
export function checkOwners(ids, lib = library()) {
  const owners = catalog(lib).filter((f) => ids.includes(f.id) && f.role === 'owner');
  if (owners.length > 1) throw new Error(`one workflow owner per project: ${owners.map((f) => f.title).join(' and ')} each replace how work is planned and run`);
}

// The answers a project keeps: ids of plugin and agent frameworks (a pack framework is a pack), the agent files picked, and
// the packs the frameworks chosen come with. An id or path the catalog does not name is refused: the state file comes with the repository.
export function resolveFrameworks(a, lib = library()) {
  const cat = catalog(lib);
  const unknown = a.frameworks.filter((id) => !cat.some((f) => f.id === id));
  if (unknown.length) throw new Error(`unknown framework ${unknown.join(', ')}: ${cat.map((f) => f.id).join(', ')}`);
  checkOwners(a.frameworks, lib);
  const chosen = cat.filter((f) => a.frameworks.includes(f.id));
  for (const f of chosen) {
    const ids = f.install.agents;
    if (ids && !a.agents.some((x) => ids.includes(x))) throw new Error(`${f.title} installs for ${ids.map((x) => agent(x).name).join(', ')} only: choose it among the agents or leave ${f.title} out`);
  }
  const offered = new Map(cat.filter((f) => f.install.kind === 'agents').flatMap((f) => f.install.files.map((x) => [x.path, f.id])));
  const bad = a.agentFiles.filter((p) => !offered.has(p));
  if (bad.length) throw new Error(`not an agent file of the catalog: ${bad.join(', ')}`);
  const rogue = a.agentFiles.filter((p) => !a.frameworks.includes(offered.get(p)));
  if (rogue.length) throw new Error(`agent files ${rogue.join(', ')} need their framework chosen`);
  for (const f of chosen.filter((x) => x.install.kind === 'agents')) if (!a.agentFiles.some((p) => offered.get(p) === f.id)) throw new Error(`${f.title}: pick the agent files to add (a pick, not the whole roster)`);
  const packs = chosen.filter((f) => f.install.kind === 'pack').map((f) => f.install.pack);
  return { frameworks: a.frameworks.filter((id) => cat.find((f) => f.id === id).install.kind !== 'pack'), packs: [...new Set([...a.packs, ...packs])] };
}

// The owner chosen, if any: the project block gives BenchKeeper's workflow way to it.
export const ownerOf = (a, lib = library()) => catalog(lib).find((f) => f.role === 'owner' && a.frameworks.includes(f.id)) ?? null;

// Agent files of the catalog that belong to a framework in ids.
const filesOf = (ids, lib) => new Set(catalog(lib).filter((f) => ids.includes(f.id)).flatMap((f) => f.install.files?.map((x) => x.path) ?? []));
export const agentFilesOf = (ids, files, lib = library()) => files.filter((p) => filesOf(ids, lib).has(p));

// What a state file still says that this app's catalog knows: an id or path it does not know (a newer app, a renamed file) is
// ignored, so the project can still be planned; the doctor reports it.
export function keptFrom(prev, lib = library()) {
  const frameworks = (prev?.frameworks ?? []).filter((id) => catalog(lib).some((f) => f.id === id));
  return { frameworks, agentFiles: agentFilesOf(frameworks, prev?.agentFiles ?? [], lib), agentOwned: agentFilesOf(frameworks, prev?.agentOwned ?? [], lib) };
}

// Where an agent file lands for the first agent that reads agent files in the project.
const agentDir = (dir, f) => join(dir, agent(f.install.agents[0]).project[f.install.dest].path);
const rawUrl = (f, path) => `https://raw.githubusercontent.com/${f.install.source}/${f.install.ref}/${path}`;

// The changes for the frameworks chosen and for those the state records but the answers no longer name.
// prev: the state file. Each change is { step, title, kind, ... } for the project plan to number.
export function frameworkChanges({ a, dir, prev, lib = library() }) {
  const out = [];
  const was = new Set(prev?.frameworks ?? []);
  for (const f of catalog(lib)) {
    const on = a.frameworks.includes(f.id);
    if (f.install.kind === 'plugin' && a.agents.includes('claude')) {
      const id = f.install.plugin;
      for (const scope of Object.keys(SETTINGS)) {
        const present = enabledIn(dir, scope, id), wanted = on && scope === scopeOf(a);
        const argv = (verb) => ['claude', 'plugin', verb, id, '--scope', scope];
        // Only an install this setup recorded is taken out again: another scope's copy may be the project's own.
        if (wanted && !present) out.push({ key: `plugin:${f.id}`, step: `framework:${f.id}`, title: `Claude Code plugin ${id} for this project only (scope ${scope})`, kind: 'command', cwd: dir, argv: argv('install'), undoArgv: argv('uninstall') });
        else if (!wanted && present && was.has(f.id)) out.push({ step: `framework:${f.id}`, title: `remove Claude Code plugin ${id} (scope ${scope})`, kind: 'command', cwd: dir, argv: argv('uninstall'), undoArgv: argv('install'), selected: true });
      }
    }
    if (f.install.kind === 'agents') {
      const have = new Map(Object.entries(prev?.frameworkRefs ?? {})), owned = new Set(prev?.agentOwned ?? []);
      for (const { path } of f.install.files) {
        const target = join(agentDir(dir, f), `${stemOf(path)}.md`);
        // Only a file this setup fetched (agentOwned) is refreshed or taken out again: one that was there before is the project's.
        const picked = on && a.agentFiles.includes(path), mine = owned.has(path);
        if (picked && (!exists(target) || (mine && have.get(f.id) !== f.install.ref))) {
          out.push({ key: `file:${path}`, step: `framework:${f.id}`, title: `agent ${stemOf(path)} from ${f.install.source} at ${f.install.ref.slice(0, 12)}`, kind: 'command', cwd: dir, snapshot: [target],
            argv: ['curl', '-fsSL', '--remove-on-error', '--proto', '=https', '--proto-redir', '=https', '--create-dirs', '-o', target, rawUrl(f, path)] });
        } else if (!picked && mine && exists(target)) out.push({ step: `framework:${f.id}`, title: `remove agent ${stemOf(path)} (not picked)`, kind: 'remove', path: target, selected: true });
      }
    }
  }
  return out;
}

// What the state file records of the frameworks. ran(key): whether the fetch or install planned under that key ran in this run
// (null: none was planned). A plugin install that did not run is not recorded; a file is the setup's own (agentOwned) once
// fetched, and its ref is the one fetched. Nothing is recorded for files and refs of a run that failed or skipped them.
export function frameworkState({ a, prev, ran, lib = library() }) {
  const cat = catalog(lib).filter((f) => a.frameworks.includes(f.id));
  const was = new Set(prev?.agentOwned ?? []), refs = prev?.frameworkRefs ?? {};
  const files = cat.flatMap((f) => f.install.files?.map((x) => x.path) ?? []).filter((p) => a.agentFiles.includes(p));
  const frameworks = cat.filter((f) => f.install.kind !== 'plugin' || ran(`plugin:${f.id}`) !== false).map((f) => f.id);
  const fetched = (f) => (f.install.files ?? []).some((x) => ran(`file:${x.path}`) === true);
  const frameworkRefs = Object.fromEntries(cat.filter((f) => f.install.ref && (fetched(f) || refs[f.id])).map((f) => [f.id, fetched(f) ? f.install.ref : refs[f.id]]));
  const agentOwned = files.filter((p) => ran(`file:${p}`) === true || was.has(p));
  return { ...(frameworks.length ? { frameworks } : {}), ...(files.length ? { agentFiles: files, agentOwned } : {}), ...(Object.keys(frameworkRefs).length ? { frameworkRefs } : {}) };
}

// Paths (relative to the project) the framework installs write, for the git exclude list of a local setup.
export function frameworkPaths(a, dir, lib = library()) {
  const out = [];
  for (const f of catalog(lib).filter((x) => a.frameworks.includes(x.id))) {
    if (f.install.kind === 'plugin' && a.agents.includes('claude') && !a.share) out.push(SETTINGS.local);
    if (f.install.kind === 'agents') for (const { path } of f.install.files) if (a.agentFiles.includes(path)) out.push(`${agent(f.install.agents[0]).project[f.install.dest].path}/${stemOf(path)}.md`);
  }
  return out;
}

// The state file's framework plugins and agent files as removals, for "Remove BenchKeeper setup": the enabledPlugins keys
// the setup set (in the file of its scope) and the agent files it fetched. Names from the state file count only when the catalog has them.
export function frameworkRemovals(dir, state, scope, lib = library()) {
  const out = [];
  const cat = catalog(lib).filter((f) => (state?.frameworks ?? []).includes(f.id));
  for (const f of cat) {
    if (f.install.kind === 'plugin' && enabledIn(dir, scope, f.install.plugin)) out.push({ step: 'framework', title: `${SETTINGS[scope]} without the plugin ${f.install.plugin}`, kind: 'write', path: join(dir, SETTINGS[scope]),
      edit: (t) => mergeJson(t, [{ path: ['enabledPlugins', f.install.plugin], remove: true }, { path: ['enabledPlugins'], prune: true }]) });
    if (f.install.kind === 'agents') for (const { path } of f.install.files.filter((x) => (state.agentOwned ?? []).includes(x.path))) {
      const target = join(agentDir(dir, f), `${stemOf(path)}.md`);
      if (exists(target)) out.push({ step: 'framework', title: `remove agent ${stemOf(path)}`, kind: 'remove', path: target });
    }
  }
  return out;
}

// Doctor: owners in a project. Found: owner frameworks enabled for the project (either settings file) or the user, and those
// the state records. A second owner, or a framework installed for the user that the setup did not record, is a finding.
export function frameworkChecks({ dir, state, userPlugins = [], lib = library() }) {
  // Projects without a BenchKeeper setup are not ours to judge.
  if (!state) return [];
  const issue = (level, message, fix) => ({ level, check: 'frameworks', message, fix });
  const out = [];
  const recorded = new Set(state?.frameworks ?? []);
  const owners = catalog(lib).filter((f) => f.role === 'owner' && f.install.kind === 'plugin');
  const name = (id) => id.split('@')[0];
  const found = owners.filter((f) => recorded.has(f.id)
    || Object.keys(SETTINGS).some((s) => Object.entries(tryJson(readText(join(dir, SETTINGS[s])))?.enabledPlugins ?? {}).some(([id, on]) => on === true && name(id) === name(f.install.plugin)))
    || userPlugins.some((p) => name(p.id) === name(f.install.plugin)));
  if (found.length > 1) out.push(issue('error', `two workflow owners in this project: ${found.map((f) => f.title).join(' and ')}`, 'keep one: benchkeeper projects apply --framework <id>, and uninstall the other plugin'));
  for (const f of found.filter((x) => !recorded.has(x.id))) {
    const user = userPlugins.some((p) => name(p.id) === name(f.install.plugin));
    out.push(issue('warning', `${f.title} is installed${user ? ' for the user (all projects)' : ' here'}, but this project's setup does not record it: BenchKeeper's workflow and ${f.title} both drive the work`,
      user ? `claude plugin uninstall ${f.install.plugin}, then choose it per project: benchkeeper projects apply --framework ${f.id}` : `benchkeeper projects apply --framework ${f.id}, or claude plugin uninstall ${f.install.plugin} --scope <project|local>`));
  }
  // A framework the state names that the catalog does not: a state file from another version or a changed one.
  for (const id of recorded) if (!catalog(lib).some((f) => f.id === id)) out.push(issue('warning', `the setup records framework ${id}, which this app does not know`, 'benchkeeper projects apply --framework none, or update the app'));
  return out;
}

// The catalog as the setup form and `frameworks list` show it: evidence next to each framework, what the install writes and its limits.
export const frameworkRows = (lib = library()) => catalog(lib).map((f) => ({
  id: f.id, title: f.title, role: f.role, license: f.license, pin: f.pin, verdict: f.verdict, hooks: f.hooks, gives: f.gives ?? null, limits: f.limits ?? null,
  evaluation: f.evaluation, kind: f.install.kind, pack: f.install.pack ?? null, agents: f.install.agents ?? null,
  files: (f.install.files ?? []).map(({ path, pickWhen }) => ({ path, name: stemOf(path), pickWhen })),
}));

// Plan notices: the evidence of each plugin or agent framework newly chosen, and that an owner takes the workflow over.
export function frameworkNotices({ a, prev, lib = library() }) {
  const out = [];
  const fresh = catalog(lib).filter((f) => a.frameworks.includes(f.id) && !(prev?.frameworks ?? []).includes(f.id));
  for (const f of fresh) out.push(`${f.title}: ${f.verdict} ${f.hooks} ${f.limits ?? ''}`.trim());
  const owner = ownerOf(a, lib);
  if (owner) out.push(`${owner.title} owns the workflow in this project: BenchKeeper's workflow skill and the issue-tracker specs give way (the project block says so).`);
  return out;
}
