// Ponytail is optional: its band and ledger are handled only when its files are there. Every path is below a temporary home.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { boardHtml } from '../src/board.mjs';
import { doctor } from '../src/doctor.mjs';
import { bandStacks, parseCsv, readLedger } from '../src/ponytail.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { scanSessions } from '../src/sessions.mjs';
import { globalPlan } from '../src/steps/global.mjs';
import { writeSessions } from './fixtures/sessions.mjs';

const run = (argv) => ({ code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' });
const HEADER = 'key,started,project,name,cost_usd,turns,agent_minutes,tokens_total,tokens_output,reuse_pct,reused,new,callers_open,tests,level,model';
const FLAG = '.claude/.ponytail-band';
const CONFIG = '.config/ponytail/config.json';

function machine({ band = true, ponytail = true, benchkeeper = true, flag } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bk-pony-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { ...(ponytail ? { 'ponytail@ponytail': true } : {}), ...(benchkeeper ? { 'benchkeeper@benchkeeper': true } : {}) }, pluginConfigs: { 'benchkeeper@benchkeeper': { options: { tierBand: band } } } }));
  if (flag) writeFileSync(join(home, FLAG), flag);
  return context({ home, run });
}
const bandPlan = (ctx) => preview(globalPlan({ ctx, agents: ['claude'], options: { level: 'lite' } })).filter((c) => c.step === 'settings:ponytail:band');

test('two bands: doctor warns, the plan hides both with a diff, nothing changes unplanned, undo restores', () => {
  const ctx = machine();
  mkdirSync(join(ctx.home, '.config/ponytail'), { recursive: true });
  writeFileSync(join(ctx.home, CONFIG), '{\n  "defaultMode": "full"\n}\n');
  const found = doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'ponytail');
  assert.equal(found.length, 1);
  assert.match(found[0].message, /\.ponytail-band/);
  assert.match(found[0].message, /hideStatus/);
  assert.match(found[0].fix, /^benchkeeper apply/);
  // Offered, never preselected: no plan applied, no change.
  const plan = bandPlan(ctx);
  assert.equal(plan.length, 2);
  assert.ok(plan.every((c) => c.selected === false && c.optional && c.diff));
  assert.equal(apply(plan, ctx, { scope: 'global', select: [] }).entries.length, 0);
  assert.equal(existsSync(join(ctx.home, FLAG)), false);
  // The two go together or not at all.
  assert.throws(() => apply(plan, ctx, { scope: 'global', select: [plan[0].id] }), /go together/);
  const done = apply(plan, ctx, { scope: 'global', select: plan.map((c) => c.id) });
  assert.equal(readFileSync(join(ctx.home, FLAG), 'utf8'), 'off');
  assert.deepEqual(JSON.parse(readFileSync(join(ctx.home, CONFIG), 'utf8')), { defaultMode: 'full', hideStatus: true });
  assert.deepEqual(doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => i.check === 'ponytail'), []);
  undo(done.id, ctx);
  assert.equal(existsSync(join(ctx.home, FLAG)), false);
  assert.equal(readFileSync(join(ctx.home, CONFIG), 'utf8'), '{\n  "defaultMode": "full"\n}\n');
  assert.equal(bandStacks(ctx), true);
});

test('two bands: no finding and no step without Ponytail, without the tier band, or with Ponytail\'s band already off', () => {
  for (const m of [machine({ ponytail: false }), machine({ band: false }), machine({ benchkeeper: false }), machine({ flag: 'off\n' })]) {
    assert.deepEqual(doctor(m, { agents: ['claude'], env: {} }).filter((i) => i.check === 'ponytail'), []);
    assert.deepEqual(bandPlan(m), []);
  }
  // Codex alone has no Claude Code band.
  assert.deepEqual(doctor(machine(), { agents: ['codex'], env: {} }).filter((i) => i.check === 'ponytail'), []);
  assert.deepEqual(preview(globalPlan({ ctx: machine(), agents: ['codex'], options: { level: 'lite' } })).filter((c) => c.step === 'settings:ponytail:band'), []);
  // A settings file that does not parse is not a finding.
  const broken = machine();
  writeFileSync(join(broken.home, '.claude/settings.json'), '{ nope');
  assert.equal(bandStacks(broken), false);
});

