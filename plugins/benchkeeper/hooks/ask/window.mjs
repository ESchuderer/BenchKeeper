// The window of terminal questions that /benchkeeper:ask opens, read alike by the plugin's hook (ask.mjs) and its band.

// The line a session reads while the window is closed, and the reason the hook gives when it refuses the question tool.
export const OFF = 'Terminal questions are off: the question tool (AskUserQuestion) is refused. Put the open questions with your recommendations into one issue per task in the issue tracker the project names, else the report; take each recommendation that is safe and reversible (an item without one waits), and go on. Only the user can allow terminal questions, with /benchkeeper:ask.';

const pad = (n) => String(n).padStart(2, '0');

// A local time as HH:MM, with its date when that is not today.
export function clock(at, now) {
  const a = new Date(at);
  const time = `${pad(a.getHours())}:${pad(a.getMinutes())}`;
  return a.toDateString() === new Date(now).toDateString() ? time : `${a.getFullYear()}-${pad(a.getMonth() + 1)}-${pad(a.getDate())} ${time}`;
}

export const allowed = (until, now) => `Terminal questions are allowed until ${clock(until, now)}: the user opened them with /benchkeeper:ask, and the question tool is refused again after that.`;

// The end of the window the arguments ask for, in epoch milliseconds: none for 30 minutes, `for <n>m` or `for <n>h`, or
// `until HH:MM` (the next such local time); null for `off`, undefined for arguments it does not read.
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
