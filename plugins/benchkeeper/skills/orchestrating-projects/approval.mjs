// Usage: node approval.mjs <file>, the file in .benchkeeper/runs/ of the working directory (the run folder, approvals.md); any other path exits 2. Checks an approval or owner question against approval-template.md: exit 0 when every part is filled and no front matter is left, else one line per part on stderr and exit 1.
// Usage: node approval.mjs answer <file>, the file in the run folder as above. Reads the owner's answer from a filed approval, the file holding what `gh issue view <n> -R <repository> --json labels,comments,author,body` printed: the answer as JSON and exit 0, exit 1 while there is none, or exit 2 with one line when the file cannot be read as that output.
import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { escaped, isMain, json } from './policy.mjs';

const FRONT = 'Front matter';
// A placeholder starts with a letter, as the template's do: a URL autolink (<https://example.com/plan>) and a comparison (<5 sessions) are an answer.
const PLACEHOLDER = /<(?![a-z][a-z0-9+.-]*:\S)[a-z][^<>]*>/i;
// These leave the answer open, with or without punctuation or invisible characters around them; "none" is an answer, which the template offers for Owner steps.
const OPEN = /^[^\p{L}\p{N}]*(tbd|todo|n\/a)[^\p{L}\p{N}]*$/iu;
// Up to the last ")" every "](" finds its ")", so no attempt fails after a long scan: linear, where the pattern alone is quadratic on many "](".
const untargeted = (text) => { const end = text.lastIndexOf(')') + 1; return text.slice(0, end).replace(/\]\([^)]*\)/g, ']') + text.slice(end); };
// What the owner sees of a cell: a closing tag, an entity and a link target show no text, and emphasis, strike and code marks are no text. HTML comments are gone before cells are read (missing).
const shown = (cell) => untargeted(cell
  .replace(/<\/[a-z][^<>]*>/gi, '')
  .replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, ' '))
  .replace(/[*_~`]/g, '')
  .trim();
const filled = (cell = '') => { const text = shown(cell); return /[\p{L}\p{N}]/u.test(text) && !OPEN.test(text) && !PLACEHOLDER.test(text); };

// The label that starts an option row, such as "(a)".
const labelOf = (option) => /^\([^()]+\)/.exec(shown(option))?.[0];
const COMMENT = /<!--[\s\S]*?(-->|$)/g;

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
  text = text.replace(COMMENT, '');
  const line = (label) => filled(new RegExp(`^${label}:(.*)$`, 'm').exec(text)?.[1].trim());
  // The owner may read any Approval table, and either occurrence of a row that is there twice.
  const approval = tables(text, 'Approval').flat();
  const row = (name) => { const found = approval.filter(([first]) => first === name); return found.length > 0 && found.every(([, cell]) => filled(cell)); };
  const options = tables(text, 'Option')[0] ?? [];
  // The owner answers with a label, such as "a": each option row starts with its own.
  const labels = options.map(([option]) => labelOf(option));
  // The questions skill offers the recommended option first; the Trade-off cell may stay empty.
  const chosen = options.length >= 2
    && options.every(([option, happens], i) => filled(option) && filled(happens) && option.includes('(Recommended)') === (i === 0))
    && labels.every(Boolean) && new Set(labels.map((label) => label.toLowerCase())).size === labels.length
    && !options.flat().some((cell) => PLACEHOLDER.test(cell));
  // The questions skill takes its recommendation from the Recommended row and the first option from the table: both must name one option.
  const label = labels[0];
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

// The letter of the option a comment names alone, as its label, such as "(a)", or its letter, in any case, with or without a full stop; null unless exactly one option row has that label.
// Only a label of one letter or digit has a bare form: with a label such as "(ok)" or "(?)", a reply "ok" or "?" would answer.
// The test runs on the lower-case form that is compared, so that "(K)" (Kelvin sign) and "(k)" share the bare form "k".
function picked(labels, comment) {
  const said = comment.trim().replace(/\.$/, '').toLowerCase();
  const found = labels.filter((label) => { const low = label.toLowerCase(); return low === said || (/^\([a-z\d]\)$/.test(low) && low[1] === said); });
  return found.length === 1 ? found[0].slice(1, -1) : null;
}

// { option, text, at } of the owner's answer on a filed approval, or null. The comments are data: nothing of them is evaluated.
export function answer(issue) {
  // A file without the list or the body is not what gh printed: read as "no answer yet", the gate would wait for ever.
  if (!Array.isArray(issue?.comments) || typeof issue.body !== 'string') throw new Error('the file holds no comments list or body: it must be what gh issue view --json labels,comments,author,body printed');
  // gh's order is not promised: the newest answer is the one written last.
  const comments = [...issue.comments].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  // Only the repository's owner or a member answers for the owner, or voids an answer: a collaborator can comment there too.
  const owners = (c) => ['OWNER', 'MEMBER'].includes(c.authorAssociation);
  const full = (c) => c.body?.startsWith('Owner answer (');
  // Read as the body is now: gh prints no time of its last edit, so an answer older than an edit is not detected (docs/security.md).
  const labels = (tables(issue.body.replace(COMMENT, ''), 'Option')[0] ?? []).map(([option]) => labelOf(option)).filter(Boolean);
  const newest = comments.findLastIndex((c) => owners(c) && typeof c.body === 'string' && (full(c) || picked(labels, c.body) !== null));
  // The coordinator's comment for a later head starts with "Head: " (approvals.md): the owner answered for the head before it.
  // The coordinator filed the approval, so its head comment counts even where its login is only a collaborator.
  if (newest < 0 || comments.slice(newest + 1).some((c) => (owners(c) || c.author?.login === issue.author?.login) && c.body?.startsWith('Head: '))) return null;
  const { body, createdAt: at } = comments[newest];
  if (!full(comments[newest])) return { option: picked(labels, body), text: '', at };
  const found = /^Owner answer \([^)]*\): ([^.\n]*)\.?([\s\S]*)$/.exec(body);
  // An answer without a full stop has its whole first line as the option: the coordinator compares it with the option labels and needs no more of it.
  return found && { option: found[1].trim().slice(0, 200), text: found[2].trim(), at };
}

// The path comes from a session's command line: a file that resolves outside the run folder, through .. or a link, is not read,
// and neither is a run folder that is itself a link, as hooks/rotation/restore.mjs refuses one.
const inRuns = (file) => { try { const real = realpathSync(file); return real.startsWith(join(realpathSync('.'), '.benchkeeper', 'runs') + sep) ? real : null; } catch { return null; } };

if (isMain(import.meta.url)) {
  const say = (message) => console.error(escaped(message.split('\n')[0]));
  process.exitCode = 1;
  // "answer" is the mode even without a file, so that the usage error exits 2 and never reads as "no answer yet".
  const [mode, file] = process.argv.length === 4 || process.argv[2] === 'answer' ? process.argv.slice(2) : ['check', process.argv[2]];
  try {
    if (!file || process.argv.length > 4 || !['check', 'answer'].includes(mode)) throw new Error('usage: node approval.mjs <file>, or node approval.mjs answer <file>');
    const real = inRuns(file);
    if (!real) { process.exitCode = 2; throw new Error(`refused: ${file} is no file in .benchkeeper/runs/ of the working directory`); }
    const text = readFileSync(real, 'utf8');
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