test('two bands: a config Ponytail keeps that cannot be read fails the plan, and the flag file is not written alone', () => {
  const ctx = machine();
  mkdirSync(join(ctx.home, CONFIG), { recursive: true }); // there, but not readable as a file
  const plan = bandPlan(ctx);
  assert.ok(plan.some((c) => c.error) && plan.every((c) => c.selected === false));
  assert.throws(() => apply(plan, ctx, { scope: 'global', select: plan.map((c) => c.id) }), /go together/);
  assert.equal(existsSync(join(ctx.home, FLAG)), false);
});

test('csv: quoted commas, quotes and line breaks stay in their field', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, ""y""\nz",2\n\nlast,'), [['a', 'b'], ['x, "y"\nz', '2'], ['last', '']]);
  assert.deepEqual(parseCsv(''), []);
});

const ledgerFile = (ctx, name, text) => {
  mkdirSync(join(ctx.home, '.config/ponytail/band'), { recursive: true });
  writeFileSync(join(ctx.home, '.config/ponytail/band', name), text);
};
const MARKER_NAME = 'PLANTED-TASK-NAME', MARKER_TEXT = 'PLANTED-MESSAGE-TEXT';

test('ledger: a session in the transcripts and the ledger counts once; ledger-only rows are named; malformed input is skipped with a note; no name reaches the page', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bk-pony-board-'));
  writeSessions(home);
  const id = '2d7d8887-1111-4222-8333-444455556666';
  const dir = join(home, '.claude/projects/-work-blog');
  writeFileSync(join(dir, `${id}.jsonl`), `${[
    { type: 'user', origin: { kind: 'human' }, cwd: '/work/blog', gitBranch: 'main', sessionId: id, timestamp: '2026-10-22T09:00:00.000Z', message: { role: 'user', content: MARKER_TEXT } },
    { type: 'cost-state', totalCostUSD: 3, totalAPIDuration: 60000, totalToolDuration: 0, modelUsage: {} },
  ].map((l) => JSON.stringify(l)).join('\n')}\n`);
  const ctx = context({ home });
  ledgerFile(ctx, 'blog.csv', [
    HEADER,
    `2d7d8887-1793059689621,2026-10-22 09:00,blog,"${MARKER_NAME}, with ""quotes""",2.32,4,8.7,100,10,8,3,37,0,passed,full,`,
    // A second task of the same session adds up; the later tests value wins.
    `2d7d8887-1793059789621,2026-10-22 09:05,blog,x,1.00,1,1.3,10,1,,,,,failed,full,`,
    // Only in the ledger: its transcript is not on this machine.
    `aaaaaaaa-1793159689621,2026-10-23 09:00,shop,${MARKER_NAME},0.50,2,3.0,50,5,,0,0,0,not run,lite,claude-sonnet-5-5`,
    'not-a-key,2026-10-23 09:00,shop,x,1,1,1,1,1,,0,0,0,passed,full,',
    'short,row',
  ].join('\n'));
  ledgerFile(ctx, 'broken.csv', 'this,is,not\na,ponytail,ledger\n');
  ledgerFile(ctx, 'other.txt', 'ignored');
  const notes = [];
  const before = await scanSessions(ctx);
  const rows = await scanSessions(ctx, { ledger: true, onNote: (n) => notes.push(n) });
  assert.equal(rows.length, before.length + 1, 'the matched session adds no row');
  assert.equal(rows.filter((r) => r.id === id).length, 1);
  const matched = rows.find((r) => r.id === id);
  assert.equal(matched.source, 'transcript and Ponytail ledger');
  assert.equal(matched.costUSD, 3, 'the transcript keeps its own figures');
  assert.deepEqual(matched.ponytail, { costUSD: 3.32, turns: 5, agentMinutes: 10, reusePct: 8, tests: 'fail', level: 'full' });
  const only = rows.find((r) => r.source === 'Ponytail ledger only');
  assert.deepEqual([only.project, only.start, only.costUSD, only.busyMs, only.tokens, only.tests, only.models, only.tier, only.prs], ['shop', '2026-10-28T03:54:49.621Z', 0.5, 180000, 50, null, ['claude-sonnet-5-5'], null, []]);
  assert.ok(rows.filter((r) => r.id !== id && r !== only).every((r) => r.source === 'transcript' && !r.ponytail));
  assert.deepEqual(notes, ['Ponytail ledger blog.csv: 2 malformed rows skipped', 'Ponytail ledger broken.csv skipped: not a Ponytail ledger']);
  // Without the option the scan is what it was.
  assert.ok(before.every((r) => r.source === undefined && r.ponytail === undefined));
  assert.equal((await scanSessions(ctx, { ledger: true, since: '2026-10-29' })).some((r) => r.source === 'Ponytail ledger only'), false);
  // Neither a task name nor message text is on the page or in the rows.
  const page = boardHtml(rows, '2026-10-30T00:00:00.000Z');
  assert.ok(!page.includes(MARKER_NAME) && !page.includes(MARKER_TEXT));
  assert.ok(!JSON.stringify(readLedger(ctx)).includes(MARKER_NAME));
});

