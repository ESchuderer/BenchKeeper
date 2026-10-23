// Git helpers: working tree snapshots that leave the user's index alone.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const git = (ctx, dir, args, extra = {}) => ctx.run(['git', '-C', dir, ...args], extra);

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
    const add = git(ctx, dir, ['add', '-A'], { env });
    if (add.code !== 0) throw new Error(`git add: ${add.stderr.trim()}`);
    const local = localSetupPaths(ctx, dir);
    if (local.length) {
      const forced = git(ctx, dir, ['add', '-f', '--', ...local], { env });
      if (forced.code !== 0) throw new Error(`git add: ${forced.stderr.trim()}`);
    }
    const tree = git(ctx, dir, ['write-tree'], { env });
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
  // A name that starts with - would be read as an option by the git commands it goes into.
  if (head && !head.startsWith('origin/-')) return head.replace(/^origin\//, '');
  for (const b of ['main', 'master']) if (git(ctx, dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`]).code === 0) return b;
  return null;
}

// Git's mode of a path in a tree ('100644', '100755', '120000'), or '' when absent. path is relative to the repository root.
export const fileMode = (ctx, root, tree, path) => git(ctx, root, ['ls-tree', tree, '--', path]).stdout.split(' ')[0];
export const repoRoot = (ctx, dir) => git(ctx, dir, ['rev-parse', '--show-toplevel']).stdout.trim();

export const clean = (ctx, dir) => git(ctx, dir, ['status', '--porcelain']).stdout.trim() === '';
export const githubRemote = (ctx, dir) => /github\.com[:/]/.test(git(ctx, dir, ['remote', 'get-url', 'origin']).stdout);
export { git };
