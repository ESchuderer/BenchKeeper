import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix as posixPath } from 'node:path';
import { test } from 'node:test';
import { Ledger, SCHEMA, backupRel, runId } from '../src/ledger.mjs';

const posix = { skip: process.platform === 'win32' };
const tmp = () => mkdtempSync(join(tmpdir(), 'bk-ledger-'));
const ledger = () => { const config = tmp(); return new Ledger(config, join(config, 'home')); };
// A pid that no process holds any more.
const dead = () => spawnSync(process.execPath, ['-e', '']).pid;
const old = (p) => { const t = new Date(Date.now() - 60e3); utimesSync(p, t, t); };

test('runId: compact UTC stamp without milliseconds and six hex characters', () => {
  assert.match(runId(new Date('2026-03-04T05:06:07.890Z')), /^20260304T050607Z-[0-9a-f]{6}$/);
  assert.match(runId(), /^\d{8}T\d{6}Z-[0-9a-f]{6}$/);
});

test('backupRel: a path below HOME stays relative, a sibling with the same prefix does not', () => {
  assert.equal(backupRel('/h', '/h/a/b', posixPath), 'a/b');
  assert.equal(backupRel('/h', '/hx/a', posixPath), '_root/hx/a');
  assert.equal(backupRel('/h', '/h/../srv/x', posixPath), '_root/srv/x');
});

test('backupPath: <backup>/<run>/<change number>/<path below HOME> in a private folder', posix, () => {
  const l = ledger();
  const out = l.backupPath('r1', 2, join(l.home, '.claude', 'settings.json'));
  assert.equal(out, join(l.backups, 'r1', '2', '.claude', 'settings.json'));
  assert.equal(statSync(join(l.backups, 'r1', '2', '.claude')).mode & 0o777, 0o700);
});

test('holds: a live pid holds the lock unless its start time or command line differs', () => {
  const l = ledger();
  let live = true, start = 'S', cmd = 'node a';
  l.proc = { alive: () => live, startOf: () => start, commandOf: () => cmd };
  assert.equal(l.holds({ pid: 5, start: 'S' }), true);
  assert.equal(l.holds({ pid: 5, start: 'T' }), false);
  assert.equal(l.holds({ pid: 5, cmd: 'node a' }), true);
  assert.equal(l.holds({ pid: 5, cmd: 'node b' }), false);
  assert.equal(l.holds({ pid: 5, start: 'S', cmd: 'node b' }), true, 'the start time wins over the command line');
  assert.equal(l.holds({ pid: 5 }), true, 'an old lock without either holds while the pid lives');
  start = undefined; cmd = undefined;
  assert.equal(l.holds({ pid: 5, start: 'S' }), true, 'an OS that tells nothing keeps the lock');
  assert.equal(l.holds({ pid: 5, cmd: 'node a' }), true);
  live = false;
  assert.equal(l.holds({ pid: 5, start: 'S' }), false);
});

test('the real process probes: alive, start time and command line', () => {
  const { alive, startOf, commandOf } = ledger().proc;
  assert.equal(alive(process.pid), true);
  // pid 1 always runs, also when it belongs to another user (EPERM).
  if (process.platform !== 'win32') assert.equal(alive(1), true);
  for (const pid of [0, -1, 1.5, '5', undefined, dead()]) assert.equal(alive(pid), false, String(pid));
  if (process.platform === 'linux') {
    // Field 22 counted after the command name, which may hold spaces and parentheses.
    const stat = readFileSync('/proc/self/stat', 'utf8');
    assert.equal(startOf(process.pid), stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[19]);
  }
  assert.equal(startOf(dead()), undefined);
  if (process.platform !== 'win32') {
    assert.match(commandOf(process.pid), /node/);
    assert.equal(commandOf(process.pid), commandOf(process.pid).trim());
    assert.equal(commandOf(dead()), undefined);
  }
});

test('prune: only run folders older than the period go; the default is 90 days; no backup folder is no error', () => {
  const l = ledger();
  assert.deepEqual(l.prune(90), []);
  const now = Date.parse('2026-10-25T00:00:00Z');
  const at = (iso) => runId(new Date(iso));
  const edge = at('2026-07-27T00:00:00Z'), past = at('2026-07-26T23:59:59Z'), fresh = at('2026-10-24T00:00:00Z');
  for (const n of [edge, past, fresh, '20260101T000000Z-zzzzzz', 'x20260101T000000Z-abcdef']) mkdirSync(join(l.backups, n), { recursive: true });
  assert.deepEqual(l.prune(Number.NaN, now), [], 'a period that is not a number keeps everything');
  assert.deepEqual(l.prune(-1, now), []);
  const env = process.env.BENCHKEEPER_BACKUP_DAYS;
  try {
    process.env.BENCHKEEPER_BACKUP_DAYS = '1';
    assert.deepEqual(l.prune(undefined, now).sort(), [edge, past].sort(), 'the variable sets the period');
  } finally { if (env === undefined) delete process.env.BENCHKEEPER_BACKUP_DAYS; else process.env.BENCHKEEPER_BACKUP_DAYS = env; }
  for (const n of [edge, past]) mkdirSync(join(l.backups, n));
  assert.deepEqual(l.prune(undefined, now), [past], 'exactly 90 days old stays');
  assert.ok(existsSync(join(l.backups, '20260101T000000Z-zzzzzz')) && existsSync(join(l.backups, 'x20260101T000000Z-abcdef')));
});

