import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { context } from '../src/runner.mjs';
import { boardHtml } from '../src/board.mjs';
import { clearSessionCache, keepSessionsFor, prStates, scanSessions, sessionCache } from '../src/sessions.mjs';
import { TITLE, writeSessions } from './fixtures/sessions.mjs';

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
  assert.deepEqual(s1.setup, ['BenchKeeper', 'Matt Pocock', 'Ponytail', 'frontend']);
  assert.equal(s1.setupVersion, '6.0.0');
  assert.deepEqual(s1.prs, [{ url: 'https://github.com/acme/shop/pull/7', state: 'unknown' }]);
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
    ['codex', '/work/shop', 'main', '0.162.1', ['gpt-6-astra'], 1, null, 7000, 1300, 'pass', ['Ponytail'], '6.1.0'],
  );
  assert.deepEqual(c1.tier, { first: 'quick', last: 'quick', changeType: null, movedUp: false });
  assert.deepEqual(c1.skills, ['diagnosing-bugs', 'grilling', 'tdd']);
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

test('PR states: merged is kept, open is asked again after 6 hours, closed after a day, a failed lookup after 10 minutes', async () => {
  const calls = [];
  let answer = { state: 'OPEN' };
  const { ctx } = fixture((argv) => { calls.push(argv); return answer ? { code: 0, stdout: JSON.stringify(answer), stderr: '' } : { code: 127, stdout: '', stderr: 'not installed' }; });
  const a = 'https://github.com/acme/shop/pull/7', b = 'https://github.com/acme/shop/pull/8';
  const t0 = Date.parse('2026-10-22T00:00:00Z');
  assert.deepEqual(await prStates(ctx, [a], t0), { [a]: 'open' });
  assert.deepEqual(calls[0], ['gh', 'pr', 'view', a, '--json', 'state']);
  await prStates(ctx, [a], t0 + 5 * 3600e3);
  assert.equal(calls.length, 1);
  answer = { state: 'MERGED' };
  assert.deepEqual(await prStates(ctx, [a], t0 + 7 * 3600e3), { [a]: 'merged' });
  answer = null;
  assert.deepEqual(await prStates(ctx, [a, b, '--help', 'https://github.com/acme/shop/pull/9;rm'], t0 + 1e9), { [a]: 'merged', [b]: 'unknown', '--help': 'unknown', 'https://github.com/acme/shop/pull/9;rm': 'unknown' });
  assert.equal(calls.length, 3);
  await prStates(ctx, [b], t0 + 1e9 + 300e3);
  assert.equal(calls.length, 3);
  answer = { state: 'CLOSED' };
  assert.deepEqual(await prStates(ctx, [b], t0 + 1e9 + 700e3), { [b]: 'closed' });
  // Reopened and merged since: a closed state is asked again after a day.
  answer = { state: 'MERGED' };
  assert.deepEqual(await prStates(ctx, [b], t0 + 1e9 + 700e3 + 23 * 3600e3), { [b]: 'closed' });
  assert.deepEqual(await prStates(ctx, [b], t0 + 1e9 + 700e3 + 25 * 3600e3), { [b]: 'merged' });
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
