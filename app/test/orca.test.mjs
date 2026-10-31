import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doctor } from '../src/doctor.mjs';
import { automationResult, automationRuns, bin, createArgv, editArgv, installed, notInstalled, OBSERVED, runs, undoableAutomation, unobserved } from '../src/orca/index.mjs';
import { fake, missing, RECORDED, replies, RUN_LIST, taskListArgv, WATCHDOG_MS } from './fakes/orca.mjs';

const MARK = 'RECORDED-TEXT-NOT-FOR-VIEWS';
const [RUN_A, RUN_B] = RECORDED.runList.result.runs;
const [A, B] = [RUN_A.id, RUN_B.id];
const task = (id, status) => ({ id, run_id: A, status, spec: MARK, result: null });
// One run with the given task states.
const oneRun = (statuses, run = RUN_A) => replies({ runs: [run], tasks: { [A]: statuses.map((s, i) => task(`task_${i}`, s)) } });
// The reply of argv replaced, or a reply put before it (a first answer that times uses up).
const same = (r, argv) => JSON.stringify(r.argv) === JSON.stringify(argv);
const replace = (list, argv, change) => list.map((r) => (same(r, argv) ? { ...r, ...change } : r));
const before = (list, argv, first) => list.flatMap((r) => (same(r, argv) ? [{ argv, ...first }, r] : [r]));
// The outer guard: a hang the watchdog misses fails the test here instead of blocking the suite.
const guard = { timeout: 10e3 };

test('the recorded fixtures are of the observed version', () => {
  assert.equal(RECORDED.version.trim(), OBSERVED);
});

test('start: the recorded runs and tasks parse to ids, times and state counts; no recorded text leaves the adapter', guard, async () => {
  const { ctx, calls } = fake({ replies: replies() });
  assert.equal(installed(ctx), true);
  const got = await runs(ctx);
  assert.deepEqual(got, [
    { id: A, created: '2026-10-28T10:16:15Z', updated: '2026-10-28T13:05:17Z', tasks: 3, states: { completed: 1, dispatched: 1, ready: 1 } },
    { id: B, created: '2026-10-28T10:15:47Z', updated: '2026-10-28T13:04:41Z', tasks: 0, states: {} },
  ]);
  assert.ok(!JSON.stringify(got).includes(MARK));
  assert.deepEqual(calls(), [['--version'], RUN_LIST, taskListArgv(A), taskListArgv(B)]);
});

test('hang: the watchdog stops a command that never ends, and the read fails fast', guard, async () => {
  const { ctx, calls } = fake({ replies: replace(replies(), RUN_LIST, { hang: true }) });
  const t0 = Date.now();
  assert.equal(await runs(ctx), null);
  assert.ok(Date.now() - t0 < WATCHDOG_MS + 2e3, `took ${Date.now() - t0} ms`);
  assert.deepEqual(calls(), [['--version'], RUN_LIST]);
});

test('parked prompt: a command that waits for an answer gets none and fails; nothing waits on it', guard, async () => {
  const { ctx, calls } = fake({ replies: replace(replies(), RUN_LIST, { prompt: true }) });
  const t0 = Date.now();
  assert.equal(await runs(ctx), null);
  assert.ok(Date.now() - t0 < WATCHDOG_MS, 'the prompt read the end of its input instead of waiting for the watchdog');
  assert.deepEqual(calls(), [['--version'], RUN_LIST]);
});

test('retry: a task list that fails once costs that run its counts; the next read has them', guard, async () => {
  const { ctx, calls, state } = fake({ replies: before(replies(), taskListArgv(A), { code: 1, stderr: 'busy\n', times: 1 }) });
  assert.deepEqual((await runs(ctx)).map((r) => [r.id, r.tasks]), [[A, null], [B, 0]]);
  assert.equal(state().replies.find((r) => r.times != null).times, 0);
  assert.deepEqual((await runs(ctx)).map((r) => [r.id, r.tasks]), [[A, 3], [B, 0]]);
  assert.equal(calls().filter((c) => c[1] === 'task-list').length, 4);
});

test('gate: a task a pending decision blocks counts as blocked', guard, async () => {
  const { ctx } = fake({ replies: oneRun(['completed', 'blocked']) });
  assert.deepEqual((await runs(ctx))[0].states, { completed: 1, blocked: 1 });
});

