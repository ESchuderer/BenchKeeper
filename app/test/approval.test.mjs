import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { answer, missing } from '../../plugins/benchkeeper/skills/orchestrating-projects/approval.mjs';

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

// A comment as `gh issue view --json comments` prints it.
const said = (body, createdAt, authorAssociation = 'OWNER') => ({ author: { login: 'owner' }, authorAssociation, body, createdAt });

for (const [name, text, expected] of CASES) test(`approval: ${name} lacks ${expected.join(', ') || 'nothing'}`, () => assert.deepEqual(missing(text), expected));

test('approval: the command line exits 0 for a filled approval and 1 with the missing row on stderr', () => {
  const script = fileURLToPath(new URL(`${SKILL}approval.mjs`, import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'bk-approval-'));
  const run = (name, text, ...mode) => { writeFileSync(join(dir, name), text); return spawnSync(process.execPath, [script, ...mode, join(dir, name)], { encoding: 'utf8' }); };
  assert.equal(run('filled.md', FILLED).status, 0);
  const lacking = run('no-cost.md', NO_COST);
  assert.equal(lacking.status, 1);
  assert.match(lacking.stderr, /\bCost\b/);
  // The answer of a filed approval: printed with exit 0, a format character of its text escaped; exit 1 while there is none.
  const answered = run('answered.json', JSON.stringify({ comments: [said('Owner answer (2026-11-11): b. Hold‮ it.', '2026-11-11T10:00:00Z')] }), 'answer');
  assert.equal(answered.status, 0, answered.stderr);
  assert.ok(!answered.stdout.includes('‮'));
  assert.deepEqual(JSON.parse(answered.stdout), { option: 'b', text: 'Hold‮ it.', at: '2026-11-11T10:00:00Z' });
  const open = run('open.json', JSON.stringify({ comments: [] }), 'answer');
  assert.deepEqual([open.status, open.stdout], [1, '']);
  // No answer yet is exit 1; a file that cannot be read as an issue is exit 2, so that an error never reads as "keep waiting".
  const errors = [run('cut.json', '{ "comments": [', 'answer'), run('other.json', '{ "labels": [] }', 'answer'), spawnSync(process.execPath, [script, 'answer', join(dir, 'absent.json')], { encoding: 'utf8' }), spawnSync(process.execPath, [script, 'answer'], { cwd: dir, encoding: 'utf8' })];
  for (const r of errors) {
    assert.deepEqual([r.status, r.stdout], [2, '']);
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  }
});

const HEAD = `Head: ${'a'.repeat(40)}\n\nThe worker fixed both findings.`;
const FIRST = said('Owner answer (2026-11-10): b. Not before the release.', '2026-11-10T09:00:00Z');
const SECOND = said('Owner answer (2026-11-11): a. Go ahead, and keep the old flag.', '2026-11-11T10:00:00Z');
const GO = { option: 'a', text: 'Go ahead, and keep the old flag.', at: '2026-11-11T10:00:00Z' };
const ANSWERS = [
  ['an owner\'s answer is read', [said('The plan looks fine to me.', '2026-11-11T09:00:00Z', 'COLLABORATOR'), SECOND], GO],
  ['a member\'s answer is read', [{ ...SECOND, authorAssociation: 'MEMBER' }], GO],
  ['a collaborator\'s answer is none', [{ ...SECOND, authorAssociation: 'COLLABORATOR' }], null],
  ['an answer with a head comment after it is none', [SECOND, said(HEAD, '2026-11-11T11:00:00Z')], null],
  ['a collaborator\'s head comment after an answer voids nothing', [SECOND, { ...said(HEAD, '2026-11-11T11:00:00Z', 'COLLABORATOR'), author: { login: 'stranger' } }], GO],
  ['the head comment of the approval\'s author as a collaborator voids the answer', [SECOND, said(HEAD, '2026-11-11T11:00:00Z', 'COLLABORATOR')], null],
  ['an answer after the head comment is read', [said(HEAD, '2026-11-11T08:00:00Z'), SECOND], GO],
  ['the newest of two answers is read', [FIRST, SECOND], GO],
  ['an answer without free text is read', [said('Owner answer (2026-11-11): a', '2026-11-11T10:00:00Z')], { option: 'a', text: '', at: '2026-11-11T10:00:00Z' }],
  ['no comments are no answer', [], null],
  ['the answer text later in a comment is none', [said('As I wrote: Owner answer (2026-11-11): a. Go ahead.', '2026-11-11T10:00:00Z')], null],
  ['a later comment that quotes an answer does not hide the answer', [SECOND, said('Thanks. You wrote: Owner answer (2026-11-10): b.', '2026-11-11T12:00:00Z')], GO],
  ['comments out of order are read by their time', [SECOND, FIRST], GO],
  ['an option without a full stop is cut at 200 characters', [said(`Owner answer (2026-11-11): ${'x'.repeat(300)}`, '2026-11-11T10:00:00Z')], { option: 'x'.repeat(200), text: '', at: '2026-11-11T10:00:00Z' }],
];
for (const [name, comments, expected] of ANSWERS) test(`approval: ${name}`, () => assert.deepEqual(answer({ labels: [{ name: 'question' }], author: { login: 'owner' }, comments }), expected));
