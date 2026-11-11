// Usage: node merge-checks.mjs <project path> <scratch path> <default branch> <reviewed head> <head>. Decides steps 1 to 3 of Merge (review-and-merge.md) for one pull request head in its scratch clone and prints { next, allowed, ownerOnly, unsafePaths, sensitive, pin, upToDate, shared } as JSON, exit 0.
// Exit 2 with one line on stderr is no verdict (a refused policy, a failed git command, a bad argument, a scratch path that is no clone of its own, a head with several merge bases): nothing merges. It runs no fetch in the clone, so fetch there first, and it changes no ref and no working file.
import { realpathSync } from 'node:fs';
import { errorLine, escaped, isMain, json, read, sh } from './policy.mjs';

// A path entry covers the file or folder it names and everything below it.
const under = (file, entry) => { const folder = entry.replace(/\/$/, ''); return file === folder || file.startsWith(`${folder}/`); };
// One fold for the path tests: a checkout on macOS or Windows opens .Claude, a long s (U+017F) in place of an s and a decomposed accent as the files the entries name.
const fold = (path) => path.normalize('NFKC').toUpperCase().toLowerCase();
const named = (paths, names) => {
  const entries = paths.map(fold), segments = names.map(fold);
  return (file) => { const path = fold(file); return entries.some((entry) => under(path, entry)) || path.split('/').some((segment) => segments.includes(segment)); };
};

