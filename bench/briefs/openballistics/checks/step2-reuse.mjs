// S2-reuse: the compare code reuses lib/ (shapes2d, geometry, geom, render2d) instead of copying it.
// Usage: node step2-reuse.mjs <app> <added.diff> <jscpd.json> <numstat>; prints one check as JSON.
// - imports: an added line imports one of those modules, directly or through a site module that does
// - copies: no jscpd clone (50 tokens or more) between added lines and code in lib/ that was there before
// - redefinitions: no added definition of a function the libraries export for profiles, paths or formatting
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const [app, diffFile, jscpdFile, numstatFile] = process.argv.slice(2);
const LIBS = /^lib\/(shapes2d|geometry|geom|render2d)(\/|$)/;
const NAMES = ['caseOuterProfile', 'adaptMetallic', 'rimProfile', 'neckProfile', 'profilesFor', 'formatValue', 'fullSectionPath', 'pathOf', 'viewportFor'];

// Added lines per file, from `git diff -U0`.
const added = new Map();
let lines = null, n = 0;
for (const line of readFileSync(diffFile, 'utf8').split('\n')) {
  if (line.startsWith('+++ ')) {
    lines = line === '+++ /dev/null' ? null : new Map();
    if (lines) added.set(line.slice(6), lines);
    continue;
  }
  const h = /^@@ -\S+ \+(\d+)/.exec(line);
  if (h) n = Number(h[1]);
  else if (lines && line.startsWith('+')) lines.set(n++, line.slice(1));
}
const isAdded = (f, n) => added.get(f)?.has(n) ?? false;

// Module resolution for imports in site/ and lib/.
function target(from, spec) {
  let p;
  if (spec.startsWith('@lib/')) p = join('lib', spec.slice(5));
  else if (spec.startsWith('$lib/')) p = join('site/src/lib', spec.slice(5));
  else if (spec.startsWith('.')) p = join(dirname(from), spec);
  else return null;
  for (const c of [p, `${p}.ts`, `${p}.js`, `${p}.svelte.ts`, join(p, 'index.ts')]) {
    if (existsSync(join(app, c)) && statSync(join(app, c)).isFile()) return c;
  }
  return p.replace(/\.(ts|js)$/, '');
}
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const specs = (text) => [...text.matchAll(IMPORT)].map((m) => m[1] ?? m[2]);

// Site modules that reach the libraries, directly or transitively.
const walk = (d, out = []) => {
  for (const n of readdirSync(join(app, d))) {
    const p = join(d, n);
    if (statSync(join(app, p)).isDirectory()) { if (n !== 'node_modules' && n !== 'dist') walk(p, out); } else if (/\.(ts|js|svelte)$/.test(n)) out.push(p);
  }
  return out;
};
const site = walk('site/src');
const graph = new Map(site.map((f) => [f, specs(readFileSync(join(app, f), 'utf8')).map((s) => target(f, s)).filter(Boolean)]));
const reaches = new Set();
for (let grew = true; grew;) {
  grew = false;
  for (const [f, ts] of graph) if (!reaches.has(f) && ts.some((t) => LIBS.test(t) || reaches.has(t))) { reaches.add(f); grew = true; }
}

const notes = [];
const code = [...added].filter(([f]) => /\.(ts|js|mjs|svelte)$/.test(f));
const importing = code.filter(([f, lines]) => specs([...lines.values()].join('\n')).map((s) => target(f, s)).some((t) => t && (LIBS.test(t) || reaches.has(t))));
if (!importing.length) notes.push('no added import of lib/shapes2d, lib/geometry, lib/geom or lib/render2d, directly or through a site module');

const def = new RegExp(`\\b(?:function\\s+(${NAMES.join('|')})\\b|(?:const|let|var)\\s+(${NAMES.join('|')})\\s*=)`);
const redefined = code.filter(([f]) => !LIBS.test(f) && f !== 'lib/core/format.ts').flatMap(([f, lines]) =>
  [...lines].filter(([, l]) => def.test(l)).map(([n, l]) => `${f}:${n} ${def.exec(l).slice(1).find(Boolean)}`));
if (redefined.length) notes.push(`redefined: ${redefined.join(', ')}`);

// Clones with one fragment in added lines and the other in lib/ code that was there before (repeated route blocks in
// the site are its own pattern, not a copy of a library).
// Absolute names (--absolute); a block embedded in another format (a Svelte script) carries a ":<format>" suffix.
const rel = (p) => relative(app, resolve(app, p.replace(/:[a-z]+$/, '')));
const overlaps = (f, s, e) => { for (let n = s; n <= e; n++) if (isAdded(f, n)) return true; return false; };
const clones = (() => { try { return JSON.parse(readFileSync(jscpdFile, 'utf8')).duplicates ?? []; } catch { return null; } })();
if (clones === null) notes.push('jscpd report missing');
const copied = (clones ?? []).flatMap((d) => {
  const x = { f: rel(d.firstFile.name), s: d.firstFile.start, e: d.firstFile.end };
  const y = { f: rel(d.secondFile.name), s: d.secondFile.start, e: d.secondFile.end };
  const [ax, ay] = [overlaps(x.f, x.s, x.e), overlaps(y.f, y.s, y.e)];
  const [from, of] = ax ? [x, y] : [y, x];
  return ax !== ay && of.f.startsWith('lib/') ? [`${from.f}:${from.s} copies ${of.f}:${of.s}-${of.e}`] : [];
});
if (copied.length) notes.push(`copied: ${copied.join(', ')}`);

// Size of the change, for the record (not part of the result): files and lines, site/ and lib/ apart from the rest.
const stat = { files: 0, added: 0, removed: 0, appFiles: 0, appAdded: 0, appRemoved: 0 };
for (const line of readFileSync(numstatFile, 'utf8').split('\n').filter(Boolean)) {
  const [a, r, f] = line.split('\t');
  const [na, nr] = [Number(a) || 0, Number(r) || 0];
  stat.files++; stat.added += na; stat.removed += nr;
  if (/^(site|lib)\//.test(f)) { stat.appFiles++; stat.appAdded += na; stat.appRemoved += nr; }
}
const size = `diff: ${stat.files} files +${stat.added} -${stat.removed}; site/ and lib/: ${stat.appFiles} files +${stat.appAdded} -${stat.appRemoved}`;
const ok = clones !== null && !notes.length;
console.log(JSON.stringify({ id: 'S2-reuse', ok, detail: `${ok ? `imports via ${importing.map(([f]) => f).join(', ')}` : notes.join('; ')}. ${size}`, diff: stat }));
