// The question tool's switch, one script for three hooks of the plugin: UserPromptSubmit opens or ends the window that
// /benchkeeper:ask names, PreToolUse refuses AskUserQuestion outside it, SessionStart adds a line on the current mode.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { OFF, allowed, askUntil } from './window.mjs';

const COMMAND = /^\s*\/benchkeeper:ask(?:\s+([\s\S]*))?$/;

// One file per Claude Code process, the hook's parent (the hooks run without a shell): /clear and compaction keep the window.
const data = process.env.CLAUDE_PLUGIN_DATA;
const file = data ? join(data, 'ask', `${process.ppid}.json`) : null;

// The window's end while it is open, else null.
function openUntil(now) {
  try {
    const end = Date.parse(JSON.parse(readFileSync(file, 'utf8')).askUntil);
    return end > now ? end : null;
  } catch {
    return null;
  }
}

const line = (now) => {
  const end = openUntil(now);
  return end === null ? OFF : allowed(end, now);
};
const say = (event, fields) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } }));

const input = JSON.parse(await text(process.stdin));
const event = input.hook_event_name;
const now = Date.now();
if (event === 'PreToolUse') {
  if (openUntil(now) === null) say(event, { permissionDecision: 'deny', permissionDecisionReason: OFF });
} else if (event === 'SessionStart') {
  // A new process never inherits the window of an ended one that had the same process id.
  if (input.source === 'startup' && file) rmSync(file, { force: true });
  say(event, { additionalContext: line(now) });
} else if (event === 'UserPromptSubmit') {
  const command = COMMAND.exec(String(input.prompt ?? ''));
  if (command) {
    if (!file) throw new Error('the plugin has no data folder (CLAUDE_PLUGIN_DATA), so /benchkeeper:ask cannot keep its window');
    const end = askUntil(command[1] ?? '', now);
    if (end === undefined) {
      say(event, { additionalContext: `/benchkeeper:ask read no window in "${command[1]}", so nothing changed: use it alone (30 minutes), for 30m, for 2h, until 14:30 or off. ${line(now)}` });
    } else if (end === null || end <= now) {
      rmSync(file, { force: true });
      say(event, { additionalContext: OFF });
    } else {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ askUntil: new Date(end).toISOString() })}\n`);
      say(event, { additionalContext: allowed(end, now) });
    }
  }
}
