import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { containerChecks, keyQuota, reconcile } from '../src/containers.mjs';
import { doctor } from '../src/doctor.mjs';
import { worktreeFiles } from '../src/orca/index.mjs';
import { context } from '../src/runner.mjs';

// A fake podman with five containers: running and stopped ones of an existing worktree, a running and a stopped one of a
// removed worktree, one of a folder whose parent is gone too (an unmounted drive), and one without the workspace label.
// extra(root) adds rows [id, running, folder].
function machine({ ps = 0, inspect = 0, rm = 0, extra = () => [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bk-ctr-')), live = join(root, 'wt', 'live'), gone = join(root, 'wt', 'gone');
  mkdirSync(live, { recursive: true });
  const rows = [['a1', true, live], ['a2', false, live], ['b1', true, gone], ['b2', false, gone], ['c1', true, join(root, 'drive', 'x')], ['d1', true, null], ...extra(root)];
  const calls = [];
  const run = (argv) => {
    calls.push(argv);
    if (argv[1] === '--version') return { code: argv[0] === 'podman' ? 0 : 127, stdout: '5.0.0', stderr: '' };
    if (argv[1] === 'ps') return { code: ps, stdout: rows.map((r) => `${r[0]}\n`).join(''), stderr: '' };
    if (argv[1] === 'container') return { code: inspect, stdout: rows.map((r) => `${r[0]}full\t${r[1]}\t${JSON.stringify(r[2])}\n`).join(''), stderr: '' };
    if (argv[1] === 'rm') return { code: rm, stdout: '', stderr: '' };
    return { code: 0, stdout: argv.includes('--json') ? '[]' : '1.0.0', stderr: '' };
  };
  const proc = join(root, 'proc');
  mkdirSync(join(proc, 'sys/kernel/keys'), { recursive: true });
  const keys = (used, max = 200) => {
    writeFileSync(join(proc, 'key-users'), `    0:   521 520/520 53/1000000 1093/25000000\n ${process.getuid?.() ?? 1000}:    79 79/79 ${used}/${max} 4943/20000\n`);
    writeFileSync(join(proc, 'sys/kernel/keys/maxkeys'), `${max}\n`);
  };
  keys(10);
  return { ctx: context({ home: root, run }), root, gone, calls, proc, keys };
}
const sink = () => { let text = ''; return { stream: new Writable({ write(c, _e, done) { text += c; done(); } }), text: () => text }; };

test('keyQuota reads the user line of key-users and kernel.keys.maxkeys; null when either is missing', () => {
  const m = machine();
  m.keys(78);
  assert.deepEqual(keyQuota(m.proc, process.getuid?.() ?? 1000), { used: 78, max: 200 });
  assert.equal(keyQuota(m.proc, 4242), null);
  assert.equal(keyQuota(join(m.root, 'nowhere'), 1000), null);
});

test('doctor counts orphaned, idle and unlabelled containers and warns on the key quota from 80 percent, without names', () => {
  const m = machine();
  m.keys(159);
  const below = containerChecks(m.ctx, 'podman', { platform: 'linux', proc: m.proc });
  assert.deepEqual(below.map((f) => [f.level, f.message]), [
    ['warning', '2 dev containers of folders that no longer exist (1 running)'],
    ['info', '1 dev container stopped but not removed'],
    ['info', '1 container without a dev container workspace label, which reconcile leaves alone'],
  ]);
  m.keys(160);
  const at = containerChecks(m.ctx, 'podman', { platform: 'linux', proc: m.proc }).at(-1);
  assert.equal(at.level, 'warning');
  assert.match(at.message, /^user key quota: 160 of 200 keys used \(warning from 80 percent\)/);
  assert.ok(!JSON.stringify([...below, at]).includes(m.root));
});

test('doctor skips the check on other systems and says so; a failed listing is an info', () => {
  const m = machine();
  assert.deepEqual(containerChecks(m.ctx, 'podman', { platform: 'darwin', proc: m.proc }).map((f) => [f.level, f.message]), [['info', 'the dev container check is skipped: it reads Linux /proc files, this system is darwin']]);
  assert.deepEqual(m.calls.filter((c) => c[1] === 'ps'), []);
  const failed = containerChecks(machine({ inspect: 125 }).ctx, 'podman', { platform: 'linux', proc: m.proc });
  assert.deepEqual(failed.map((f) => f.level), ['info']);
  assert.match(failed[0].message, /^podman cannot list the containers/);
});

test('doctor runs the container check with the engine it found at level full', () => {
  const m = machine();
  m.ctx.containerFacts = { platform: 'linux', proc: m.proc };
  const found = doctor(m.ctx, { agents: ['claude'], env: {}, devcontainerCli: '1.0.0' }).filter((f) => f.check === 'containers');
  assert.deepEqual(found.map((f) => f.level), ['warning', 'info', 'info']);
});

test('reconcile removes only containers of a removed folder whose parent exists; --dry-run lists them', () => {
  const m = machine();
  const dry = reconcile(m.ctx, 'podman', { dryRun: true });
  assert.deepEqual(dry.map((c) => [c.id, c.removed]), [['b1full', undefined], ['b2full', undefined]]);
  assert.deepEqual(m.calls.filter((c) => c[1] === 'rm'), []);
  const done = reconcile(m.ctx, 'podman');
  assert.deepEqual(done.map((c) => c.removed), [true, true]);
  assert.deepEqual(m.calls.filter((c) => c[1] === 'rm'), [['podman', 'rm', '-f', 'b1full'], ['podman', 'rm', '-f', 'b2full']]);
  assert.throws(() => reconcile(machine({ ps: 1 }).ctx, 'podman'), /podman cannot list the containers/);
});

test('reconcile keeps a container whose folder it cannot read, that is not an absolute path or lies outside the home folder; doctor counts them', { skip: process.platform !== 'linux' && 'Linux only' }, () => {
  const outside = mkdtempSync(join(tmpdir(), 'bk-out-'));
  const m = machine({ extra: (root) => {
    mkdirSync(join(root, 'locked', 'proj'), { recursive: true });
    chmodSync(join(root, 'locked'), 0o600);
    return [['e1', true, join(root, 'locked', 'proj')], ['e2', true, 'C:\\Users\\x\\proj'], ['e3', true, 'wt/gone'], ['e4', true, join(outside, 'gone')]];
  } });
  // root reads any folder, so the permission case only holds for another user.
  const root = process.getuid?.() === 0;
  assert.deepEqual(reconcile(m.ctx, 'podman').map((c) => c.id), ['b1full', 'b2full']);
  assert.deepEqual(m.calls.filter((c) => c[1] === 'rm').map((c) => c[3]), ['b1full', 'b2full']);
  const found = containerChecks(m.ctx, 'podman', { platform: 'linux', proc: m.proc });
  assert.equal(found[2].message, `${root ? 3 : 4} dev containers whose folder could not be checked (outside the home folder, not a path of this system or not readable), which reconcile leaves alone`);
  chmodSync(join(m.root, 'locked'), 0o700);
});

test('reconcile keeps a container whose existing folder has a tab or a line break; a label adds no container id', { skip: process.platform === 'win32' && 'Windows names hold no tab' }, () => {
  const m = machine({ extra: (root) => {
    const tab = join(root, 'ws', 'a\tb'), nl = join(root, 'ws', `c\nx9full\ttrue\t${JSON.stringify(join(root, 'wt', 'gone'))}`);
    mkdirSync(tab, { recursive: true });
    mkdirSync(nl, { recursive: true });
    return [['f1', true, tab], ['f2', true, nl]];
  } });
  assert.deepEqual(reconcile(m.ctx, 'podman', { dryRun: true }).map((c) => c.id), ['b1full', 'b2full']);
  const injected = machine();
  const run = injected.ctx.run;
  injected.ctx.run = (argv, o) => (argv[2] === 'inspect' ? { ...run(argv, o), stdout: `${run(argv, o).stdout}x9full\ttrue\t${JSON.stringify(injected.gone)}\n` } : run(argv, o));
  assert.deepEqual(reconcile(injected.ctx, 'podman', { dryRun: true }).map((c) => c.id), ['b1full', 'b2full']);
  injected.ctx.run = (argv, o) => (argv[2] === 'inspect' ? { code: 0, stdout: 'x9full\ttrue\t/w/a\n', stderr: '' } : run(argv, o));
  assert.throws(() => reconcile(injected.ctx, 'podman'), /podman cannot list the containers/);
});

test('benchkeeper containers reconcile prints each container and the count, exit 1 when a removal fails', { skip: process.platform !== 'linux' && 'Linux only' }, async () => {
  const m = machine();
  const out = sink();
  assert.equal(await main(['containers', 'reconcile', '--dry-run'], { out: out.stream, err: out.stream, ctx: m.ctx }), 0);
  assert.equal(out.text(), `would remove b1full ${m.gone}\nwould remove b2full ${m.gone}\n2 dev containers of folders that no longer exist\n`);
  const failed = machine({ rm: 1 }), out2 = sink();
  assert.equal(await main(['containers', 'reconcile'], { out: out2.stream, err: out2.stream, ctx: failed.ctx }), 1);
  assert.match(out2.text(), /^failed b1full /);
  const out3 = sink();
  assert.equal(await main(['containers', 'prune'], { out: out3.stream, err: out3.stream, ctx: m.ctx }), 2);
});

test('the worktree archive hook removes the containers of its worktree only and never fails', { skip: process.platform === 'win32' && 'sh hook' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'bk-arch-')), bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'podman'), `#!/bin/sh\necho "$*" >> '${bin}/log'\ncase "$*" in *"label=devcontainer.local_folder=/w/done") echo c1 ;; rm*) exit 1 ;; esac\n`, { mode: 0o755 });
  const line = worktreeFiles(null, [])[0].text.match(/^ {4}(sh -c .*)$/m)[1];
  const r = spawnSync('sh', ['-c', line], { env: { PATH: `${bin}:/usr/bin:/bin`, ORCA_WORKTREE_PATH: '/w/done' }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.deepEqual(readFileSync(join(bin, 'log'), 'utf8').trim().split('\n'), ['ps -aq --filter label=devcontainer.local_folder=/w/done', 'rm -f c1']);
  assert.equal(spawnSync('sh', ['-c', line], { env: { PATH: `${bin}:/usr/bin:/bin` } }).status, 0);
  assert.equal(readFileSync(join(bin, 'log'), 'utf8').trim().split('\n').length, 2);
});