test('resume: resolving the gate changes the fake\'s state; the next read shows the task dispatched and the run updated', guard, async () => {
  const resolve = ['orchestration', 'gate-resolve', '--id', 'gate_1', '--resolution', 'go', '--json'];
  const { ctx, calls } = fake({ replies: [...oneRun(['blocked']), { argv: resolve, stdout: '{"ok":true}\n', then: oneRun(['dispatched'], { ...RUN_A, updated_at: '2026-10-28T14:00:00Z' }) }] });
  assert.deepEqual((await runs(ctx))[0].states, { blocked: 1 });
  assert.equal(ctx.run(['orca', ...resolve]).code, 0);
  const [r] = await runs(ctx);
  assert.deepEqual([r.updated, r.states], ['2026-10-28T14:00:00Z', { dispatched: 1 }]);
  assert.deepEqual(calls(), [['--version'], RUN_LIST, taskListArgv(A), resolve, RUN_LIST, taskListArgv(A)]);
});

test('a failing command: an exit code, the recorded error envelope or output that is no JSON reads as no runs', guard, async () => {
  for (const change of [{ code: 3, stdout: '', stderr: 'no runtime\n' }, { code: 1, stdout: RECORDED.error }, { code: 0, stdout: RECORDED.error }, { code: 0, stdout: 'not json' }]) {
    const { ctx, calls } = fake({ replies: replace(replies(), RUN_LIST, change) });
    assert.equal(await runs(ctx), null, JSON.stringify(change));
    assert.deepEqual(calls(), [['--version'], RUN_LIST], 'no task list is read without runs');
  }
  const { ctx, calls } = fake({ replies: replies() });
  assert.equal(ctx.run(['orca', 'orchestration', 'nonexistent']).code, 2);
  assert.deepEqual(calls(), [{ argv: ['orchestration', 'nonexistent'], unknown: true }], 'a call without a reply is logged as unknown');
});

test('a missing binary: not installed, no runs, and doctor stays quiet about its version', guard, async () => {
  const { ctx } = missing();
  assert.equal(installed(ctx), false);
  assert.equal(await runs(ctx), null);
  assert.equal(unobserved(ctx), null);
});

test('the CLI: orca, else orca-ide, else the shim in its config folder, asked once per context; every call uses the one found', async () => {
  const SHIM = '/h/.config/orca/linux-orca-cli-shim/orca';
  const at = (have) => {
    const asked = [];
    return { asked, home: '/h', run: (argv) => { asked.push(argv[0]); return { code: have.includes(argv[0]) ? 0 : 127, stdout: argv[1] === '--version' ? '2.0.0\n' : '{"ok":true,"result":{"runs":[]}}', stderr: '' }; } };
  };
  const f = { name: 'n', schedule: 'hourly', prompt: 'p', agent: 'claude', workspace: 'project', dir: '/p' };
  for (const [have, found, probes] of [[['orca', 'orca-ide'], 'orca', ['orca']], [['orca-ide'], 'orca-ide', ['orca', 'orca-ide']], [[SHIM], SHIM, ['orca', 'orca-ide', SHIM]]]) {
    const ctx = at(have);
    assert.equal(installed(ctx), true);
    assert.equal(bin(ctx), found);
    assert.match(unobserved(ctx).message, /^Orca 2\.0\.0 /);
    assert.equal(createArgv(ctx, f)[0], found);
    assert.deepEqual(await runs(ctx), []);
    assert.deepEqual(ctx.asked, [...probes, found], have.join());
  }
  const none = at([]);
  assert.equal(installed(none), false);
  assert.equal(unobserved(none), null);
  assert.match(notInstalled(none), /none of orca, orca-ide, \/h\/\.config\/orca\/linux-orca-cli-shim\/orca answered --version; put orca-ide on the PATH/);
  assert.deepEqual(none.asked, ['orca', 'orca-ide', SHIM, 'orca', 'orca-ide', SHIM], 'a miss is asked again');
});

test('doctor warns on a major version the adapter was not observed with, and only then', () => {
  const at = (stdout, code = 0) => ({ home: '/nonexistent', run: () => ({ code, stdout, stderr: '' }) });
  assert.equal(unobserved(at(`${OBSERVED}\n`)), null);
  assert.equal(unobserved(at('1.9.0\n')), null);
  assert.equal(unobserved(at('not a version')), null);
  assert.equal(unobserved(at('2.0.1', 1)), null);
  assert.match(unobserved(at('2.0.1\n')).message, /2\.0\.1 is a major version this app was not checked with \(1\.4\.245\)/);
});

test('doctor reports the unobserved major version as a tools warning', guard, () => {
  const { ctx } = fake({ replies: replace(replies(), ['--version'], { stdout: '2.0.0\n' }) });
  const found = doctor(ctx, { agents: ['claude'], env: {} }).filter((i) => /not checked with/.test(i.message));
  assert.deepEqual(found.map((i) => [i.level, i.check]), [['warning', 'tools']]);
});

