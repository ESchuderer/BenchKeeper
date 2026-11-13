import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { both, next, ownerOnly, pin, sensitive, unsafe } from '../../plugins/benchkeeper/skills/orchestrating-projects/merge-checks.mjs';
import { initRepo } from './helpers.mjs';

// By code point, so that no editor or tool recomposes them: e with acute in one character, the combining acute, the long s, Escape and the line separator.
const [E_ACUTE, ACUTE, LONG_S, ESC, LINE_SEPARATOR] = [0xe9, 0x301, 0x17f, 0x1b, 0x2028].map((code) => String.fromCodePoint(code));

const POLICY = {
  merge: { ownerOnlyPaths: ['.github', 'CODEOWNERS', 'docs/CODEOWNERS', 'docs/agents/orchestration.json', 'infra/', 'deploy', `caf${E_ACUTE}`], ownerOnlyNames: ['.claude', '.mcp.json'] },
  review: { sensitivePaths: ['src/billing'] },
};

test('merge checks: an owner-only file is one under a path entry or with a name as a segment, at any depth and in any case', () => {
  const owners = ['.github/workflows/ci.yml', 'CODEOWNERS', 'docs/CODEOWNERS', 'packages/ui/.claude/skills/x/SKILL.md', 'tools/.MCP.json', '.GitHub/workflows/x.yml', 'infra/main.tf', 'infra', 'deploy/run.sh', 'docs/agents/orchestration.json'];
  const others = ['src/CODEOWNERS', '.githubx/y', 'my.claude/x', 'deployment/run.sh', 'README.md'];
  assert.deepEqual(ownerOnly(POLICY, [...others, ...owners]), owners);
  // A sensitive file is one under review.sensitivePaths, and every owner-only file.
  assert.deepEqual(sensitive(POLICY, ['src/billing/tax.mjs', 'src/billings.mjs', 'CODEOWNERS', 'README.md']), ['src/billing/tax.mjs', 'CODEOWNERS']);
});

test('merge checks: paths are compared as a file system that ignores case and form opens them', () => {
  const decomposed = `cafe${ACUTE}`;
  const owners = [`tools/.mcp.j${LONG_S}on`, `${decomposed}/menu.md`, 'sub/.MCP.JSON'];
  assert.deepEqual(ownerOnly(POLICY, ['README.md', ...owners]), owners);
  assert.deepEqual(sensitive(POLICY, ['SRC/Billing/tax.mjs', ...owners]), ['SRC/Billing/tax.mjs', ...owners]);
  assert.deepEqual(both(['SRC/B.txt', 'src/a.txt', `${decomposed}.md`], ['src/b.txt', `caf${E_ACUTE}.md`, 'src/c.txt']), ['SRC/B.txt', `${decomposed}.md`]);
});

test('merge checks: a path with a single quote, a control character or a line break is unsafe to type', () => {
  const paths = ['docs/it\'s.md', 'docs/two\nlines.md', 'docs/tab\there.md', `docs/escape${ESC}[2K.md`, `docs/line${LINE_SEPARATOR}separator.md`];
  assert.deepEqual(unsafe(['README.md', 'docs/q"uote.md', 'docs/back\\slash.md', 'docs/sp ace.md', ...paths]), paths);
});

// A history as the pin's facts: what each head descends from, which commits the default branch holds, the tree of a clean merge of two parents, and each commit's tree.
const BASE = 'refs/remotes/origin/main';
const facts = ({ descends = {}, onDefault = [], clean = {}, trees = {} }) => ({
  base: BASE,
  ancestor: (a, b) => (b === BASE ? onDefault : descends[b] ?? []).includes(a),
  cleanTree: (first, second) => clean[`${first} ${second}`] ?? null,
  tree: (commit) => trees[commit],
});
const ONE = { descends: { m1: ['r'] }, onDefault: ['d1'], clean: { 'r d1': 't1' }, trees: { m1: 't1' } };
const TWO = { descends: { m2: ['r', 'm1'] }, onDefault: ['d1', 'd2'], clean: { 'r d1': 't1', 'm1 d2': 't2' }, trees: { m1: 't1', m2: 't2' } };

