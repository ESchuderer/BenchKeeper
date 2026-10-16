// Literal replacement for the validators' mutants: node /common/replace.mjs <file> <old> <new> [<old> <new> ...];
// fails when an <old> text is not in the file.
import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...pairs] = process.argv.slice(2);
let s = readFileSync(file, 'utf8');
for (let i = 0; i < pairs.length; i += 2) {
  if (!s.includes(pairs[i])) throw new Error(`${file}: not found: ${pairs[i]}`);
  s = s.replace(pairs[i], () => pairs[i + 1]);
}
writeFileSync(file, s);
