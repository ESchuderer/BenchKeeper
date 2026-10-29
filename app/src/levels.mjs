// The count per doctor level and its text ("2 errors, 1 warning, 1 info") with a zero level left out, for the CLI and
// the UI alike; Insights keeps the level in `severity`.
export function levelCounts(found, of = (i) => i.level) {
  const n = Object.fromEntries(['error', 'warning', 'info'].map((l) => [l, found.filter((i) => of(i) === l).length]));
  return { ...n, text: Object.entries(n).filter(([, c]) => c).map(([l, c]) => `${c} ${l}${c === 1 || l === 'info' ? '' : 's'}`).join(', ') };
}
