// Usage: node merge-checks.mjs <project path> <scratch path> <default branch> <reviewed head> <head>. Decides steps 1 to 3 of Merge (review-and-merge.md) for one pull request head in its scratch clone and prints { next, ownerOnly, sensitive, pin, upToDate, shared } as JSON, exit 0.
// Exit 2 with one line on stderr is no verdict (a refused policy, a failed git command, a bad argument, a scratch path that is no clone of its own): nothing merges. It runs no fetch in the clone, so fetch there first, and it changes no ref and no working file.
import { errorLine, isMain, json, read, sh } from './policy.mjs';

// A path entry covers the file or folder it names and everything below it.
const under = (file, entry) => { const folder = entry.replace(/\/$/, ''); return file === folder || file.startsWith(`${folder}/`); };
const lower = (list) => list.map((s) => s.toLowerCase());
// Without case: a checkout on macOS or Windows opens .Claude as .claude.
const named = (paths, names) => (file) => lower(paths).some((entry) => under(file.toLowerCase(), entry)) || lower(file.split('/')).some((segment) => lower(names).includes(segment));

// The files that are the owner's: under a merge.ownerOnlyPaths entry, or with a merge.ownerOnlyNames entry as a path segment.
export const ownerOnly = (policy, files) => files.filter(named(policy.merge.ownerOnlyPaths, policy.merge.ownerOnlyNames));
export const sensitive = (policy, files) => files.filter(named([...policy.review.sensitivePaths, ...policy.merge.ownerOnlyPaths], policy.merge.ownerOnlyNames));

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

// What happens to the head, the first that applies: 'owner' (left for the owner), 're-review', 'merge', 'update' (the default branch is merged in first) or 'trial' (a trial merge decides).
export function next({ ownerOnlyFiles, pin: pinned, upToDate, mode, shared = [], additive = [] }) {
  if (ownerOnlyFiles.length) return 'owner';
  if (pinned !== 'reviewed' && pinned !== 'clean-merges') return 're-review';
  if (upToDate) return 'merge';
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
  const { policy, errors } = read(project);
  if (!policy) throw new Error(errors.map(errorLine).join('; '));
  const base = `refs/remotes/origin/${branch}`;
  // merge-base and merge-tree say no with exit 1; any other failure is no answer.
  const passes = (...args) => { try { return git(...args); } catch (e) { if (e.status === 1) return null; throw e; } };
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
  const theirs = policy.merge.mode === 'disjoint' ? changed(`${head}...${base}`) : [];
  const shared = files.filter((file) => theirs.includes(file));
  const owners = ownerOnly(policy, files);
  return { next: next({ ownerOnlyFiles: owners, pin: pinned, upToDate, mode: policy.merge.mode, shared, additive: policy.merge.additivePaths }), ownerOnly: owners, sensitive: sensitive(policy, files), pin: pinned, upToDate, shared };
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 7) throw new Error('usage: node merge-checks.mjs <project path> <scratch path> <default branch> <reviewed head> <head>');
    console.log(json(verdict(...process.argv.slice(2))));
  } catch (e) {
    // A path or git's message can hold control and format characters, which could rewrite the terminal line.
    console.error(e.message.split('\n')[0].replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?'));
    process.exitCode = 2;
  }
}