test('save writes pretty JSON with a final newline and drops the list cache', () => {
  const l = ledger();
  l.save({ schema: SCHEMA, id: 'a', entries: [] });
  assert.equal(readFileSync(join(l.dir, 'a.json'), 'utf8'), '{\n  "schema": 1,\n  "id": "a",\n  "entries": []\n}\n');
  assert.equal(l.list().length, 1);
  l.save({ schema: SCHEMA, id: 'b', entries: [] });
  assert.deepEqual(l.list().map((r) => r.id), ['b', 'a']);
});

test('get: a bad id is 400, a missing run 404, an unreadable file 500 naming the run and the folder', () => {
  const l = ledger();
  for (const id of ['a/b', '../x', '', 'a.b', 5, null]) assert.throws(() => l.get(id), (e) => e.status === 400 && e.message === `bad run id: ${id}`);
  assert.throws(() => l.get('nope'), (e) => e.status === 404 && e.message === 'no run nope');
  mkdirSync(l.dir, { recursive: true });
  writeFileSync(join(l.dir, 'torn.json'), '{');
  assert.throws(() => l.get('torn'), (e) => e.status === 500 && e.message === `the ledger file of run torn is unreadable (not valid JSON): move it out of ${l.dir}`);
  mkdirSync(join(l.dir, 'dir.json'));
  assert.throws(() => l.get('dir'), (e) => e.status === 500 && e.message === `the ledger file of run dir is unreadable (EISDIR): move it out of ${l.dir}`);
  l.save({ schema: SCHEMA, id: 'ok-1_2', entries: [] });
  assert.equal(l.get('ok-1_2').id, 'ok-1_2');
});

test('list: newest first, only parsing runs of this schema, cached until the folder changes', () => {
  const l = ledger();
  assert.deepEqual(l.list(), []);
  mkdirSync(l.dir, { recursive: true });
  writeFileSync(join(l.dir, '1.json'), JSON.stringify({ schema: SCHEMA, id: '1' }));
  writeFileSync(join(l.dir, '3.json'), JSON.stringify({ schema: SCHEMA, id: '3' }));
  writeFileSync(join(l.dir, '2.json'), JSON.stringify({ schema: SCHEMA + 1, id: '2' }));
  writeFileSync(join(l.dir, '4.json'), 'null');
  writeFileSync(join(l.dir, '5.json'), '{');
  writeFileSync(join(l.dir, '6.txt'), JSON.stringify({ schema: SCHEMA, id: '6' }));
  const runs = l.list();
  assert.deepEqual(runs.map((r) => r.id), ['3', '1']);
  assert.equal(l.list(), runs, 'the same folder gives the cached list');
  // Another process's file: the folder's mtime moves.
  writeFileSync(join(l.dir, '7.json'), JSON.stringify({ schema: SCHEMA, id: '7' }));
  const t = new Date(Date.now() + 5e3);
  utimesSync(l.dir, t, t);
  assert.deepEqual(l.list().map((r) => r.id), ['7', '3', '1']);
  // A file added within the same mtime still counts.
  writeFileSync(join(l.dir, '8.json'), JSON.stringify({ schema: SCHEMA, id: '8' }));
  utimesSync(l.dir, t, t);
  assert.deepEqual(l.list().map((r) => r.id), ['8', '7', '3', '1']);
});

