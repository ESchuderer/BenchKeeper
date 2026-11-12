// Usage: node approval.mjs <file>, the file in .benchkeeper/runs/ of the working directory (the run folder, approvals.md); any other path exits 2. Checks an approval or owner question against approval-template.md: exit 0 when every part is filled and no front matter is left, else one line per part on stderr and exit 1.
import { readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { isMain } from './policy.mjs';

const FRONT = 'Front matter';
// A placeholder starts with a letter, as the template's do: a URL autolink (<https://example.com/plan>) and a comparison (<5 sessions) are an answer.
const PLACEHOLDER = /<(?![a-z][a-z0-9+.-]*:\S)[a-z][^<>]*>/i;
// These leave the answer open, with or without punctuation or invisible characters around them; "none" is an answer, which the template offers for Owner steps.
const OPEN = /^[^\p{L}\p{N}]*(tbd|todo|n\/a)[^\p{L}\p{N}]*$/iu;
// What the owner sees of a cell: a closing tag, an entity and a link target show no text, and emphasis, strike and code marks are no text. HTML comments are gone before cells are read (missing).
const shown = (cell) => cell
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

// The path comes from a session's command line: a file that resolves outside the run folder, through .. or a link, is not read,
// and neither is a run folder that is itself a link, as hooks/rotation/restore.mjs refuses one.
const inRuns = (file) => { try { const real = realpathSync(file); return real.startsWith(join(realpathSync('.'), '.benchkeeper', 'runs') + sep) ? real : null; } catch { return null; } };

if (isMain(import.meta.url)) {
  // A path or a read error can hold control and format characters, which could rewrite the terminal line.
  const say = (message) => console.error(message.split('\n')[0].replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?'));
  process.exitCode = 1;
  try {
    if (process.argv.length !== 3) throw new Error('usage: node approval.mjs <file>');
    const file = inRuns(process.argv[2]);
    if (!file) { process.exitCode = 2; throw new Error(`refused: ${process.argv[2]} is no file in .benchkeeper/runs/ of the working directory`); }
    const lacks = missing(readFileSync(file, 'utf8'));
    for (const name of lacks) {
      if (name === FRONT) say('remove the front matter: its labels go on the command line');
      else if (name === 'Recommended') say('missing, unfilled or not starting with the label of the first option row, such as (a): Recommended');
      else say(`missing or unfilled: ${name}`);
    }
    if (!lacks.length) process.exitCode = 0;
  } catch (e) {
    say(e.message);
  }
}
