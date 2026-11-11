import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { missing } from '../../plugins/benchkeeper/skills/orchestrating-projects/approval.mjs';

const FILLED = `What: Approve the design of the streamed export (plan: docs/plans/export.md).

| Approval | |
|---|---|
| Recommended | (a) Stream the export, confidence high |
| Work if approved | 2 PRs, each under 1,000 lines, in owner/project; the reader first |
| Runs on | opus xhigh; phases: plan opus high, implement opus high, test sonnet high, review opus high, depth xhigh |
| Review | fresh reviewer per PR at xhigh, plus the security review |
| Merges | the coordinator after green checks; .github stays for the owner |
| Owner steps | none |
| Cost | 2 worker sessions, about 3 hours (unverified) |
| Undo | revert each PR |
| Answer | comment "a", "b" or free text, or run /benchkeeper:questions |

| Option | What happens | Trade-off |
|---|---|---|
| (a) Stream the export (Recommended) | Both PRs start | More code to review |
| (b) Hold | Nothing changes | The export stays slow |

Why now: issue 12 waits on it.
`;

// A variant must differ from the filled text, or its assertion would pass on the text that passes.
const swap = (from, to) => { assert.ok(FILLED.includes(from), from); return FILLED.replace(from, to); };
const NO_COST = swap('| Cost | 2 worker sessions, about 3 hours (unverified) |\n', '');

test('approval: a filled approval lacks nothing, and each missing, empty or unfilled part is named', () => {
  assert.deepEqual(missing(FILLED), []);
  assert.deepEqual(missing(NO_COST), ['Cost']);
  assert.deepEqual(missing(swap('| Merges | the coordinator after green checks; .github stays for the owner |', '| Merges | |')), ['Merges']);
  assert.deepEqual(missing(swap('test sonnet high', 'test <model effort>')), ['Runs on']);
  assert.deepEqual(missing(swap('| (b) Hold | Nothing changes | The export stays slow |\n', '')), ['Options']);
  assert.deepEqual(missing(swap(' (Recommended)', '')), ['Options']);
});

test('approval: the command line exits 0 for a filled approval and 1 with the missing row on stderr', () => {
  const script = fileURLToPath(new URL('../../plugins/benchkeeper/skills/orchestrating-projects/approval.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  const run = (name, text) => { writeFileSync(join(dir, name), text); return spawnSync(process.execPath, [script, join(dir, name)], { encoding: 'utf8' }); };
  assert.equal(run('filled.md', FILLED).status, 0);
  const lacking = run('no-cost.md', NO_COST);
  assert.equal(lacking.status, 1);
  assert.match(lacking.stderr, /\bCost\b/);
});
