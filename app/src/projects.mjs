// Registered projects and Update all: one branch, one commit and one pull request per project, built in a git
// worktree so the user's checkout stays as it is.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { agent } from './agents.mjs';
import { contentVersion } from './content.mjs';
import { PACK_SCOPES, libraryWith, packScope, packScopes, scopeText, scopeWrite } from './packs.mjs';
import { exists, hashText, isDir, readText, realish, writeAtomic } from './fsx.mjs';
import { blob, clean, defaultBranch, git, githubRemote, isRepo, repoEnv, repoRoot, safeBranch } from './git.mjs';
import { unfit, unscannable } from './roots.mjs';
import { apply, preview } from './runner.mjs';
import { agentFileRows } from './frameworks.mjs';
import { projectSkills, skillFiles } from './skills.mjs';
import { PLUGINS, globalPlan, globalSkills, localPlugins, pluginScope, pluginState } from './steps/global.mjs';
import { STATE, chosenSkills, committedSetup, localSetup, normalizeState, parseState, projectCtx, projectPlan, readState, tracksState, tryState, upToDate } from './steps/project.mjs';
import { newer } from './update.mjs';

const file = (ctx) => join(ctx.config, 'projects.json');

// One folder, one project: links are resolved, so a path through a symlink and the folder it points to are the same.
export const canon = (p) => { try { return realish(p); } catch { return resolve(p); } };
// Entries that name one folder under two paths merge into one (the first keeps its date, a kept state survives), so
// a registry written before paths were canonical shows no duplicates; the next save writes the merged list.
export function listProjects(ctx) {
  let list;
  try { list = JSON.parse(readFileSync(file(ctx), 'utf8')).projects; } catch { return []; }
  if (!Array.isArray(list)) return [];
  const merged = new Map();
  for (const p of list) {
    const path = canon(p.path), prev = merged.get(path);
    merged.set(path, prev ? { ...prev, ...(!prev.state && p.state ? { state: p.state } : {}) } : { ...p, path });
  }
  return [...merged.values()];
}
// Why the registry cannot be read, null when it is fine or missing (listProjects reads such a file as empty).
export function registryProblem(ctx) {
  const text = readText(file(ctx));
  if (text == null) return exists(file(ctx)) ? 'the registered projects file cannot be read' : null;
  // A parser's message can quote the file, so none is passed on.
  let parsed;
  try { parsed = JSON.parse(text); } catch { return 'the registered projects file is not valid JSON'; }
  return Array.isArray(parsed?.projects) ? null : 'the registered projects file has no projects list';
}
// Packs the registered projects use; null when none has a state file, so nothing counts as unused.
export function packsInUse(ctx) {
  const states = listProjects(ctx).map((p) => projectState(ctx, p.path)).filter(Boolean);
  return states.length ? [...new Set(states.flatMap((s) => s.packs ?? []))] : null;
}
// The registered projects whose setup names the pack.
export const projectsUsing = (ctx, id) => usersByPack(ctx).get(id) ?? [];
// Pack id to the registered projects whose setup names it, read once for all packs.
export function usersByPack(ctx) {
  const users = new Map();
  for (const p of listProjects(ctx)) for (const id of projectState(ctx, p.path)?.packs ?? []) users.set(id, [...(users.get(id) ?? []), p.path]);
  return users;
}
// A pack moved to the other scope (PACK_SCOPES) as one plan: its installs come out of one place and go into the other, and the
// scope file records the choice; undo takes all of it back. Agents that offer one scope only keep their install (fixed).
// The projects' state files are left for their next projects apply, which records the skill list.
// A change inside a project names it (project), so it can run under that project's own bounds.
export function scopePlan(ctx, id, scope, agents) {
  const pack = libraryWith(ctx).packs.find((p) => p.id === id);
  if (!pack) throw new Error(`unknown pack ${id}`);
  if (!PACK_SCOPES.includes(scope)) throw new Error(`scope must be one of ${PACK_SCOPES.join(', ')}`);
  const was = packScope(ctx, pack);
  if (was === scope) return [];
  const next = { ...ctx, packScopes: { ...ctx.packScopes, [id]: scope } };
  const users = projectsUsing(ctx, id).filter((p) => isDir(p));
  const changes = [];
  // The other part's steps for this pack, with ids and units per project so two projects do not share one.
  const take = (list, keep, where = '', extra = {}) => changes.push(...list.filter(keep).map((c) => ({ ...c, id: `${where}${c.id}`, ...(c.unit ? { unit: `${where}${c.unit}` } : {}), ...extra })));
  // Preselected, except a change the project plan holds back (a skill edited there) or treats as the user's own.
  const projectSide = (keep) => { for (const path of users) take((projectItemPlan(next, path) ?? []).map((c) => ({ ...c, selected: c.held || c.foreign ? c.selected : true })), keep, `${path}:`, { project: path }); };
  // The global plan without a registry lookup for the host tools, whose steps are left out anyway.
  const global = (packs = []) => globalPlan({ ctx: next, agents, devcontainerCli: '0.0.0', options: { packs, level: 'full' } });
  if (pack.plugins) {
    for (const a of agents.filter((x) => pack.plugins[x] && !packScopes(pack, x).fixed)) {
      const pid = pack.plugins[a].id, flags = (s) => ['--scope', s];
      if (scope === 'projects') {
        const argv = [a, 'plugin', 'uninstall', ...flags('user'), pid], undoArgv = [a, 'plugin', 'install', ...flags('user'), pid];
        if (pluginState(ctx, a).listed.some((x) => x.id === pid)) changes.push({ id: `scope:${id}:${a}:user`, step: `scope:${id}`, title: `uninstall ${pid} for the user (now ${scopeText(scope)})`, kind: 'command', argv, undoArgv, selected: true, destructive: true,
          impact: `removing runs ${argv.join(' ')}, which deletes the plugin and its data from ${agent(a).name}; ${undoArgv.join(' ')} brings it back` });
        // A marketplace the agent knows stays: undoing its add would remove it.
        const known = pluginState(ctx, a).markets;
        projectSide((c) => c.step === `pack:${id}:${a}` && !(c.argv[3] === 'add' && known.includes(pack.plugins[a].id.split('@')[1])));
      } else {
        for (const path of users.filter((x) => localPlugins(ctx, x).includes(pid))) changes.push({ id: `scope:${id}:${a}:${path}`, step: `scope:${id}`, title: `uninstall ${pid} in ${path} (local scope; now ${scopeText(scope)})`, kind: 'command', argv: [a, 'plugin', 'uninstall', ...flags('local'), pid], undoArgv: [a, 'plugin', 'install', ...flags('local'), pid], cwd: path, project: path, selected: true });
        take(global([id]), (c) => c.step === `plugin:${a}:${pid}`);
      }
    }
  } else {
    const named = (c, prefix) => pack.skills.some((n) => c.step === `${prefix}:${n}`);
    if (scope === 'global') {
      take(global(), (c) => c.step === `pack:${id}`);
      projectSide((c) => named(c, 'remove'));
    } else {
      // A folder of that name the app did not install is the user's: offered, not preselected.
      for (const c of global().filter((x) => /^other:\w+:skill$/.test(x.step) && pack.skills.includes(basename(x.path)))) changes.push({ ...c, selected: installedSkill(ctx, c.path) });
      projectSide((c) => named(c, 'skill'));
    }
  }
  changes.push({ id: `scope:${id}`, step: `scope:${id}`, title: `pack ${id}: ${scopeText(scope)} (was ${scopeText(was)})`, ...scopeWrite(ctx, id, scope) });
  return changes;
}
// The Installs tab of a project, from its resolved answers (a). Per pack and skill: the scope hint ("also global" when it is
// installed for the user, by the pack's scope or because an agent offers only that scope), the scopes agents fix and why, and
// the state on disk. Then the agent files, and what the global setup makes active here that the project does not select.
const WORSE = ['installed', 'off', 'outdated', 'modified', 'not installed'];
const CELL = { current: 'installed', removed: 'not installed', absent: 'not installed', disabled: 'off' };
export function projectInstalls(ctx, dir, a) {
  const lib = libraryWith(ctx);
  const plugged = a.agents.filter((x) => PLUGINS[x]);
  const enabled = Object.fromEntries(plugged.map((x) => [x, pluginState(ctx, x).listed.filter((p) => p.enabled).map((p) => p.id)]));
  const local = plugged.includes('claude') ? localPlugins(ctx, dir) : [];
  const inGlobal = (n) => (plugged.some((x) => exists(join(ctx.home, agent(x).global.skills, n, 'SKILL.md'))) ? 'installed' : 'not installed');
  const onDisk = new Map((projectSkills(ctx, dir)?.skills ?? []).map((s) => [s.name, CELL[s.state] ?? s.state]));
  const worst = (list) => list.reduce((w, s) => (WORSE.indexOf(s) > WORSE.indexOf(w) ? s : w), 'installed');
  const packs = Object.fromEntries(lib.packs.map((p) => {
    const scope = packScope(ctx, p);
    const fixed = a.agents.flatMap((x) => { const o = packScopes(p, x); return o?.fixed ? [{ agent: agent(x).name, scope: o.scopes[0], reason: o.fixed }] : []; });
    const state = p.plugins
      ? (plugged.some((x) => p.plugins[x] && (pluginScope(ctx, { pack: p.id }, x) === 'global' ? enabled[x] : local).includes(p.plugins[x].id)) ? 'installed' : 'not installed')
      : worst((p.skills ?? []).map((n) => (scope === 'global' ? inGlobal(n) : onDisk.get(n) ?? 'not installed')));
    return [p.id, { scope, fixed, state, owner: p.role === 'workflow owner', hint: scope === 'global' || fixed.some((f) => f.scope === 'global') ? 'also global' : 'only this project' }];
  }));
  const viaGlobal = (n) => a.packs.some((id) => packs[id]?.scope === 'global' && lib.packs.find((p) => p.id === id).skills?.includes(n));
  const skills = Object.fromEntries(chosenSkills(a, lib).map(({ name: n }) => [n, viaGlobal(n)
    ? { state: a.disabled.includes(n) ? 'off' : inGlobal(n), hint: 'also global' }
    : { state: onDisk.get(n) ?? 'not installed', hint: 'only this project' }]));
  return { packs, skills, files: agentFileRows(a, dir, tryState(dir), lib),
    global: {
      plugin: plugged.filter((x) => enabled[x].includes('benchkeeper@benchkeeper')).map((x) => agent(x).name),
      packs: lib.packs.filter((p) => !a.packs.includes(p.id) && packs[p.id].scope === 'global' && packs[p.id].state === 'installed').map((p) => ({ id: p.id, title: p.title ?? p.id })),
      skills: plugged.map((x) => ({ agent: agent(x).name, count: globalSkills(ctx, x) })),
    } };
}
// BenchKeeper installed the global skill folder: the newest done, not undone ledger entry on it is a pack's install.
function installedSkill(ctx, dir) {
  const on = (p) => p === dir || !!p?.startsWith(`${dir}${sep}`);
  for (const run of ctx.ledger.list()) {
    const e = [...run.entries].reverse().find((x) => x.status === 'done' && !x.undone && (on(x.path) || x.snapshot?.some((y) => on(y.path))));
    if (e) return e.step.startsWith('pack:');
  }
  return false;
}
// A registry that exists but cannot be read is listed as empty, so writing then would drop every project.
function save(ctx, projects) {
  const problem = registryProblem(ctx);
  if (problem) throw Object.assign(new Error(problem), { status: 409 });
  writeAtomic(file(ctx), `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`);
}
// Every change of the registry: read and write under the run lock, so the UI server and a CLI command do not drop each
// other's entries. Re-entrant: a caller inside a run goes on.
function updateRegistry(ctx, change) {
  const release = ctx.ledger.lock();
  try { save(ctx, change(listProjects(ctx))); } finally { release(); }
}
// The state file a removal pull request deletes from the checkout on the next pull, kept in the registry until the
// project has its own again (local, untracked).
// Normalized like a state file: an earlier app kept version 1.
// Throws for a state this app cannot read (schemaVersion above 2), so a batch stops that project instead of using an older setup from origin.
const keptStrict = (ctx, path) => {
  const s = listProjects(ctx).find((p) => p.path === canon(path))?.state;
  try { return s ? normalizeState(s) : null; } catch (e) { throw new Error(`the setup kept for ${canon(path)}: ${e.message}`); }
};
// For listings: an unreadable kept state counts as none.
const kept = (ctx, path) => { try { return keptStrict(ctx, path); } catch { return null; } };
// A registered project's answers: its state file, or the one kept after a removal pull request.
export const projectState = (ctx, path) => tryState(path) ?? kept(ctx, path);
function keepState(ctx, dir, state) {
  const path = canon(dir);
  updateRegistry(ctx, (list) => {
    if (!list.some((p) => p.path === path)) list.push({ path, added: new Date().toISOString() });
    return list.map((p) => (p.path !== path ? p : state ? { ...p, state } : (({ state: _, ...rest }) => rest)(p)));
  });
}
// A state file as answers for a local setup.
const localAnswers = (s) => ({ ...s, skills: s.singles, share: false });
// The whole plan of a registered project that has a setup (the checkout's state file, or the one kept after a removal
// pull request), unfiltered, for the Dashboard's item states; null without a setup.
export function projectItemPlan(ctx, path) {
  const own = tryState(path), local = own ?? kept(ctx, path);
  // What the Projects view calls a change: selected ones, and commands that run in the project. A skill edited here is held back
  // from the plan, but it is a modified item all the same.
  return local ? projectPlan({ ctx: projectCtx(ctx, path), dir: path, answers: own ? {} : localAnswers(local) }).changes.filter((c) => (c.selected !== false || c.held) && (c.kind !== 'command' || c.cwd)) : null;
}
// Per chosen agent, the skills in the project folder it reads.
export function skillCounts(path, agents) {
  const files = skillFiles(path);
  return Object.fromEntries(agents.map((a) => [a, files.filter((f) => f.file.startsWith(join(path, agent(a).project.skills, '/'))).length]));
}
// One repository position: the git common directory (shared by all worktrees) and the folder's place below the worktree
// root, so two worktrees of one repository match and two folders of a monorepo do not. null outside a repository.
function repoKey(ctx, path) {
  const r = git(ctx, path, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-prefix']);
  const [common, prefix = ''] = r.stdout.split('\n');
  return r.code === 0 && isAbsolute(common) && existsSync(common) ? `${canon(common)}\0${prefix}` : null;
}
// What adding a folder runs into: it is registered already (same), another worktree of a registered project's repository
// is (worktree), or it lies inside a registered project (inside). Throws when the folder is not a folder.
export function checkAdd(ctx, path) {
  const p = canon(path);
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
  if (!statSync(p).isDirectory()) throw new Error(`${p} is not a folder`);
  const why = unfit(ctx, p);
  if (why) throw new Error(`${p} is ${why}: register the project's own folder`);
  const all = listProjects(ctx), same = all.some((x) => x.path === p);
  const list = all.filter((x) => x.path !== p);
  const key = repoKey(ctx, p);
  return { path: p, same,
    worktree: (!same && key && list.find((x) => repoKey(ctx, x.path) === key)?.path) || null,
    inside: list.find((x) => p.startsWith(x.path + sep))?.path ?? null };
}
// worktree: add a folder that is another worktree of a registered project's repository as a project of its own.
export function addProject(ctx, path, { worktree = false } = {}) {
  const found = checkAdd(ctx, path);
  if (found.worktree && !worktree) throw new Error(`${found.path} is the same repository as ${found.worktree} (another worktree): not added as a second project`);
  if (!found.same) updateRegistry(ctx, (list) => (list.some((x) => x.path === found.path) ? list : [...list, { path: found.path, added: new Date().toISOString() }]));
  return found.path;
}
// path or a list of them; the files in the folders stay.
export function removeProject(ctx, path) {
  const gone = new Set([path].flat().map(canon));
  updateRegistry(ctx, (list) => list.filter((x) => !gone.has(x.path)));
}
const registeredEntry = (ctx, path) => {
  const p = canon(path), entry = listProjects(ctx).find((x) => x.path === p);
  if (!entry) throw new Error(`${p} is not a registered project`);
  return entry;
};
// Control characters other than the line break and tab of notes.
const control = (c, multiline) => { const n = c.charCodeAt(0); return n === 127 || (n < 32 && !(multiline && (n === 10 || n === 9))); };
const field = (v, what, max, multiline) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new Error(`${what} must be text`);
  if (v.length > max) throw new Error(`${what} is longer than ${max} characters`);
  if ([...v].some((c) => control(c, multiline))) throw new Error(`${what} has control characters`);
  return v.trim() || null;
};
// Display name and notes live in projects.json only. A missing key stays as it is; an empty one clears it.
export function renameProject(ctx, path, { name, notes } = {}) {
  const entry = registeredEntry(ctx, path);
  const set = [['name', name === undefined ? undefined : field(name, 'the name', 80, false)], ['notes', notes === undefined ? undefined : field(notes, 'the notes', 2000, true)]];
  updateRegistry(ctx, (list) => list.map((x) => {
    if (x.path !== entry.path) return x;
    const next = { ...x };
    for (const [key, v] of set) {
      if (v === undefined) continue;
      if (v == null) delete next[key]; else next[key] = v;
    }
    return next;
  }));
}
// A moved or renamed folder: the entry (name, notes, kept answers) takes the new path, and so does every run of the
// project in the history, so undo and the drift checks find its files there. The state file moved with the folder.
export function relocateProject(ctx, path, to) {
  const entry = registeredEntry(ctx, path);
  const dest = canon(to);
  if (!existsSync(dest) || !statSync(dest).isDirectory()) throw new Error(`${dest} is not a folder`);
  if (dest === entry.path) throw new Error(`${dest} is the folder already registered`);
  if (listProjects(ctx).some((x) => x.path === dest)) throw new Error(`${dest} is registered already: remove one of the two first`);
  const release = ctx.ledger.lock();
  try {
    ctx.ledger.relocate(entry.path, dest);
    try { updateRegistry(ctx, (list) => list.map((x) => (x.path === entry.path ? { ...x, path: dest } : x))); } catch (e) { ctx.ledger.relocate(dest, entry.path); throw e; }
  } finally { release(); }
  return dest;
}

