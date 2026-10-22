// Registered projects and Update all: one branch, one commit and one pull request per project, built in a git
// worktree so the user's checkout stays as it is.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { agent } from './agents.mjs';
import { appVersion } from './content.mjs';
import { hashText, writeAtomic } from './fsx.mjs';
import { skillFiles } from './doctor.mjs';
import { blob, clean, defaultBranch, git, githubRemote, isRepo } from './git.mjs';
import { apply, preview } from './runner.mjs';
import { STATE, projectPlan, readState, tryState } from './steps/project.mjs';
import { newer } from './update.mjs';

const file = (ctx) => join(ctx.config, 'projects.json');

export function listProjects(ctx) {
  try { return JSON.parse(readFileSync(file(ctx), 'utf8')).projects; } catch { return []; }
}
// Packs the registered projects use; null when none has a state file, so nothing counts as unused.
export function packsInUse(ctx) {
  const states = listProjects(ctx).map((p) => tryState(p.path)).filter(Boolean);
  return states.length ? [...new Set(states.flatMap((s) => s.packs ?? []))] : null;
}
function save(ctx, projects) {
  writeAtomic(file(ctx), `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`);
}
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
const projectChanges = (ctx, dir, answers = {}) => preview(projectPlan({ ctx: { ...ctx, roots: [dir] }, dir, answers }).changes).filter((c) => c.kind !== 'command' || c.cwd);

// Fetches origin's default branch without waiting on a password or passphrase prompt; true when it worked.
// shortcut: blocks the server like the other git reads here; move to ctx.runAsync if many slow remotes stall the UI.
function fetchBase(ctx, path, base) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (!env.GIT_SSH_COMMAND && !git(ctx, path, ['config', '--get', 'core.sshCommand']).stdout.trim()) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return git(ctx, path, ['fetch', '-q', 'origin', base], { env, timeout: 20e3 }).code === 0;
}
// The state file on origin's default branch after a fetch (kept a minute per project once a fetch worked); null without
// origin or that branch. Update all starts there, so a setup merged on origin counts before the checkout is pulled.
const origins = new Map();
function originState(ctx, path) {
  const hit = origins.get(path);
  if (hit && Date.now() - hit.at < 60e3) return hit.value;
  const base = isRepo(ctx, path) && git(ctx, path, ['remote', 'get-url', 'origin']).code === 0 && defaultBranch(ctx, path);
  if (!base) return null;
  const ok = fetchBase(ctx, path, base);
  const ref = `origin/${base}`;
  if (git(ctx, path, ['rev-parse', '--verify', '-q', ref]).code !== 0) return null;
  let state = null;
  try { state = JSON.parse(blob(ctx, path, ref, STATE).toString('utf8')); } catch { /* none, or unreadable: the checkout's counts */ }
  if (ok) origins.set(path, { at: Date.now(), value: { ref, state } });
  return { ref, state };
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
  const { state, checkout, origin } = setupOf(ctx, path, local);
  const repo = isRepo(ctx, path);
  const branch = repo ? git(ctx, path, ['branch', '--show-current']).stdout.trim() : null;
  let changes = null;
  if (state && state === local) {
    // Changes offered but not preselected (a removal BenchKeeper did not set up) are not pending.
    try { changes = projectChanges(ctx, path).filter((c) => c.selected); } catch (e) { error = e.message; }
  }
  // Per chosen agent, the skills in the project folder it reads.
  const files = skillFiles(path);
  const skills = Object.fromEntries((state?.agents ?? []).map((a) => [a, files.filter((f) => f.file.startsWith(join(path, agent(a).project.skills, '/'))).length]));
  return { path, setupVersion: state?.setupVersion ?? null, current: state?.setupVersion === appVersion, checkout, origin, repo, branch, clean: repo ? clean(ctx, path) : null, changes, error, skills };
}

// Updates every registered project with a state file. Each project stops on its own error; the others continue.
// answers[path] sets up a project without a state file the same way: its first setup lands on the branch too.
export function updateAll(ctx, { paths = listProjects(ctx).map((p) => p.path), push = true, answers = {} } = {}) {
  const branch = `chore/agent-setup-${appVersion}`;
  return paths.map((path) => {
    const result = { path, branch };
    try {
      const local = readState(path), repo = isRepo(ctx, path);
      if (!answers[path] && !local && !repo) throw new Error(`no ${STATE}: set the project up first`);
      if (!repo) throw new Error('not a git repository');
      if (!clean(ctx, path)) throw new Error('working tree has changes');
      const base = defaultBranch(ctx, path);
      if (!base) throw new Error('no default branch (origin/HEAD, main or master)');
      // The branch starts at the remote's default branch when it can be fetched, else at the local one.
      const start = fetchBase(ctx, path, base) ? `origin/${base}` : base;
      // Without a state file here, the one on the start branch (a setup merged on origin) sets the project up.
      if (!answers[path] && !local && git(ctx, path, ['cat-file', '-e', `${start}:${STATE}`]).code !== 0) throw new Error(`no ${STATE}: set the project up first`);
      // Per project path, so two projects with one folder name never share (and delete) a worktree.
      const tree = join(ctx.home, '.cache/benchkeeper/worktrees', `${basename(path)}-${hashText(path).slice(0, 8)}-${appVersion}`);
      git(ctx, path, ['worktree', 'prune']);
      // A relative core.hooksPath resolves in the worktree, which holds the fetched tree: the checkout's hooks run instead.
      const hooksPath = git(ctx, path, ['config', '--get', 'core.hooksPath']).stdout.trim();
      const hooks = hooksPath && !isAbsolute(hooksPath) && !hooksPath.startsWith('~') ? ['-c', `core.hooksPath=${resolve(path, hooksPath)}`] : [];
      // A worktree left by a failed run holds its partial work: it stays until the user removes it.
      if (existsSync(tree)) throw new Error(`a failed Update all left ${tree}: look at it, then git worktree remove --force ${tree}`);
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
        const changes = projectChanges(ctx, tree, answers[path]);
        planned = keep = true;
        const run = apply(changes, { ...ctx, roots: [tree] }, { scope: tree, note: { updateAll: path, branch } });
        result.run = run.id;
        if (run.status !== 'done') throw new Error(`${run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; ')} (the worktree stays at ${tree})`);
        git(ctx, tree, ['add', '-A']);
        if (clean(ctx, tree)) { result.status = 'current'; keep = false; return result; }
        const commit = git(ctx, tree, [...hooks, 'commit', '-q', '-m', `chore: agent setup ${appVersion}`, '-m', `BenchKeeper setup ${appVersion}, applied by benchkeeper update-all from ${STATE}.`]);
        if (commit.code !== 0) throw new Error(`git commit: ${commit.stderr.trim()} (the worktree stays at ${tree})`);
        ctx.ledger.save({ ...ctx.ledger.get(run.id), note: { updateAll: path, branch, commit: git(ctx, tree, ['rev-parse', 'HEAD']).stdout.trim() } });
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
          const pr = ctx.run(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', `chore: agent setup ${appVersion}`, '--body', `BenchKeeper setup ${appVersion}, applied by \`benchkeeper update-all\` from \`${STATE}\`. Steps that need an agent session are not part of this change.`], { cwd: tree });
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
    } catch (e) {
      result.status = 'stopped';
      result.reason = e.message;
    }
    return result;
  });
}
