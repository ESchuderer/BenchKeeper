// Registered projects and Update all: one branch, one commit and one pull request per project, built in a git
// worktree so the user's checkout stays as it is.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { agent } from './agents.mjs';
import { appVersion } from './content.mjs';
import { hashText, writeAtomic } from './fsx.mjs';
import { skillFiles } from './doctor.mjs';
import { blob, clean, defaultBranch, git, githubRemote, isRepo, safeBranch } from './git.mjs';
import { apply, preview } from './runner.mjs';
import { STATE, committedSetup, projectCtx, projectPlan, readState, tracksState, tryState } from './steps/project.mjs';
import { newer } from './update.mjs';

const file = (ctx) => join(ctx.config, 'projects.json');

export function listProjects(ctx) {
  try { return JSON.parse(readFileSync(file(ctx), 'utf8')).projects; } catch { return []; }
}
// Packs the registered projects use; null when none has a state file, so nothing counts as unused.
export function packsInUse(ctx) {
  const states = listProjects(ctx).map((p) => projectState(ctx, p.path)).filter(Boolean);
  return states.length ? [...new Set(states.flatMap((s) => s.packs ?? []))] : null;
}
function save(ctx, projects) {
  writeAtomic(file(ctx), `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`);
}
// The state file a removal pull request deletes from the checkout on the next pull, kept in the registry until the
// project has its own again (local, untracked).
const kept = (ctx, path) => listProjects(ctx).find((p) => p.path === path)?.state ?? null;
// A registered project's answers: its state file, or the one kept after a removal pull request.
export const projectState = (ctx, path) => tryState(path) ?? kept(ctx, path);
function keepState(ctx, path, state) {
  const list = listProjects(ctx);
  if (!list.some((p) => p.path === path)) list.push({ path, added: new Date().toISOString() });
  save(ctx, list.map((p) => (p.path !== path ? p : state ? { ...p, state } : (({ state: _, ...rest }) => rest)(p))));
}
// A state file as answers for a local setup.
const localAnswers = (s) => ({ ...s, skills: s.singles, share: false });
export function addProject(ctx, path) {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
  if (!statSync(p).isDirectory()) throw new Error(`${p} is not a folder`);
  const list = listProjects(ctx);
  if (!list.some((x) => x.path === p)) save(ctx, [...list, { path: p, added: new Date().toISOString() }]);
  return p;
}
export function removeProject(ctx, path) {
  save(ctx, listProjects(ctx).filter((x) => x.path !== resolve(path)));
}

const MARKERS = ['AGENTS.md', 'skills-lock.json', STATE];
const SKIP = new Set(['node_modules', '.git', '.cache', 'dist', 'build', 'vendor']);
// Folders below root (3 levels) holding an agent setup.
export function scan(root, depth = 3) {
  const found = [];
  const walk = (d, n) => {
    if (MARKERS.some((m) => existsSync(join(d, m)))) { found.push(d); return; }
    if (n === 0) return;
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(join(d, e.name), n - 1);
  };
  walk(resolve(root), depth);
  return found;
}

// The project's own changes from its state file. Plugin installs change the machine, not the project: global apply does them.
const projectChanges = (ctx, dir, answers = {}) => preview(projectPlan({ ctx: projectCtx(ctx, dir), dir, answers }).changes).filter((c) => c.kind !== 'command' || c.cwd);

// Git talks to origin without waiting on a password or passphrase prompt (terminal or askpass helper).
function quiet(ctx, path) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '' };
  if (!env.GIT_SSH_COMMAND && !git(ctx, path, ['config', '--get', 'core.sshCommand']).stdout.trim()) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return env;
}
// Fetches origin's default branch; true when it worked. One fetch per project and minute: the CLI's status and Update all
// share it; the server fills it first with prefetchOrigins, so its requests do not wait on the network.
const fetched = new Map();
function fetchBase(ctx, path, base) {
  const key = `${path}\0${base}`;
  if (Date.now() - (fetched.get(key) ?? 0) < 60e3) return true;
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
  try { state = JSON.parse(blob(ctx, path, ref, STATE).toString('utf8')); } catch { /* none, or unreadable: the checkout's counts */ }
  origins.set(path, { at: Date.now(), value: { ref, state } });
  return { ref, state };
}
// originState's network reads (ls-remote, fetch) through ctx.runAsync, four projects at a time, into the minute caches it
// reads: a server keeps answering meanwhile, where minutes of slow remotes would time out the page's requests. A failed
// fetch is kept as no origin state for the minute too.
export async function prefetchOrigins(ctx, paths) {
  if (!ctx.runAsync) return;
  const due = paths.filter((p) => tryState(p)?.setupVersion !== appVersion && !(Date.now() - (origins.get(p)?.at ?? 0) < 60e3) && hasOrigin(ctx, p));
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
  const origin = checkout?.setupVersion === appVersion ? null : originState(ctx, path);
  const v = origin?.state?.setupVersion;
  const state = typeof v === 'string' && (!checkout?.setupVersion || newer(v, checkout.setupVersion)) ? origin.state : checkout;
  return { state, checkout: checkout?.setupVersion ?? null, origin: origin?.ref ?? null };
}

// Per project: setup version (checkout: the checked-out one, when origin's counts instead), branch, clean tree, and
// the changes Update all would make, from the checkout's state file only when that is the one that counts.
export function status(ctx, path) {
  let local = null, error = null;
  try { local = readState(path); } catch (e) { error = e.message; }
  const own = local;
  local ??= kept(ctx, path);
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
  const files = skillFiles(path);
  const skills = Object.fromEntries((state?.agents ?? []).map((a) => [a, files.filter((f) => f.file.startsWith(join(path, agent(a).project.skills, '/'))).length]));
  return { path, setupVersion: state?.setupVersion ?? null, current: state?.setupVersion === appVersion, checkout, origin, repo, branch, clean: repo ? clean(ctx, path) : null, changes, error, skills,
    share, committed };
}

