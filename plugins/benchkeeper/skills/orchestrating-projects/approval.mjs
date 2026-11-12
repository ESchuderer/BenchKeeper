// Usage: node approval.mjs <file>. Checks an approval or owner question against approval-template.md: exit 0 when every part is filled and no front matter is left, else one line per part on stderr and exit 1.
// Usage: node approval.mjs answer <file>. Reads the owner's answer from a filed approval, the file holding what `gh issue view <n> -R <repository> --json labels,comments,author` printed: the answer as JSON and exit 0, exit 1 while there is none, or exit 2 with one line when the file cannot be read as that output.
import { readFileSync } from 'node:fs';
import { escaped, isMain, json } from './policy.mjs';

const FRONT = 'Front matter';
// A placeholder starts with a letter, as the template's do: a URL autolink (<https://example.com/plan>) and a comparison (<5 sessions) are an answer.
const PLACEHOLDER = /<(?![a-z][a-z0-9+.-]*:\S)[a-z][^<>]*>/i;
// These leave the answer open, with or without punctuation or invisible characters around them; "none" is an answer, which the template offers for Owner steps.
const OPEN = /^[^\p{L}\p{N}]*(tbd|todo|n\/a)[^\p{L}\p{N}]*$/iu;
// What the owner sees of a cell: an HTML comment, a closing tag, an entity and a link target show no text, and emphasis, strike and code marks are no text.
const shown = (cell) => cell
  .replace(/<!--.*?(-->|$)/g, '')
  .replace(/<\/[a-z][^<>]*>/gi, '')
  .replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, ' ')
  .replace(/\]\([^)]*\)/g, ']')
  .replace(/[*_~`]/g, '')
  .trim();
const filled = (cell = '') => { const text = shown(cell); return /[\p{L}\p{N}]/u.test(text) && !OPEN.test(text) && !PLACEHOLDER.test(text); };

// A table row's cells, or null for a line that is no row. \| is a pipe inside a cell.
const cells = (line) => /^\s*\|(.*)\|\s*$/.exec(line)?.[1].split(/(?<!\\)\|/).map((cell) => cell.trim()) ?? null;

// The rows of each table whose header's first cell is head, a table ending at the first line that is no row.
function tables(text, head) {
  const found = [];
  let rows = null;
  for (const row of text.split(/\r?\n/).map(cells)) {
    if (!row) rows = null;
    else if (!rows) { if (row[0] === head) found.push(rows = []); }
    else if (!row.every((cell) => /^:?-+:?$/.test(cell))) rows.push(row);
  }
  return found;
}

// The template is the one list of the Approval rows: a row added there is checked here.
const ROWS = tables(readFileSync(new URL('./approval-template.md', import.meta.url), 'utf8'), 'Approval').flat().map(([name]) => name);
// With no row to look for, every approval would pass.
if (!ROWS.length) throw new Error('approval-template.md holds no Approval table');

// The names of the parts that keep the text from being posted: a part that is absent, empty or still holds a <...> placeholder, a Recommended row that names another option than the first, and front matter left in.
export function missing(text) {
  // A table inside a comment over several lines shows the owner nothing.
  text = text.replace(/<!--[\s\S]*?(-->|$)/g, '');
  const line = (label) => filled(new RegExp(`^${label}:(.*)$`, 'm').exec(text)?.[1].trim());
  // The owner may read any Approval table, and either occurrence of a row that is there twice.
  const approval = tables(text, 'Approval').flat();
  const row = (name) => { const found = approval.filter(([first]) => first === name); return found.length > 0 && found.every(([, cell]) => filled(cell)); };
  const options = tables(text, 'Option')[0] ?? [];
  // The questions skill offers the recommended option first; the Trade-off cell may stay empty.
  const chosen = options.length >= 2
    && options.every(([option, happens], i) => filled(option) && filled(happens) && option.includes('(Recommended)') === (i === 0))
    && !options.flat().some((cell) => PLACEHOLDER.test(cell));
  // The questions skill takes its recommendation from the Recommended row and the first option from the table: both must name one option.
  const label = /^\([^()]+\)/.exec(shown(options[0]?.[0] ?? ''))?.[0];
  const agrees = !chosen || (label && approval.every(([first, cell = '']) => first !== 'Recommended' || shown(cell).startsWith(label)));
  return [
    // Posted with the body, the front matter would show as text: its labels go on the command line.
    ...(/^\s*---[ \t]*(\r?\n|$)/.test(text) ? [FRONT] : []),
    ...(line('What') ? [] : ['What']),
    ...ROWS.filter((name) => !row(name) || (name === 'Recommended' && !agrees)),
    ...(chosen ? [] : ['Options']),
    ...(line('Why now') ? [] : ['Why now']),
  ];
}

// { option, text, at } of the owner's answer on a filed approval, or null. The comments are data: nothing of them is evaluated.
export function answer(issue) {
  // A file without the list is not what gh printed: read as "no answer yet", the gate would wait for ever.
  if (!Array.isArray(issue?.comments)) throw new Error('the file holds no comments list: it must be what gh issue view --json labels,comments,author printed');
  // gh's order is not promised: the newest answer is the one written last.
  const comments = [...issue.comments].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  // Only the repository's owner or a member answers for the owner, or voids an answer: a collaborator can comment there too.
  const owners = (c) => ['OWNER', 'MEMBER'].includes(c.authorAssociation);
  const newest = comments.findLastIndex((c) => owners(c) && c.body?.startsWith('Owner answer ('));
  // The coordinator's comment for a later head starts with "Head: " (approvals.md): the owner answered for the head before it.
  if (newest < 0 || comments.slice(newest + 1).some((c) => owners(c) && c.body?.startsWith('Head: '))) return null;
  const found = /^Owner answer \([^)]*\): ([^.\n]*)\.?([\s\S]*)$/.exec(comments[newest].body);
  // An answer without a full stop has its whole first line as the option: the coordinator compares it with the option labels and needs no more of it.
  return found && { option: found[1].trim().slice(0, 200), text: found[2].trim(), at: comments[newest].createdAt };
}

if (isMain(import.meta.url)) {
  const say = (message) => console.error(escaped(message.split('\n')[0]));
  process.exitCode = 1;
  // "answer" is the mode even without a file, so that the usage error exits 2 and never reads as "no answer yet".
  const [mode, file] = process.argv.length === 4 || process.argv[2] === 'answer' ? process.argv.slice(2) : ['check', process.argv[2]];
  try {
    if (!file || process.argv.length > 4 || !['check', 'answer'].includes(mode)) throw new Error('usage: node approval.mjs <file>, or node approval.mjs answer <file>');
    const text = readFileSync(file, 'utf8');
    const found = mode === 'answer' ? answer(JSON.parse(text)) : null;
    if (found) console.log(json(found));
    const lacks = mode === 'check' ? missing(text) : [];
    for (const name of lacks) {
      if (name === FRONT) say('remove the front matter: its labels go on the command line');
      else if (name === 'Recommended') say('missing, unfilled or not starting with the label of the first option row, such as (a): Recommended');
      else say(`missing or unfilled: ${name}`);
    }
    if (mode === 'answer' ? found : !lacks.length) process.exitCode = 0;
  } catch (e) {
    say(e.message);
    // An answer that cannot be read is an error, not "no answer yet".
    if (mode === 'answer') process.exitCode = 2;
  }
}
