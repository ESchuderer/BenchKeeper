// Usage: node approval.mjs <file>. Checks an approval or owner question against approval-template.md: exit 0 when every part is filled, else one line per missing part on stderr and exit 1.
import { readFileSync } from 'node:fs';
import { isMain } from './policy.mjs';

const PLACEHOLDER = /<[^\s<>][^<>]*>/;
const filled = (cell) => Boolean(cell) && !PLACEHOLDER.test(cell);

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

// The names of the parts the text lacks: a part that is absent, empty or still holds a <...> placeholder.
export function missing(text) {
  const line = (label) => filled(new RegExp(`^${label}:(.*)$`, 'm').exec(text)?.[1].trim());
  const approval = new Map(table(text, 'Approval'));
  const options = table(text, 'Option');
  const chosen = options.filter(([option, happens]) => option && happens).length >= 2
    && options.some(([option]) => option.includes('(Recommended)'))
    && !options.flat().some((cell) => PLACEHOLDER.test(cell));
  return [
    ...(line('What') ? [] : ['What']),
    ...ROWS.filter((name) => !filled(approval.get(name))),
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
    for (const name of lacks) say(`missing or unfilled: ${name}`);
    if (!lacks.length) process.exitCode = 0;
  } catch (e) {
    say(e.message);
  }
}
