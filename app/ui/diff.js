// A unified diff from src/diff.mjs as hunks of numbered lines ({ kind: ' ' | '-' | '+', text, a: old line, b: new line })
// plus the counts of added and removed lines.
export function parseDiff(unified) {
  const hunks = [];
  let added = 0, removed = 0, a = 0, b = 0;
  for (const line of (unified || '').split('\n').slice(2)) {
    const head = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (head) {
      // A side with no lines in the hunk never uses its number.
      [a, b] = [Number(head[1]), Number(head[2])];
      hunks.push({ head: line, lines: [] });
      continue;
    }
    if (!hunks.length) continue;
    const kind = line[0], text = line.slice(1);
    if (kind === '-') { hunks.at(-1).lines.push({ kind, text, a: a++ }); removed++; }
    else if (kind === '+') { hunks.at(-1).lines.push({ kind, text, b: b++ }); added++; }
    else hunks.at(-1).lines.push({ kind: ' ', text, a: a++, b: b++ });
  }
  return { hunks, added, removed };
}

// One hunk's lines as rows of an old and a new cell. Runs of removed and added lines pair up line by line.
export function sideBySide(lines) {
  const rows = [];
  let del = [], add = [];
  const flush = () => {
    for (let i = 0; i < Math.max(del.length, add.length); i++) rows.push({ old: del[i] ?? null, new: add[i] ?? null });
    del = [];
    add = [];
  };
  for (const l of lines) {
    if (l.kind === '-') del.push(l);
    else if (l.kind === '+') add.push(l);
    else { flush(); rows.push({ old: l, new: l }); }
  }
  flush();
  return rows;
}
