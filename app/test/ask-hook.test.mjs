import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../plugins/benchkeeper/hooks/ask/ask.mjs', import.meta.url));
// The inputs Claude Code 2.1.316 gave the plugin's hook in a scratch session, paths and ids replaced.
const BASE = { session_id: '596beaa6-1d50-456c-aa11-aa29e85e6bcc', transcript_path: '/home/user/.claude/projects/-home-user-proj/596beaa6-1d50-456c-aa11-aa29e85e6bcc.jsonl', cwd: '/home/user/proj', permission_mode: 'acceptEdits' };
const QUESTION = {
  ...BASE,
  hook_event_name: 'PreToolUse',
  tool_name: 'AskUserQuestion',
  tool_input: { questions: [{ question: 'Which color should be written to color.txt?', header: 'Color', options: [{ label: 'Red', description: 'Write red' }, { label: 'Blue', description: 'Write blue' }], multiSelect: false }] },
  tool_use_id: 'toolu_01',
};
const prompt = (text) => ({ ...BASE, hook_event_name: 'UserPromptSubmit', prompt: text });

// Every run is a child of this test process, so all of them share one window file, as the hooks of one Claude Code process do.
const run = (data, input) => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(input), env: { ...process.env, CLAUDE_PLUGIN_DATA: data }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout === '' ? null : JSON.parse(r.stdout).hookSpecificOutput;
};
const decision = (data) => run(data, QUESTION)?.permissionDecision ?? 'none';

test('ask hook: refuses the question tool until /benchkeeper:ask opens a window, and again after off', () => {
  const data = mkdtempSync(join(tmpdir(), 'ask-'));
  assert.equal(decision(data), 'deny');
  run(data, prompt('/benchkeeper:ask for 30m'));
  assert.equal(decision(data), 'none');
  run(data, prompt('/benchkeeper:ask off'));
  assert.equal(decision(data), 'deny');
});
