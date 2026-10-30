import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';
import { main } from '../src/cli.mjs';
import { decide, denyReason } from '../src/guard-hook.mjs';
import { DENY, GUARD_PATH, HOOK, guardChecks, guardScript } from '../src/guards.mjs';
import { apply, context, preview, undo } from '../src/runner.mjs';
import { committedSetup, localSetup, projectPlan, readState } from '../src/steps/project.mjs';
import { initRepo } from './helpers.mjs';

const TMP = realpathSync(tmpdir());
function repo() {
  const dir = mkdtempSync(join(TMP, 'bk-guard-'));
  const git = initRepo(dir);
  const home = mkdtempSync(join(TMP, 'bk-home-'));
  return { dir, git, ctx: context({ home, roots: [home, dir], appVersion: '6.0.0' }) };
}
const read = (p) => readFileSync(p, 'utf8');
const plan = (r, answers) => projectPlan({ ctx: r.ctx, dir: r.dir, answers: { agents: ['claude'], env: 'host-agent', ...answers }, plugins: { claude: [], codex: [] } });
const run = (r, answers) => { const p = plan(r, answers); return apply(preview(p.changes), r.ctx, { scope: r.dir, select: p.changes.filter((c) => c.kind !== 'command').map((c) => c.id) }); };

// The usual form of each command, as Claude Code writes it: a deny rule matches it. A star at the end after a space also matches the bare command.
const globRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/ \*$/, '( .*)?').replace(/\*/g, '.*')}$`);
const ruled = (cmd) => DENY.some((r) => globRe(r.slice(5, -1)).test(cmd));

const USUAL = ['git commit --no-verify', 'git commit -m "x" --no-verify', 'git commit -n', 'git commit -nm x', 'git commit -m x -n', 'git push --no-verify', 'git push -n origin main',
  'git push --force', 'git push origin main --force', 'git push -f', 'git push origin main -f', 'git push -fu origin main', 'git push --force-with-lease',
  'sudo rm x', 'terraform apply -auto-approve', 'kubectl apply -f x.yaml', 'helm upgrade app ./chart'];
// Forms a text pattern misses.
const ODD = ['git -C sub push -f', 'git -c push.default=current push --force', '/usr/bin/git push origin main -f', "git 'push' --force", 'git commit -anm "x"', 'git push origin +main',
  "bash -c 'git push --force'", 'sh -lc "git commit --no-verify -m x"', 'eval "sudo ls"', 'echo $(git push -f)', 'echo "$(git commit -n)"', 'env FOO=1 git push -f', 'timeout 30s git commit -n',
  'nice -n 5 sudo ls', 'cd x && git push origin main -f', 'git status; kubectl -n prod apply -f x', 'terraform -chdir=infra apply', 'helm --kube-context prod upgrade app .',
  'if true; then git push -f; fi', 'cat <<EOF | bash\ngit push --force\nEOF', 'bash <<EOF\nsudo ls\nEOF', 'xargs git push -f', 'FOO=1 sudo -u root ls', 'git\\\n push -f', 'git commit -m x -- a && git commit -n',
  'cat <<< "x"\ngit push -f', 'env -u VAR git push -f', 'timeout -s KILL 10 git push -f', 'xargs -I X git push -f', 'env -C dir git push -f',
  "bash <<< 'git push -f'", 'sh <<< "sudo ls"', 'git commit -S -n', 'git -C x commit -S --no-verify', 'git commit -u -n', 'git push -- origin +main'];
const FINE = ['git commit -m "fix: no-verify docs"', 'git commit -m "x -n y"', "git commit -m '--no-verify'", 'git commit -am msg', 'git commit -m n', 'git push origin main', 'git push -u origin feature', 'git push --set-upstream origin x',
  'git log --grep sudo', 'echo sudo', 'grep -r "git push -f" .', 'terraform plan', 'terraform show apply.tfplan', 'kubectl get pods', 'helm list', 'git status', 'npm test && git diff -n',
  'git commit -F msg.txt', 'git push -o ci.skip origin main', 'cat <<EOF\ngit push -f\nEOF', 'git commit -m "$(cat <<\'EOF\'\nfix: it\'s fine, no --no-verify here\nEOF\n)"', 'git commit -m "it\'s" -- file', '', '# git push -f', 'cat <<< "x"\ngit status', 'env -u VAR git status', 'timeout -s KILL 10 git push origin main',
  'cat <<< "git push -f"', "git commit -m 'document `sudo ls` and $(git push -f) literally'", 'git commit -S -m x', 'git commit -Skey -m x', 'git commit -u -m x', 'git push -- origin main'];

test('each denied command form is denied by a rule or by the hook; nothing else is', () => {
  for (const c of USUAL) assert.ok(ruled(c) && denyReason(c), c);
  for (const c of ODD) assert.ok(denyReason(c), c);
  for (const c of FINE) assert.equal(denyReason(c), null, c);
});

test('the hook only denies: exit 2 with one line, or no output and exit 0', () => {
  const call = (command, tool_name = 'Bash') => spawnSync(process.execPath, [new URL('../src/guard-hook.mjs', import.meta.url).pathname], { input: JSON.stringify({ tool_name, tool_input: { command } }), encoding: 'utf8' });
  const denied = call('git push -f');
  assert.deepEqual([denied.status, denied.stdout, denied.stderr.trim().split('\n').length], [2, '', 1]);
  assert.match(denied.stderr, /^BenchKeeper guard: git push with -f is denied/);
  for (const ok of [call('git status'), call('git push -f', 'Read'), spawnSync(process.execPath, [new URL('../src/guard-hook.mjs', import.meta.url).pathname], { input: 'not json', encoding: 'utf8' })]) assert.deepEqual([ok.status, ok.stdout, ok.stderr], [0, '', '']);
  // Run through a symlinked directory the hook still denies (Node resolves the main module, argv[1] stays as given).
  const link = join(mkdtempSync(join(TMP, 'bk-link-')), 'src');
  symlinkSync(new URL('../src', import.meta.url).pathname, link);
  const viaLink = spawnSync(process.execPath, [join(link, 'guard-hook.mjs')], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push -f' } }), encoding: 'utf8' });
  assert.equal(viaLink.status, 2);
  // Input of other shapes and a loop of eval stay quiet instead of failing.
  assert.equal(decide(JSON.stringify({ tool_name: 'Bash', tool_input: {} })), null);
  assert.equal(denyReason('eval eval eval eval eval eval eval "sudo ls"'), null);
  assert.equal(decide('null'), null);
});

test('local setup: rules merge into the user\'s deny list, the hook is registered, git ignores it all, undo restores the files byte for byte', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude'));
  const mine = '{\n  "permissions": { "deny": ["Read(./.env)"], "allow": ["Bash(npm test)"] },\n  "hooks": { "PreToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "true" }] }] }\n}\n';
  writeFileSync(join(r.dir, '.claude/settings.local.json'), mine);
  const p = plan(r, {});
  const shown = preview(p.changes).filter((c) => c.step === 'guards');
  assert.deepEqual(shown.map((c) => c.path.slice(r.dir.length + 1)), ['.claude/settings.local.json', GUARD_PATH]);
  assert.ok(shown.every((c) => c.selected !== false && c.diff.includes('+')), 'plan and diff show both');
  assert.match(shown[0].diff, /Bash\(sudo \*\)/);
  const done = apply(preview(p.changes), r.ctx, { scope: r.dir, select: p.changes.filter((c) => c.kind !== 'command').map((c) => c.id) });
  assert.equal(done.status, 'done');
  const s = JSON.parse(read(join(r.dir, '.claude/settings.local.json')));
  assert.deepEqual(s.permissions.deny, ['Read(./.env)', ...DENY]);
  assert.deepEqual(s.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(s.hooks.PreToolUse.map((h) => h.matcher), ['Edit', 'Bash']);
  assert.deepEqual(s.hooks.PreToolUse[1], HOOK);
  assert.equal(read(join(r.dir, GUARD_PATH)), guardScript());
  assert.equal(readState(r.dir).guards, true);
  assert.equal(r.git('status', '--porcelain').toString(), '', 'git ignores the settings file and the hook');
  assert.deepEqual(guardChecks(r.dir, readState(r.dir)), []);
  assert.equal(undo(done.id, r.ctx).status, 'done');
  assert.equal(read(join(r.dir, '.claude/settings.local.json')), mine);
  assert.ok(!existsSync(join(r.dir, GUARD_PATH)));
});

test('shared setup: rules and the hook go to the committed settings file; a second apply changes nothing', () => {
  const r = repo();
  assert.equal(run(r, { share: true }).status, 'done');
  assert.deepEqual(JSON.parse(read(join(r.dir, '.claude/settings.json'))).permissions.deny, DENY);
  assert.ok(!existsSync(join(r.dir, '.claude/settings.local.json')));
  assert.ok(existsSync(join(r.dir, GUARD_PATH)));
  assert.ok(preview(plan(r, { share: true }).changes).filter((c) => c.step === 'guards').every((c) => c.noop));
});

test('moving the setup between local and shared takes the rules out of the settings file it left, and your own entries stay', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude'));
  writeFileSync(join(r.dir, '.claude/settings.local.json'), '{ "permissions": { "deny": ["Read(./.env)"] } }\n');
  run(r, {});
  assert.equal(run(r, { share: true }).status, 'done');
  assert.deepEqual(JSON.parse(read(join(r.dir, '.claude/settings.local.json'))), { permissions: { deny: ['Read(./.env)'] } });
  assert.deepEqual(JSON.parse(read(join(r.dir, '.claude/settings.json'))).permissions.deny, DENY);
  assert.equal(run(r, { guards: false }).status, 'done');
  assert.ok(!existsSync(join(r.dir, '.claude/settings.json')) || !read(join(r.dir, '.claude/settings.json')).includes('sudo'));
  assert.ok(!read(join(r.dir, '.claude/settings.local.json')).includes('sudo'));
});

test('sharing moves and guards go off in one run: the rules leave the settings file the setup left', () => {
  const r = repo();
  run(r, {});
  assert.equal(run(r, { share: true, guards: false }).status, 'done');
  for (const f of ['.claude/settings.local.json', '.claude/settings.json']) assert.ok(!existsSync(join(r.dir, f)) || !read(join(r.dir, f)).includes('sudo'), f);
  assert.equal(readState(r.dir).guards, false);
});

test('guards off: only what the run added comes out, the hook file too; the state file records it', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude'));
  writeFileSync(join(r.dir, '.claude/settings.local.json'), '{ "permissions": { "deny": ["Read(./.env)"] } }\n');
  run(r, {});
  const off = plan(r, { guards: false });
  const steps = preview(off.changes).filter((c) => c.step === 'guards');
  assert.equal(steps.length, 2);
  assert.ok(steps.every((c) => c.selected));
  apply(preview(off.changes), r.ctx, { scope: r.dir, select: off.changes.filter((c) => c.kind !== 'command').map((c) => c.id) });
  assert.deepEqual(JSON.parse(read(join(r.dir, '.claude/settings.local.json'))), { permissions: { deny: ['Read(./.env)'] } });
  assert.ok(!existsSync(join(r.dir, GUARD_PATH)));
  assert.equal(readState(r.dir).guards, false);
  // The switch is kept: a later plan without the answer stays off and writes no rule.
  assert.equal(preview(plan(r, {}).changes).filter((c) => c.step === 'guards').length, 0);
  // Guards that were not written by this setup are offered, not preselected.
  const other = repo();
  mkdirSync(join(other.dir, '.claude'));
  writeFileSync(join(other.dir, '.claude/settings.local.json'), '{ "permissions": { "deny": ["Bash(sudo *)"] } }\n');
  const own = preview(plan(other, { guards: false }).changes).find((c) => c.step === 'guards');
  assert.ok(!own.selected && own.title.includes('not written by BenchKeeper'));
});

test('a hook file of the same name that is not ours is offered, not preselected; without Claude Code nothing is written', () => {
  const r = repo();
  mkdirSync(join(r.dir, '.claude/hooks'), { recursive: true });
  writeFileSync(join(r.dir, GUARD_PATH), '// mine\n');
  const file = preview(plan(r, {}).changes).find((c) => c.path === join(r.dir, GUARD_PATH));
  assert.ok(file.selected === false && file.title.includes('replaces your own file'));
  assert.equal(plan(repo(), { agents: ['codex'] }).changes.filter((c) => c.step === 'guards').length, 0);
});

test('remove setup takes the guards out of a local and of a committed setup', () => {
  const r = repo();
  run(r, {});
  const local = localSetup(r.ctx, r.dir).filter((c) => c.step === 'sandbox' || c.step === 'guards');
  assert.deepEqual(local.map((c) => [c.kind, c.path.slice(r.dir.length + 1)]), [['remove', '.claude/settings.local.json'], ['remove', GUARD_PATH]]);
  const s = repo();
  mkdirSync(join(s.dir, '.claude'));
  writeFileSync(join(s.dir, '.claude/settings.json'), '{ "permissions": { "deny": ["Read(./.env)"] } }\n');
  run(s, { share: true });
  const shared = committedSetup(s.dir).filter((c) => c.step === 'sandbox' || c.step === 'guards');
  assert.deepEqual(shared.map((c) => c.kind), ['write', 'remove']);
  assert.deepEqual(JSON.parse(shared[0].edit(read(join(s.dir, '.claude/settings.json')))), { permissions: { deny: ['Read(./.env)'] } });
  // A guard script the user edited is offered for removal, not preselected.
  assert.deepEqual([local, shared].map((l) => l.at(-1).selected), [true, true]);
  for (const [dir, l] of [[r.dir, () => localSetup(r.ctx, r.dir)], [s.dir, () => committedSetup(s.dir)]]) {
    writeFileSync(join(dir, GUARD_PATH), '// mine\n');
    assert.equal(l().find((c) => c.step === 'guards').selected, false);
  }
});

test('doctor: on and complete is quiet, on and missing is a warning, off and present is an info', () => {
  const r = repo();
  run(r, {});
  const state = readState(r.dir);
  assert.deepEqual(guardChecks(r.dir, state), []);
  assert.deepEqual(guardChecks(r.dir, { ...state, agents: ['codex'] }), []);
  // Missing: a rule taken out by hand, then the hook script.
  const file = join(r.dir, '.claude/settings.local.json');
  const full = read(file);
  writeFileSync(file, full.replace(/\s*"Bash\(sudo \*\)",?/, ''));
  const [one] = guardChecks(r.dir, state);
  assert.deepEqual([one.level, one.check], ['warning', 'guards']);
  assert.match(one.message, /1 of 13 deny rules/);
  writeFileSync(file, '{}\n');
  assert.match(guardChecks(r.dir, state)[0].message, /13 of 13 deny rules, the PreToolUse hook/);
  writeFileSync(file, full);
  writeFileSync(join(r.dir, GUARD_PATH), '// changed\n');
  assert.match(guardChecks(r.dir, state)[0].message, /missing or changed/);
  // Off while present: an info; off and gone: quiet.
  const [info] = guardChecks(r.dir, { ...state, guards: false });
  assert.deepEqual([info.level, info.check], ['info', 'guards']);
  assert.match(info.message, /13 deny rules, the PreToolUse hook, \.claude\/hooks\/benchkeeper-guard\.mjs/);
  writeFileSync(file, '{}\n');
  assert.equal(guardChecks(r.dir, { ...state, guards: false }).length, 1);
  rmSync(join(r.dir, GUARD_PATH));
  assert.deepEqual(guardChecks(mkdtempSync(join(TMP, 'bk-none-')), { ...state, guards: false }), []);
  // A state file from before the answer existed counts as on.
  const { guards, ...old } = state;
  assert.equal(guards, true);
  assert.equal(guardChecks(r.dir, old)[0].level, 'warning');
});

test('the command line: --no-guards writes none, --guards writes them again, and the answer is kept', async () => {
  const r = repo();
  const cli = async (...args) => { let text = ''; const out = new Writable({ write(c, _, done) { text += c; done(); } }); const code = await main(['projects', 'apply', r.dir, '--agents', 'claude', '--env', 'host', ...args, '--yes'], { out, ctx: r.ctx, input: Readable.from(['']) }); assert.equal(code, 0, text); };
  await cli('--no-guards');
  assert.deepEqual([existsSync(join(r.dir, '.claude/settings.local.json')), existsSync(join(r.dir, GUARD_PATH)), readState(r.dir).guards], [false, false, false]);
  await cli();
  assert.equal(readState(r.dir).guards, false);
  await cli('--guards');
  assert.deepEqual([JSON.parse(read(join(r.dir, '.claude/settings.local.json'))).permissions.deny, readState(r.dir).guards], [DENY, true]);
});
