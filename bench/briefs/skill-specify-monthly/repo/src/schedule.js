// Dates of recurring reminders as calendar dates 'YYYY-MM-DD' (rules: README.md). Computed in UTC, so the machine's
// time zone does not change them.
const DAY = 86_400_000;

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new RangeError(`invalid date ${s}`);
  return d;
}

export const formatDate = (d) => d.toISOString().slice(0, 10);

function checkCount(count) {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`invalid count ${count}`);
}

export function daily(start, count) {
  checkCount(count);
  const d = parseDate(start);
  return Array.from({ length: count }, (_, i) => formatDate(new Date(d.getTime() + i * DAY)));
}

export function weekly(start, count) {
  checkCount(count);
  const d = parseDate(start);
  return Array.from({ length: count }, (_, i) => formatDate(new Date(d.getTime() + i * 7 * DAY)));
}
