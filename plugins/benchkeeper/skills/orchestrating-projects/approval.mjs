// Usage: node approval.mjs <file>. Checks an approval or owner question against approval-template.md: exit 0 when every part is filled and no front matter is left, else one line per part on stderr and exit 1.
import { readFileSync } from 'node:fs';
import { isMain } from './policy.mjs';

const FRONT = 'Front matter';
// A placeholder starts with a letter, as the template's do: a URL autolink (<https://example.com/plan>) and a comparison (<5 sessions) are an answer.
const PLACEHOLDER = /<(?![a-z][a-z0-9+.-]*:\S)[a-z][^<>]*>/i;
// These leave the answer open; "none" is an answer, which the template offers for Owner steps.
const OPEN = /^(tbd|n\/a)$/i;
const filled = (cell = '') => /[\p{L}\p{N}]/u.test(cell) && !OPEN.test(cell) && !PLACEHOLDER.test(cell);

// A table row's cells, or null for a line that is no row. \| is a pipe inside a cell.
const cells = (line) => /^\s*\|(.*)\|\s*$/.exec(line)?.[1].split(/(?<!\\)\|/).map((cell) => cell.trim()) ?? null;

// The rows below the header whose first cell is head, up to the first line that is no row.
function table(text, head) {
  const lines = text.split(/\r?\n/).map(cells);
  const start = lines.findIndex((row) => row?.[0] === head);
  if (start < 0) return [];
  const end = lines.findIndex((row, i) => i > start && !row);
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
}

// The template is the one list of the Approval rows: a row added there is checked here.
const ROWS = table(readFileSync(new URL('./approval-template.md', import.meta.url), 'utf8'), 'Approval').map(([name]) => name);
// With no row to look for, every approval would pass.
if (!ROWS.length) throw new Error('approval-template.md holds no Approval table');

// The names of the parts that keep the text from being posted: a part that is absent, empty or still holds a <...> placeholder, and front matter left in.
export function missing(text) {
  const line = (label) => filled(new RegExp(`^${label}:(.*)$`, 'm').exec(text)?.[1].trim());
  const approval = table(text, 'Approval');
  // The owner may read either occurrence of a row that is there twice.
  const row = (name) => { const found = approval.filter(([first]) => first === name); return found.length > 0 && found.every(([, cell]) => filled(cell)); };
  const options = table(text, 'Option');
  // The questions skill offers the recommended option first; the Trade-off cell may stay empty.
  const chosen = options.length >= 2
    && options.every(([option, happens], i) => filled(option) && filled(happens) && option.includes('(Recommended)') === (i === 0))
    && !options.flat().some((cell) => PLACEHOLDER.test(cell));
  return [
    // Posted with the body, the front matter would show as text: its labels go on the command line.
    ...(/^\s*---[ \t]*(\r?\n|$)/.test(text) ? [FRONT] : []),
    ...(line('What') ? [] : ['What']),
    ...ROWS.filter((name) => !row(name)),
    ...(chosen ? [] : ['Options']),
    ...(line('Why now') ? [] : ['Why now']),
  ];
}

if (isMain(import.meta.url)) {
  // A path or a read error can hold control and format characters, which could rewrite the terminal line.
  const say = (message) => console.error(message.split('\n')[0].replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '?'));
  process.exitCode = 1;
  try {
    if (process.argv.length !== 3) throw new Error('usage: node approval.mjs <file>');
    const lacks = missing(readFileSync(process.argv[2], 'utf8'));
    for (const name of lacks) say(name === FRONT ? 'remove the front matter: its labels go on the command line' : `missing or unfilled: ${name}`);
    if (!lacks.length) process.exitCode = 0;
  } catch (e) {
    say(e.message);
  }
}
