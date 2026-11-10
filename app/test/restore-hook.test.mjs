import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../plugins/benchkeeper/hooks/rotation/restore.mjs', import.meta.url));
const OWNED = '# Handoff\nTerminal: term-a\n\n## Next\nwatch #12\n';
const RUNS = join('.benchkeeper', 'runs');

// A folder holding the coordinator's handoff file, untracked in a git work tree unless `git` is false.
const folder = ({ text = OWNED, git = true } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'restore-'));
  if (git) execFileSync('git', ['init', '-q', root]);
  mkdirSync(join(root, RUNS), { recursive: true });
  writeFileSync(join(root, RUNS, 'handoff.md'), text);
  return root;
};
// What the hook prints for a SessionStart after a clear in that folder, the way Codex runs it.
const restore = (root, { terminal = 'term-a', input = JSON.stringify({ hook_event_name: 'SessionStart', source: 'clear', cwd: root }) } = {}) => {
  const r = spawnSync(process.execPath, [HOOK], { input, env: { ...process.env, ORCA_TERMINAL_HANDLE: terminal }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

test('restore hook: hands back the file its terminal owns, cut to stay below 10,000 characters', () => {
  assert.match(restore(folder()), /\n# Handoff\nTerminal: term-a\n\n## Next\nwatch #12\n$/);
  assert.ok(restore(folder({ text: OWNED + 'x'.repeat(20_000) })).length < 10_000);
});

test('restore hook: prints nothing for another terminal, a linked file or folder, a tracked file, a folder outside git, or bad input', () => {
  assert.equal(restore(folder(), { terminal: 'term-b' }), '');
  const linked = folder();
  renameSync(join(linked, RUNS, 'handoff.md'), join(linked, 'notes.md'));
  symlinkSync(join(linked, 'notes.md'), join(linked, RUNS, 'handoff.md'));
  assert.equal(restore(linked), '');
  const behind = folder();
  renameSync(join(behind, RUNS), join(behind, 'elsewhere'));
  symlinkSync(join(behind, 'elsewhere'), join(behind, RUNS));
  assert.equal(restore(behind), '');
  const tracked = folder();
  execFileSync('git', ['-C', tracked, 'add', '-f', join(RUNS, 'handoff.md')]);
  assert.equal(restore(tracked), '');
  assert.equal(restore(folder({ git: false })), '');
  assert.equal(restore(folder(), { input: 'not json' }), '');
});