test('ledger: the reuse share of a session is computed from its summed counts', () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-pony-reuse-')) });
  ledgerFile(ctx, 'a.csv', [
    HEADER,
    `2d7d8887-1793059689621,2026-10-22 09:00,blog,a,1,1,1,1,1,0,0,10,0,passed,full,`,
    `2d7d8887-1793059789621,2026-10-22 09:05,blog,b,1,1,1,1,1,100,10,0,0,passed,full,`,
  ].join('\n'));
  assert.deepEqual(readLedger(ctx).rows.map((r) => r.reusePct), [50]);
});

test('ledger: nothing without Ponytail\'s folder, and a file over the limit is skipped', () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-pony-none-')) });
  assert.deepEqual(readLedger(ctx), { rows: [], notes: [] });
  ledgerFile(ctx, 'big.csv', `${HEADER}\n${'x'.repeat(9 * 1024 * 1024)}`);
  assert.deepEqual(readLedger(ctx), { rows: [], notes: ['Ponytail ledger big.csv skipped: larger than 8 MB'] });
});

test('ledger: the newest task by start gives project, tests, level and model, whatever the file order', () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-pony-newest-')) });
  ledgerFile(ctx, 'a.csv', [
    HEADER,
    `2d7d8887-1793059789621,2026-10-22 09:05,newer,b,1,1,1,1,1,,,,0,,lite,m2`,
    `2d7d8887-1793059689621,2026-10-22 09:00,older,a,1,1,1,1,1,,,,0,passed,full,m1`,
  ].join('\n'));
  const [row] = readLedger(ctx).rows;
  assert.deepEqual([row.project, row.tests, row.level, row.model, row.startedMs, row.turns], ['newer', null, 'lite', 'm2', 1793059689621, 2]);
});

test('ledger: a task that starts between two earlier ones is not the newest', () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-pony-three-')) });
  ledgerFile(ctx, 'a.csv', [
    HEADER,
    `2d7d8887-1793059789621,2026-10-22 09:05,newest,c,1,1,1,1,1,,,,0,,lite,m3`,
    `2d7d8887-1793059689621,2026-10-22 09:00,oldest,a,1,1,1,1,1,,,,0,passed,full,m1`,
    `2d7d8887-1793059739621,2026-10-22 09:02,middle,b,1,1,1,1,1,,,,0,passed,full,m2`,
  ].join('\n'));
  const [row] = readLedger(ctx).rows;
  assert.deepEqual([row.project, row.tests, row.level, row.model, row.startedMs, row.turns, 'lastMs' in row], ['newest', null, 'lite', 'm3', 1793059689621, 3, false]);
});

test('ledger: a folder that cannot be listed is reported, not read as empty', () => {
  const ctx = context({ home: mkdtempSync(join(tmpdir(), 'bk-pony-file-')) });
  mkdirSync(join(ctx.home, '.config/ponytail'), { recursive: true });
  writeFileSync(join(ctx.home, '.config/ponytail/band'), 'not a folder');
  assert.deepEqual(readLedger(ctx), { rows: [], notes: ['Ponytail ledger folder could not be read: ENOTDIR'] });
});
