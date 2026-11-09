// The window of terminal questions that /benchkeeper:ask and /benchkeeper:questions open, read alike by the plugin's hook (ask.mjs) and its band.

// The line a session reads while the window is closed, and the reason the hook gives when it refuses the question tool or plan mode.
export const OFF = 'Terminal questions are off: the question tool (AskUserQuestion) and plan mode (EnterPlanMode) are refused. Put the open questions with your recommendations into one issue per task in the issue tracker the project names, else the report; take each recommendation that is safe and reversible (an item without one waits), and go on. Only the user can allow terminal questions, with /benchkeeper:ask.';

const pad = (n) => String(n).padStart(2, '0');

// A local time as HH:MM, with its date when that is not today.
export function clock(at, now) {
  const a = new Date(at);
  const time = `${pad(a.getHours())}:${pad(a.getMinutes())}`;
  return a.toDateString() === new Date(now).toDateString() ? time : `${a.getFullYear()}-${pad(a.getMonth() + 1)}-${pad(a.getDate())} ${time}`;
}

// /benchkeeper:questions opens the window until Claude Code quits: an end of Infinity, kept as SESSION in the window file.
export const SESSION = 'session';
export const span = (until, now) => (until === Infinity ? 'for this session' : `until ${clock(until, now)}`);

export const allowed = (until, now) => `Terminal questions are allowed ${span(until, now)}: the user opened them with /benchkeeper:ask or /benchkeeper:questions, and the question tool and plan mode are refused again after that.`;

// The window's end in epoch ms: none 30 minutes, `for <n>m|h`, `until HH:MM` (next such local time); null off, undefined unread.
export function askUntil(args, now) {
  const a = args.trim().toLowerCase();
  if (a === 'off') return null;
  if (a === '') return now + 30 * 60_000;
  const span = /^for (\d{1,4}) ?(m|h)$/.exec(a);
  if (span) return now + Number(span[1]) * (span[2] === 'h' ? 3_600_000 : 60_000);
  const at = /^until ([01]?\d|2[0-3]):([0-5]\d)$/.exec(a);
  if (!at) return undefined;
  const end = new Date(now);
  end.setHours(Number(at[1]), Number(at[2]), 0, 0);
  if (end.getTime() <= now) end.setDate(end.getDate() + 1);
  return end.getTime();
}
