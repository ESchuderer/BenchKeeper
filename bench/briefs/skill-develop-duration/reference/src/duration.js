// Durations as written in job files and on the command line: whole numbers with units, largest first or in any order,
// for example 90s or 1h30m. In ms.
const UNIT = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
export const DURATION = /^(\d+(ms|s|m|h))+$/;

export function parseDuration(text) {
  const s = String(text);
  if (!DURATION.test(s)) throw new RangeError(`invalid duration ${text}`);
  let ms = 0;
  for (const [, n, unit] of s.matchAll(/(?<!\d)(\d+)(ms|s|m|h)/g)) ms += Number(n) * UNIT[unit];
  return ms;
}
