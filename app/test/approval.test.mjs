import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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
const APPROVAL = FILLED.slice(FILLED.indexOf('| Approval | |'), FILLED.indexOf('\n\n| Option'));

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
  ['an entity as a cell', swap(COST, '| Cost | &nbsp; |'), ['Cost']],
  ['an HTML comment as a cell', swap(COST, '| Cost | <!-- tbd --> |'), ['Cost']],
  ['an HTML comment over two lines as a cell', swap(COST, '| Cost | <!-- 2 worker\nsessions --> |'), ['Cost']],
  ['a link without text as a cell', swap(COST, '| Cost | [](x) |'), ['Cost']],
  ['a deferral in bold', swap(COST, '| Cost | **TBD** |'), ['Cost']],
  ['a deferral with a full stop', swap(COST, '| Cost | tbd. |'), ['Cost']],
  ['a cell that says todo', swap(COST, '| Cost | TODO |'), ['Cost']],
  ['a closing tag as a cell', swap(COST, '| Cost | </b> |'), ['Cost']],
  ['a deferral in brackets', swap(COST, '| Cost | (TBD) |'), ['Cost']],
  ['a deferral as a link text', swap(COST, '| Cost | [TBD](x) |'), ['Cost']],
  ['a deferral after a zero-width space', swap(COST, '| Cost | ​TBD |'), ['Cost']],
  ['the Approval table inside a multi-line HTML comment', swap(APPROVAL, `<!--\n${APPROVAL}\n-->`),
    ['Recommended', 'Work if approved', 'Runs on', 'Review', 'Merges', 'Owner steps', 'Cost', 'Undo', 'Answer']],
  ['a Recommended row that names another option than the first', swap('| Recommended | (a) Stream the export, confidence high |', '| Recommended | (b) Hold, confidence high |'), ['Recommended']],
  ['a second Approval table with an empty row', `${FILLED}\n| Approval | |\n|---|---|\n| Cost | |\n`, ['Cost']],
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
  // Every part of the template holds a placeholder: the Answer row depends on where the issue lands.
  ['the unfilled template', readFileSync(new URL(`${SKILL}approval-template.md`, import.meta.url), 'utf8'),
    ['Front matter', 'What', 'Recommended', 'Work if approved', 'Runs on', 'Review', 'Merges', 'Owner steps', 'Cost', 'Undo', 'Answer', 'Options', 'Why now']],
];

for (const [name, text, expected] of CASES) test(`approval: ${name} lacks ${expected.join(', ') || 'nothing'}`, () => assert.deepEqual(missing(text), expected));

test('approval: the command line exits 0 for a filled approval and 1 with the missing row on stderr', () => {
  const script = fileURLToPath(new URL(`${SKILL}approval.mjs`, import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  mkdirSync(join(dir, '.benchkeeper/runs/r1'), { recursive: true });
  const run = (name, text) => { writeFileSync(join(dir, '.benchkeeper/runs/r1', name), text); return spawnSync(process.execPath, [script, `.benchkeeper/runs/r1/${name}`], { cwd: dir, encoding: 'utf8' }); };
  assert.equal(run('filled.md', FILLED).status, 0);
  const lacking = run('no-cost.md', NO_COST);
  assert.equal(lacking.status, 1);
  assert.match(lacking.stderr, /\bCost\b/);
});

test('approval: the command line refuses a file outside the run folder with exit 2', () => {
  const script = fileURLToPath(new URL(`${SKILL}approval.mjs`, import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  mkdirSync(join(dir, '.benchkeeper/runs/r1'), { recursive: true });
  writeFileSync(join(dir, 'filled.md'), FILLED);
  symlinkSync(join(dir, 'filled.md'), join(dir, '.benchkeeper/runs/r1/link.md'));
  const status = (cwd, file) => spawnSync(process.execPath, [script, file], { cwd, encoding: 'utf8' }).status;
  const refused = spawnSync(process.execPath, [script, '.benchkeeper/runs/../../filled.md'], { cwd: dir, encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.equal(refused.stderr.trim().split('\n').length, 1);
  assert.equal(status(dir, '.benchkeeper/runs/r1/link.md'), 2);
  // A linked .benchkeeper or runs folder leads out of the project, so even a filled approval under it is refused.
  const out = mkdtempSync(join(tmpdir(), 'bk-approval-out-'));
  mkdirSync(join(out, 'runs/r1'), { recursive: true });
  writeFileSync(join(out, 'runs/r1/filled.md'), FILLED);
  const linkedDot = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  symlinkSync(out, join(linkedDot, '.benchkeeper'));
  assert.equal(status(linkedDot, '.benchkeeper/runs/r1/filled.md'), 2);
  const linkedRuns = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  mkdirSync(join(linkedRuns, '.benchkeeper'));
  symlinkSync(join(out, 'runs'), join(linkedRuns, '.benchkeeper/runs'));
  assert.equal(status(linkedRuns, '.benchkeeper/runs/r1/filled.md'), 2);
});
