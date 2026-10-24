// Git helpers: working tree snapshots that leave the user's index alone.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Variables that point git at another repository (set when the app runs from a hook or `git rebase --exec`) never reach it:
// -C names the repository. index: the caller sets GIT_INDEX_FILE itself.
const REPO_VARS = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/;
const git = (ctx, dir, args, { index, ...extra } = {}) => ctx.run(['git', '-C', dir, ...args], { ...extra, env: Object.fromEntries(Object.entries(extra.env ?? process.env).filter(([k]) => (index && k === 'GIT_INDEX_FILE') || !REPO_VARS.test(k))) });

// A branch name safe to pass on as an argument and a fetch refspec: no option, no refspec syntax.
export const safeBranch = (n) => (/^[\w.][\w.\/-]*$/.test(n ?? '') && !n.includes('..') ? n : null);

export const isRepo = (ctx, dir) => git(ctx, dir, ['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';

// Tree of every tracked and untracked, not ignored, file, written through a temporary index.
// The files of a local agent setup that git ignores through BenchKeeper's blocks in info/exclude (paths from the
// repository root dir): a snapshot holds them too, so a recorded session can undo skills it installed there.
function localSetupPaths(ctx, dir) {
  const common = git(ctx, dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
  let text = '';
  try { text = readFileSync(join(common, 'info', 'exclude'), 'utf8'); } catch { return []; }
  const paths = [];
  let inside = false;
  for (const l of text.split('\n')) {
    if (/^# benchkeeper:local.* start$/.test(l)) inside = true;
    else if (/^# benchkeeper:local.* end$/.test(l)) inside = false;
    else if (inside && l.startsWith('/')) paths.push(l.slice(1).replace(/\/$/, ''));
  }
  return paths.filter((p) => existsSync(join(dir, p)));
}

export function snapshot(ctx, dir) {
  const tmp = mkdtempSync(join(tmpdir(), 'bk-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index') };
  try {
    const add = git(ctx, dir, ['add', '-A'], { env, index: true });
    if (add.code !== 0) throw new Error(`git add: ${add.stderr.trim()}`);
    const local = localSetupPaths(ctx, dir);
    if (local.length) {
      const forced = git(ctx, dir, ['add', '-f', '--', ...local], { env, index: true });
      if (forced.code !== 0) throw new Error(`git add: ${forced.stderr.trim()}`);
    }
    const tree = git(ctx, dir, ['write-tree'], { env, index: true });
    if (tree.code !== 0) throw new Error(`git write-tree: ${tree.stderr.trim()}`);
    return tree.stdout.trim();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// [{ status: 'A'|'M'|'D', path }] between two trees.
export function changedFiles(ctx, dir, before, after) {
  const r = git(ctx, dir, ['diff-tree', '-r', '--no-renames', '--name-status', '-z', before, after]);
  const parts = r.stdout.split('\0').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i += 2) out.push({ status: parts[i][0], path: parts[i + 1] });
  return out;
}

export function blob(ctx, dir, tree, path) {
  const r = git(ctx, dir, ['cat-file', 'blob', `${tree}:${path}`], { buffer: true });
  if (r.code !== 0) throw new Error(`git cat-file ${tree}:${path}: ${r.stderr.trim()}`);
  return r.stdout;
}

export function defaultBranch(ctx, dir) {
  const head = git(ctx, dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).stdout.trim();
  if (safeBranch(head.replace(/^origin\//, ''))) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master']) if (git(ctx, dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).code === 0) return b;
  return null;
}

// Git's mode of a path in a tree ('100644', '100755', '120000'), or '' when absent. path is relative to the repository root.
export const fileMode = (ctx, root, tree, path) => git(ctx, root, ['ls-tree', tree, '--', path]).stdout.split(' ')[0];
// False when git no longer has the tree: an unreferenced snapshot is removed by gc.
export const hasTree = (ctx, root, tree) => git(ctx, root, ['cat-file', '-e', `${tree}^{tree}`]).code === 0;
export const repoRoot = (ctx, dir) => git(ctx, dir, ['rev-parse', '--show-toplevel']).stdout.trim();

// A status that fails is not a clean tree.
export const clean = (ctx, dir) => { const r = git(ctx, dir, ['status', '--porcelain']); return r.code === 0 && r.stdout.trim() === ''; };
// The host of origin is github.com: https, ssh or scp form, not a folder of that name on another host.
export const githubRemote = (ctx, dir) => /^(?:(?:https?|ssh|git):\/\/)?(?:[^@/:]+@)?github\.com[:/]/i.test(git(ctx, dir, ['remote', 'get-url', 'origin']).stdout.trim());
export { git };
