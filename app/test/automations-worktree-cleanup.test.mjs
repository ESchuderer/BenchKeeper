import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fill, genericDir, lint, load } from '../src/automations.mjs';
import { context } from '../src/runner.mjs';

const template = () => load(context({ home: mkdtempSync(join(tmpdir(), 'bk-wc-')) }), [['generic', genericDir]]).templates.find((t) => t.id === 'worktree-cleanup');
const sh = { skip: process.platform === 'win32' && 'sh helpers' };
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-C', dir, ...args], { encoding: 'utf8', env }).trim();
const commit = (dir, name) => { writeFileSync(join(dir, name), name); git(dir, 'add', name); git(dir, 'commit', '-qm', name); return git(dir, 'rev-parse', 'HEAD'); };

// A checkout with a linked worktree per branch under wt/ of the real temporary path (git reports worktrees by it, and on
// macOS /var links to /private/var), and fakes on PATH that log their arguments: gh answers the merged
// pull request heads of a branch from the file heads-<branch>, df the used percent from the file used, podman one stopped
// container and one volume for the worktree of branch done.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bk-wc-repo-'))), repo = join(root, 'repo'), bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  git(repo, 'init', '-q', '-b', 'main');
  commit(repo, 'base');
  const worktree = (branch) => { const p = join(root, 'wt', branch); git(repo, 'worktree', 'add', '-q', '-b', branch, p); return p; };
  const merged = (branch, ...heads) => writeFileSync(join(bin, `heads-${branch}`), heads.map((h) => `${h}\n`).join(''));
  const fake = (name, body) => writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${bin}/log'\n${body}\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'used'), '50');
  fake('df', `printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\\nfs 100 1 99 %s%% /\\n' "$(cat '${bin}/used')"`);
  fake('gh', `while [ "$1" != --head ]; do shift; done; cat '${bin}'/heads-"$2" 2>/dev/null; true`);
  fake('podman', `case "$*" in *"ps -a -q --filter label=devcontainer.local_folder=${join(root, 'wt', 'done')}") echo c1 ;; *"volume ls -q --filter label=devcontainer.local_folder=${join(root, 'wt', 'done')}") echo v1 ;; esac`);
  const exec = (cmd, args = []) => {
    writeFileSync(join(bin, 'log'), '');
    const r = spawnSync('sh', ['-c', cmd, 'sh', ...args], { cwd: repo, env: { ...env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root }, encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim().split('\n').filter(Boolean), log: readFileSync(join(bin, 'log'), 'utf8').trim().split('\n').filter(Boolean) };
  };
  return {
    root, repo, bin, worktree, merged,
    used: (n) => writeFileSync(join(bin, 'used'), String(n)),
    precheck: (values = {}) => exec(`${genericDir}/${fill(template(), values).precheck}`),
    // The sweep commands of the prompt as the agent runs them.
    prompt: (values = {}) => [...fill(template(), values).prompt.matchAll(/`(worktree-cleanup\/sweep\.sh (?:report|act) "[^`]*)`/g)].map((m) => exec(`${genericDir}/${m[1]}`)),
    sweep: (mode, limit = '80', ...rest) => exec(`${genericDir}/worktree-cleanup/sweep.sh "$@"`, [mode, limit, ...rest]),
    branches: () => git(repo, 'branch', '--format=%(refname:short)').split('\n'),
  };
}

test('worktree-cleanup: parameters tmp_limit_percent and rebuildable, report only by default, lint passes', () => {
  const t = template();
  assert.deepEqual(Object.keys(t.parameters), ['tmp_limit_percent', 'rebuildable']);
  assert.deepEqual(fill(t).values, { mode: 'report', tmp_limit_percent: '80', rebuildable: 'node_modules,dist,build,.cache' });
  assert.deepEqual(lint(t), []);
  assert.match(t.prompt, /^Remove nothing yourself/m);
});

test('worktree-cleanup precheck: runs for temporary space above the limit or a removable worktree, skips otherwise', sh, () => {
  const f = fixture();
  f.used(81);
  const full = f.precheck();
  assert.equal(full.code, 0);
  assert.ok(full.log.includes(`df -P ${f.root}`), full.log.join('\n'));
  f.used(80);
  assert.equal(f.precheck().code, 1, 'at the limit');
  assert.equal(f.precheck({ tmp_limit_percent: 79 }).code, 0, 'the parameter sets the limit');
  const done = f.worktree('done');
  f.merged('done', commit(done, 'a'));
  assert.equal(f.precheck().code, 0, 'a removable worktree');
  assert.ok(existsSync(done), 'the precheck removes nothing');
  assert.equal(f.sweep('report', '').code, 2, 'an empty limit');
});

test('worktree-cleanup: a dirty worktree and an unpushed commit remove nothing', sh, () => {
  const f = fixture();
  const dirty = f.worktree('dirty'), ahead = f.worktree('ahead');
  f.merged('dirty', commit(dirty, 'a'));
  writeFileSync(join(dirty, 'a'), 'changed');
  f.merged('ahead', commit(ahead, 'b'));
  commit(ahead, 'c');
  const r = f.sweep('act');
  assert.equal(r.code, 1);
  assert.deepEqual(r.out, [`tmp 50 80 ${f.root}`, `keep worktree ${ahead} ahead unpushed`, `keep worktree ${dirty} dirty dirty`]);
  assert.ok(existsSync(dirty) && existsSync(ahead));
  assert.deepEqual(f.branches().sort(), ['ahead', 'dirty', 'main']);
  assert.ok(!r.log.some((l) => / rm /.test(l)), r.log.join('\n'));
});

test('worktree-cleanup: an ignored file keeps its worktree unless a rebuildable folder or an unchanged .worktreeinclude entry holds it', sh, () => {
  const f = fixture();
  writeFileSync(join(f.repo, '.gitignore'), '.env\nnode_modules/\nCLAUDE.local.md\n');
  git(f.repo, 'add', '.gitignore'); git(f.repo, 'commit', '-qm', 'ignore');
  writeFileSync(join(f.repo, '.worktreeinclude'), '# copied\nCLAUDE.local.md\n');
  writeFileSync(join(f.repo, 'CLAUDE.local.md'), 'local');
  const secret = f.worktree('secret'), deps = f.worktree('deps'), copy = f.worktree('copy'), edited = f.worktree('edited');
  for (const b of ['secret', 'deps', 'copy', 'edited']) f.merged(b, git(f.repo, 'rev-parse', 'main'));
  writeFileSync(join(secret, '.env'), 'TOKEN=x');
  mkdirSync(join(deps, 'app', 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(deps, 'app', 'node_modules', 'x', 'index.js'), '');
  writeFileSync(join(copy, 'CLAUDE.local.md'), 'local');
  writeFileSync(join(edited, 'CLAUDE.local.md'), 'edited');
  const kept = [`keep worktree ${edited} edited ignored-files`, `keep worktree ${secret} secret ignored-files`];
  assert.deepEqual(f.sweep('report').out.slice(1).sort(), [...kept, `removable worktree ${copy} copy`, `removable worktree ${deps} deps`].sort());
  assert.ok(f.sweep('report', '80', '').out.includes(`keep worktree ${deps} deps ignored-files`), 'an empty list rebuilds nothing');
  const empty = f.prompt({ rebuildable: '' });
  assert.equal(empty.length, 2);
  for (const r of empty) assert.ok(r.out.includes(`keep worktree ${deps} deps ignored-files`), `an empty parameter rebuilds nothing: ${r.out.join('\n')}`);
  assert.match(fill(template(), { rebuildable: '' }).precheck, / "80" ""$/);
  const act = f.sweep('act');
  assert.deepEqual(act.out.filter((l) => l.startsWith('keep')).sort(), kept);
  assert.ok(existsSync(join(secret, '.env')) && existsSync(join(edited, 'CLAUDE.local.md')));
  assert.ok(!existsSync(deps) && !existsSync(copy));
});

test('worktree-cleanup sweep: lists before act removes merged work with its container and volume, keeps the rest', sh, async () => {
  const f = fixture();
  const done = f.worktree('done'), open = f.worktree('open'), busy = f.worktree('busy'), lost = f.worktree('lost');
  f.merged('done', 'f00', commit(done, 'a'));
  commit(open, 'b');
  f.merged('busy', commit(busy, 'c'));
  f.merged('lost', commit(lost, 'd'));
  git(f.repo, 'worktree', 'lock', lost);
  git(f.repo, 'branch', 'gone', 'main');
  f.merged('gone', git(f.repo, 'rev-parse', 'main'));
  git(f.repo, 'branch', 'other', 'main');
  const session = spawn('sleep', ['30'], { cwd: busy });
  try {
    const report = f.sweep('report');
    assert.equal(report.code, 0);
    assert.deepEqual(report.out.slice(1).sort(), [
      `keep worktree ${busy} busy busy`, `keep worktree ${lost} lost locked`, `keep worktree ${open} open unmerged`,
      'removable branch gone', `removable container c1 ${done}`, `removable volume v1 ${done}`, `removable worktree ${done} done`,
    ].sort());
    assert.ok(existsSync(done) && f.branches().includes('gone'), 'report removes nothing');
    assert.ok(!report.log.some((l) => / rm /.test(l)));

    const act = f.sweep('act');
    assert.deepEqual(act.out.filter((l) => l.startsWith('removed')), [`removed container c1 ${done}`, `removed volume v1 ${done}`, `removed worktree ${done} done`, 'removed branch done', 'removed branch gone']);
    assert.ok(act.log.includes('podman rm -v c1') && act.log.includes('podman volume rm v1'));
    assert.ok(!existsSync(done) && existsSync(open) && existsSync(busy) && existsSync(lost));
    assert.deepEqual(f.branches().sort(), ['busy', 'lost', 'main', 'open', 'other']);
  } finally { session.kill(); }
});

test('worktree-cleanup: a branch whose tip moves during the removal is kept and the worktree reported as removed', sh, () => {
  const f = fixture();
  const done = f.worktree('done');
  f.merged('done', commit(done, 'a'));
  // A podman whose container removal adds a commit to the branch, as a commit from elsewhere would.
  writeFileSync(join(f.bin, 'podman'), `#!/bin/sh\ncase "$*" in "ps -a -q"*) echo c1 ;; "rm -v c1") git update-ref refs/heads/done "$(git -c user.name=t -c user.email=t@example.com commit-tree -p done -m b done^{tree})" ;; esac\n`, { mode: 0o755 });
  const act = f.sweep('act');
  assert.deepEqual(act.out.slice(1), [`removed container c1 ${done}`, `removed worktree ${done} done`, 'kept branch done moved']);
  assert.ok(!existsSync(done));
  assert.deepEqual(f.branches().sort(), ['done', 'main']);
});

