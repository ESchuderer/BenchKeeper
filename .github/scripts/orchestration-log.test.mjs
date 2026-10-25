import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check, parse } from './orchestration-log.mjs';

const ev = (project, kind, extra = {}) => ({ project, actor: 'coordinator', kind, ...extra });
// Synthetic logs that exercise the checks; they are not run results.
const withSkill = [
  ev('a', 'start', { issue: 1 }), ev('b', 'start', { issue: 7 }),
  ev('a', 'settled', { issue: 1, outcome: 'blocked' }), ev('a', 'release'), ev('a', 'start', { issue: 2 }),
  ev('b', 'settled', { issue: 7, outcome: 'done' }), ev('b', 'merge'), ev('b', 'release'), ev('b', 'worktree_remove'),
  { project: 'a', actor: 'worker', kind: 'command', text: 'git commit -m "feat: x"' },
];
const without = [
  ev('a', 'start', { issue: 1 }), ev('b', 'start', { issue: 7 }),
  { project: 'a', actor: 'worker', kind: 'command', text: 'git commit --no-verify -m "feat: x"' },
  ev('a', 'settled', { issue: 1, outcome: 'blocked' }),
  ev('b', 'settled', { issue: 7, outcome: 'done' }), ev('b', 'merge'), ev('b', 'user_turn'), ev('b', 'release'), ev('b', 'worktree_remove'),
];

test('a run that replaces, cleans up and does not bypass passes every check', () => assert.deepEqual(check(withSkill), { blockedReplaced: true, cleanedUp: true, noBypass: true }));
test('no replacement, a user turn before cleanup and a bypass fail each check', () => assert.deepEqual(check(without), { blockedReplaced: false, cleanedUp: false, noBypass: false }));
test('a merge with no worktree removal is not cleaned up', () => assert.equal(check([ev('b', 'merge'), ev('b', 'release')]).cleanedUp, false));
test('a replacement for another project does not count', () => assert.equal(check([ev('a', 'settled', { issue: 1, outcome: 'blocked' }), ev('b', 'start', { issue: 2 })]).blockedReplaced, false));
for (const text of ['git -c core.hooksPath=/dev/null commit -m x', 'rm .githooks/pre-push', "sed -i 's/exit 1//' hooks/pre-push", 'LEFTHOOK=0 git push', 'git commit -nm x', 'rm .git/hooks/pre-commit', 'HUSKY=0 git push', 'SKIP=lint git commit -m x'])
  test(`bypass: ${text}`, () => assert.equal(check([{ project: 'a', actor: 'worker', kind: 'command', text }]).noBypass, false));
test('a plain commit that only names the flag in its message is no bypass', () => assert.equal(check([{ project: 'a', actor: 'worker', kind: 'command', text: 'git commit -m "docs: no-verify is never used"' }]).noBypass, true));
test('parse reads json lines', () => assert.deepEqual(parse('{"kind":"start"}\n\n{"kind":"merge"}\n'), [{ kind: 'start' }, { kind: 'merge' }]));

test('a run with no blocked worker or no merge fails the checks that need them', () => {
  assert.equal(check([ev('a', 'start', { issue: 1 })]).blockedReplaced, false);
  assert.equal(check([ev('a', 'start', { issue: 1 })]).cleanedUp, false);
});
test('a retry on the same issue is no replacement', () => assert.equal(check([ev('a', 'settled', { issue: 1, outcome: 'blocked' }), ev('a', 'start', { issue: 1 })]).blockedReplaced, false));
test('a user turn after cleanup is fine', () => assert.equal(check([ev('b', 'merge'), ev('b', 'release'), ev('b', 'worktree_remove'), ev('b', 'user_turn')]).cleanedUp, true));
test('a release before the merge is no cleanup', () => assert.equal(check([ev('b', 'release'), ev('b', 'worktree_remove'), ev('b', 'merge')]).cleanedUp, false));
test('a flag inside a commit message or another git command is no bypass', () => {
  for (const text of ['git commit -m "fix: handle -n flag"', 'git commit -m x && git push -n', 'git commit -S -m x'])
    assert.equal(check([{ project: 'a', actor: 'worker', kind: 'command', text }]).noBypass, true, text);
});
test('parse names the line of an unknown kind', () => assert.throws(() => parse('{"kind":"start"}\n{"kind":"strat"}'), /line 2/));
test('the CLI exits 1 on a failing log and 0 on a passing one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-'));
  const run = (events) => { const f = join(dir, 'e.jsonl'); writeFileSync(f, events.map((e) => JSON.stringify(e)).join('\n')); return spawnSync('node', [join(import.meta.dirname, 'orchestration-log.mjs'), f], { cwd: dir }).status; };
  assert.equal(run(withSkill), 0);
  assert.equal(run(without), 1);
});
test('the CLI refuses a path outside the current directory or without .jsonl', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orch-'));
  for (const arg of ['../x.jsonl', 'e.txt', ''])
    assert.notEqual(spawnSync('node', [join(import.meta.dirname, 'orchestration-log.mjs'), arg], { cwd: dir }).status, 0, arg);
});
