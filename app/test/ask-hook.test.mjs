import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../plugins/benchkeeper/hooks/ask/ask.mjs', import.meta.url));
// The inputs Claude Code 2.1.316 gave the plugin's hooks in a scratch session, paths and ids replaced.
const BASE = { session_id: '596beaa6-1d50-456c-aa11-aa29e85e6bcc', transcript_path: '/home/user/.claude/projects/-home-user-proj/596beaa6-1d50-456c-aa11-aa29e85e6bcc.jsonl', cwd: '/home/user/proj', permission_mode: 'acceptEdits' };
const QUESTION = {
  ...BASE,
  hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which color should be written to color.txt?', header: 'Color', options: [{ label: 'Red', description: 'Write red' }, { label: 'Blue', description: 'Write blue' }], multiSelect: false }] },
  tool_use_id: 'toolu_01',
};
const typed = (args) => ({ ...BASE, prompt_id: '708efaa2-3c69-4830-9c29-0b03a091a6cb', hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: 'benchkeeper:ask', command_args: args, command_source: 'plugin', prompt: `/benchkeeper:ask ${args}` });
const start = (source) => ({ ...BASE, hook_event_name: 'SessionStart', source });

// Every run carries one CLAUDE_PID, as the hooks of one Claude Code process do.
const run = (data, input) => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PLUGIN_DATA: data, CLAUDE_PID: '4242' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout).hookSpecificOutput;
};
const decision = (data) => run(data, QUESTION)?.permissionDecision ?? 'none';

test('ask hook: refuses the question tool until /benchkeeper:ask opens a window, and again after off', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  assert.equal(decision(data), 'deny');
  run(data, typed('for 30m'));
  assert.equal(decision(data), 'none');
  run(data, typed('off'));
  assert.equal(decision(data), 'deny');
});

test('ask hook: /clear keeps the window, a resumed conversation starts without it', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  run(data, typed('for 30m'));
  run(data, start('clear'));
  assert.equal(decision(data), 'none');
  run(data, start('resume'));
  assert.equal(decision(data), 'deny');
});

test('ask hook: /benchkeeper:questions allows the question tool for the session, until /benchkeeper:ask off', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  run(data, { ...typed('cedarloom'), command_name: 'benchkeeper:questions', prompt: '/benchkeeper:questions cedarloom' });
  assert.equal(decision(data), 'none');
  run(data, start('compact'));
  assert.equal(decision(data), 'none');
  run(data, typed('off'));
  assert.equal(decision(data), 'deny');
});