test('worktree-cleanup: a file named like a rebuildable folder, an untracked file and a failing ignored-file scan keep the worktree', sh, () => {
  const f = fixture();
  writeFileSync(join(f.repo, '.gitignore'), 'dist\n');
  git(f.repo, 'add', '.gitignore'); git(f.repo, 'commit', '-qm', 'ignore');
  git(f.repo, 'config', 'status.showUntrackedFiles', 'no');
  const file = f.worktree('file'), folder = f.worktree('folder'), loose = f.worktree('loose');
  for (const b of ['file', 'folder', 'loose']) f.merged(b, git(f.repo, 'rev-parse', 'main'));
  writeFileSync(join(file, 'dist'), 'only copy');
  mkdirSync(join(folder, 'dist'));
  writeFileSync(join(folder, 'dist', 'a.js'), '');
  writeFileSync(join(loose, 'notes'), 'untracked');
  assert.deepEqual(f.sweep('act').out.slice(1).sort(), [
    `keep worktree ${file} file ignored-files`, `keep worktree ${loose} loose dirty`, `removed branch folder`, `removed worktree ${folder} folder`,
  ].sort());
  assert.ok(existsSync(join(file, 'dist')) && existsSync(join(loose, 'notes')));
  // A git that fails the ignored-file scan only.
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(f.bin, 'git'), `#!/bin/sh\ncase "$*" in *--ignored=*) exit 128 ;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  rmSync(join(file, 'dist'));
  assert.ok(f.sweep('act').out.includes(`keep worktree ${file} file ignored-scan`));
  assert.ok(existsSync(file));
});

test('worktree-cleanup: a folder whose name joins rebuildable names with a comma and a file named -n keep the worktree', sh, () => {
  const f = fixture();
  writeFileSync(join(f.repo, '.gitignore'), 'dist,build/\n-n\n');
  git(f.repo, 'add', '.gitignore'); git(f.repo, 'commit', '-qm', 'ignore');
  const comma = f.worktree('comma'), option = f.worktree('option');
  for (const b of ['comma', 'option']) f.merged(b, git(f.repo, 'rev-parse', 'main'));
  mkdirSync(join(comma, 'dist,build'));
  writeFileSync(join(comma, 'dist,build', 'a.js'), 'only copy');
  writeFileSync(join(option, '-n'), 'only copy');
  assert.deepEqual(f.sweep('act').out.slice(1).sort(), [`keep worktree ${comma} comma ignored-files`, `keep worktree ${option} option ignored-files`].sort());
  assert.ok(existsSync(join(comma, 'dist,build', 'a.js')) && existsSync(join(option, '-n')));
});