test('list and last: two runs of the same second go by their start time, not by the random suffix of their id', () => {
  const l = ledger();
  const path = join(l.home, 'f.txt');
  const run = (id, time, hash) => ({ schema: SCHEMA, id, time, kind: 'apply', scope: 'global', status: 'done', entries: [{ id: 'w', step: 's', title: 't', kind: 'write', path, status: 'done', hashAfter: hash }] });
  // The earlier run has the larger suffix; a run of the second before and one after stay in place.
  l.save(run('20261101T000000Z-ffffff', '2026-11-01T00:00:00.100Z', 'first'));
  l.save(run('20261101T000000Z-000000', '2026-11-01T00:00:00.900Z', 'second'));
  l.save(run('20261031T235959Z-aaaaaa', '2026-10-31T23:59:59.999Z', 'before'));
  l.save(run('20261101T000001Z-000001', '2026-11-01T00:00:01.000Z', 'after'));
  assert.deepEqual(l.list().map((r) => r.id), ['20261101T000001Z-000001', '20261101T000000Z-000000', '20261101T000000Z-ffffff', '20261031T235959Z-aaaaaa']);
  l.save(run('20261101T000002Z-000002', 'not a time', 'unreadable'));
  l.save(run('20261101T000002Z-000003', undefined, 'none'));
  assert.deepEqual(l.list().slice(0, 2).map((r) => r.id), ['20261101T000002Z-000003', '20261101T000002Z-000002'], 'without a readable time: by name');
  // The newest run that wrote the path is the later one of the same second.
  const l2 = ledger(), p2 = join(l2.home, 'f.txt');
  const run2 = (id, time, hash) => ({ ...run(id, time, hash), entries: [{ id: 'w', step: 's', title: 't', kind: 'write', path: p2, status: 'done', hashAfter: hash }] });
  l2.save(run2('20261101T000000Z-ffffff', '2026-11-01T00:00:00.100Z', 'first'));
  l2.save(run2('20261101T000000Z-000000', '2026-11-01T00:00:00.900Z', 'second'));
  assert.equal(l2.last(p2).hashAfter, 'second');
});

test('broken: run files that are not a JSON object, sorted; no folder is none', () => {
  const l = ledger();
  assert.deepEqual(l.broken(), []);
  mkdirSync(l.dir, { recursive: true });
  for (const [n, text] of [['ok', '{}'], ['z', '{'], ['n', 'null'], ['a', '[]'], ['s', '"x"'], ['num', '1']]) writeFileSync(join(l.dir, `${n}.json`), text);
  writeFileSync(join(l.dir, 'skip.txt'), '{');
  assert.deepEqual(l.broken(), ['a.json', 'n.json', 'num.json', 's.json', 'z.json']);
});

test('foreign: parsing runs of another schema, sorted; unreadable files and runs of this schema are not', () => {
  const l = ledger();
  assert.deepEqual(l.foreign(), []);
  mkdirSync(l.dir, { recursive: true });
  for (const [n, text] of [['ok', JSON.stringify({ schema: SCHEMA })], ['z', JSON.stringify({ schema: 99 })], ['none', '{}'], ['bad', '{'], ['n', 'null'], ['a', '[]']]) writeFileSync(join(l.dir, `${n}.json`), text);
  assert.deepEqual(l.foreign(), ['none.json', 'z.json']);
});

test('relocate: runs of the moved folder and its Update all runs get the new path, backups and other runs do not', () => {
  const l = ledger();
  const from = join(l.home, 'p'), to = join(l.home, 'q');
  const entry = (path) => ({ path, n: 1, done: null, backup: join(from, 'b'), files: [path, join(`${from}x`, 'f')] });
  l.save({ schema: SCHEMA, id: '1', scope: from, entries: [entry(join(from, 'AGENTS.md')), entry(from)] });
  l.save({ schema: SCHEMA, id: '2', scope: join(l.home, 'wt'), note: { updateAll: from }, entries: [entry(join(from, 'a'))] });
  l.save({ schema: SCHEMA, id: '3', scope: `${from}x`, entries: [entry(join(`${from}x`, 'a'))] });
  l.save({ schema: SCHEMA, id: '4', scope: join(l.home, 'other'), entries: [entry(join(from, 'a'))] });
  const before3 = l.get('3'), before4 = l.get('4');
  l.relocate(from, to);
  const one = l.get('1');
  assert.equal(one.scope, to);
  assert.deepEqual(one.entries.map((e) => e.path), [join(to, 'AGENTS.md'), to]);
  assert.equal(one.entries[0].backup, join(from, 'b'), 'a backup path stays');
  assert.deepEqual(one.entries[0].files, [join(to, 'AGENTS.md'), join(`${from}x`, 'f')], 'a sibling with the same prefix stays');
  const two = l.get('2');
  assert.equal(two.note.updateAll, to);
  assert.equal(two.entries[0].path, join(to, 'a'));
  assert.equal(one.entries[0].n, 1);
  assert.equal(one.entries[0].done, null);
  assert.deepEqual(l.get('3'), before3);
  assert.deepEqual(l.get('4'), before4, 'another scope keeps its paths');
});

