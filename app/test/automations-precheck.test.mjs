import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { genericDir, load } from '../src/automations.mjs';
import { main } from '../src/cli.mjs';
import { context } from '../src/runner.mjs';

const ctx = () => context({ home: mkdtempSync(join(tmpdir(), 'bk-pre-')) });

test('the generic templates carry their own precheck: no built-in automations precheck, no issue pickup or pr watcher', () => {
  const { templates, errors } = load(ctx(), [['generic', genericDir]]);
  assert.deepEqual(errors, []);
  const ids = templates.map((t) => t.id);
  assert.ok(ids.includes('issue-triage'));
  for (const id of ['issue-pickup', 'pr-watcher']) assert.ok(!ids.includes(id), id);
  for (const t of templates) assert.doesNotMatch(t.precheck, /automations precheck/, t.id);
});

test('automations precheck is not a command: exit 2 with the subcommands', async () => {
  const lines = [];
  const cli = (argv) => main(argv, { out: { write: (s) => { lines.push(s); } }, err: { write: () => {} }, ctx: ctx() });
  assert.equal(await cli(['automations', 'precheck']), 2);
  assert.equal(lines.pop(), 'automations needs list, show, install, update, remove, diff or status\n');
  assert.equal(await cli(['automations', 'precheck', 'pr-watcher', '--json']), 2);
  assert.match(JSON.parse(lines.pop()).error, /unexpected argument pr-watcher/);
  assert.equal(await cli(['automations', 'list', '--param', 'a=b']), 2);
  assert.equal(lines.pop(), '--param does not belong to automations list\n');
});
