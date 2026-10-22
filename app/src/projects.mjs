// Registered projects and Update all: one branch, one commit and one pull request per project, built in a git
// worktree so the user's checkout stays as it is.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { appVersion } from './content.mjs';
import { hashText, writeAtomic } from './fsx.mjs';
import { clean, defaultBranch, git, githubRemote, isRepo } from './git.mjs';
import { apply, preview } from './runner.mjs';
import { STATE, projectPlan, readState } from './steps/project.mjs';

const file = (ctx) => join(ctx.config, 'projects.json');

export function listProjects(ctx) {
  try { return JSON.parse(readFileSync(file(ctx), 'utf8')).projects; } catch { return []; }
}
function save(ctx, projects) {
  writeAtomic(file(ctx), `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`);
}
export function addProject(ctx, path) {
  const p = resolve(path);
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
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
const projectChanges = (ctx, dir) => preview(projectPlan({ ctx: { ...ctx, roots: [dir] }, dir, answers: {} }).changes).filter((c) => c.kind !== 'command' || c.cwd);

// Per project: setup version, branch, clean tree, and the changes Update all would make.
export function status(ctx, path) {
  let state = null, error = null;
  try { state = readState(path); } catch (e) { error = e.message; }
  const repo = isRepo(ctx, path);
  const branch = repo ? git(ctx, path, ['branch', '--show-current']).stdout.trim() : null;
  let changes = null;
  if (state) {
    try { changes = projectChanges(ctx, path); } catch (e) { error = e.message; }
  }
  return { path, setupVersion: state?.setupVersion ?? null, current: state?.setupVersion === appVersion, repo, branch, clean: repo ? clean(ctx, path) : null, changes, error };
}

// Updates every registered project with a state file. Each project stops on its own error; the others continue.
export function updateAll(ctx, { paths = listProjects(ctx).map((p) => p.path), push = true } = {}) {
  const branch = `chore/agent-setup-${appVersion}`;
  return paths.map((path) => {
    const result = { path, branch };
    try {
      if (!readState(path)) throw new Error(`no ${STATE}: run benchkeeper project apply there first`);
      if (!isRepo(ctx, path)) throw new Error('not a git repository');
      if (!clean(ctx, path)) throw new Error('working tree has changes');
      const base = defaultBranch(ctx, path);
      if (!base) throw new Error('no default branch (origin/HEAD, main or master)');
      // The branch starts at the remote's default branch when it can be fetched, else at the local one.
      const start = git(ctx, path, ['fetch', '-q', 'origin', base]).code === 0 ? `origin/${base}` : base;
      // Per project path, so two projects with one folder name never share (and delete) a worktree.
      const tree = join(ctx.home, '.cache/benchkeeper/worktrees', `${basename(path)}-${hashText(path).slice(0, 8)}-${appVersion}`);
      rmSync(tree, { recursive: true, force: true });
      git(ctx, path, ['worktree', 'prune']);
      const previous = git(ctx, path, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`]).stdout.trim();
      // The branch is rebuilt from the default branch; commits other than an earlier Update all would be lost.
      const other = previous && git(ctx, path, ['log', '--format=%s', `${start}..${previous}`]).stdout.split('\n').filter((l) => l && l !== `chore: agent setup ${appVersion}`);
      if (other?.length) throw new Error(`local branch ${branch} has other commits (${other[0]}): merge or rename it first`);
      const wt = git(ctx, path, ['worktree', 'add', '-q', '-B', branch, tree, start]);
      if (wt.code !== 0) throw new Error(`git worktree add: ${wt.stderr.trim()}`);
      try {
        const run = apply(projectChanges(ctx, tree), { ...ctx, roots: [tree] }, { scope: tree, note: { updateAll: path, branch } });
        result.run = run.id;
        if (run.status !== 'done') throw new Error(run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; '));
        git(ctx, tree, ['add', '-A']);
        if (clean(ctx, tree)) { result.status = 'current'; return result; }
        const commit = git(ctx, tree, ['commit', '-q', '-m', `chore: agent setup ${appVersion}`, '-m', `BenchKeeper setup ${appVersion}, applied by benchkeeper update-all from ${STATE}.`]);
        if (commit.code !== 0) throw new Error(`git commit: ${commit.stderr.trim()}`);
        result.status = 'committed';
        // A branch from an earlier run with the same files stays as it was.
        if (previous && git(ctx, tree, ['diff', '--quiet', previous, 'HEAD']).code === 0) {
          git(ctx, tree, ['reset', '-q', '--hard', previous]);
          result.status = 'current';
        }
        if (push && githubRemote(ctx, path)) {
          const head = git(ctx, tree, ['rev-parse', 'HEAD']).stdout.trim();
          const remote = git(ctx, path, ['ls-remote', 'origin', `refs/heads/${branch}`]).stdout.split(/\s/)[0];
          if (remote !== head) {
            const p = git(ctx, tree, ['push', '-q', '-u', 'origin', branch]);
            if (p.code !== 0) throw new Error(`git push (origin may have ${branch} with other commits: merge or close its pull request first): ${p.stderr.trim()}`);
          }
          const pr = ctx.run(['gh', 'pr', 'create', '--base', base, '--head', branch, '--title', `chore: agent setup ${appVersion}`, '--body', `BenchKeeper setup ${appVersion}, applied by \`benchkeeper update-all\` from \`${STATE}\`. Steps that need an agent session are not part of this change.`], { cwd: tree });
          const url = `${pr.stdout}\n${pr.stderr}`.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0];
          if (pr.code !== 0 && !(url && /already exists/.test(pr.stderr))) throw new Error(`gh pr create: ${pr.stderr.trim()}`);
          result.pr = url;
          result.status = 'pull request';
        }
      } finally {
        git(ctx, path, ['worktree', 'remove', '--force', tree]);
      }
    } catch (e) {
      result.status = 'stopped';
      result.reason = e.message;
    }
    return result;
  });
}
