// The run folders a command line may name: those under bench/runs and bench/results and in the temp folder.
// The argument only selects one of them, it is never used as a path itself.
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bench = fileURLToPath(new URL('..', import.meta.url));
const under = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(dir, e.name)) : []);

export function runDir(arg) {
  const run = [join(bench, 'runs'), join(bench, 'results'), tmpdir(), '/tmp'].flatMap(under).find((d) => typeof arg === 'string' && d === resolve(arg));
  if (!run) throw new Error('not a folder of bench/runs, bench/results or the temp folder');
  return run;
}
