// Splits a unified diff from src/diff.mjs into rows of an old and a new column. Runs of removed and added lines pair
// up line by line; the +/- markers stay in the text.
export function sideBySide(unified) {
  if (!unified) return [];
  const rows = [];
  let del = [], add = [];
  const flush = () => {
    for (let i = 0; i < Math.max(del.length, add.length); i++) rows.push({ old: del[i] ?? null, new: add[i] ?? null });
    del = [];
    add = [];
  };
  for (const line of unified.split('\n').slice(2)) {
    if (line === '@@') { flush(); rows.push({ gap: true }); }
    else if (line[0] === '-') del.push(line);
    else if (line[0] === '+') add.push(line);
    else { flush(); rows.push({ old: line, new: line }); }
  }
  flush();
  return rows;
}