test('runs: a run without times or a task list that is no list reads as null for those fields', async () => {
  const reply = (argv) => (argv[2] === 'run-list' ? { ok: true, result: { runs: [{ id: 7 }] } } : { ok: true, result: { tasks: 'none' } });
  const ctx = { home: '/h', run: (argv) => ({ code: 0, stdout: argv[1] === '--version' ? '1.4.243\n' : JSON.stringify(reply(argv)), stderr: '' }) };
  assert.deepEqual(await runs(ctx), [{ id: '7', created: null, updated: null, tasks: null, states: {} }]);
});

test('the automation commands: precheck, grace and session flags only when set; a worktree automation targets the repository', () => {
  const ctx = { home: '/h', run: () => ({ code: 0, stdout: '1.4.243\n', stderr: '' }) };
  const f = { name: 'n', schedule: 'hourly', prompt: 'p', agent: 'claude', dir: '/p' };
  const base = ['--name', 'n', '--trigger', 'hourly', '--prompt', 'p', '--provider', 'claude'];
  assert.deepEqual(createArgv(ctx, { ...f, workspace: 'worktree', grace: 0 }).slice(1),
    ['automations', 'create', ...base, '--repo', 'path:/p', '--workspace-mode', 'new-per-run', '--disabled', '--json']);
  assert.deepEqual(editArgv(ctx, 'a1', { ...f, workspace: 'project', precheck: 'true', grace: 5, reuseSession: true }).slice(1),
    ['automations', 'edit', '--id', 'a1', ...base, '--precheck', 'true', '--missed-run-grace-minutes', '5', '--reuse-session', '--json']);
  assert.ok(editArgv(ctx, 'a1', { ...f, workspace: 'project' }).includes('--fresh-session'));
  assert.equal(undoableAutomation(['orca', 'automations', 'remove', '--id']), false, 'no id');
});

test('an automation result: picked fields with defaults, else the error from the envelope, the output or the exit code', () => {
  const ok = (automation) => ({ code: 0, stdout: JSON.stringify({ ok: true, result: { automation } }), stderr: '' });
  assert.deepEqual(automationResult(ok({ id: 1 })), { automation: { id: '1', name: '', prompt: '', schedule: '', precheck: '', agent: '', enabled: false } });
  assert.deepEqual(automationResult(ok({ id: 'a', name: 'n', prompt: 'p', rrule: 'r', precheck: { command: 'c' }, agentId: 'claude', enabled: true, host: 'x' })),
    { automation: { id: 'a', name: 'n', prompt: 'p', schedule: 'r', precheck: 'c', agent: 'claude', enabled: true } });
  assert.deepEqual(automationResult({ code: 1, stdout: JSON.stringify({ ok: false, error: { message: 'Automation not found' } }), stderr: '' }), { error: 'Orca: Automation not found', removed: true });
  assert.deepEqual(automationResult({ code: 1, stdout: 'not json', stderr: 'first\nlast\n' }), { error: 'Orca: last' });
  assert.deepEqual(automationResult({ code: 1, stdout: 'only stdout', stderr: '' }), { error: 'Orca: only stdout' });
  assert.deepEqual(automationResult({ code: 9, stdout: '', stderr: '' }), { error: 'Orca: exit 9' });
});

test('automation runs: status, trigger and due time picked with defaults; a failure reads as its message', () => {
  const at = (r) => ({ home: '/h', run: (argv) => (argv[1] === '--version' ? { code: 0, stdout: '1.4.243\n', stderr: '' } : r) });
  const runsOf = (list) => at({ code: 0, stdout: JSON.stringify({ ok: true, result: { runs: list } }), stderr: '' });
  assert.deepEqual(automationRuns(runsOf([{ status: 'completed', trigger: 'manual', startedAt: 0 }, {}]), 'a1'),
    { runs: [{ status: 'completed', trigger: 'manual', at: '1970-01-01T00:00:00.000Z' }, { status: '', trigger: '', at: null }] });
  assert.deepEqual(automationRuns(at({ code: 1, stdout: 'not json', stderr: 'boom\n' }), 'a1'), { error: 'Orca: boom' });
  assert.deepEqual(automationRuns(at({ code: 1, stdout: JSON.stringify({ ok: false, error: { message: 'gone' } }), stderr: '' }), 'a1'), { error: 'Orca: gone' });
  assert.deepEqual(automationRuns(at({ code: 2, stdout: '', stderr: '' }), 'a1'), { error: 'Orca: exit 2' });
});
