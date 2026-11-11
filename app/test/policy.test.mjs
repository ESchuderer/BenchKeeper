import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { effective, read, validate } from '../../plugins/benchkeeper/skills/orchestrating-projects/policy.mjs';
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
// git as the reader runs it: the remote's default branch holds this policy file, or none (null).
const remote = (file, calls = []) => (dir, cmd, args) => {
  calls.push([cmd, ...args].join(' '));
  if (args[0] === 'ls-tree') return file == null ? '' : 'docs/agents/orchestration.json\n';
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
  for (const [issues, rule] of [[{ repository: 'owner/tracker' }, 'missing-key'], [{ repository: 'owner/tracker', labels: [] }, 'length']]) {
    const { policy, errors } = effective({ issues }, '6.26.0');
    assert.equal(policy, null);
    assert.deepEqual(rules(errors), [[rule, 'issues.labels']]);
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
  // A folder with a closing slash, a file below a folder, names that start with dots and a name with a space inside are paths.
  const paths = ['schemas/', 'docs/registry.json', '..cache', '.claude', '.github/workflows', 'docs/release notes.md'];
  assert.deepEqual(effective({ merge: { additivePaths: paths } }, '6.26.0').policy.merge.additivePaths, paths);
});

const PATH_LISTS = [['merge', 'ownerOnlyPaths'], ['merge', 'additivePaths'], ['review', 'sensitivePaths']];
const NO_PATHS = ['', '/x', '../x', 'x/..', 'a/*', 'a\\b', './x', 'x//y', 'x/./y', ' x', 'x ', 'x /y', '.', 'x\ny', 'x\0y', 'infra​', 'x y', 'a‮b'];
// One refused document per row, with the one rule and path named for it.
const REFUSED = [
  ...PATH_LISTS.flatMap(([group, list]) => NO_PATHS.map((path) => [{ [group]: { [list]: [path] } }, 'pattern', `${group}.${list}[0]`])),
  ...['owner/tracker/docs', 'owner/tra cker', 'owner/..', 'tracker'].map((repository) => [{ issues: { repository, labels: ['project-a'] } }, 'pattern', 'issues.repository']),
  [{ issues: { repository: 'owner/tracker', labels: [] } }, 'length', 'issues.labels'],
  [{ startLabel: 'go', issues: { repository: 'owner/tracker', labels: ['go', 'GO'] } }, 'length', 'issues.labels'],
  [{ models: { phases: { review: { model: 'some-model-20260101' } } } }, 'enum', 'models.phases.review.model'],
  [{ review: { depth: 'max' } }, 'enum', 'review.depth'],
  [{ review: { sensitiveDepth: 'max' } }, 'enum', 'review.sensitiveDepth'],
  [{ minPlugin: '6.26' }, 'pattern', 'minPlugin'],
  [{ minPlugin: 'v6.26.0' }, 'pattern', 'minPlugin'],
  [{ issuesPerWorker: 0 }, 'range', 'issuesPerWorker'],
  [{ issuesPerWorker: 17 }, 'range', 'issuesPerWorker'],
  ...['', '--dangerously-skip-permissions', 'opus; id', 'opus fast', `o${'p'.repeat(128)}`].map((model) => [{ models: { worker: { model } } }, 'pattern', 'models.worker.model']),
  [{ later: true }, 'unknown-key', 'later'],
  [{ models: { phases: { plan: { modle: 'opus' } } } }, 'unknown-key', 'models.phases.plan.modle'],
  // A key is shown without the characters that could rewrite a terminal line or cut the message.
  [{ 'later\u001B[2K\nmerge': true }, 'unknown-key', 'later?[2K?merge'],
];

test('policy: each refused value is named with its rule and path', () => {
  for (const [doc, rule, path] of REFUSED) {
    assert.deepEqual(rules(validate(doc)), [[rule, path]], JSON.stringify(doc));
  }
  // The longest name and the characters of a full model name stay allowed.
  for (const model of ['opus[1m]', 'vendor.family-4-5-v1:0', 'team/model@2026-01-01', 'p'.repeat(128)]) assert.deepEqual(validate({ models: { worker: { model } } }), [], model);
  // A tracker label besides startLabel is the project's own.
  assert.deepEqual(validate({ startLabel: 'go', issues: { repository: 'owner/tracker', labels: ['go', 'project-a'] } }), []);
});

