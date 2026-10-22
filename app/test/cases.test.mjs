import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { addCase, firstPrompt, loadCases } from '../src/cases.mjs';
import { main } from '../src/cli.mjs';
import { context, undo } from '../src/runner.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), p));

test('first prompt from Claude Code and Codex transcripts', () => {
  const d = tmp('bk-tr-');
  writeFileSync(join(d, 'c.jsonl'), [JSON.stringify({ type: 'summary' }), JSON.stringify({ type: 'user', message: { content: 'fix the login bug' } })].join('\n'));
  writeFileSync(join(d, 'x.jsonl'), [
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' }] } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'add a README' }] } }),
  ].join('\n'));
  assert.equal(firstPrompt(join(d, 'c.jsonl')), 'fix the login bug');
  assert.equal(firstPrompt(join(d, 'x.jsonl')), 'add a README');
});

test('a case from a recorded session links project and run; history shows it; undo removes it', async () => {
  const ctx = context({ home: tmp('bk-case-') });
  const project = tmp('bk-case-proj-');
  const tr = join(ctx.home, 't.jsonl');
  writeFileSync(tr, JSON.stringify({ type: 'user', message: { content: 'rename the config flag' } }));
  mkdirSync(join(ctx.config, 'ledger'), { recursive: true });
  const session = { schema: 1, id: '20261022T100000Z-abcd', kind: 'session', scope: project, status: 'done', entries: [{ id: 'session', transcript: tr, status: 'done' }] };
  writeFileSync(join(ctx.config, 'ledger', `${session.id}.json`), JSON.stringify(session));
  let text = '';
  const out = new Writable({ write(c, _, done) { text += c; done(); } });
  assert.equal(await main(['case', 'add', '--run', session.id, '--target', 'skill:workflow', '--expected', 'the workflow skill loads before the first edit'], { out, ctx }), 0);
  const [c] = loadCases(ctx)['skill:workflow'].filter((x) => x.source?.run);
  assert.deepEqual([c.query, c.should, c.source.project, c.source.transcript], ['rename the config flag', true, project, tr]);
  await main(['history'], { out, ctx });
  const run = text.match(/undo with benchkeeper undo (\S+)/)[1];
  assert.match(text, new RegExp(`${run}  apply +done .*eval case ${c.id} for skill:workflow, from ${session.id}`));
  assert.match(text, /a miss: benchkeeper case add --run 20261022T100000Z-abcd/);
  undo(run, ctx);
  assert.equal(existsSync(c.file), false);
});

test('cases need a valid target, an expectation and a query source', () => {
  const ctx = context({ home: tmp('bk-case-') });
  assert.throws(() => addCase(ctx, { target: 'skill:../x', expected: 'e', query: 'q' }), /target/);
  assert.throws(() => addCase(ctx, { target: 'rule:global', query: 'q' }), /expected/);
  assert.throws(() => addCase(ctx, { target: 'rule:global', expected: 'e' }), /query/);
  const r = addCase(ctx, { target: 'rule:global', expected: 'asks before merging', should: true, description: 'merged a PR without asking' });
  assert.equal(r.case.query, 'merged a PR without asking');
  assert.equal(addCase(ctx, { target: 'rule:global', expected: 'x', should: false, query: 'q2' }).path, r.path);
  assert.equal(loadCases(ctx)['rule:global'].filter((x) => x.file === r.path).length, 2);
});
