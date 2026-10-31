import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { context } from '../src/runner.mjs';
import { boardHtml } from '../src/board.mjs';
import { byRun, clearSessionCache, keepSessionsFor, MIGRATE, scanSessions, sessionCache, TEST } from '../src/sessions.mjs';
import { TITLE, writeActivitySessions, writePatternSessions, writeRunSessions, writeSessions } from './fixtures/sessions.mjs';

const fixture = (run = () => ({ code: 127, stdout: '', stderr: 'not installed' })) => {
  const home = mkdtempSync(join(tmpdir(), 'bk-sessions-'));
  writeSessions(home);
  const ctx = context({ home, run });
  // Global applies set the setup version of the sessions after them; project applies do not.
  const ledger = join(ctx.config, 'ledger');
  mkdirSync(ledger, { recursive: true });
  for (const [id, time, appVersion, scope] of [['a', '2026-10-19T00:00:00.000Z', '6.0.0', 'global'], ['b', '2026-10-21T10:30:00.000Z', '6.1.0', 'global'], ['c', '2026-10-20T09:00:00.000Z', '9.9.9', '/work/shop']]) {
    writeFileSync(join(ledger, `${id}.json`), JSON.stringify({ schema: 1, id, time, appVersion, kind: 'apply', scope, status: 'done', entries: [] }));
  }
  return { home, ctx };
};
const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));

test('Claude Code sessions: cost, time and tokens from the last cost-state, tier moves, skills, tests, setup, PRs', async () => {
  const { ctx } = fixture();
  const { s1, s2 } = byId(await scanSessions(ctx));
  assert.deepEqual(
    [s1.agent, s1.project, s1.branch, s1.agentVersion, s1.title, s1.start, s1.end, s1.turns, s1.costUSD, s1.busyMs, s1.tokens, s1.models],
    ['claude', '/work/shop', 'feat/cart', '2.1.300', TITLE, '2026-10-20T10:00:00.000Z', '2026-10-20T10:03:00.000Z', 2, 1.25, 90000, 1160, ['claude-sonnet-5-5']],
  );
  assert.deepEqual(s1.tier, { first: 'standard', last: 'full', changeType: 'bug, known cause', movedUp: true });
  // Skill calls (subagents too), slash commands and the skill a turn was attributed to.
  assert.deepEqual(s1.skills, ['designing-technical-uis', 'diagnosing-bugs', 'ponytail-review', 'tdd']);
  assert.equal(s1.tests, 'pass');
  assert.deepEqual(s1.setup, ['BenchKeeper', 'ponytail', 'matt-pocock', 'frontend']);
  assert.equal(s1.setupVersion, '6.0.0');
  assert.deepEqual(s1.prs, ['https://github.com/acme/shop/pull/7']);
  // No cost-state yet: no cost, tokens from each message once.
  assert.deepEqual([s2.costUSD, s2.busyMs, s2.tokens, s2.tests, s2.setup], [null, null, 115, null, null]);
  assert.deepEqual(s2.tier, { first: 'quick', last: 'quick', changeType: 'docs, typo', movedUp: false });
});

test('Codex sessions: tokens and skills of subagent rollouts go to the parent; compacted history is not read twice', async () => {
  const { ctx } = fixture();
  const rows = await scanSessions(ctx);
  assert.equal(rows.length, 3);
  const { c1 } = byId(rows);
  assert.deepEqual(
    [c1.agent, c1.project, c1.branch, c1.agentVersion, c1.models, c1.turns, c1.costUSD, c1.busyMs, c1.tokens, c1.tests, c1.setup, c1.setupVersion],
    ['codex', '/work/shop', 'main', '0.162.1', ['gpt-6-astra'], 1, null, 7000, 1300, 'pass', ['ponytail'], '6.1.0'],
  );
  assert.deepEqual(c1.tier, { first: 'quick', last: 'quick', changeType: null, movedUp: false });
  assert.deepEqual(c1.skills, ['diagnosing-bugs', 'grilling', 'tdd']);
});