const MARKERS = ['AGENTS.md', 'skills-lock.json', STATE];
const SKIP = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'vendor']);
// Folders below root (3 levels) holding an agent setup.
export function scan(ctx, root, depth = 3) {
  const why = unscannable(ctx, root);
  if (why) throw new Error(`${canon(root)} is ${why}: scan the folder your projects are in`);
  const found = [];
  const walk = (d, n) => {
    if (MARKERS.some((m) => existsSync(join(d, m)))) { found.push(d); return; }
    if (n === 0) return;
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.') && !unscannable(ctx, join(d, e.name))) walk(join(d, e.name), n - 1);
  };
  walk(canon(root), depth);
  return found;
}

// The project's own changes from its state file. Plugin installs change the machine, not the project: global apply does them, and
// projects apply in the checkout the ones at local scope (a run in a worktree would record them for the worktree's folder).
const projectChanges = (ctx, dir, answers = {}) => preview(projectPlan({ ctx: projectCtx(ctx, dir), dir, answers }).changes).filter((c) => c.kind !== 'command' || (c.cwd && !c.machine));

// Commands run synchronously, so each has a time limit: a push that waits for a passphrase or a commit that waits for a
// signing prompt would freeze a server for good (Stop cannot reach it). Local steps and network steps get their own limit.
const LOCAL = 300e3, NET = 120e3;
// Git talks to origin without waiting on a password or passphrase prompt (terminal or askpass helper).
function quiet(ctx, path) {
  const env = { ...repoEnv(), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' };
  if (!env.GIT_SSH_COMMAND && !git(ctx, path, ['config', '--get', 'core.sshCommand']).stdout.trim()) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return env;
}
// Fetches origin's default branch; true when it worked. One fetch per project and minute: the CLI's status and Update all
// share it; the server fills it first with prefetchOrigins, so its requests do not wait on the network. fresh skips the
// cache: a run that pushes must see the current origin (it may be unreachable or another repository by now).
const fetched = new Map();
function fetchBase(ctx, path, base, fresh = false) {
  const key = `${path}\0${base}`;
  if (!fresh && Date.now() - (fetched.get(key) ?? 0) < 60e3) return true;
  const ok = git(ctx, path, ['fetch', '-q', 'origin', base], { env: quiet(ctx, path), timeout: 20e3 }).code === 0;
  if (ok) fetched.set(key, Date.now());
  return ok;
}
// Origin's default branch: origin/HEAD, or asked from origin when the clone has none (a local main or master may not be it).
function remoteDefault(ctx, path) {
  const head = git(ctx, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).stdout.trim();
  if (head) return safeBranch(head.replace(/^origin\//, ''));
  return remoteHead(ctx, path, git(ctx, path, ['ls-remote', '--symref', 'origin', 'HEAD'], { env: quiet(ctx, path), timeout: 20e3 }));
}
// origin names its default branch itself: the name goes into a fetch refspec, so only plain branch names pass.
export function remoteHead(ctx, path, r) {
  const name = r.code === 0 ? r.stdout.match(/^ref: refs\/heads\/(\S+)\tHEAD$/m)?.[1] : null;
  if (name) return safeBranch(name);
  // Origin names none (no HEAD there, or unreachable): the local main or master.
  return defaultBranch(ctx, path);
}
// The state file on origin's default branch, read only after a fetch worked (an old tracking ref is not origin's
// state), kept a minute per project; null without origin, its default branch or a fetch. Update all starts there, so a
// setup merged on origin counts before the checkout is pulled.
const origins = new Map();
function originState(ctx, path) {
  const hit = origins.get(path);
  if (hit && Date.now() - hit.at < 60e3) return hit.value;
  const base = hasOrigin(ctx, path) && remoteDefault(ctx, path);
  if (!base || !fetchBase(ctx, path, base)) return null;
  return keepOrigin(ctx, path, base);
}
const hasOrigin = (ctx, path) => isRepo(ctx, path) && git(ctx, path, ['remote', 'get-url', 'origin']).code === 0;
function keepOrigin(ctx, path, base) {
  const ref = `origin/${base}`;
  let state = null;
  try { state = parseState(blob(ctx, path, ref, STATE).toString('utf8')); } catch { /* none, or unreadable: the checkout's counts */ }
  origins.set(path, { at: Date.now(), value: { ref, state } });
  return { ref, state };
}
// originState's network reads (ls-remote, fetch) through ctx.runAsync, four projects at a time, into the minute caches it
// reads: a server keeps answering meanwhile, where minutes of slow remotes would time out the page's requests. A failed
// fetch is kept as no origin state for the minute too.
export async function prefetchOrigins(ctx, paths) {
  if (!ctx.runAsync) return;
  const due = paths.filter((p) => !upToDate(tryState(p)) && !(Date.now() - (origins.get(p)?.at ?? 0) < 60e3) && hasOrigin(ctx, p));
  const net = (path, args) => ctx.runAsync(['git', '-C', path, ...args], { env: quiet(ctx, path), timeout: 20e3 });
  const one = async (path) => {
    const head = git(ctx, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).stdout.trim();
    const base = head ? safeBranch(head.replace(/^origin\//, '')) : remoteHead(ctx, path, await net(path, ['ls-remote', '--symref', 'origin', 'HEAD']));
    if (!base) return;
    const key = `${path}\0${base}`;
    if (!(Date.now() - (fetched.get(key) ?? 0) < 60e3)) {
      if ((await net(path, ['fetch', '-q', 'origin', base])).code !== 0) { origins.set(path, { at: Date.now(), value: null }); return; }
      fetched.set(key, Date.now());
    }
    keepOrigin(ctx, path, base);
  };
  await Promise.all(Array.from({ length: 4 }, async () => { while (due.length) await one(due.shift()); }));
}
// The setup that counts: the checkout's, unless origin's default branch has a newer one (or the checkout none).
export function setupOf(ctx, path, checkout = tryState(path)) {
  const origin = upToDate(checkout) ? null : originState(ctx, path);
  const o = origin?.state;
  // An app-only setup update on origin keeps the content version and raises the app version.
  const ahead = typeof o?.contentVersion === 'string' && (!checkout?.contentVersion || newer(o.contentVersion, checkout.contentVersion)
    || (o.contentVersion === checkout.contentVersion && typeof o.appVersion === 'string' && (!checkout.appVersion || newer(o.appVersion, checkout.appVersion))));
  const state = ahead ? o : checkout;
  return { state, checkout: checkout?.contentVersion ?? null, origin: origin?.ref ?? null };
}

// Per project: setup version (checkout: the checked-out one, when origin's counts instead), branch, clean tree, and
// the changes Update all would make, from the checkout's state file only when that is the one that counts.
export function status(ctx, path) {
  // A moved or deleted folder: nothing to read, Relocate and Remove are what is left.
  if (!isDir(path)) return { path, missing: true, setupVersion: null, current: false, checkout: null, origin: null, repo: false, branch: null, clean: null, changes: null, error: null, skills: {}, share: false, committed: false, agents: [], packs: [], tier: null };
  let local = null, error = null;
  try { local = readState(path); } catch (e) { error = e.message; }
  const own = local;
  if (!local) try { local = keptStrict(ctx, path); } catch (e) { error ??= e.message; }
  const { state, checkout, origin } = setupOf(ctx, path, local);
  const repo = isRepo(ctx, path);
  const branch = repo ? git(ctx, path, ['branch', '--show-current']).stdout.trim() : null;
  const share = state?.share === true;
  // committed: git tracks the state file of a setup this machine keeps local; Update all opens the pull request
  // that removes it, and plans no local changes until then.
  const committed = !!repo && !share && tracksState(ctx, path);
  let changes = null;
  if (state && state === local && !committed) {
    // Changes offered but not preselected (a removal BenchKeeper did not set up) are not pending.
    try { changes = projectChanges(ctx, path, own ? undefined : localAnswers(local)).filter((c) => c.selected); } catch (e) { error = e.message; }
  }
  // Per chosen agent, the skills in the project folder it reads.
  const skills = skillCounts(path, state?.agents ?? []);
  return { path, setupVersion: state?.contentVersion ?? null, current: upToDate(state), checkout, origin, repo, branch, clean: repo ? clean(ctx, path) : null, changes, error, skills,
    share, committed, agents: state?.agents ?? [], packs: state?.packs ?? [], tier: state?.tier ?? null };
}

// Repository git config that runs code or sends git elsewhere during Update all (local and worktree scope, include files
// followed), and the executable hooks of the common hooks folder. An unattended Update all runs a project only while this
// list equals the one its owner confirmed.
const CODE_KEYS = /^(core\.(hookspath|fsmonitor|sshcommand|askpass|gitproxy|worktree)|credential\.(.+\.)?helper|url\..+\.(pushinsteadof|insteadof)|remote\..+\.(url|pushurl|vcs|uploadpack|receivepack)|protocol\.(.+\.)?allow|filter\..+\.(clean|smudge|process)|commit\.gpgsign|gpg\.(.+\.)?program|include\.path|includeif\..+\.path|fetch\.recursesubmodules|submodule\.recurse)$/;
export function gitCodeConfig(ctx, path) {
  if (!isRepo(ctx, path)) return [];
  const parts = git(ctx, path, ['config', '--list', '--show-scope', '--includes', '-z']).stdout.split('\0');
  const out = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [key, value = ''] = parts[i + 1].split(/\n([\s\S]*)/);
    if (['local', 'worktree'].includes(parts[i]) && CODE_KEYS.test(key)) out.push({ key, value });
  }
  const common = git(ctx, path, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
  const hooks = common && join(common, 'hooks');
  for (const name of isDir(hooks) ? readdirSync(hooks).sort() : []) {
    const file = join(hooks, name);
    // A hook that links to a removed script runs nothing.
    let st; try { st = statSync(file); } catch { continue; }
    if (!name.endsWith('.sample') && st.isFile() && (st.mode & 0o111)) out.push({ key: `hook ${name}`, value: readFileSync(file, 'utf8') });
  }
  return out;
}
// Key and a hash of the value: a credential helper's value can hold a token, and the registry holds none.
const fingerprint = (items) => items.map((i) => `${i.key}=${hashText(i.value).slice(0, 16)}`).sort();
// The keys whose presence or value differs from the confirmed list; empty when they match.
export function unconfirmedGit(ctx, path) {
  const confirmed = new Set(listProjects(ctx).find((p) => p.path === canon(path))?.gitConfirmed ?? []);
  const now = new Set(fingerprint(gitCodeConfig(ctx, path)));
  const key = (f) => f.replace(/=[^=]*$/, '');
  return [...new Set([...now].filter((f) => !confirmed.has(f)).concat([...confirmed].filter((f) => !now.has(f))).map(key))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
// Records the project's current list as confirmed by its owner.
export function confirmGit(ctx, path) {
  const entry = registeredEntry(ctx, path), gitConfirmed = fingerprint(gitCodeConfig(ctx, entry.path));
  updateRegistry(ctx, (list) => list.map((x) => (x.path === entry.path ? { ...x, gitConfirmed } : x)));
  return gitConfirmed;
}

// One run pushes to at most this many repositories (max raises it): a registry that grew by an import or a scan does not
// publish to every repository at once.
export const MAX_PROJECTS = 25;
// Updates every registered project with a state file. Each project stops on its own error; the others continue.
// answers[path] sets up a project without a state file the same way. A local setup (the default) is applied in the
// checkout; a shared one lands on branch chore/agent-setup-<version> with one commit and a pull request.
// The setup that counts for a project says whether it is shared: the checkout's, the one kept from a removal pull request,
// or origin's.
const setupFor = (ctx, path, local = readState(path)) => local ?? keptStrict(ctx, path) ?? (isRepo(ctx, path) ? setupOf(ctx, path, local).state : null);
// The paths a pushed run would push: a GitHub origin and a pull request (a shared setup, or a committed one that goes local).
// A local setup is applied in the checkout and pushes nothing.
export const pushTargets = (ctx, paths, answers = {}) => paths.filter((p) => {
  try {
    if (!githubRemote(ctx, p)) return false;
    return (answers[p]?.share ?? setupFor(ctx, p)?.share ?? false) || (!answers[p] && tracksState(ctx, p));
  } catch { return false; }
});
export function updateAll(ctx, { paths = listProjects(ctx).map((p) => p.path), push = true, answers = {}, max = MAX_PROJECTS } = {}) {
  const targets = push ? pushTargets(ctx, paths, answers).length : 0;
  if (targets > max) throw new Error(`${targets} repositories to push to: Update all pushes to at most ${max} per run (--max N raises it, --no-push stays local)`);
  return paths.map((path) => {
    const result = { path };
    try {
      if (!isDir(path)) throw new Error('folder not found: relocate the project or remove it from the list');
      const local = readState(path), repo = isRepo(ctx, path);
      // The setup that counts says whether it is shared: the checkout's, the one kept from a removal pull request, or
      // origin's.
      const setup = setupFor(ctx, path, local);
      if (!answers[path] && !setup) throw new Error(`no ${STATE}: set the project up first`);
      if (!(answers[path]?.share ?? setup?.share ?? false)) {
        // Still committed: a local apply would change tracked files, and pulling the removal later would fail on them.
        if (!answers[path] && repo && tracksState(ctx, path)) return unshare(ctx, path, { push });
        const run = apply(projectChanges(ctx, path, answers[path] ?? (local ? undefined : localAnswers(setup))), projectCtx(ctx, path), { scope: path, note: { updateAll: path } });
        result.run = run.id;
        if (run.status !== 'done') throw new Error(run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; '));
        if (kept(ctx, path)) keepState(ctx, path, null);
        result.status = run.entries.length ? 'applied' : 'current';
        return result;
      }
      viaPullRequest(ctx, path, result, {
        branch: `chore/agent-setup-${contentVersion}`, push,
        // Without a state file here, the one on the start branch (a setup merged on origin) sets the project up.
        check: (start) => { if (!answers[path] && !local && git(ctx, path, ['cat-file', '-e', `${start}:${STATE}`]).code !== 0) throw new Error(`no ${STATE}: set the project up first`); },
        work: (tree) => apply(projectChanges(ctx, tree, answers[path]), projectCtx(ctx, tree), { scope: tree, note: { updateAll: path, branch: `chore/agent-setup-${contentVersion}` } }),
        title: `chore: agent setup ${contentVersion}`,
        body: `BenchKeeper setup ${contentVersion}, applied by \`benchkeeper projects update\` from \`${STATE}\`. Steps that need an agent session are not part of this change.`,
      });
    } catch (e) {
      result.status = 'stopped';
      result.reason = e.message;
    }
    return result;
  });
}

// A committed setup made local: one pull request takes it out of the repository (committedSetup). The checkout keeps the
// committed copies until the merge is pulled (changing them would make that pull fail), and the registry keeps its state
// file, so Update all writes the local setup after the pull deleted them.
export function unshare(ctx, path, { push = true } = {}) {
  const result = { path };
  try {
    // Kept first: once the pull request is merged and pulled, the state file is gone, whatever this run ends with.
    const state = readState(path);
    if (state) keepState(ctx, path, state);
    viaPullRequest(ctx, path, result, {
      branch: 'chore/agent-setup-local', push,
      work: (tree) => apply(preview(committedSetup(tree)), projectCtx(ctx, tree), { scope: tree, note: { updateAll: path, branch: 'chore/agent-setup-local' } }),
      title: 'chore: keep the agent setup local',
      body: 'BenchKeeper now keeps the per-project agent setup on each machine, in files git ignores (`.git/info/exclude`): `CLAUDE.local.md`, `AGENTS.override.md`, `.claude/settings.local.json`, the installed skills and `.benchkeeper/`. This removes the committed copies: the BenchKeeper block in `AGENTS.md`, a `CLAUDE.md` that only imported `AGENTS.md`, the sandbox keys BenchKeeper set, the skills BenchKeeper or the skills CLI installed with `skills-lock.json`, and `.benchkeeper/`. The project\'s own `AGENTS.md` text, its own skills, `docs/agents/` and the dev container stay.\n\nAfter merging, pull, then run Update all in BenchKeeper (`npx benchkeeper projects update`): it writes the local setup from the answers it kept. Other machines: `npx benchkeeper projects apply --agents ...` once.',
    });
  } catch (e) {
    result.status = 'stopped';
    result.reason = e.message;
  }
  return result;
}

// What "Remove BenchKeeper setup" would do: the files of a local setup in the checkout, or, for a shared setup (and a
// local one git still tracks), the committed copies as a pull request. The state file kept in the registry counts as a
// setup too.
export function setupRemoval(ctx, path) {
  registeredEntry(ctx, path);
  const state = tryState(path);
  const shared = state?.share === true;
  // A local setup git still tracks leaves with a pull request too, next to the local files git ignores.
  const pr = shared || (isRepo(ctx, path) && tracksState(ctx, path));
  const key = repoKey(ctx, path);
  const keepExclude = !!key && listProjects(ctx).some((x) => x.path !== canon(path) && repoKey(ctx, x.path) === key);
  const local = shared ? [] : preview(localSetup(ctx, path, { keepExclude }));
  const committed = pr ? preview(committedSetup(path)) : [];
  return { shared: pr, local, pr: committed, changes: [...local, ...committed], kept: !!kept(ctx, path) };
}
const REMOVAL_BRANCH = 'chore/remove-agent-setup';
// Takes the BenchKeeper setup out of a project and leaves it registered, as "not set up". A local setup is one run in the
// checkout (undo in History); a shared one is a pull request, which is undone by closing it. The project's own AGENTS.md
// text, docs/agents/ and .devcontainer/ stay.
export function removeSetup(ctx, path, { push = true } = {}) {
  const result = { path };
  try {
    const { shared, local, changes, kept: keptState } = setupRemoval(ctx, path);
    if (!changes.length && !keptState) throw new Error('no BenchKeeper setup to remove');
    if (local.length) {
      const run = apply(local, projectCtx(ctx, path), { scope: path, note: { removeSetup: path } });
      result.run = run.id;
      if (run.status !== 'done') throw new Error(run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; '));
    }
    if (shared) {
      viaPullRequest(ctx, path, result, {
        branch: REMOVAL_BRANCH, push,
        work: (tree) => apply(preview(committedSetup(tree)), projectCtx(ctx, tree), { scope: tree, note: { updateAll: path, branch: REMOVAL_BRANCH } }),
        title: 'chore: remove the BenchKeeper agent setup',
        body: 'Removes the BenchKeeper setup of this repository: the BenchKeeper block in `AGENTS.md`, a `CLAUDE.md` that only imported `AGENTS.md`, the sandbox keys BenchKeeper set, the skills BenchKeeper or the skills CLI installed with `skills-lock.json`, and `.benchkeeper/`. The project\'s own `AGENTS.md` text, its own skills, `docs/agents/` and the dev container stay.',
      });
    } else result.status = 'removed';
    // The answers kept for a later local setup would bring the setup back with the next Update all.
    if (keptState) keepState(ctx, path, null);
  } catch (e) {
    result.status = 'stopped';
    result.reason = e.message;
  }
  return result;
}

// One change as a pull request: a worktree on origin's default branch (or the local one), work(tree) returns the run
// that changed it, then one commit, push and gh pr create. Fills result (branch, run, status, pr, a kept worktree) and
// throws with the reason.
function viaPullRequest(ctx, path, result, { branch, push = true, check = () => {}, work, title, body }) {
  result.branch = branch;
  if (!isRepo(ctx, path)) throw new Error('not a git repository');
  // The pull request is built from the repository root: a project in a subfolder would get the root's files.
  if (canon(repoRoot(ctx, path)) !== canon(path)) throw new Error('the project is a subfolder of a repository: Update all by pull request needs the repository root');
  if (!clean(ctx, path)) throw new Error('working tree has changes');
  const base = defaultBranch(ctx, path);
  if (!base) throw new Error('no default branch (origin/HEAD, main or master)');
  // The branch starts at the remote's default branch when it can be fetched. The local one may hold commits that were
  // never pushed: it starts a branch only when nothing is pushed.
  const fetchedOk = fetchBase(ctx, path, base, push);
  if (!fetchedOk && push && githubRemote(ctx, path)) throw new Error(`could not fetch origin/${base}: the local ${base} may hold unpushed commits (try again, or --no-push)`);
  const start = fetchedOk ? `origin/${base}` : base;
  check(start);
  // Per project path, so two projects with one folder name never share (and delete) a worktree.
  const tree = join(ctx.home, '.cache/benchkeeper/worktrees', `${basename(path)}-${hashText(path).slice(0, 8)}-${branch.split('/').pop()}`);
  // A relative core.hooksPath resolves in the worktree, which holds the fetched tree: the checkout's hooks run instead.
  const hooksPath = git(ctx, path, ['config', '--get', 'core.hooksPath']).stdout.trim();
  const hooks = hooksPath && !isAbsolute(hooksPath) && !hooksPath.startsWith('~') ? ['-c', `core.hooksPath=${resolve(path, hooksPath)}`] : [];
  // Every git call in the worktree goes through this, so the pin covers add, status and the rest, not only commit and push.
  const inTree = (args, extra) => git(ctx, tree, [...hooks, ...args], extra);
  // A worktree left by a failed run holds its partial work: it stays until the user removes it.
  if (existsSync(tree)) throw new Error(`an earlier failed run left ${tree}: look at it, then git worktree remove --force ${tree}`);
  const previous = git(ctx, path, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).stdout.trim();
  // An unmerged branch from earlier runs gets new commits on top, so its pushes stay fast-forward; it may hold
  // only the commits those runs made (by id, from the ledger). A merged one starts again at the default branch.
  const open = previous && git(ctx, path, ['merge-base', '--is-ancestor', previous, start]).code !== 0;
  if (open) {
    const made = new Set(ctx.ledger.list().filter((r) => r.note?.updateAll === path && r.note.branch === branch && r.note.commit).map((r) => r.note.commit));
    const other = git(ctx, path, ['log', '--format=%H %s', `${start}..${previous}`]).stdout.split('\n').filter(Boolean).filter((l) => !made.has(l.split(' ')[0]));
    if (other.length) throw new Error(`local branch ${branch} has other commits (${other[0].slice(41)}): merge or rename it first`);
  }
  // Only this worktree's own stale record (its folder is gone) is removed: `git worktree prune` would drop the records of
  // the user's other worktrees whose folder is missing, an unmounted drive.
  if (git(ctx, path, ['worktree', 'list', '--porcelain']).stdout.split('\n').some((l) => l.startsWith('worktree ') && canon(l.slice(9)) === canon(tree))) git(ctx, path, ['worktree', 'remove', '--force', tree]);
  const wt = git(ctx, path, [...hooks, ...(open ? ['worktree', 'add', '-q', tree, branch] : ['worktree', 'add', '-q', '-B', branch, tree, start])], { timeout: LOCAL });
  if (wt.code !== 0) throw new Error(`git worktree add: ${wt.stderr.trim()}`);
  let keep = false, planned = false;
  try {
    const run = work(tree);
    planned = keep = true;
    result.run = run.id;
    if (run.status !== 'done') throw new Error(`${run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; ')} (the worktree stays at ${tree})`);
    inTree(['add', '-A']);
    // Nothing new on an unmerged branch from an earlier run: its commits still go out (that run's push or pull
    // request may have failed).
    if (clean(ctx, tree, hooks) && !(open && push && githubRemote(ctx, path))) { result.status = 'current'; keep = false; return result; }
    if (!clean(ctx, tree, hooks)) {
      const commit = inTree(['commit', '-q', '-m', title, '-m', body.replace(/`/g, '')], { timeout: LOCAL });
      if (commit.code !== 0) throw new Error(`git commit: ${commit.stderr.trim()} (the worktree stays at ${tree})`);
      ctx.ledger.save({ ...ctx.ledger.get(run.id), note: { updateAll: path, branch, commit: inTree(['rev-parse', 'HEAD']).stdout.trim() } });
    }
    // The commit is on the branch: the worktree is not needed for pushing.
    keep = false;
    result.status = 'committed';
    if (push && githubRemote(ctx, path)) {
      const head = inTree(['rev-parse', 'HEAD']).stdout.trim();
      const remote = git(ctx, path, ['ls-remote', 'origin', `refs/heads/${branch}`], { env: quiet(ctx, path), timeout: NET }).stdout.split(/\s/)[0];
      if (remote !== head) {
        const p = inTree(['push', '-q', '-u', 'origin', branch], { env: quiet(ctx, path), timeout: NET });
        if (p.code !== 0) throw new Error(`git push (origin may have ${branch} with other commits: merge or close its pull request first): ${p.stderr.trim()}`);
      }
      const pr = ctx.run(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: tree, timeout: NET });
      const url = `${pr.stdout}\n${pr.stderr}`.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0];
      if (pr.code !== 0 && !(url && /already exists/.test(pr.stderr))) throw new Error(`gh pr create: ${pr.stderr.trim()}`);
      result.pr = url;
      result.status = 'pull request';
    }
  } finally {
    if (keep) result.worktree = tree;
    else git(ctx, path, ['worktree', 'remove', '--force', tree]);
    // A plan that failed wrote nothing: a branch this run made goes too.
    if (!planned && !previous) git(ctx, path, ['branch', '-D', branch]);
  }
}
