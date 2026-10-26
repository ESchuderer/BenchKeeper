import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { HELP } from '../src/cli.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const REASONS = ['UI internal', 'gap #319', 'gap #320'];

// Routes come from the server source: the api table, and the page routes the request handler answers itself.
const source = read('../src/server.mjs');
const routes = [
  ...[...source.matchAll(/^ {4}'((?:GET|POST) \/[^']*)':/gm)].map((m) => m[1]),
  ...[...source.matchAll(/req\.method === '(GET|POST)' && url\.pathname === '(\/[^']*)'/g)].map((m) => `${m[1]} ${m[2]}`),
];
const section = read('../README.md').split(/^### Routes and commands$/m)[1]?.split(/^#{1,3} /m)[0] ?? '';
const rows = [...section.matchAll(/^\| `((?:GET|POST) [^`]+)` \| ([^|]+) \|/gm)].map((m) => ({ route: m[1], cell: m[2].trim() }));
// Help text per command word: its own lines and the indented ones below, so a subcommand or flag is looked up in its command's block.
const blocks = new Map();
for (const [, word, rest] of HELP.matchAll(/^ {2}([a-z][a-z-]*)(.*(?:\n {3,}.*)*)/gm)) blocks.set(word, `${blocks.get(word) ?? ''}${rest}\n`);
const known = (c) => { const [word, ...rest] = c.split(' '); return blocks.has(word) && rest.every((t) => new RegExp(`(?<![\\w-])${t}(?![\\w-])`).test(blocks.get(word))); };

test('the route table lists exactly the routes of server.mjs', () => {
  assert.ok(routes.length > 40, `found ${routes.length} routes: the pattern no longer matches server.mjs`);
  const listed = rows.map((r) => r.route);
  assert.deepEqual(routes.filter((r) => !listed.includes(r)), [], 'routes missing from the table in app/README.md');
  assert.deepEqual(listed.filter((r) => !routes.includes(r)), [], 'table rows without a route in server.mjs');
  assert.equal(new Set(listed).size, listed.length, 'a route is listed twice');
});

test('each row names commands of the CLI or one reason', () => {
  for (const { route, cell } of rows) {
    const items = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(items.length && cell.replaceAll(/`[^`]+`|, /g, '') === '', `${route}: the cell is a list of code spans`);
    if (REASONS.includes(items[0])) assert.equal(items.length, 1, `${route}: one reason, nothing else`);
    else for (const c of items) assert.ok(known(c), `${route}: "${c}" is not a command in help`);
  }
});
