import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { effective, read } from '../../plugins/benchkeeper/skills/orchestrating-projects/policy.mjs';
import { initRepo } from './helpers.mjs';

const BUILT_IN = ['.github/workflows', '.github/dependabot.yml', 'docs/agents/orchestration.json', 'docs/agents/worker-rules.md'];
const DEFAULTS = {
  startLabel: null,
  trustedAuthors: [],
  workersPerProject: 1,
  hostWorkerLimit: 2,
  stallMinutes: 20,
  merge: { allowed: false, requiredChecks: [], mode: 'strict', additivePaths: [], ownerOnlyPaths: BUILT_IN },
  closeIssue: false,
  deleteMergedBranch: false,
  issuesPerWorker: 1,
  keepRunning: false,
  permissionPrompts: 'block',
  review: { depth: 'high', sensitiveDepth: 'xhigh', sensitivePaths: [] },
  issues: { repository: null, labels: [] },
  minPlugin: null,
  models: {
    worker: { quick: { model: 'sonnet', effort: 'high' }, standard: { model: 'opus', effort: 'high' }, full: { model: 'opus', effort: 'xhigh' }, research: { model: 'fable', effort: 'xhigh' } },
    phases: {},
  },
};
const rules = (errors) => errors.map((e) => [e.rule, e.path]);
// A repository that was not cloned: no origin/HEAD, the remote's default branch is trunk and holds this policy file.
const notCloned = (file, calls = []) => (dir, cmd, args) => {
  calls.push([cmd, ...args].join(' '));
  if (args[0] === 'symbolic-ref') throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
  if (args[0] === 'ls-remote') return 'ref: refs/heads/trunk\tHEAD\n0123456789abcdef0123456789abcdef01234567\tHEAD\n';
  return args[0] === 'show' ? file : '';
};

test('policy: a version 1 file, or one without schemaVersion, keeps its fields and gets every default', () => {
  assert.deepEqual(effective({}, '6.26.0'), { policy: DEFAULTS, errors: [] });
  const file = { schemaVersion: 1, startLabel: 'agent-ready', trustedAuthors: ['review-bot[bot]'], hostWorkerLimit: 3, merge: { allowed: true, requiredChecks: ['ci'] }, closeIssue: true };
  assert.deepEqual(effective(file, '6.26.0').policy, { ...DEFAULTS, startLabel: 'agent-ready', trustedAuthors: ['review-bot[bot]'], hostWorkerLimit: 3, merge: { ...DEFAULTS.merge, allowed: true, requiredChecks: ['ci'] }, closeIssue: true });
});

test('policy: a value the schema rejects gives no policy, not the default', () => {
  const { policy, errors } = effective({ schemaVersion: 2, merge: { mode: 'disjont' } }, '6.26.0');
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['enum', 'merge.mode']]);
});

test('policy: the built-in owner-only paths stay first, whatever the file lists and whatever its schemaVersion', () => {
  const paths = (ownerOnlyPaths) => effective({ schemaVersion: 1, merge: { ownerOnlyPaths } }, '6.26.0').policy.merge.ownerOnlyPaths;
  assert.deepEqual(paths([]), BUILT_IN);
  assert.deepEqual(paths(['infra', '.github/workflows']), [...BUILT_IN, 'infra']);
});

test('policy: a key the schema does not name gives no policy, a // comment key passes', () => {
  const misspelled = effective({ merge: { ownerOnlyPath: ['infra'] } }, '6.26.0');
  assert.equal(misspelled.policy, null);
  assert.deepEqual(rules(misspelled.errors), [['unknown-key', 'merge.ownerOnlyPath']]);
  const commented = effective({ '//': 'note', merge: { '//why': 'the owner merges', allowed: true } }, '6.26.0');
  assert.deepEqual(commented.errors, []);
  assert.deepEqual(commented.policy.merge, { ...DEFAULTS.merge, allowed: true });
});

test('policy: a tracker without a label gives no policy', () => {
  for (const issues of [{ repository: 'owner/tracker' }, { repository: 'owner/tracker', labels: [] }]) {
    const { policy, errors } = effective({ issues }, '6.26.0');
    assert.equal(policy, null);
    assert.deepEqual(rules(errors), [['length', 'issues.labels']]);
  }
  assert.deepEqual(effective({ issues: { repository: 'owner/tracker', labels: ['project-a'] } }, '6.26.0').policy.issues, { repository: 'owner/tracker', labels: ['project-a'] });
});

