import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { next, ownerOnly, pin, sensitive } from '../../plugins/benchkeeper/skills/orchestrating-projects/merge-checks.mjs';
import { initRepo } from './helpers.mjs';

const POLICY = {
  merge: { ownerOnlyPaths: ['.github', 'CODEOWNERS', 'docs/CODEOWNERS', 'docs/agents/orchestration.json', 'infra/', 'deploy'], ownerOnlyNames: ['.claude', '.mcp.json'] },
  review: { sensitivePaths: ['src/billing'] },
};

test('merge checks: an owner-only file is one under a path entry or with a name as a segment, at any depth and in any case', () => {
  const owners = ['.github/workflows/ci.yml', 'CODEOWNERS', 'docs/CODEOWNERS', 'packages/ui/.claude/skills/x/SKILL.md', 'tools/.MCP.json', '.GitHub/workflows/x.yml', 'infra/main.tf', 'infra', 'deploy/run.sh', 'docs/agents/orchestration.json'];
  const others = ['src/CODEOWNERS', '.githubx/y', 'my.claude/x', 'deployment/run.sh', 'README.md'];
  assert.deepEqual(ownerOnly(POLICY, [...others, ...owners]), owners);
  // A sensitive file is one under review.sensitivePaths, and every owner-only file.
  assert.deepEqual(sensitive(POLICY, ['src/billing/tax.mjs', 'src/billings.mjs', 'CODEOWNERS', 'README.md']), ['src/billing/tax.mjs', 'CODEOWNERS']);
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
  ['a first parent that is not the head accepted before', 'm2', [['m1', 'r', 'd1'], ['m2', 'x', 'd2']], TWO, 'fail'],
  ['a plain commit', 'c1', [['c1', 'r']], { descends: { c1: ['r'] } }, 'fail'],
  ['a plain commit after a clean merge', 'c2', [['m1', 'r', 'd1'], ['c2', 'm1']], { ...ONE, descends: { c2: ['r', 'm1'] } }, 'fail'],
  ['a head the reviewed head is no ancestor of', 'm1', [['m1', 'r', 'd1']], { ...ONE, descends: {} }, 'fail'],
  ['no line', 'm1', [], ONE, 'fail'],
];
for (const [name, head, lines, history, expected] of PINS) test(`merge checks: the pin of ${name} is ${expected}`, () => assert.equal(pin('r', head, lines, facts(history)), expected));

test('merge checks: the next step is the owner\'s before a re-review, a re-review before a merge, then by the mode and the shared files', () => {
  const state = { ownerOnlyFiles: [], pin: 'reviewed', upToDate: true, mode: 'strict', shared: [], additive: [] };
  assert.equal(next(state), 'merge');
  assert.equal(next({ ...state, pin: 'clean-merges' }), 'merge');
  assert.equal(next({ ...state, ownerOnlyFiles: ['.github/workflows/ci.yml'] }), 'owner');
  assert.equal(next({ ...state, ownerOnlyFiles: ['.github/workflows/ci.yml'], pin: 'fail' }), 'owner');
  assert.equal(next({ ...state, pin: 'fail' }), 're-review');
  assert.equal(next({ ...state, pin: 'fail', upToDate: false, mode: 'disjoint' }), 're-review');
  assert.equal(next({ ...state, upToDate: false }), 'update');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint' }), 'trial');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['schemas/a.json'], additive: ['schemas'] }), 'trial');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['schemas/a.json', 'src/a.mjs'], additive: ['schemas/'] }), 'update');
  assert.equal(next({ ...state, upToDate: false, mode: 'disjoint', shared: ['schemas/a.json'] }), 'update');
});

test('merge checks: the command line prints the verdict of a head in its scratch clone, and exits 2 without one on a bad argument, a failed git command or a folder that is no clone', () => {
  const origin = mkdtempSync(join(tmpdir(), 'bk-merge-'));
  const git = initRepo(origin);
  const head = () => git('rev-parse', 'HEAD').toString().trim();
  const commit = (files) => {
    for (const [path, text] of Object.entries(files)) { mkdirSync(join(origin, path, '..'), { recursive: true }); writeFileSync(join(origin, path), text); }
    git('add', '-A');
    git('commit', '-qm', 'change');
    return head();
  };
  commit({ 'docs/agents/orchestration.json': '{ "merge": { "mode": "disjoint" } }', '.github/workflows/ci.yml': 'on: push\n', 'src/a.txt': 'a\n', 'src/b.txt': 'b\n' });
  git('checkout', '-q', '-b', 'feat/1-workflow');
  const workflow = commit({ '.github/workflows/new.yml': 'on: push\n', 'src/b.txt': 'worker\n' });
  git('checkout', '-q', '-b', 'feat/2-move', 'main');
  mkdirSync(join(origin, 'tools'));
  git('mv', '.github/workflows/ci.yml', 'tools/ci.yml');
  const moved = commit({});
  git('checkout', '-q', '-b', 'feat/3-code', 'main');
  const reviewed = commit({ 'src/a.txt': 'a2\n' });
  git('branch', 'feat/4-resolved');
  git('checkout', '-q', 'main');
  commit({ 'docs/c.md': 'c\n', 'src/b.txt': 'b2\n' });
  git('checkout', '-q', 'feat/3-code');
  git('merge', '-q', '--no-edit', 'main');
  const clean = head();
  // The parents of a clean merge, and a tree with a line no reviewer read.
  git('checkout', '-q', 'feat/4-resolved');
  git('merge', '-q', '--no-commit', 'main');
  const resolved = commit({ 'src/b.txt': 'worker\n' });
  git('checkout', '-q', 'main');
  const project = join(mkdtempSync(join(tmpdir(), 'bk-merge-')), 'project');
  git('clone', '-q', origin, project);
  const scratch = join(mkdtempSync(join(tmpdir(), 'bk-merge-')), 'scratch');
  git('clone', '-q', '--no-checkout', origin, scratch);

  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/merge-checks.mjs', import.meta.url)), ...args], { encoding: 'utf8' });
  const verdict = (from, to) => { const r = cli(project, scratch, 'main', from, to); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
  const workflows = (file) => ({ next: 'owner', ownerOnly: [file], sensitive: [file], pin: 'reviewed', upToDate: false });
  assert.deepEqual(verdict(workflow, workflow), { ...workflows('.github/workflows/new.yml'), shared: ['src/b.txt'] });
  // A moved file counts at its old path too: the branch that moves a workflow out of .github touches .github.
  assert.deepEqual(verdict(moved, moved), { ...workflows('.github/workflows/ci.yml'), shared: [] });
  assert.deepEqual(verdict(reviewed, reviewed), { next: 'trial', ownerOnly: [], sensitive: [], pin: 'reviewed', upToDate: false, shared: [] });
  assert.deepEqual(verdict(reviewed, clean), { next: 'merge', ownerOnly: [], sensitive: [], pin: 'clean-merges', upToDate: true, shared: [] });
  assert.deepEqual(verdict(reviewed, resolved), { next: 're-review', ownerOnly: [], sensitive: [], pin: 'fail', upToDate: true, shared: [] });

  // A folder without a repository of its own: git would answer from the repository above it, here the project's.
  const empty = join(project, 'clones', 'empty');
  mkdirSync(empty, { recursive: true });
  const refused = [
    [project, scratch, 'main', 'HEAD', clean],
    [project, scratch, 'main', reviewed, clean.slice(0, 12)],
    [project, scratch, '-main', reviewed, clean],
    [project, scratch, 'ma..in', reviewed, clean],
    [project, scratch, 'main', reviewed],
    [project, scratch, 'main', reviewed, 'f'.repeat(40)],
    [project, scratch, 'no-such-branch', reviewed, clean],
    [project, empty, 'main', reviewed, clean],
    [join(origin, 'no-project'), scratch, 'main', reviewed, clean],
  ];
  for (const args of refused) {
    const r = cli(...args);
    assert.deepEqual([r.status, r.stdout], [2, ''], args.join(' '));
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  }
});
