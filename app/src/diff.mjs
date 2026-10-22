// Line diff for the plan preview: unified format with 3 lines of context.
export function diffLines(before, after, label = 'file') {
  const a = before == null ? [] : before.split('\n');
  const b = after == null ? [] : after.split('\n');
  const n = a.length, m = b.length;
  // shortcut: O(n*m) LCS table, fine for config and Markdown files; switch to Myers when files exceed a few thousand lines.
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push([' ', a[i++], j++]);
    else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  if (!ops.some((o) => o[0] !== ' ')) return '';
  const out = [`--- ${before == null ? '/dev/null' : label}`, `+++ ${after == null ? '/dev/null' : label}`];
  const changed = ops.map((o, k) => (o[0] !== ' ' ? k : -1)).filter((k) => k >= 0);
  let k = 0;
  while (k < changed.length) {
    const start = Math.max(0, changed[k] - 3), end = Math.min(ops.length, changed[k] + 4);
    while (k + 1 < changed.length && changed[k + 1] - 3 <= end) end = Math.min(ops.length, changed[++k] + 4);
    out.push('@@', ...ops.slice(start, end).map((o) => o[0] + o[1]));
    k++;
  }
  return out.join('\n');
}
