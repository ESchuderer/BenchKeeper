import { keyed, mask, maskKeys } from './redact.mjs';

// Line diff for the plan preview: unified format with 3 lines of context. Secrets in any line shown, context included,
// are masked (the files are written from the real text, never from this).
export function diffLines(before, after, label = 'file') {
  if (before === after) return '';
  const all = before == null ? [] : before.split('\n');
  const bll = after == null ? [] : after.split('\n');
  // The ops carry the lines with key bodies masked over the whole text: a key spans lines, so mask() on one line misses it.
  // maskKeys keeps the line count, so index k of a masked text is line k of its source.
  const [ma, mb] = [before, after].map((t) => (t == null ? [] : maskKeys(t).split('\n')));
  // A shared line may be a key body on one side only: it shows masked if either side masks it.
  const same = (i, j) => [' ', ma[i] === all[i] ? mb[j] : ma[i]];
  // Lines both share at the start and the end stay out of the table: an edit in a long file costs only its middle.
  let p = 0;
  while (p < all.length && p < bll.length && all[p] === bll[p]) p++;
  let q = 0;
  while (q < all.length - p && q < bll.length - p && all[all.length - 1 - q] === bll[bll.length - 1 - q]) q++;
  const a = all.slice(p, all.length - q), b = bll.slice(p, bll.length - q);
  const n = a.length, m = b.length;
  const ops = all.slice(0, p).map((_, i) => same(i, i));
  if (n * m > 4e6) {
    // shortcut: a middle too large for the O(n*m) LCS table shows as removed then added; use Myers if that matters.
    ops.push(...ma.slice(p, p + n).map((l) => ['-', l]), ...mb.slice(p, p + m).map((l) => ['+', l]));
  } else {
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push(same(p + i++, p + j++)); }
      else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push(['-', ma[p + i++]]);
      else ops.push(['+', mb[p + j++]]);
    }
  }
  for (let k = q; k > 0; k--) ops.push(same(all.length - k, bll.length - k));
  if (!ops.some((o) => o[0] !== ' ')) return '';
  const out = [`--- ${before == null ? '/dev/null' : label}`, `+++ ${after == null ? '/dev/null' : label}`];
  const changed = ops.map((o, k) => (o[0] !== ' ' ? k : -1)).filter((k) => k >= 0);
  // Line numbers before each op, old and new, for the hunk headers.
  const at = [[1, 1]];
  for (const [m] of ops) { const [a, b] = at.at(-1); at.push([a + (m !== '+'), b + (m !== '-')]); }
  // As in unified diff: an empty side names the line before.
  const range = (from, n) => `${n ? from : from - 1},${n}`;
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, changed[k] - 3);
    let end = Math.min(ops.length, changed[k] + 4);
    while (k + 1 < changed.length && changed[k + 1] - 3 <= end) end = Math.min(ops.length, changed[++k] + 4);
    const hunk = ops.slice(start, end);
    out.push(`@@ -${range(at[start][0], hunk.filter((o) => o[0] !== '+').length)} +${range(at[start][1], hunk.filter((o) => o[0] !== '-').length)} @@`, ...hunk.map((o) => o[0] + mask(o[1], { keys: keyed(label) })));
    k++;
  }
  return out.join('\n');
}