test('last: the newest done and not undone entry for a path, newest run and last entry first', () => {
  const l = ledger();
  mkdirSync(l.home, { recursive: true });
  const p = join(l.home, 'f'), q = join(l.home, 'g');
  const e = (path, n, extra = {}) => ({ path, n, status: 'done', ...extra });
  l.save({ schema: SCHEMA, id: '20260101T000000Z-000001', entries: [e(p, 1), e(p, 2), e(q, 3)] });
  assert.equal(l.last(p).n, 2);
  l.save({ schema: SCHEMA, id: '20260101T000000Z-000002', entries: [e(p, 4), e(p, 5, { undone: true }), e(p, 6, { status: 'failed' }), e(q, 7)] });
  assert.equal(l.last(p).n, 4);
  assert.equal(l.last(q).n, 7);
  assert.equal(l.last(join(l.home, 'none')), null);
});

test('lock: one run per config folder, counted within a process, released at the last release', () => {
  const l = ledger(), file = join(l.dir, '..', 'lock');
  l.proc = { ...l.proc, startOf: () => 'S' };
  const a = l.lock();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, start: 'S' });
  const b = l.lock();
  b();
  assert.equal(existsSync(file), true, 'the outer run still holds it');
  a();
  assert.equal(existsSync(file), false);
  // Another ledger on the same folder in this process shares the count.
  const c = l.lock(), d = new Ledger(join(l.dir, '..'), l.home).lock();
  c();
  assert.equal(existsSync(file), true);
  d();
  assert.equal(existsSync(file), false);
});

test('lock: a live holder is busy; a dead, foreign-start or own-pid lock is taken over', () => {
  const l = ledger(), file = join(l.dir, '..', 'lock');
  mkdirSync(join(l.dir, '..'), { recursive: true });
  let live = true;
  l.proc = { alive: () => live, startOf: (pid) => (pid === process.pid ? 'ME' : 'S'), commandOf: () => undefined };
  writeFileSync(file, JSON.stringify({ pid: 4242, start: 'S' }));
  const check = process.platform === 'win32' ? 'tasklist /fi "pid eq 4242"' : 'ps -p 4242';
  assert.throws(() => l.lock(), (e) => e.message === `another BenchKeeper run is in progress (process 4242): wait until it ends. If no BenchKeeper run is going (check with ${check}), remove ${file}`);
  writeFileSync(file, JSON.stringify({ pid: 4242, start: 'T' }));
  l.lock()();
  assert.equal(existsSync(file), false, 'a reused pid is not the run');
  writeFileSync(file, JSON.stringify({ pid: process.pid, start: 'ME' }));
  l.lock()();
  assert.equal(existsSync(file), false, 'an earlier process with this pid left it');
  live = false;
  writeFileSync(file, JSON.stringify({ pid: 4242, start: 'S' }));
  const release = l.lock();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, start: 'ME' });
  release();
  assert.equal(existsSync(`${file}.takeover`), false);
});

test('lock: a fresh lock without a pid is busy, an old one is taken over; the busy text then names no process', () => {
  const l = ledger(), file = join(l.dir, '..', 'lock');
  mkdirSync(join(l.dir, '..'), { recursive: true });
  for (const text of ['', '{', 'null', '{}']) {
    writeFileSync(file, text);
    assert.throws(() => l.lock(), (e) => e.message === `another BenchKeeper run is in progress: wait until it ends. If no BenchKeeper run is going, remove ${file}`, text);
    old(file);
    l.lock()();
    assert.equal(existsSync(file), false, text);
  }
});

test('lock: a fresh takeover guard is busy, an old one is a crash and goes; the run records its command line without a start time', () => {
  const l = ledger(), file = join(l.dir, '..', 'lock'), guard = `${file}.takeover`;
  mkdirSync(join(l.dir, '..'), { recursive: true });
  l.proc = { alive: () => false, startOf: () => undefined, commandOf: () => 'node me' };
  writeFileSync(file, JSON.stringify({ pid: 4242 }));
  writeFileSync(guard, '1');
  assert.throws(() => l.lock(), (e) => e.message.startsWith('another BenchKeeper run is in progress: wait'));
  assert.equal(existsSync(file), true);
  old(guard);
  const release = l.lock();
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: process.pid, cmd: 'node me' });
  assert.equal(existsSync(guard), false);
  release();
});

test('lock: a lock replaced while being examined stays for its new holder', () => {
  const l = ledger(), file = join(l.dir, '..', 'lock');
  mkdirSync(join(l.dir, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify({ pid: 4242, start: 'S' }));
  let swapped = false;
  l.proc = {
    alive: (pid) => pid !== 4242 || !swapped,
    startOf: (pid) => {
      // While this run checks the dead holder, another process takes the lock over.
      if (pid === 4242 && !swapped) { swapped = true; writeFileSync(file, JSON.stringify({ pid: 4343, start: 'U' })); return 'T'; }
      return pid === 4343 ? 'U' : 'ME';
    },
    commandOf: () => undefined,
  };
  assert.throws(() => l.lock(), /in progress \(process 4343\)/);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { pid: 4343, start: 'U' });
  assert.equal(existsSync(`${file}.takeover`), false);
});
