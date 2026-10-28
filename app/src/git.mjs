// Git helpers: working tree snapshots that leave the user's index alone.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Variables that point git at another repository (set when the app runs from a hook or `git rebase --exec`) never reach it:
// -C names the repository. index: the caller sets GIT_INDEX_FILE itself.
const REPO_VARS = /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/;
// The -c settings of an outer git command (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT with its KEY and VALUE pairs) also go when
// a repository variable was set: the app then runs from a hook of that command, and its settings are not this app's to inherit.
// Container setups that export the pairs themselves keep them for the git calls of this module; `childEnv` (third-party code) drops them unless BENCHKEEPER_PASS_ENV names each one.
const CONFIG_VARS = /^GIT_CONFIG_(PARAMETERS|COUNT|KEY_\d+|VALUE_\d+)$/;
export const repoEnv = (env = process.env, index = false) => {
  const fromHook = Object.keys(env).some((k) => REPO_VARS.test(k) && !(index && k === 'GIT_INDEX_FILE'));
  return Object.fromEntries(Object.entries(env).filter(([k]) => ((index && k === 'GIT_INDEX_FILE') || !REPO_VARS.test(k)) && !(fromHook && CONFIG_VARS.test(k))));
};
// Filter drivers (filter.<name>.clean, smudge, process) of the repository's own config, also of a file it includes, name shell
// commands that add, status, commit and a checkout run for every path whose attributes pick the driver: a repository that came with its
// .git runs code that way. They are switched off for those commands, except the exact commands git-lfs installs. Set through
// GIT_CONFIG_* pairs: a -c option splits at the first = and cannot name a driver that has one.
const LFS_DRIVER = /^(?:git-lfs (?:clean|smudge)(?: --skip)? -- %f|git-lfs filter-process(?: --skip)?)$/;
// Commands that only read refs, objects and config never run a filter; every other command (add, status, commit, write-tree
// re-checking racy index entries, a checkout, a diff) may, so a command the app starts using later is covered by default.
const NO_FILTER = new Set(['config', 'rev-parse', 'symbolic-ref', 'remote', 'cat-file', 'ls-tree', 'ls-remote', 'fetch', 'push', 'merge-base', 'log', 'branch', 'diff-tree']);
const subcommand = (args) => args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-c');
// timeout is the later command's: a config that blocks (an include of a FIFO) must not hang the app before that command starts.
// GIT_CONFIG makes `git config` (only that command) read one file instead of the repository's: it stays out of this call.
function driverOverrides(ctx, dir, env, timeout) {
  const { GIT_CONFIG: _, ...bare } = env;
  const r = ctx.run(['git', '-C', dir, 'config', '--show-scope', '-z', '--get-regexp', '^filter\\..*\\.(clean|smudge|process)$'], { env: bare, timeout });
  // 1 is no match; any other failure (a config git cannot read) leaves the drivers unknown: the command is not run.
  if (r.code !== 0 && r.code !== 1) return null;
  // With -z and --show-scope each entry is the scope, a NUL, then key, a line break, value and a NUL.
  const parts = r.stdout.split('\0'), own = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const [key, ...value] = parts[i + 1].split('\n');
    if (parts[i] === 'local' || parts[i] === 'worktree') own.push({ key, value: value.join('\n') });
  }
  const off = new Set(own.filter((e) => !LFS_DRIVER.test(e.value)).map((e) => e.key.slice(0, e.key.lastIndexOf('.'))));
  return [...own.filter((e) => off.has(e.key.slice(0, e.key.lastIndexOf('.')))).map((e) => [e.key, '']), ...[...off].map((d) => [`${d}.required`, 'false'])];
}
const withPairs = (env, pairs) => {
  const out = { ...env };
  let n = Number.parseInt(env.GIT_CONFIG_COUNT, 10) || 0;
  for (const [k, v] of pairs) { out[`GIT_CONFIG_KEY_${n}`] = k; out[`GIT_CONFIG_VALUE_${n}`] = v; n++; }
  out.GIT_CONFIG_COUNT = String(n);
  return out;
};
// core.fsmonitor is a command the repository's own config names, and status and add would run it: off for every call.
const git = (ctx, dir, args, { index, ...extra } = {}) => {
  let env = repoEnv(extra.env, index);
  if (!NO_FILTER.has(subcommand(args))) {
    const off = driverOverrides(ctx, dir, env, extra.timeout);
    if (!off) return { code: 128, stdout: '', stderr: 'the repository config cannot be read, so its filter drivers are unknown' };
    env = withPairs(env, off);
  }
  return ctx.run(['git', '-C', dir, '-c', 'core.fsmonitor=false', ...args], { ...extra, env });
};

// A branch name safe to pass on as an argument and a fetch refspec: no option, no refspec syntax, and a valid git ref
// (non-ASCII letters, @ and + inside the name are allowed; a leading + is a force refspec, @{ and a bare @ are reflog syntax).
export const safeBranch = (n) => (/^[\p{L}\p{N}_.][\p{L}\p{N}_.\/@+-]*$/u.test(n ?? '') && !/(?:\.\.|@\{|\/\/|(?:^|\/)\.|\.lock(?:\/|$)|[./]$)/.test(n) && n !== '@' ? n : null);

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
export const clean = (ctx, dir, pin = []) => { const r = git(ctx, dir, [...pin, 'status', '--porcelain']); return r.code === 0 && r.stdout.trim() === ''; };
// The host of origin is github.com: https, ssh or scp form, not a folder of that name on another host.
export const githubRemote = (ctx, dir) => /^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|(?:[^@/:]+@)?github\.com:)/i.test(git(ctx, dir, ['remote', 'get-url', 'origin']).stdout.trim());
export { git };
