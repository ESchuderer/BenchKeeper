import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, distinct, pickable, report } from '../../plugins/benchkeeper/skills/orchestrating-projects/precheck.mjs';

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
    // GitHub compares label names without case.
    issue(7, { labels: [{ name: 'Agent-Ready' }] }),
  ];
  assert.deepEqual(pickable(POLICY, issues, [{ headRefName: 'fix/6-crash' }, { headRefName: 'feat/16-x' }]), [1, 3, 7]);
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

test('precheck: an issue labeled question is the owner\'s, also once it carries the start label', () => {
  const issues = [issue(1), issue(2, { labels: [{ name: 'agent-ready' }, { name: 'Question' }] }), issue(3, { labels: [{ name: 'question' }, { name: 'agent-ready' }] })];
  assert.deepEqual(pickable(POLICY, issues, []), [1]);
});

test('precheck: an issue that several projects list starts in none of them', () => {
  const lists = [
    { dir: '/a', tracker: 'owner/tracker', numbers: [12, 14] },
    { dir: '/b', tracker: 'Owner/Tracker', numbers: [14, 15] },
    // The same number in another repository is another issue.
    { dir: '/c', tracker: 'owner/project', numbers: [12, 15] },
  ];
  assert.deepEqual(distinct(lists), {
    lists: [
      { dir: '/a', tracker: 'owner/tracker', numbers: [12] },
      { dir: '/b', tracker: 'Owner/Tracker', numbers: [15] },
      { dir: '/c', tracker: 'owner/project', numbers: [12, 15] },
    ],
    shared: [{ tracker: 'owner/tracker', number: 14, dirs: ['/a', '/b'] }],
  });
});

test('precheck: the command line prints no issue that several projects list, names the project that fails, and exits 0 only with an issue to pick', () => {
  const lists = { '/a': { tracker: 'owner/tracker', numbers: [14, 12] }, '/b': { tracker: 'owner/tracker', numbers: [14] } };
  // An Escape sequence in a folder name and a right-to-left override in a program's message would rewrite the terminal line.
  const odd = `/c${String.fromCodePoint(0x1b)}[2K`;
  const pick = (dir) => { if (!lists[dir]) throw new Error(`no ${String.fromCodePoint(0x202e)}policy\nsecond line`); return lists[dir]; };
  assert.deepEqual(report(['/a', '/b', odd], pick), { out: ['/a: #12'], err: ['/c?[2K: no ?policy', 'several projects: owner/tracker#14 (/a, /b)'], code: 0 });
  assert.deepEqual(report(['/b', '/a'], (dir) => ({ tracker: 'owner/tracker', numbers: lists[dir].numbers.filter((n) => n === 14) })), { out: [], err: ['several projects: owner/tracker#14 (/b, /a)'], code: 1 });
  assert.deepEqual(report(['/a'], () => ({ tracker: 'owner/project', numbers: [31, 7] })), { out: ['/a: #7 #31'], err: [], code: 0 });
});

const calls = [];
const stub = (policy, origin = 'git@github.com:owner/project.git') => (dir, cmd, args) => {
  calls.push([cmd, ...args].join(' '));
  if (args[0] === 'fetch') return '';
  if (args[0] === 'remote') return `${origin}\n`;
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
  assert.ok(calls.includes('gh pr list -R owner/project --state all --limit 1000 --json headRefName,state,isCrossRepository,body'));
});

test('precheck: reads the policy from the default branch, skips a project without one and names why the reader rejects one', () => {
  calls.length = 0;
  assert.deepEqual(check('/p', stub(POLICY)), [7]);
  assert.ok(calls.includes('git show refs/benchkeeper/policy:docs/agents/orchestration.json'));
  // The issues and pull requests are origin's, whatever gh would resolve through an upstream remote or a set default.
  assert.ok(calls.includes('gh api --paginate --slurp repos/owner/project/issues?state=open&per_page=100&labels=agent-ready'));
  assert.ok(calls.includes('gh pr list -R owner/project --state all --limit 1000 --json headRefName,state,isCrossRepository'));
  calls.length = 0;
  assert.deepEqual(check('/p', stub(null)), []);
  assert.ok(!calls.some((c) => c.startsWith('gh')));
  assert.throws(() => check('/p', stub({ ...POLICY, merge: { mode: 'disjont' }, later: true })), /enum at merge\.mode: .+; unknown-key at later: /);
});

