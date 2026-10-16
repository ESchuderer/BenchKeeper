// Durations as written in job files and on the command line: a whole number and a unit, for example 90s. In ms.
const UNIT = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

export function parseDuration(text) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(text));
  if (!m) throw new RangeError(`invalid duration ${text}`);
  return Number(m[1]) * UNIT[m[2]];
}
