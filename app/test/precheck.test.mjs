import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, pickable } from '../../plugins/benchkeeper/skills/orchestrating-projects/precheck.mjs';

const POLICY = { startLabel: 'agent-ready', trustedAuthors: ['helper[bot]'] };
const issue = (number, extra = {}) => ({ number, author_association: 'OWNER', user: { login: 'owner' }, labels: [{ name: 'agent-ready' }], ...extra });

test('precheck: picks labeled issues by trusted authors that have no open or merged pull request', () => {
  const issues = [
    issue(1),
    issue(2, { author_association: 'NONE', user: { login: 'stranger' } }),
    issue(3, { author_association: 'NONE', user: { login: 'helper[bot]' } }),
    issue(4, { labels: [{ name: 'other' }] }),
    issue(5, { pull_request: {} }),
    issue(6),
  ];
  assert.deepEqual(pickable(POLICY, issues, [{ headRefName: 'fix/6-crash' }, { headRefName: 'feat/16-x' }]), [1, 3]);
  assert.deepEqual(pickable({}, issues, []), []);
  assert.deepEqual(pickable(null, issues, []), []);
});

test('precheck: with a tracker an issue needs every label, and a pull request hides it only when its body names the tracker issue', () => {
  const policy = { startLabel: 'agent-ready', issues: { repository: 'owner/tracker', labels: ['project-a'] } };
  const labels = [{ name: 'agent-ready' }, { name: 'project-a' }];
  const issues = [issue(12, { labels }), issue(13), ...[14, 15, 16, 17, 18, 19, 20].map((n) => issue(n, { labels }))];
  const pulls = [
    { headRefName: 'fix/12-an-old-branch-of-the-project', body: 'Fixes #12' },
    { headRefName: 'feat/12-other', body: 'Part of owner/tracker#123 and co-owner/tracker#12.' },
    { headRefName: 'fix/14-crash', body: 'Closes owner/tracker#14.' },
    { headRefName: 'fix/15-x', body: null },
    { headRefName: 'fix/16-x', body: 'See other/owner/tracker#16' },
    { headRefName: 'fix/17-x', body: 'Closes Owner/Tracker#17' },
    { headRefName: 'fix/18-x', body: 'Closes https://github.com/owner/tracker/issues/18' },
    { headRefName: 'fix/19-x', body: 'After https://github.com/owner/tracker/issues/190 and https://github.com/owner/tracker/pull/19' },
    { headRefName: 'fix/20-x', body: 'Closes https://github.com/other/tracker/issues/20' },
  ];
  assert.deepEqual(pickable(policy, issues, pulls), [12, 15, 16, 19, 20]);
});

const calls = [];
const stub = (policy) => (dir, cmd, args) => {
  calls.push([cmd, ...args].join(' '));
  if (args[0] === 'fetch') return '';
  if (args[0] === 'ls-tree') return policy ? 'docs/agents/orchestration.json\n' : '';
  if (args[0] === 'show') return JSON.stringify(policy);
  if (args[0] === 'api') return JSON.stringify([[issue(7)], [issue(8)], [issue(9)]]);
  // 7: a closed pull request and an open one from a fork, which anyone can open; 8: an open one of the project; 9: a merged one from a fork.
  return JSON.stringify([
    { headRefName: 'feat/8-x', state: 'OPEN', isCrossRepository: false },
    { headRefName: 'feat/7-x', state: 'CLOSED', isCrossRepository: false },
    { headRefName: 'fix/7-x', state: 'OPEN', isCrossRepository: true },
    { headRefName: 'fix/9-y', state: 'MERGED', isCrossRepository: true },
  ]);
};

test('precheck: with a tracker the issues are listed there with every label, and the pull requests with their bodies', () => {
  calls.length = 0;
  // Issues 7 to 9 lack the label project-a.
  assert.deepEqual(check('/p', stub({ ...POLICY, issues: { repository: 'owner/tracker', labels: ['project-a'] } })), []);
  assert.ok(calls.includes('gh api --paginate --slurp repos/owner/tracker/issues?state=open&per_page=100&labels=agent-ready,project-a'));
  assert.ok(calls.includes('gh pr list --state all --limit 1000 --json headRefName,state,isCrossRepository,body'));
});

test('precheck: reads the policy from the default branch, skips a project without one and names why the reader rejects one', () => {
  calls.length = 0;
  assert.deepEqual(check('/p', stub(POLICY)), [7]);
  assert.ok(calls.includes('git show refs/benchkeeper/policy:docs/agents/orchestration.json'));
  assert.ok(calls.some((c) => c.startsWith('gh api') && c.includes('labels=agent-ready')));
  calls.length = 0;
  assert.deepEqual(check('/p', stub(null)), []);
  assert.ok(!calls.some((c) => c.startsWith('gh')));
  assert.throws(() => check('/p', stub({ ...POLICY, merge: { mode: 'disjont' }, later: true })), /enum at merge\.mode: .+; unknown-key at later: /);
});

test('precheck and policy: started through a symlinked folder they still run, so no project means exit 1, not a silent 0', () => {
  // Exit 0 means "there is an issue to pick" or "here is the policy": a guard that skipped the command line would start every scheduled run.
  const real = realpathSync(fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects', import.meta.url)));
  const link = join(mkdtempSync(join(tmpdir(), 'bk-precheck-')), 'link');
  symlinkSync(real, link, 'dir');
  for (const dir of [real, link]) for (const script of ['precheck.mjs', 'policy.mjs']) assert.equal(spawnSync(process.execPath, [join(dir, script)]).status, 1, join(dir, script));
});