test('pattern: single, loop, group and Orca worker; one value when several apply, the subagent count and the run id stay', async () => {
  const { home, ctx } = fixture();
  writePatternSessions(home);
  const rows = byId(await scanSessions(ctx));
  const got = (id) => [rows[id].pattern, rows[id].subagents, rows[id].run];
  assert.deepEqual(got('s1'), ['group', 1, null], 'a Claude subagent file makes a group');
  assert.deepEqual(got('s2'), ['single', 0, null]);
  assert.deepEqual(got('c1'), ['group', 2, null], 'Codex subagent rollouts at any depth');
  assert.deepEqual(got('p1'), ['loop', 0, null], 'a scheduled wakeup');
  assert.deepEqual(got('p2'), ['loop', 0, null], '/goal');
  assert.deepEqual(got('p6'), ['loop', 2, null], 'a loop with subagents is a loop');
  assert.deepEqual(got('p3'), ['Orca worker', 0, 'r-1.a'], 'a worker that loops is a worker; the run line names the run');
  assert.deepEqual(got('p4'), ['Orca worker', 0, null], 'the dispatch text after the user\'s own words');
  assert.deepEqual(got('p5'), ['single', 0, null], 'quoted text, in a later prompt or a tool result, marks no worker');
  assert.deepEqual(got('p7'), ['single', 0, null], 'one quoted line of the dispatch text in the first prompt marks no worker');
  assert.ok(rows.p2.skills.includes('goal'));
  assert.deepEqual(['p3', 'p4', 'p5', 's2'].map((id) => rows[id].task), ['task_1', 'task_1', null, null], 'the task id only from a worker\'s first prompt');
});

