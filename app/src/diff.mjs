// Line diff for the plan preview: unified format with 3 lines of context.
export function diffLines(before, after, label = 'file') {
  if (before === after) return '';
  const all = before == null ? [] : before.split('\n');
  const bll = after == null ? [] : after.split('\n');
  // Lines both share at the start and the end stay out of the table: an edit in a long file costs only its middle.
  let p = 0;
  while (p < all.length && p < bll.length && all[p] === bll[p]) p++;
  let q = 0;
  while (q < all.length - p && q < bll.length - p && all[all.length - 1 - q] === bll[bll.length - 1 - q]) q++;
  const a = all.slice(p, all.length - q), b = bll.slice(p, bll.length - q);
  const n = a.length, m = b.length;
  const ops = all.slice(0, p).map((l) => [' ', l]);
  if (n * m > 4e6) {
    // shortcut: a middle too large for the O(n*m) LCS table shows as removed then added; use Myers if that matters.
    ops.push(...a.map((l) => ['-', l]), ...b.map((l) => ['+', l]));
  } else {
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push([' ', a[i++]]); j++; }
      else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push(['-', a[i++]]);
      else ops.push(['+', b[j++]]);
    }
  }
  ops.push(...all.slice(all.length - q).map((l) => [' ', l]));
  if (!ops.some((o) => o[0] !== ' ')) return '';
  const out = [`--- ${before == null ? '/dev/null' : label}`, `+++ ${after == null ? '/dev/null' : label}`];
  const changed = ops.map((o, k) => (o[0] !== ' ' ? k : -1)).filter((k) => k >= 0);
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, changed[k] - 3);
    let end = Math.min(ops.length, changed[k] + 4);
    while (k + 1 < changed.length && changed[k + 1] - 3 <= end) end = Math.min(ops.length, changed[++k] + 4);
    out.push('@@', ...ops.slice(start, end).map((o) => o[0] + o[1]));
    k++;
  }
  return out.join('\n');
}
