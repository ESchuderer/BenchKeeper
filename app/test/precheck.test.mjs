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
  assert.deepEqual(pickable(POLICY, issues, ['fix/6-crash', 'feat/16-x']), [1, 3]);
  assert.deepEqual(pickable({}, issues, []), []);
  assert.deepEqual(pickable(null, issues, []), []);
});

test('precheck: reads the policy from the default branch and skips a project without one', () => {
  const calls = [];
  const stub = (policy) => (dir, cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args[0] === 'symbolic-ref') return 'origin/main\n';
    if (args[0] === 'fetch') return '';
    if (args[0] === 'show') { if (!policy) throw new Error('no file'); return JSON.stringify(policy); }
    if (args[0] === 'api') return JSON.stringify([[issue(7)], [issue(8)], [issue(9)]]);
    return JSON.stringify([{ headRefName: 'feat/8-x', state: 'OPEN' }, { headRefName: 'feat/7-x', state: 'CLOSED' }, { headRefName: 'fix/9-y', state: 'MERGED' }]);
  };
  assert.deepEqual(check('/p', stub(POLICY)), [7]);
  assert.ok(calls.includes('git show origin/main:docs/agents/orchestration.json'));
  assert.ok(calls.some((c) => c.startsWith('gh api') && c.includes('labels=agent-ready')));
  calls.length = 0;
  assert.deepEqual(check('/p', stub(null)), []);
  assert.ok(!calls.some((c) => c.startsWith('gh')));
});

test('precheck: started through a symlinked folder it still runs, so no project means exit 1, not a silent 0', () => {
  // Exit 0 means "there is an issue to pick": a guard that skipped the command line would start every scheduled run.
  const real = realpathSync(fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects', import.meta.url)));
  const link = join(mkdtempSync(join(tmpdir(), 'bk-precheck-')), 'link');
  symlinkSync(real, link, 'dir');
  for (const dir of [real, link]) assert.equal(spawnSync(process.execPath, [join(dir, 'precheck.mjs')]).status, 1, dir);
});
