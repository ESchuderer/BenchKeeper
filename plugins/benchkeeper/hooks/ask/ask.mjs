// The question tool's switch for three hooks: UserPromptExpansion sets the window of /benchkeeper:ask and /benchkeeper:questions, PreToolUse refuses outside it, SessionStart says the mode.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { text } from 'node:stream/consumers';
import { OFF, SESSION, allowed, askUntil } from './window.mjs';

// One file per Claude Code process (CLAUDE_PID, which it sets for hook commands): /clear and compaction keep the window.
const dir = process.env.CLAUDE_PLUGIN_DATA ? join(process.env.CLAUDE_PLUGIN_DATA, 'ask') : null;
const file = dir && join(dir, `${process.env.CLAUDE_PID ?? process.ppid}.json`);

// A window file's end while it is open (Infinity for the session), else null.
function openUntil(path, now) {
  try {
    const at = JSON.parse(readFileSync(path, 'utf8')).askUntil;
    const end = at === SESSION ? Infinity : Date.parse(at);
    return end > now ? end : null;
  } catch {
    return null;
  }
}

// Signal 0 only tests that the process runs, on Windows too (https://nodejs.org/api/process.html#processkillpid-signal).
const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

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
  // A new process or a resumed conversation starts with questions off; the ended windows and those of quit processes go too.
  if (dir && (input.source === 'startup' || input.source === 'resume')) {
    rmSync(file, { force: true });
    let names = [];
    try { names = readdirSync(dir); } catch { /* no window was ever opened */ }
    for (const name of names) {
      const path = join(dir, name);
      if (openUntil(path, now) === null || !running(Number.parseInt(name, 10))) rmSync(path, { force: true });
    }
  }
  say(event, { additionalContext: line(now) });
} else if (event === 'UserPromptExpansion' && ['benchkeeper:ask', 'benchkeeper:questions'].includes(input.command_name)) {
  // Only a typed command expands; a scheduled or delivered prompt with the same text does not (trial, Claude Code 2.1.316).
  if (!file) throw new Error(`the plugin has no data folder (CLAUDE_PLUGIN_DATA), so /${input.command_name} cannot keep its window`);
  const args = String(input.command_args ?? '');
  // Running the question queue is the user allowing terminal questions until Claude Code quits.
  const end = input.command_name === 'benchkeeper:questions' ? Infinity : askUntil(args, now);
  if (end === undefined) {
    say(event, { additionalContext: `/benchkeeper:ask read no window in "${args}", so nothing changed: use it alone (30 minutes), for 30m, for 2h, until 14:30 or off. ${line(now)}` });
  } else if (end === null || end <= now) {
    rmSync(file, { force: true });
    say(event, { additionalContext: OFF });
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify({ askUntil: end === Infinity ? SESSION : new Date(end).toISOString() })}\n`);
    say(event, { additionalContext: allowed(end, now) });
  }
}
