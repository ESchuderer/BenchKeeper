// A stateful fake of the multi-agent IDE's CLI for the adapter tests. Run as a program (through the launcher fake() writes),
// it reads its state from FAKE_STATE, appends each call to FAKE_LOG and answers from the state's replies alone, so a new
// command needs a reply, not code here. Imported, it builds the launcher, the state and a context whose commands find this
// fake first on the PATH, plus the replies recorded from the real CLI (app/test/fixtures/orca/, version in version.txt).
// State: { replies: [{ argv, stdout, stderr, code, times, then, hang, prompt }] }. A call takes the first reply whose argv equals
// its own and whose times (calls left; none: every call) is not used up. then: replies put in front once it answered, so a
// command changes what later calls get. hang never ends; prompt asks on stderr and answers only after a line starting with y
// on stdin. A call no reply matches exits 2 and is logged with unknown: true.
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, runCommand, runCommandAsync } from '../../src/runner.mjs';

const self = fileURLToPath(import.meta.url);
// A hung or parked command is stopped after this long: the test fails fast instead of waiting for the adapter's own timeout.
export const WATCHDOG_MS = 1500;
const fixture = (f) => readFileSync(new URL(`../fixtures/orca/${f}`, import.meta.url), 'utf8');
export const RECORDED = { version: fixture('version.txt'), runList: JSON.parse(fixture('run-list.json')), taskList: JSON.parse(fixture('task-list.json')), error: fixture('error.json') };

// The replies of the calls the adapter makes. runs and tasks (by run id) default to the recorded ones.
const json = (x) => `${JSON.stringify(x, null, 2)}\n`;
export const RUN_LIST = ['orchestration', 'run-list', '--limit', '20', '--json'];
export const taskListArgv = (id) => ['orchestration', 'task-list', '--run', id, '--json'];
export function replies({ runs = RECORDED.runList.result.runs, tasks = { [RECORDED.taskList.result.runId]: RECORDED.taskList.result.tasks } } = {}) {
  const t = RECORDED.taskList;
  return [
    { argv: ['--version'], stdout: RECORDED.version },
    { argv: RUN_LIST, stdout: json({ ...RECORDED.runList, result: { ...RECORDED.runList.result, runs } }) },
    ...runs.map((r) => ({ argv: taskListArgv(r.id), stdout: json({ ...t, result: { ...t.result, runId: r.id, tasks: tasks[r.id] ?? [], count: (tasks[r.id] ?? []).length } }) })),
  ];
}

export function fake(state) {
  const dir = mkdtempSync(join(tmpdir(), 'bk-fake-ide-'));
  const bin = join(dir, 'bin'), file = join(dir, 'state.json'), log = join(dir, 'calls.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'orca'), `#!/bin/sh\nexec "${process.execPath}" "${self}" "$@"\n`);
  chmodSync(join(bin, 'orca'), 0o755);
  writeFileSync(file, JSON.stringify(state));
  writeFileSync(log, '');
  return world(dir, { ...process.env, PATH: bin, FAKE_STATE: file, FAKE_LOG: log }, file, log);
}

// No such program on the PATH.
export function missing() {
  const dir = mkdtempSync(join(tmpdir(), 'bk-fake-ide-'));
  mkdirSync(join(dir, 'bin'));
  return world(dir, { ...process.env, PATH: join(dir, 'bin') }, null, null);
}

function world(dir, env, file, log) {
  const capped = (o) => ({ ...o, env, timeout: Math.min(o?.timeout ?? WATCHDOG_MS, WATCHDOG_MS) });
  const ctx = context({ home: dir, run: (argv, o) => runCommand(argv, capped(o)) });
  ctx.runAsync = (argv, o) => runCommandAsync(argv, { ...capped(o), grace: 200 });
  return {
    ctx,
    calls: () => (log ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    state: () => JSON.parse(readFileSync(file, 'utf8')),
    update: (fn) => writeFileSync(file, JSON.stringify(fn(JSON.parse(readFileSync(file, 'utf8'))))),
  };
}

function main(argv) {
  const state = JSON.parse(readFileSync(process.env.FAKE_STATE, 'utf8'));
  const reply = state.replies.find((r) => JSON.stringify(r.argv) === JSON.stringify(argv) && (r.times ?? 1) > 0);
  appendFileSync(process.env.FAKE_LOG, `${JSON.stringify(reply ? argv : { argv, unknown: true })}\n`);
  if (!reply) { process.stderr.write(`fake: no reply for ${JSON.stringify(argv)}\n`); process.exitCode = 2; return; }
  if (reply.times != null) reply.times -= 1;
  if (reply.then) state.replies.unshift(...reply.then);
  if (reply.times != null || reply.then) writeFileSync(process.env.FAKE_STATE, JSON.stringify(state));
  if (reply.hang) { setInterval(() => {}, 60e3); return; }
  const answer = () => {
    process.stdout.write(reply.stdout ?? '');
    process.stderr.write(reply.stderr ?? '');
    process.exitCode = reply.code ?? 0;
  };
  if (!reply.prompt) { answer(); return; }
  process.stderr.write('Continue? [y/N] ');
  let line = '';
  process.stdin.setEncoding('utf8').on('data', (d) => { line += d; }).on('end', () => {
    if (/^y/i.test(line)) answer();
    else { process.stderr.write('aborted\n'); process.exitCode = 1; }
  });
}

if (process.argv[1] === self) main(process.argv.slice(2));