test('byRun: cost and tokens per run and per task from the run fixture; Codex adds tokens only; no worker text in a row or on the board', async () => {
  const MARK = 'PLANTED-WORKER-TEXT-4711';
  const { home, ctx } = fixture();
  writeRunSessions(home, '/work/app', MARK);
  const rows = await scanSessions(ctx);
  const codex = { agent: 'codex', run: 'r-9', task: 'task_c', costUSD: null, tokens: 500 };
  const [run, ...rest] = byRun([...rows, codex]);
  assert.deepEqual(rest, [], 'sessions without a run or task id are no run');
  assert.deepEqual([run.run, run.sessions, run.costUSD, run.tokens], ['r-9', 4, 2.25, 3 * 115 + 500]);
  assert.deepEqual(run.tasks.map((t) => [t.task, t.sessions, t.costUSD, t.tokens]), [['task_b', 1, 0.25, 115], ['task_a', 2, 2, 230], ['task_c', 1, null, 500]]);
  assert.ok(!JSON.stringify(rows).includes(MARK));
  assert.ok(!boardHtml(rows).includes(MARK));
  assert.match(boardHtml(rows), /"runs":\[\{"run":"r-9"/);
});

test('pattern: a cached summary from before it was read is parsed again; one whose transcript is gone stays and reads not recorded', async () => {
  const { home, ctx } = fixture();
  writePatternSessions(home);
  await scanSessions(ctx);
  const cache = join(home, '.cache/benchkeeper/sessions.json');
  const saved = JSON.parse(readFileSync(cache, 'utf8'));
  const old = (x) => { const { loop, orca, run, ...d } = x.d; return { ...x, key: x.key.replace(/:\d+$/, ''), d }; };
  const file = join(home, '.claude/projects/-work-app/p1.jsonl');
  saved.files[file] = old(saved.files[file]);
  const gone = join(home, '.claude/projects/-work-app/gone.jsonl');
  saved.files[gone] = old(saved.files[file]);
  writeFileSync(cache, JSON.stringify(saved));
  const rows = byId(await scanSessions(ctx));
  assert.equal(rows.p1.pattern, 'loop');
  assert.equal(rows.gone.pattern, null);
  assert.equal(rows.gone.subagents, 0);
  assert.match(boardHtml(Object.values(rows)), /not recorded/);
});

test('turns and usage limit waits: turn lines, task_complete, the gap fallback, merged errors, unresumed waits; an old summary reads not recorded', async () => {
  const { home, ctx } = fixture();
  writeActivitySessions(home);
  const rows = byId(await scanSessions(ctx));
  const S = Date.parse('2026-10-22T09:00:00.000Z') / 1000;
  assert.deepEqual(rows.t1.active, [[S, S + 1200], [S + 3300, S + 3600]]);
  assert.deepEqual(rows.t1.limits, [[S + 1800, S + 2700, S + 3600], [S + 5400, null, S + 6000]]);
  assert.deepEqual(rows.t2.active, [[S, S + 300], [S + 1500, S + 2100]]);
  assert.deepEqual(rows.t2.limits, [[S + 3600, null, null]]);
  assert.deepEqual([rows.x1.active, rows.x1.limits], [[[S + 60, S + 300], [S + 840, S + 900]], null]);
  // Cached before the fields were read, and the transcript gone since.
  const cache = join(home, '.cache/benchkeeper/sessions.json');
  const saved = JSON.parse(readFileSync(cache, 'utf8'));
  const file = join(home, '.claude/projects/-work-act/t1.jsonl');
  const { active, limits, ...d } = saved.files[file].d;
  saved.files[join(home, '.claude/projects/-work-act/gone.jsonl')] = { ...saved.files[file], key: 'old', d };
  writeFileSync(cache, JSON.stringify(saved));
  const again = byId(await scanSessions(ctx));
  assert.deepEqual([again.gone.active, again.gone.limits], [null, null]);
});

test('an unchanged file comes from the cache; a changed one is read again; since leaves out older sessions', async () => {
  const { home, ctx } = fixture();
  const file = join(home, '.claude/projects/-work-blog/s2.jsonl');
  const mtime = new Date('2026-10-21T10:00:00Z');
  utimesSync(file, mtime, mtime);
  await scanSessions(ctx);
  assert.ok(JSON.parse(readFileSync(join(home, '.cache/benchkeeper/sessions.json'), 'utf8')).files);
  const { size } = statSync(file);
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.replace('Tier: quick', 'Tier: full '));
  utimesSync(file, mtime, mtime);
  assert.equal(statSync(file).size, size);
  assert.equal(byId(await scanSessions(ctx)).s2.tier.first, 'quick');
  utimesSync(file, new Date(), new Date());
  assert.equal(byId(await scanSessions(ctx)).s2.tier.first, 'full');
  assert.deepEqual((await scanSessions(ctx, { since: '2026-10-21T00:00:00.000Z' })).map((r) => r.id).sort(), ['c1', 's2']);
});

const cacheFile = (home) => join(home, '.cache/benchkeeper/sessions.json');
const removeS1 = (home) => { rmSync(join(home, '.claude/projects/-work-shop/s1.jsonl')); rmSync(join(home, '.claude/projects/-work-shop/s1'), { recursive: true }); };

test('a transcript the agent deleted between two scans: its row, the board and the totals stay unchanged', async () => {
  const { home, ctx } = fixture();
  const before = await scanSessions(ctx);
  removeS1(home);
  const after = await scanSessions(ctx);
  assert.deepEqual(after, before);
  // Its subagent's skill stays on the row, the charts and totals are drawn from the same rows.
  assert.ok(after.find((r) => r.id === 's1').skills.includes('diagnosing-bugs'));
  assert.equal(boardHtml(after, '2026-10-25T00:00:00.000Z', []), boardHtml(before, '2026-10-25T00:00:00.000Z', []));
  assert.equal(sessionCache(ctx).sessions, 3);
});

test('a schema bump converts the cache: the summary of a deleted transcript is still listed', async () => {
  const { home, ctx } = fixture();
  const before = await scanSessions(ctx);
  removeS1(home);
  MIGRATE[1] = (x) => ({ ...x, files: Object.fromEntries(Object.entries(x.files).map(([f, v]) => [f, { ...v, moved: true }])) });
  try {
    const notes = [];
    assert.deepEqual(await scanSessions(ctx, { onNote: (n) => notes.push(n) }), before);
    assert.deepEqual(notes, []);
    const saved = JSON.parse(readFileSync(cacheFile(home), 'utf8'));
    assert.equal(saved.schema, 2);
    assert.ok(Object.values(saved.files).every((v) => v.moved));
  } finally { delete MIGRATE[1]; }
});

test('a cache file it cannot convert is moved aside with a note, not overwritten; a normal scan has no note', async () => {
  const { home, ctx } = fixture();
  const notes = [];
  await scanSessions(ctx, { onNote: (n) => notes.push(n) });
  assert.deepEqual(notes, []);
  for (const [i, text] of ['{"schema":99,"files":{"x":{}}}', 'not json'].entries()) {
    writeFileSync(cacheFile(home), text);
    await scanSessions(ctx, { onNote: (n) => notes.push(n) });
    assert.equal(notes.length, i + 1);
    assert.match(notes[i], /session cache .* unreadable or of an unknown version/);
    const aside = readdirSync(join(home, '.cache/benchkeeper')).filter((f) => /^sessions\.json\.\d+$/.test(f));
    assert.ok(aside.some((f) => readFileSync(join(home, '.cache/benchkeeper', f), 'utf8') === text), text);
    assert.equal(JSON.parse(readFileSync(cacheFile(home), 'utf8')).schema, 1);
  }
});

test('the cache file holds no message text and is readable by this user only', async () => {
  const { home, ctx } = fixture();
  await scanSessions(ctx);
  const text = readFileSync(cacheFile(home), 'utf8');
  for (const said of ['fix the cart total', 'it touches checkout too', 'Reading the code', 'Next the test', 'typo in the README', 'Looking at it', 'not ok 1', '3 passed']) assert.ok(!text.includes(said), said);
  if (process.platform !== 'win32') assert.equal(statSync(cacheFile(home)).mode & 0o777, 0o600);
});

test('retention drops the summaries of deleted transcripts after the days; Clear empties the cache and keeps the setting', async () => {
  const { home, ctx } = fixture();
  assert.deepEqual(sessionCache(ctx), { keepDays: null, sessions: 0 });
  await scanSessions(ctx);
  removeS1(home);
  keepSessionsFor(ctx, 3650);
  assert.ok(byId(await scanSessions(ctx)).s1);
  // The fixture sessions are older than a day: the deleted one goes, the ones still on disk stay.
  keepSessionsFor(ctx, 1);
  assert.deepEqual(Object.keys(byId(await scanSessions(ctx))).sort(), ['c1', 's2']);
  assert.deepEqual(sessionCache(ctx), { keepDays: 1, sessions: 2 });
  keepSessionsFor(ctx, null);
  assert.equal(sessionCache(ctx).keepDays, null);
  for (const bad of [0, -1, 1.5, '7', NaN, 3651]) assert.throws(() => keepSessionsFor(ctx, bad), /whole number/);
  keepSessionsFor(ctx, 9);
  clearSessionCache(ctx);
  assert.deepEqual(sessionCache(ctx), { keepDays: 9, sessions: 0 });
  assert.equal(Object.keys(byId(await scanSessions(ctx))).length, 2);
});

test('the cache count equals the board rows, also when a Codex parent has expired and its subagent rollout stays', async () => {
  const { home, ctx } = fixture();
  await scanSessions(ctx);
  removeS1(home);
  rmSync(join(home, '.codex/sessions/2026/10/21/rollout-2026-10-21T11-00-00-c1.jsonl'));
  keepSessionsFor(ctx, 1);
  const rows = await scanSessions(ctx);
  assert.deepEqual(rows.map((r) => r.id).sort(), ['c2', 's2']);
  assert.equal(sessionCache(ctx).sessions, rows.length);
});

test('Codex cost: estimated per model from the growth of the token totals, subagents added, unpriced models and old rollouts left out', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-sessions-'));
  const dir = join(home, '.codex/sessions/2026/10/22');
  mkdirSync(dir, { recursive: true });
  const at = '2026-10-22T10:00:00.000Z';
  const usage = (input_tokens, cached_input_tokens, output_tokens, cache_write_input_tokens, last = 1000) => ({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, total_tokens: input_tokens + output_tokens }, last_token_usage: { input_tokens: last } } } });
  const model = (m) => ({ timestamp: at, type: 'turn_context', payload: { model: m } });
  const rollout = (id, meta, lines) => writeFileSync(join(dir, `rollout-2026-10-22T10-00-00-${id}.jsonl`), [{ timestamp: at, type: 'session_meta', payload: { id, cwd: '/work/shop', model_provider: 'openai', ...meta } }, ...lines].map((l) => JSON.stringify(l)).join('\n'));
  rollout('two', {}, [
    model('gpt-5.6-terra'), usage(100_000, 40_000, 10_000, 20_000),
    // The same totals again: nothing added.
    usage(100_000, 40_000, 10_000, 20_000),
    // Growth under gpt-5.5: 50,000 input, 10,000 cached, 5,000 output.
    model('gpt-5.5'), usage(150_000, 50_000, 15_000, 20_000),
  ]);
  rollout('review', { parent_thread_id: 'two' }, [model('codex-auto-review'), usage(1_000_000, 0, 1000, 0)]);
  rollout('child', { parent_thread_id: 'two' }, [model('gpt-5.6-terra'), usage(10_000, 0, 0, 0)]);
  // Growth above 272K over several requests is short context; a last request above it is long context.
  rollout('long', {}, [model('gpt-6.1-terra'), usage(400_000, 0, 0, 0), usage(800_000, 0, 0, 0, 300_000)]);
  rollout('unpriced', {}, [model('gpt-daybreak-blue-latest'), usage(1000, 0, 10, 0)]);
  rollout('other', { model_provider: 'ollama' }, [model('gpt-5'), usage(1000, 0, 10, 0)]);
  rollout('old', {}, [model('gpt-5'), { timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 900 } } } }]);
  const rows = byId(await scanSessions(context({ home, run: () => ({ code: 127, stdout: '', stderr: '' }) })));
  // Per 1M tokens. gpt-5.6-terra: 40,000 input at $2, 40,000 cached at $0.20, 20,000 written at $2.50, 10,000 output at $12: 0.258.
  // gpt-5.5: 40,000 input at $5, 10,000 cached at $0.50, 5,000 output at $30: 0.355. The child's 10,000 input at $2: 0.02.
  assert.equal(rows.two.costUSD.toFixed(6), '0.633000');
  assert.equal(rows.two.costEstimated, true);
  assert.equal(rows.long.costUSD.toFixed(6), '1.200000', '400,000 input at $1, then 400,000 at the long-context $2');
  for (const id of ['unpriced', 'other', 'old']) assert.deepEqual([id, rows[id].costUSD, rows[id].costEstimated], [id, null, false]);
});