// Updates every registered project with a state file. Each project stops on its own error; the others continue.
// answers[path] sets up a project without a state file the same way. A local setup (the default) is applied in the
// checkout; a shared one lands on branch chore/agent-setup-<version> with one commit and a pull request.
export function updateAll(ctx, { paths = listProjects(ctx).map((p) => p.path), push = true, answers = {} } = {}) {
  return paths.map((path) => {
    const result = { path };
    try {
      const local = readState(path), repo = isRepo(ctx, path);
      // The setup that counts says whether it is shared: the checkout's, the one kept from a removal pull request, or
      // origin's.
      const setup = local ?? kept(ctx, path) ?? (repo ? setupOf(ctx, path, local).state : null);
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
        branch: `chore/agent-setup-${appVersion}`, push,
        // Without a state file here, the one on the start branch (a setup merged on origin) sets the project up.
        check: (start) => { if (!answers[path] && !local && git(ctx, path, ['cat-file', '-e', `${start}:${STATE}`]).code !== 0) throw new Error(`no ${STATE}: set the project up first`); },
        work: (tree) => apply(projectChanges(ctx, tree, answers[path]), projectCtx(ctx, tree), { scope: tree, note: { updateAll: path, branch: `chore/agent-setup-${appVersion}` } }),
        title: `chore: agent setup ${appVersion}`,
        body: `BenchKeeper setup ${appVersion}, applied by \`benchkeeper update-all\` from \`${STATE}\`. Steps that need an agent session are not part of this change.`,
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
      body: 'BenchKeeper now keeps the per-project agent setup on each machine, in files git ignores (`.git/info/exclude`): `CLAUDE.local.md`, `AGENTS.override.md`, `.claude/settings.local.json`, the installed skills and `.benchkeeper/`. This removes the committed copies: the BenchKeeper block in `AGENTS.md`, a `CLAUDE.md` that only imported `AGENTS.md`, the sandbox keys BenchKeeper set, the skills BenchKeeper or the skills CLI installed with `skills-lock.json`, and `.benchkeeper/`. The project\'s own `AGENTS.md` text, its own skills, `docs/agents/` and the dev container stay.\n\nAfter merging, pull, then run Update all in BenchKeeper (`npx benchkeeper update-all`): it writes the local setup from the answers it kept. Other machines: `npx benchkeeper project apply --agents ...` once.',
    });
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
  if (!clean(ctx, path)) throw new Error('working tree has changes');
  const base = defaultBranch(ctx, path);
  if (!base) throw new Error('no default branch (origin/HEAD, main or master)');
  // The branch starts at the remote's default branch when it can be fetched, else at the local one.
  const start = fetchBase(ctx, path, base) ? `origin/${base}` : base;
  check(start);
  // Per project path, so two projects with one folder name never share (and delete) a worktree.
  const tree = join(ctx.home, '.cache/benchkeeper/worktrees', `${basename(path)}-${hashText(path).slice(0, 8)}-${branch.split('/').pop()}`);
  git(ctx, path, ['worktree', 'prune']);
  // A relative core.hooksPath resolves in the worktree, which holds the fetched tree: the checkout's hooks run instead.
  const hooksPath = git(ctx, path, ['config', '--get', 'core.hooksPath']).stdout.trim();
  const hooks = hooksPath && !isAbsolute(hooksPath) && !hooksPath.startsWith('~') ? ['-c', `core.hooksPath=${resolve(path, hooksPath)}`] : [];
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
  const wt = git(ctx, path, [...hooks, ...(open ? ['worktree', 'add', '-q', tree, branch] : ['worktree', 'add', '-q', '-B', branch, tree, start])]);
  if (wt.code !== 0) throw new Error(`git worktree add: ${wt.stderr.trim()}`);
  let keep = false, planned = false;
  try {
    const run = work(tree);
    planned = keep = true;
    result.run = run.id;
    if (run.status !== 'done') throw new Error(`${run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; ')} (the worktree stays at ${tree})`);
    git(ctx, tree, ['add', '-A']);
    // Nothing new on an unmerged branch from an earlier run: its commits still go out (that run's push or pull
    // request may have failed).
    if (clean(ctx, tree) && !(open && push && githubRemote(ctx, path))) { result.status = 'current'; keep = false; return result; }
    if (!clean(ctx, tree)) {
      const commit = git(ctx, tree, [...hooks, 'commit', '-q', '-m', title, '-m', body.replace(/`/g, '')]);
      if (commit.code !== 0) throw new Error(`git commit: ${commit.stderr.trim()} (the worktree stays at ${tree})`);
      ctx.ledger.save({ ...ctx.ledger.get(run.id), note: { updateAll: path, branch, commit: git(ctx, tree, ['rev-parse', 'HEAD']).stdout.trim() } });
    }
    // The commit is on the branch: the worktree is not needed for pushing.
    keep = false;
    result.status = 'committed';
    if (push && githubRemote(ctx, path)) {
      const head = git(ctx, tree, ['rev-parse', 'HEAD']).stdout.trim();
      const remote = git(ctx, path, ['ls-remote', 'origin', `refs/heads/${branch}`]).stdout.split(/\s/)[0];
      if (remote !== head) {
        const p = git(ctx, tree, [...hooks, 'push', '-q', '-u', 'origin', branch]);
        if (p.code !== 0) throw new Error(`git push (origin may have ${branch} with other commits: merge or close its pull request first): ${p.stderr.trim()}`);
      }
      const pr = ctx.run(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: tree });
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
