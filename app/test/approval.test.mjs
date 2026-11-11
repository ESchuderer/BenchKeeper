import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { missing } from '../../plugins/benchkeeper/skills/orchestrating-projects/approval.mjs';

const SKILL = '../../plugins/benchkeeper/skills/orchestrating-projects/';
const WHAT = 'What: Approve the design of the streamed export (plan: docs/plans/export.md).';
const MERGES = '| Merges | the coordinator after green checks; .github stays for the owner |';
const COST = '| Cost | 2 worker sessions, about 3 hours (unverified) |';
const STREAM = '| (a) Stream the export (Recommended) | Both PRs start | More code to review |';
const HOLD = '| (b) Hold | Nothing changes | The export stays slow |';
const WHY = 'Why now: issue 12 waits on it.';
const FILLED = `${WHAT}

| Approval | |
|---|---|
| Recommended | (a) Stream the export, confidence high |
| Work if approved | 2 PRs, each under 1,000 lines, in owner/project; the reader first |
| Runs on | opus xhigh; phases: plan opus high, implement opus high, test sonnet high, review opus high, depth xhigh |
| Review | fresh reviewer per PR at xhigh, plus the security review |
${MERGES}
| Owner steps | none |
${COST}
| Undo | revert each PR |
| Answer | comment "a", "b" or free text, or run /benchkeeper:questions |

| Option | What happens | Trade-off |
|---|---|---|
${STREAM}
${HOLD}

${WHY}
`;

// A variant must differ from the filled text, or its case would pass on the text that passes.
const swap = (from, to) => { assert.ok(FILLED.includes(from), from); return FILLED.replace(from, to); };
const NO_COST = swap(`${COST}\n`, '');

const CASES = [
  ['the filled text', FILLED, []],
  ['CRLF line endings', FILLED.replaceAll('\n', '\r\n'), []],
  ['an escaped pipe in a cell', swap('(a) Stream the export (Recommended)', '(a) Stream the export \\| CSV (Recommended)'), []],
  ['a URL autolink in a cell', swap('| Undo | revert each PR |', '| Undo | revert each PR, see <https://example.com/plan> |'), []],
  ['no Cost row', NO_COST, ['Cost']],
  ['an empty Merges cell', swap(MERGES, '| Merges | |'), ['Merges']],
  ['a placeholder left in Runs on', swap('test sonnet high', 'test <model effort>'), ['Runs on']],
  ['a cell without a letter or digit', swap(COST, '| Cost | ? |'), ['Cost']],
  ['a cell that only defers', swap(COST, '| Cost | TBD |'), ['Cost']],
  ['a row twice, once empty', swap(COST, `| Cost | |\n${COST}`), ['Cost']],
  ['no What line', swap(`${WHAT}\n`, ''), ['What']],
  ['a placeholder as What', swap(WHAT, 'What: <the decision in one sentence>'), ['What']],
  ['no Why now line', swap(`${WHY}\n`, ''), ['Why now']],
  ['a placeholder as Why now', swap(WHY, 'Why now: <what waits on it>'), ['Why now']],
  ['one option row', swap(`${HOLD}\n`, ''), ['Options']],
  ['no option marked', swap(' (Recommended)', ''), ['Options']],
  ['the marked option not first', swap(`${STREAM}\n${HOLD}`, `${HOLD}\n${STREAM}`), ['Options']],
  ['two options marked', swap('| (b) Hold |', '| (b) Hold (Recommended) |'), ['Options']],
  ['a placeholder in the options table', swap('| More code to review |', '| <trade-off> |'), ['Options']],
  ['an option without What happens', swap(HOLD, '| (b) Hold | | The export stays slow |'), ['Options']],
  ['front matter left in', `---\nlabels: question, ready-for-human\n---\n\n${FILLED}`, ['Front matter']],
  // Every part of the template that holds a placeholder: only its Answer row is text to keep.
  ['the unfilled template', readFileSync(new URL(`${SKILL}approval-template.md`, import.meta.url), 'utf8'),
    ['Front matter', 'What', 'Recommended', 'Work if approved', 'Runs on', 'Review', 'Merges', 'Owner steps', 'Cost', 'Undo', 'Options', 'Why now']],
];

for (const [name, text, expected] of CASES) test(`approval: ${name} lacks ${expected.join(', ') || 'nothing'}`, () => assert.deepEqual(missing(text), expected));

test('approval: the command line exits 0 for a filled approval and 1 with the missing row on stderr', () => {
  const script = fileURLToPath(new URL(`${SKILL}approval.mjs`, import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  const run = (name, text) => { writeFileSync(join(dir, name), text); return spawnSync(process.execPath, [script, join(dir, name)], { encoding: 'utf8' }); };
  assert.equal(run('filled.md', FILLED).status, 0);
  const lacking = run('no-cost.md', NO_COST);
  assert.equal(lacking.status, 1);
  assert.match(lacking.stderr, /\bCost\b/);
});