test('tests: a test command counts in command position only, not echoed or quoted in another command', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-sessions-'));
  const dir = join(home, '.codex/sessions/2026/10/22');
  mkdirSync(dir, { recursive: true });
  const rollout = (id, commands) => writeFileSync(join(dir, `rollout-2026-10-22T10-00-00-${id}.jsonl`), [
    { timestamp: '2026-10-22T10:00:00.000Z', type: 'session_meta', payload: { id, cwd: '/work/shop' } },
    ...commands.map(([command, code]) => ({ timestamp: '2026-10-22T10:00:01.000Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'CommandExecution', command: ['/usr/bin/bash', '-lc', command], exit_code: String(code) } } })),
  ].map((l) => JSON.stringify(l)).join('\n'));
  rollout('echoed', [['npm test', 1], ["echo 'playwright test'", 0], ['git commit -m "fix: npm test"', 0]]);
  rollout('chained', [['npm test', 1], ['cd app && CI=1 npx vitest run', 0]]);
  const rows = byId(await scanSessions(context({ home, run: () => ({ code: 127, stdout: '', stderr: '' }) })));
  assert.deepEqual([rows.echoed.tests, rows.chained.tests], ['fail', 'pass']);
});

test('tests: a long chain of variable assignments is matched in linear time, quoted values too', () => {
  const start = performance.now();
  assert.equal(TEST.test(';a=b'.repeat(20000)), false);
  assert.equal(TEST.test(';a="b"'.repeat(20000)), false);
  assert.equal(TEST.test(`sh -c${' '.repeat(50000)}x`), false);
  assert.ok(performance.now() - start < 200);
  assert.equal(TEST.test(`${';a=b'.repeat(20000)};A=1 B=2 npm test`), true);
  assert.equal(TEST.test(`NODE_OPTIONS="--trace-warnings --no-deprecation" A='x y' npm test`), true);
  assert.deepEqual(['sh -c npm test', "bash -lc  'npm test'", 'sh -c " npm test"'].map((c) => TEST.test(c)), [true, true, true]);
});