test('policy: a schemaVersion the reader does not know gives no policy', () => {
  const { policy, errors } = effective({ schemaVersion: 3 }, '6.26.0');
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['enum', 'schemaVersion']]);
});

test('policy: minPlugin newer than the plugin gives no policy, and versions compare by number', () => {
  const newer = effective({ minPlugin: '6.10.0' }, '6.9.0');
  assert.equal(newer.policy, null);
  assert.deepEqual(rules(newer.errors), [['range', 'minPlugin']]);
  assert.equal(effective({ minPlugin: '6.9.0' }, '6.9.0').policy.minPlugin, '6.9.0');
  assert.equal(effective({ minPlugin: '6.9.0' }, '6.10.0').policy.minPlugin, '6.9.0');
});

test('policy: models.worker replaces the model of every tier and keeps the tier\'s effort; phases hold only what the file names', () => {
  assert.deepEqual(effective({ models: { '//': 'note', worker: { model: 'fable' }, phases: { '//': 'note', review: { model: 'inherit', effort: 'max' } } } }, '6.26.0').policy.models, {
    worker: { quick: { model: 'fable', effort: 'high' }, standard: { model: 'fable', effort: 'high' }, full: { model: 'fable', effort: 'xhigh' }, research: { model: 'fable', effort: 'xhigh' } },
    phases: { review: { model: 'inherit', effort: 'max' } },
  });
});

test('policy: a path entry that leaves the repository, starts at its root or holds a glob is rejected', () => {
  const { policy, errors } = effective(JSON.parse(readFileSync(new URL('./fixtures/params/policy/invalid/pattern.json', import.meta.url), 'utf8')), '6.26.0');
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['pattern', 'merge.ownerOnlyPaths[0]'], ['pattern', 'merge.ownerOnlyPaths[1]'], ['pattern', 'merge.ownerOnlyPaths[2]']]);
  // A folder with a closing slash, a file below a folder and a name that only starts with two dots are paths.
  assert.deepEqual(effective({ merge: { additivePaths: ['schemas/', 'docs/registry.json', '..cache'] } }, '6.26.0').policy.merge.additivePaths, ['schemas/', 'docs/registry.json', '..cache']);
});

test('policy: a repository that was not cloned asks the remote for its default branch and writes no reference', () => {
  const calls = [];
  assert.equal(read('/p', notCloned('{ "startLabel": "go" }', calls)).policy.startLabel, 'go');
  assert.ok(calls.includes('git show origin/trunk:docs/agents/orchestration.json'));
  assert.deepEqual(calls.filter((c) => /set-head|update-ref|symbolic-ref (?!--short )/.test(c)), []);
});

test('policy: a file that is not JSON gives no policy', () => {
  const { policy, errors } = read('/p', notCloned('{ "startLabel": '));
  assert.equal(policy, null);
  assert.deepEqual(rules(errors), [['bad-json', '']]);
});

test('policy: the command line prints the policy of the default branch and exits 0, or names each error and exits 1', () => {
  const origin = mkdtempSync(join(tmpdir(), 'bk-policy-'));
  const git = initRepo(origin);
  const commit = (text) => {
    mkdirSync(join(origin, 'docs/agents'), { recursive: true });
    writeFileSync(join(origin, 'docs/agents/orchestration.json'), text);
    git('add', '-A');
    git('commit', '-qm', 'policy');
  };
  commit('{ "merge": { "mode": "disjont" } }');
  const project = join(mkdtempSync(join(tmpdir(), 'bk-policy-')), 'project');
  git('clone', '-q', origin, project);
  const cli = (dir) => spawnSync(process.execPath, [fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/policy.mjs', import.meta.url)), dir], { encoding: 'utf8' });
  const rejected = cli(project);
  assert.deepEqual([rejected.status, rejected.stdout], [1, '']);
  assert.match(rejected.stderr, /^enum at merge\.mode: /);
  // The clone is older than the next commit: the reader fetches the default branch before it reads.
  commit('{ "startLabel": "go" }');
  const printed = cli(project);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(JSON.parse(printed.stdout).startLabel, 'go');
  // Not cloned (init, then remote add): git's own answer names the default branch, and origin/HEAD stays unset.
  const added = mkdtempSync(join(tmpdir(), 'bk-policy-'));
  git('init', '-q', '-b', 'other', added);
  git('-C', added, 'remote', 'add', 'origin', origin);
  const asked = cli(added);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(JSON.parse(asked.stdout).startLabel, 'go');
  assert.throws(() => git('-C', added, 'symbolic-ref', 'refs/remotes/origin/HEAD'));
});