// The files that are the owner's: under a merge.ownerOnlyPaths entry, or with a merge.ownerOnlyNames entry as a path segment.
export const ownerOnly = (policy, files) => files.filter(named(policy.merge.ownerOnlyPaths, policy.merge.ownerOnlyNames));
export const sensitive = (policy, files) => files.filter(named([...policy.review.sensitivePaths, ...policy.merge.ownerOnlyPaths], policy.merge.ownerOnlyNames));
// The files of the pull request that the default branch changed too.
export const both = (files, theirs) => { const changed = new Set(theirs.map(fold)); return files.filter((file) => changed.has(fold(file))); };
// Paths nobody types into a command: a single quote ends the quotes a path stands in, and a control character or a line break starts another line.
export const unsafe = (files) => files.filter((file) => /['\p{Cc}\p{Zl}\p{Zp}]/u.test(file));

// 'reviewed', 'clean-merges' or 'fail'. lines: what `git rev-list --first-parent --reverse --parents <reviewed>..<head>` printed, each split into [commit, ...parents]. facts: { base, ancestor(a, b), cleanTree(first, second), tree(commit) }, base naming the default branch's tip and cleanTree giving null for a conflict.
export function pin(reviewed, head, lines, facts) {
  if (head === reviewed) return 'reviewed';
  // A branch pushed back to an older commit is no descendant of the reviewed head.
  if (!facts.ancestor(reviewed, head) || !lines.length) return 'fail';
  let accepted = reviewed;
  for (const [commit, ...parents] of lines) {
    const [first, second] = parents;
    if (parents.length !== 2 || first !== accepted || !facts.ancestor(second, facts.base)) return 'fail';
    // A worker's own conflict resolution has the right parents and another tree: only the tree shows that the merge added no line.
    const tree = facts.cleanTree(first, second);
    if (!tree || tree !== facts.tree(commit)) return 'fail';
    accepted = commit;
  }
  return accepted === head ? 'clean-merges' : 'fail';
}

// What happens to the head, the first that applies: 'owner' (left for the owner), 're-review', 'ready' (no merge.allowed: left ready for the owner), 'merge', 'update' (the default branch is merged in first) or 'trial' (a trial merge decides).
export function next({ ownerOnlyFiles, unsafePaths = [], pin: pinned, allowed, upToDate, mode, shared = [], additive = [] }) {
  if (ownerOnlyFiles.length || unsafePaths.length) return 'owner';
  if (pinned !== 'reviewed' && pinned !== 'clean-merges') return 're-review';
  if (allowed !== true) return 'ready';
  if (upToDate) return 'merge';
  // Not folded: an additive entry widens what merges without an update, so a file that differs from it in case or form takes the update.
  return mode !== 'disjoint' || shared.some((file) => !additive.some((entry) => under(file, entry))) ? 'update' : 'trial';
}

const BRANCH = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;

function verdict(project, scratch, branch, reviewed, head) {
  if (!BRANCH.test(branch)) throw new Error('the default branch is no plain name: letters, digits, . _ / and -, no - at the start, no ..');
  if (!COMMIT.test(reviewed) || !COMMIT.test(head)) throw new Error('the reviewed head and the head must be full commit ids, 40 hex characters each');
  // Every git call runs in the clone: the project's checkout shares its git directory with the workers.
  const git = (...args) => sh(scratch, 'git', args);
  // In a folder without a repository of its own, a clone that failed, git answers from the repository above it.
  if (git('rev-parse', '--git-dir').trim() !== '.git') throw new Error('the scratch path is not the top folder of a clone of its own');
  // The project's checkout passes that test too, and so does a folder whose repository the project path lies in.
  const store = (dir) => realpathSync(sh(dir, 'git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  if (store(scratch) === store(project)) throw new Error('the scratch path and the project path are one repository: the clone must be a repository of its own');
  // A second worktree shares the clone's refs and settings with whoever works there.
  if (git('worktree', 'list', '--porcelain').split('\n').filter((line) => line.startsWith('worktree ')).length !== 1) throw new Error('the scratch clone has more than one worktree');
  const { policy, errors } = read(project);
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  const base = `refs/remotes/origin/${branch}`;
  // merge-base and merge-tree say no with exit 1; any other failure is no answer.
  const passes = (...args) => { try { return git(...args); } catch (e) { if (e.status === 1) return null; throw e; } };
  // With several merge bases the three-dot diff starts at one of them and hides what the head takes back from the others: main = merge(m, a) and a head with the parents m and a and m's tree lists none of a's files.
  const bases = (passes('merge-base', '--all', base, head) ?? '').split('\n').filter(Boolean).length;
  if (bases !== 1) throw new Error(`the head has ${bases ? 'several merge bases' : 'no merge base'} with the default branch and is the owner's to judge`);
  // --no-renames: a moved file counts at its old and at its new path. -z: git prints every path as it is, so no path reaches the tests in a quoted form.
  const changed = (range) => git('-c', 'core.quotePath=false', 'diff', '--name-only', '--no-renames', '-z', range).split('\0').filter(Boolean);
  const files = changed(`${base}...${head}`);
  const facts = {
    base,
    ancestor: (a, b) => passes('merge-base', '--is-ancestor', a, b) !== null,
    cleanTree: (first, second) => passes('merge-tree', '--write-tree', first, second)?.split('\n')[0] ?? null,
    tree: (commit) => git('rev-parse', `${commit}^{tree}`).trim(),
  };
  const lines = head === reviewed ? [] : git('rev-list', '--first-parent', '--reverse', '--parents', `${reviewed}..${head}`).split('\n').filter(Boolean).map((line) => line.split(' '));
  const pinned = pin(reviewed, head, lines, facts);
  const upToDate = facts.ancestor(base, head);
  const shared = both(files, policy.merge.mode === 'disjoint' ? changed(`${head}...${base}`) : []);
  const owners = ownerOnly(policy, files), unsafePaths = unsafe(files), { allowed } = policy.merge;
  return { next: next({ ownerOnlyFiles: owners, unsafePaths, pin: pinned, allowed, upToDate, mode: policy.merge.mode, shared, additive: policy.merge.additivePaths }), allowed, ownerOnly: owners, unsafePaths, sensitive: sensitive(policy, files), pin: pinned, upToDate, shared };
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 7) throw new Error('usage: node merge-checks.mjs <project path> <scratch path> <default branch> <reviewed head> <head>');
    console.log(json(verdict(...process.argv.slice(2))));
  } catch (e) {
    console.error(escaped(e.message.split('\n')[0]));
    process.exitCode = 2;
  }
}
