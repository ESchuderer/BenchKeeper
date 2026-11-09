// The question tool's switch for three hooks: UserPromptExpansion sets the /benchkeeper:ask window, PreToolUse refuses outside it, SessionStart says the mode.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { OFF, allowed, askUntil } from './window.mjs';

// One file per Claude Code process (CLAUDE_PID, which it sets for hook commands): /clear and compaction keep the window.
const dir = process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'ask') : null;
const file = dir && join(dir, `${process.env.CLAUDE_PID ?? process.ppid}.json`);

// A window file's end while it is open, else null.
function openUntil(path, now) {
  try {
    const end = Date.parse(JSON.parse(readFileSync(path, 'utf8')).askUntil);
    return end > now ? end : null;
  } catch {
    return null;
  }
}

const line = (now) => {
  const end = openUntil(file, now);
  return end === null ? OFF : allowed(end, now);
};
const say = (event, fields) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...fields } }));

const input = JSON.parse(await text(process.stdin));
const event = input.hook_event_name;
const now = Date.now();
if (event === 'PreToolUse') {
  if (openUntil(file, now) === null) say(event, { permissionDecision: 'deny', permissionDecisionReason: OFF });
} else if (event === 'SessionStart') {
  // A new process or a resumed conversation starts with questions off; ended windows of earlier processes go too.
  if (dir && (input.source === 'startup' || input.source === 'resume')) {
    rmSync(file, { force: true });
    let names = [];
    try { names = readdirSync(dir); } catch { /* no window was ever opened */ }
    for (const name of names) if (openUntil(join(dir, name), now) === null) rmSync(join(dir, name), { force: true });
  }
  say(event, { additionalContext: line(now) });
} else if (event === 'UserPromptExpansion' && input.command_name === 'benchkeeper:ask') {
  // Only a typed command expands; a scheduled or delivered prompt with the same text does not (trial, Claude Code 2.1.316).
  if (!file) throw new Error('the plugin has no data folder (CLAUDE_PLUGIN_DATA), so /benchkeeper:ask cannot keep its window');
  const args = String(input.command_args ?? '');
  const end = askUntil(args, now);
  if (end === undefined) {
    say(event, { additionalContext: `/benchkeeper:ask read no window in "${args}", so nothing changed: use it alone (30 minutes), for 30m, for 2h, until 14:30 or off. ${line(now)}` });
  } else if (end === null || end <= now) {
    rmSync(file, { force: true });
    say(event, { additionalContext: OFF });
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ askUntil: new Date(end).toISOString() })}\n`);
    say(event, { additionalContext: allowed(end, now) });
  }
}