const PINS = [
  ['the reviewed head', 'r', [], {}, 'reviewed'],
  ['one clean merge of the default branch', 'm1', [['m1', 'r', 'd1']], ONE, 'clean-merges'],
  ['two clean merges', 'm2', [['m1', 'r', 'd1'], ['m2', 'm1', 'd2']], TWO, 'clean-merges'],
  ['a merge whose tree is not the clean merge\'s', 'm1', [['m1', 'r', 'd1']], { ...ONE, trees: { m1: 'resolved-by-hand' } }, 'fail'],
  ['a merge that conflicts', 'm1', [['m1', 'r', 'd1']], { ...ONE, clean: {} }, 'fail'],
  ['a merge of three parents', 'm1', [['m1', 'r', 'd1', 'd2']], { ...ONE, onDefault: ['d1', 'd2'] }, 'fail'],
  ['a second parent that is not on the default branch', 'm1', [['m1', 'r', 'd1']], { ...ONE, onDefault: [] }, 'fail'],
  // Its tree is the clean merge of its own two parents, so only the first parent fails it.
  ['a first parent that is not the head accepted before', 'm2', [['m1', 'r', 'd1'], ['m2', 'x', 'd2']], { ...TWO, clean: { ...TWO.clean, 'x d2': 't2' } }, 'fail'],
  ['a plain commit', 'c1', [['c1', 'r']], { descends: { c1: ['r'] } }, 'fail'],
  ['a plain commit after a clean merge', 'c2', [['m1', 'r', 'd1'], ['c2', 'm1']], { ...ONE, descends: { c2: ['r', 'm1'] } }, 'fail'],
  ['a head the reviewed head is no ancestor of', 'm1', [['m1', 'r', 'd1']], { ...ONE, descends: {} }, 'fail'],
  ['no line', 'm1', [], ONE, 'fail'],
];
for (const [name, head, lines, history, expected] of PINS) test(`merge checks: the pin of ${name} is ${expected}`, () => assert.equal(pin('r', head, lines, facts(history)), expected));

test('merge checks: the next step is the owner\'s before a re-review, a re-review before ready, ready before a merge, then by the mode and the shared files', () => {
  const state = { ownerOnlyFiles: [], unsafePaths: [], pin: 'reviewed', allowed: true, upToDate: true, mode: 'strict', shared: [], additive: [] };
  assert.equal(next(state), 'merge');
  assert.equal(next({ ...state, pin: 'clean-merges' }), 'merge');
  assert.equal(next({ ...state, ownerOnlyFiles: ['.github/workflows/ci.yml'] }), 'owner');
  assert.equal(next({ ...state, ownerOnlyFiles: ['.github/workflows/ci.yml'], pin: 'fail' }), 'owner');
  assert.equal(next({ ...state, unsafePaths: ['docs/it\'s.md'] }), 'owner');
  assert.equal(next({ ...state, unsafePaths: ['docs/it\'s.md'], allowed: false }), 'owner');
  assert.equal(next({ ...state, pin: 'fail' }), 're-review');
  assert.equal(next({ ...state, pin: 'fail', allowed: false }), 're-review');
  assert.equal(next({ ...state, pin: 'fail', upToDate: false, mode: 'disjoint' }), 're-review');
  // Without merge.allowed no head merges or gets a trial, whatever else holds.
  assert.equal(next({ ...state, allowed: false }), 'ready');
  assert.equal(next({ ...state, allowed: false, pin: 'clean-merges', upToDate: false }), 'ready');
  assert.equal(next({ ...state, allowed: false, upToDate: false, mode: 'disjoint' }), 'ready');
  assert.equal(next({ ...state, upToDate: false }), 'update');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint' }), 'trial');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['schemas/a.json'], additive: ['schemas'] }), 'trial');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['schemas/a.json', 'src/a.mjs'], additive: ['schemas/'] }), 'update');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['schemas/a.json'] }), 'update');
  // An additive entry is matched as written: a file that differs from it in case takes the update.
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['Schemas/a.json'], additive: ['schemas'] }), 'update');
});

const SCRIPT = fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/merge-checks.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const folder = () => mkdtempSync(join(tmpdir(), 'bk-merge-'));