test('policy: a skill folder copied alone, as for an agent without plugins, checks with its own schema; minPlugin cannot be checked there and gives no policy', async () => {
  const copy = join(mkdtempSync(join(tmpdir(), 'bk-policy-')), 'skills', 'orchestrating-projects');
  cpSync(fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects', import.meta.url)), copy, { recursive: true });
  const copied = await import(pathToFileURL(join(copy, 'policy.mjs')).href);
  assert.equal(copied.effective({ startLabel: 'go', merge: { mode: 'disjoint' } }).policy.merge.mode, 'disjoint');
  assert.deepEqual(rules(copied.effective({ merge: { mode: 'disjont' } }).errors), [['enum', 'merge.mode']]);
  const gated = copied.effective({ startLabel: 'go', minPlugin: '1.0.0' });
  assert.equal(gated.policy, null);
  assert.deepEqual(rules(gated.errors), [['range', 'minPlugin']]);
  // A schema that gains a keyword the check does not implement refuses every file, the valid ones too, instead of passing what the schema refuses.
  const schema = join(copy, 'orchestration.schema.json');
  for (const edit of [(s) => { s.properties.trustedAuthors.maxItems = 1; }, (s) => { s.properties.merge.additionalProperties = true; }, (s) => { s.patternProperties['^//'] = { type: 'string' }; }]) {
    const edited = JSON.parse(readFileSync(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/orchestration.schema.json', import.meta.url), 'utf8'));
    edit(edited);
    writeFileSync(schema, JSON.stringify(edited));
    assert.throws(() => copied.validate({ startLabel: 'go' }), /does not implement/);
  }
});

test('policy: the remote\'s HEAD is fetched into the reader\'s own ref and the file is read from that ref; no file means the defaults', () => {
  const calls = [];
  assert.equal(read('/p', remote('{ "startLabel": "go" }', calls)).policy.startLabel, 'go');
  // No name that the remote or the local origin/HEAD chooses is part of a command.
  assert.ok(calls.some((call) => call.startsWith('git fetch ') && call.endsWith(' origin +HEAD:refs/benchkeeper/policy')));
  assert.ok(calls.includes('git show refs/benchkeeper/policy:docs/agents/orchestration.json'));
  assert.deepEqual(read('/p', remote(null)), { policy: DEFAULTS, errors: [] });
});

test('policy: a fetch or a show that fails gives no policy: not the defaults, and not the file an older fetch left', () => {
  for (const failing of ['fetch', 'show']) {
    const { policy, errors } = read('/p', (dir, cmd, args) => {
      if (args[0] === failing) throw new Error(`fatal: the ${failing} failed`);
      return args[0] === 'ls-tree' ? 'docs/agents/orchestration.json\n' : '{ "startLabel": "go", "merge": { "allowed": true } }';
    });
    assert.equal(policy, null, failing);
    assert.deepEqual(rules(errors), [['unreadable', '']], failing);
  }
});

test('policy: a file that is not JSON gives no policy', () => {
  const { policy, errors } = read('/p', remote('{ "startLabel": '));
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
  const cli = (dir, env = {}) => spawnSync(process.execPath, [fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/policy.mjs', import.meta.url)), dir], { encoding: 'utf8', env: { ...process.env, ...env } });
  const rejected = cli(project);
  assert.deepEqual([rejected.status, rejected.stdout], [1, '']);
  assert.match(rejected.stderr, /^enum at merge\.mode: /);
  // The clone is older than the next commit: the reader fetches the default branch before it reads.
  commit('{ "startLabel": "go" }');
  const printed = cli(project);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(JSON.parse(printed.stdout).startLabel, 'go');
  // A project path below the repository root reads the same file, not "no file" and with it the defaults.
  const below = cli(join(project, 'docs'));
  assert.equal(below.status, 0, below.stderr);
  assert.equal(JSON.parse(below.stdout).startLabel, 'go');
  // Not cloned (init, then remote add): there is no origin/HEAD, and the remote's HEAD is all the reader needs.
  const added = mkdtempSync(join(tmpdir(), 'bk-policy-'));
  git('init', '-q', '-b', 'other', added);
  git('-C', added, 'remote', 'add', 'origin', origin);
  const asked = cli(added);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(JSON.parse(asked.stdout).startLabel, 'go');
  // Started from a hook, GIT_DIR names another repository (here origin, which has no remote): the project's policy is still the one read.
  const hooked = cli(project, { GIT_DIR: join(origin, '.git') });
  assert.equal(hooked.status, 0, hooked.stderr);
  assert.equal(JSON.parse(hooked.stdout).startLabel, 'go');
  // A worker shares the git directory: a replace ref that swaps the policy blob for a wider one changes nothing the reader prints.
  const blob = (...args) => spawnSync('git', ['-C', project, ...args], { encoding: 'utf8', input: '{ "startLabel": "go", "merge": { "allowed": true } }' }).stdout.trim();
  blob('replace', blob('rev-parse', 'refs/benchkeeper/policy:docs/agents/orchestration.json'), blob('hash-object', '-w', '--stdin'));
  const replaced = cli(project);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(JSON.parse(replaced.stdout).merge.allowed, false);
  // The owner moves the default branch: the clone's origin/HEAD still names main, the reader reads the remote's HEAD.
  git('checkout', '-q', '-b', 'next');
  commit('{ "startLabel": "next" }');
  const moved = cli(project);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(JSON.parse(moved.stdout).startLabel, 'next');
});