test('precheck: an origin on another host than gh\'s fails instead of listing the github.com repository of the same path', () => {
  for (const origin of ['https://gitlab.com/owner/project.git', 'git@gitlab.com:owner/project.git', 'ssh://git@gitlab.com:2222/owner/project']) {
    calls.length = 0;
    assert.throws(() => check('/p', stub(POLICY, origin), {}), /gitlab\.com/, origin);
    assert.ok(!calls.some((c) => c.startsWith('gh')), origin);
  }
  // An ssh alias names no host, ssh.github.com is github.com's own, and GH_HOST names the host gh asks.
  assert.deepEqual(check('/p', stub(POLICY, 'work:owner/project'), {}), [7]);
  assert.deepEqual(check('/p', stub(POLICY, 'ssh://git@ssh.github.com:443/owner/project.git'), {}), [7]);
  assert.deepEqual(check('/p', stub(POLICY, 'https://gitlab.com/owner/project.git'), { GH_HOST: 'gitlab.com' }), [7]);
  assert.throws(() => check('/p', stub(POLICY), { GH_HOST: 'gitlab.com' }), /github\.com/);
});

test('precheck: an origin whose host cannot be compared with gh\'s fails, and an ssh alias passes', () => {
  const fails = (origin, why) => {
    calls.length = 0;
    assert.throws(() => check('/p', stub(POLICY, origin), {}), why, origin);
    assert.ok(!calls.some((c) => c.startsWith('gh')), origin);
  };
  // A local path and a file: URL name no host: gh would list the github.com repository of the same path.
  for (const origin of ['/srv/git/owner/project.git', '../owner/project', 'file:///srv/git/owner/project.git', 'file://github.com/owner/project', 'C:/git/owner/project']) fails(origin, /local path/);
  // git and curl end the host at the #, so the fetch goes to evil.example.
  fails('https://evil.example#@github.com/owner/project', /evil\.example/);
  fails('https://evil.example?@github.com/owner/project', /evil\.example/);
  fails('https://evil.example@other.example@github.com/owner/project', /./);
  fails('git@github.com-work.evil.example:owner/project.git', /evil\.example/);
  // The error names the host and nothing of a credential.
  for (const origin of ['https://user:s3cret@gitlab.com/owner/project.git', 'https://user:s3@cret@gitlab.com/owner/project.git', 'https://user:s3/cret@gitlab.com/owner/project.git']) {
    fails(origin, (e) => !/s3|cret|user/.test(e.message));
  }
  // An alias of ~/.ssh/config: a name without a dot, or gh's host with a suffix, as in the accounts of one user.
  for (const origin of ['git@github.com-work:owner/project.git', 'github.com-work:owner/project', 'git@work:owner/project.git']) assert.deepEqual(check('/p', stub(POLICY, origin), {}), [7], origin);
});

test('precheck and policy: started through a symlinked folder they still run, so no project means exit 1, not a silent 0', () => {
  // Exit 0 means "there is an issue to pick" or "here is the policy": a guard that skipped the command line would start every scheduled run.
  const real = realpathSync(fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects', import.meta.url)));
  const link = join(mkdtempSync(join(tmpdir(), 'bk-precheck-')), 'link');
  symlinkSync(real, link, 'dir');
  for (const dir of [real, link]) for (const script of ['precheck.mjs', 'policy.mjs']) assert.equal(spawnSync(process.execPath, [join(dir, script)]).status, 1, join(dir, script));
});