// An origin whose first commit holds these files. clones() gives the project's checkout and the scratch clone, once every head is on a branch.
function world(files) {
  const origin = folder();
  const git = initRepo(origin);
  const out = (...args) => git(...args).toString().trim();
  const commit = (changed) => {
    for (const [path, text] of Object.entries(changed)) { mkdirSync(join(origin, path, '..'), { recursive: true }); writeFileSync(join(origin, path), text); }
    git('add', '-A');
    git('commit', '-qm', 'change');
    return out('rev-parse', 'HEAD');
  };
  commit(files);
  const clones = () => {
    const project = join(folder(), 'project'), scratch = join(folder(), 'scratch');
    git('clone', '-q', origin, project);
    git('clone', '-q', '--no-checkout', origin, scratch);
    return { project, scratch };
  };
  return { origin, git, out, commit, clones };
}

test('merge checks: the command line prints the verdict of a head in its scratch clone, and exits 2 without one on a bad argument, a failed git command or a folder that is no clone of its own', () => {
  const { origin, git, out, commit, clones } = world({ 'docs/agents/orchestration.json': '{ "merge": { "allowed": true, "requiredChecks": ["ci"], "mode": "disjoint" } }', '.github/workflows/ci.yml': 'on: push\n', 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' });
  git('checkout', '-q', '-b', 'feat/1-workflow');
  const workflow = commit({ '.github/workflows/new.yml': 'on: push\n', 'src/b.txt': 'worker\n' });
  git('checkout', '-q', '-b', 'feat/2-move', 'main');
  mkdirSync(join(origin, 'tools'));
  git('mv', '.github/workflows/ci.yml', 'tools/ci.yml');
  const moved = commit({});
  git('checkout', '-q', '-b', 'feat/5-quote', 'main');
  const quoted = commit({ 'docs/it\'s.md': 'x\n', 'docs/two\nlines.md': 'y\n' });
  git('checkout', '-q', '-b', 'feat/3-code', 'main');
  const reviewed = commit({ 'src/a.txt': 'a2\n' });
  git('branch', 'feat/4-resolved');
  git('checkout', '-q', 'main');
  commit({ 'docs/c.md': 'c\n', 'src/b.txt': 'b2\n' });
  git('checkout', '-q', 'feat/3-code');
  git('merge', '-q', '--no-edit', 'main');
  const clean = out('rev-parse', 'HEAD');
  // The parents of a clean merge, and a tree with a line no reviewer read.
  git('checkout', '-q', 'feat/4-resolved');
  git('merge', '-q', '--no-commit', 'main');
  const resolved = commit({ 'src/b.txt': 'worker\n' });
  git('checkout', '-q', 'main');
  const { project, scratch } = clones();

  const verdict = (from, to) => { const r = cli(project, scratch, 'main', from, to); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const refuses = (args) => {
    const r = cli(...args);
    assert.deepEqual([r.status, r.stdout], [2, ''], args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  };
  const plain = { allowed: true, ownerOnly: [], unsafePaths: [], sensitive: [] };
  const workflows = (file) => ({ ...plain, next: 'owner', ownerOnly: [file], sensitive: [file], pin: 'reviewed', upToDate: false });
  assert.deepEqual(verdict(workflow, workflow), { ...workflows('.github/workflows/new.yml'), shared: ['src/b.txt'] });
  // A moved file counts at its old path too: the branch that moves a workflow out of .github touches .github.
  assert.deepEqual(verdict(moved, moved), { ...workflows('.github/workflows/ci.yml'), shared: [] });
  assert.deepEqual(verdict(quoted, quoted), { ...plain, next: 'owner', unsafePaths: ['docs/it\'s.md', 'docs/two\nlines.md'], pin: 'reviewed', upToDate: false, shared: [] });
  assert.deepEqual(verdict(reviewed, reviewed), { ...plain, next: 'trial', pin: 'reviewed', upToDate: false, shared: [] });
  const merged = { ...plain, next: 'merge', pin: 'clean-merges', upToDate: true, shared: [] };
  assert.deepEqual(verdict(reviewed, clean), merged);
  assert.deepEqual(verdict(reviewed, resolved), { ...plain, next: 're-review', pin: 'fail', upToDate: true, shared: [] });
  // A tag that answers the short name origin/main names another commit: the default branch is read by its full ref.
  git('-C', scratch, 'update-ref', 'refs/tags/origin/main', workflow);
  assert.deepEqual(verdict(reviewed, clean), merged);
  // The remote's default branch moves on: a clone that was not fetched since gets no verdict, a fetched one sees the head behind.
  commit({ 'src/a.txt': 'a3\n' });
  refuses([project, scratch, 'main', reviewed, clean]);
  git('-C', scratch, 'fetch', '-q', 'origin');
  assert.deepEqual(verdict(reviewed, clean), { ...merged, next: 'update', upToDate: false, shared: ['src/a.txt'] });

  // A folder without a repository of its own: git would answer from the repository above it, here a fresh clone that is not the project's.
  const empty = join(clones().scratch, 'clones', 'empty');
  mkdirSync(empty, { recursive: true });
  const refused = [
    [project, scratch, 'main', 'HEAD', clean],
    [project, scratch, 'main', reviewed, clean.slice(0, 12)],
    [project, scratch, '-main', reviewed, clean],
    [project, scratch, 'ma..in', reviewed, clean],
    // A revision that git would resolve to the commit before the default branch's tip.
    [project, scratch, 'main~1', reviewed, clean],
    [project, scratch, 'main', reviewed],
    [project, scratch, 'main', reviewed, 'f'.repeat(40)],
    // A tree in place of the reviewed head: merge-base fails, which is no answer and never "not an ancestor".
    [project, scratch, 'main', out('rev-parse', `${reviewed}^{tree}`), clean],
    [project, scratch, 'no-such-branch', reviewed, clean],
    [project, scratch, 'HEAD', reviewed, clean],
    [project, empty, 'main', reviewed, clean],
    // The project's checkout holds what the workers write.
    [project, project, 'main', reviewed, clean],
    [join(origin, 'no-project'), scratch, 'main', reviewed, clean],
  ];
  for (const args of refused) refuses(args);
  // A second worktree of the scratch clone can be a checkout that somebody works in.
  git('-C', scratch, 'worktree', 'add', '-q', '--detach', join(folder(), 'worktree'), clean);
  refuses([project, scratch, 'main', reviewed, clean]);
});

test('merge checks: a head with several merge bases is the owner\'s to judge, and without merge.allowed a reviewed head is left ready', () => {
  const { git, out, commit, clones } = world({ '.github/workflows/ci.yml': 'on: push\n', 'src/a.txt': 'a\n' });
  git('checkout', '-q', '-b', 'side');
  const hardened = commit({ '.github/workflows/ci.yml': 'on: pull_request\n' });
  git('checkout', '-q', 'main');
  const before = commit({ 'docs/c.md': 'c\n' });
  git('merge', '-q', '--no-ff', '--no-edit', 'side');
  git('checkout', '-q', '-b', 'feat/1-plain', before);
  const plain = commit({ 'src/new.txt': 'n\n' });
  // Both parents are in the default branch's history, and the tree is the one before the workflow change: merging this head takes that change back.
  const hidden = out('commit-tree', `${plain}^{tree}`, '-p', before, '-p', hardened, '-m', 'merge');
  git('branch', 'feat/2-hidden', hidden);
  git('checkout', '-q', 'main');
  const { project, scratch } = clones();
  // A setting in the project's shared git directory sends its origin to a repository whose policy allows merges: the verdict reads the policy in the clone.
  const other = folder(), elsewhere = initRepo(other);
  mkdirSync(join(other, 'docs/agents'), { recursive: true });
  writeFileSync(join(other, 'docs/agents/orchestration.json'), '{ "merge": { "allowed": true } }');
  elsewhere('add', '-A');
  elsewhere('commit', '-qm', 'policy');
  git('-C', project, 'config', `url.${other}.insteadOf`, git('-C', project, 'remote', 'get-url', 'origin').toString().trim());

  const r = cli(project, scratch, 'main', hidden, hidden);
  assert.deepEqual([r.status, r.stdout], [2, '']);
  assert.match(r.stderr, /^the head has several merge bases with the default branch\b.*\n$/);
  // The same tree on one parent, in a project whose policy allows no merge.
  const ready = cli(project, scratch, 'main', plain, plain);
  assert.equal(ready.status, 0, ready.stderr);
  assert.deepEqual(JSON.parse(ready.stdout), { next: 'ready', allowed: false, ownerOnly: [], unsafePaths: [], sensitive: [], pin: 'reviewed', upToDate: false, shared: [] });
});
