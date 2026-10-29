// A fix names its source as "(https://...)": the fix text without it (and the white space before it), and its URL.
// Not one regex with a leading \s*: that one takes quadratic time on a long run of spaces.
const SOURCE = /\((https:\/\/[^\s)]+)\)/;
export function splitSource(fix) {
  const m = SOURCE.exec(fix);
  return m ? { text: fix.slice(0, m.index).trimEnd() + fix.slice(m.index + m[0].length), source: m[1] } : { text: fix, source: undefined };
}
