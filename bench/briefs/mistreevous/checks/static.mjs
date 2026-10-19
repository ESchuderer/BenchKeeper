// Static checks of step <k> (Q<k>-*): the repository after the step (/cur) against the state before it (/prev), both
// extracted snapshots with their git history. Prints {checks: [...]}. Runs in a container without network.
// Usage: node static.mjs <prev-dir> <cur-dir> <k>
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (dir, ...a) => execFileSync('git', ['-c', 'safe.directory=*', '-c', 'core.fsmonitor=false', '-C', dir, ...a], { encoding: 'utf8' });
const read = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
const json = (dir, f) => { try { return JSON.parse(read(dir, f)); } catch { return null; } };

// Test cases in a mocha spec: `it(` calls, and the ones that skip or focus (`it.skip`, `xit`, `it.only`, `describe.only`, ...).
export const cases = (src) => (src.match(/(^|[^\w.])it\s*\(/g) || []).length;
export const focusOrSkip = (src) => (src.match(/\b(it|describe|context)\.(only|skip)\s*\(|(^|[^\w.])x(it|describe)\s*\(/g) || []).length;
const specs = (dir) => git(dir, 'ls-files', 'test').split('\n').filter((f) => /\.spec\.ts$/.test(f));
// The rows of the README's "Version History" table, without the header and separator.
export const history = (readme) => {
  const i = (readme || '').search(/^##\s+Version History/m);
  if (i < 0) return [];
  return readme.slice(i).split('\n').filter((l) => /^\|/.test(l)).slice(2).map((l) => l.trim());
};
const deps = (p) => JSON.stringify(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].map((k) => p?.[k] ?? {}));

export function checks(prev, cur, k) {
  const out = [];
  const add = (id, ok, detail) => out.push({ id: `Q${k}-${id}`, ok, detail });
  const before = new Map(specs(prev).map((f) => [f, read(prev, f)]));
  const after = new Map(specs(cur).map((f) => [f, read(cur, f)]));
  const added = [...after].reduce((n, [f, src]) => n + Math.max(0, cases(src) - cases(before.get(f) || '')), 0);
  add('tests', added > 0, `${added} test cases added in test/`);
  const removed = [...before.keys()].filter((f) => !after.has(f));
  const fewer = [...before].filter(([f, src]) => after.has(f) && cases(after.get(f)) < cases(src)).map(([f]) => f);
  const skipped = [...after].filter(([f, src]) => focusOrSkip(src) > focusOrSkip(before.get(f) || '')).map(([f]) => f);
  const intact = !removed.length && !fewer.length && !skipped.length;
  add('intact', intact, intact ? 'no test file removed, no test case removed, skipped or focused'
    : [removed.length && `removed: ${removed.join(', ')}`, fewer.length && `fewer cases: ${fewer.join(', ')}`, skipped.length && `skip or only: ${skipped.join(', ')}`].filter(Boolean).join('; '));
  const pp = json(prev, 'package.json'), cp = json(cur, 'package.json');
  add('deps', deps(pp) === deps(cp), deps(pp) === deps(cp) ? 'dependencies unchanged' : 'package.json dependencies changed');
  if (k <= 2) {
    const r0 = read(prev, 'README.md') || '', r1 = read(cur, 'README.md') || '';
    const ok = r1 !== r0 && /snapshot\s*\(/i.test(r1) && /restore\s*\(/i.test(r1);
    add('docs', ok, ok ? 'README changed and documents snapshot() and restore()' : 'README does not document snapshot() and restore()');
  }
  const rows = history(read(cur, 'README.md')), old = new Set(history(read(prev, 'README.md')));
  const newRow = rows.some((r) => !old.has(r)), bumped = pp?.version !== cp?.version;
  add('history', newRow && bumped, `Version History row added: ${newRow}, package version ${pp?.version} -> ${cp?.version}`);
  const clean = git(cur, 'status', '--porcelain', '--untracked-files=no').trim() === '';
  const moved = git(cur, 'rev-parse', 'HEAD').trim() !== git(prev, 'rev-parse', 'HEAD').trim();
  add('committed', clean && moved, `new commits: ${moved}, tracked changes uncommitted: ${!clean}`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [prev, cur, k] = process.argv.slice(2);
  console.log(JSON.stringify({ checks: checks(prev, cur, Number(k)) }));
}
