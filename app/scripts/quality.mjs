// Floors and baselines of quality.json: coverage per module (the modules of .dependency-cruiser.cjs), knip findings and
// duplicated lines (jscpd). A baseline may only shrink: a new finding fails, and so does a fixed one still listed.
// Usage: node scripts/quality.mjs coverage <lcov file> | baselines [--write]. --write drops fixed findings, never adds one.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const QUALITY = join(here, 'quality.json');
const KINDS = { lines: ['LF', 'LH'], branches: ['BRF', 'BRH'], functions: ['FNF', 'FNH'] };
// jscpd arguments per area of baselines.duplicatedLines, paths relative to app/. `tests` counts tests with the source they repeat,
// .jsx included.
const JS = ['--format', 'javascript,jsx'];
const AREAS = {
  app: [...JS, 'src', 'ui', 'scripts', 'bin'],
  tests: [...JS, '--cross-formats', 'javascript,jsx', 'src', 'ui', 'scripts', 'bin', 'test'],
  web: ['../web/src', '../web/scripts', '../web/tests'],
  plugins: ['../plugins'],
};

// Module name to path pattern, read from the `<module>-imports` rules so the modules are defined in one place.
export const modules = () => Object.fromEntries(createRequire(import.meta.url)('../.dependency-cruiser.cjs').forbidden
  .filter((r) => r.name.endsWith('-imports')).map((r) => [r.name.slice(0, -'-imports'.length), new RegExp(r.from.path)]));

// Percent covered per module and kind from an lcov report; a module without a found line, branch or function gets 100.
export function perModule(lcov, mods) {
  const sums = {};
  for (const record of lcov.split('end_of_record')) {
    const file = /^SF:(.+)$/m.exec(record)?.[1].replaceAll('\\', '/');
    const mod = file && Object.keys(mods).find((m) => mods[m].test(file));
    if (!mod) continue;
    sums[mod] ??= {};
    for (const [kind, [found, hit]] of Object.entries(KINDS)) {
      const n = (key) => Number(new RegExp(`^${key}:(\\d+)$`, 'm').exec(record)?.[1] ?? 0);
      sums[mod][kind] = [(sums[mod][kind]?.[0] ?? 0) + n(found), (sums[mod][kind]?.[1] ?? 0) + n(hit)];
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([m, k]) => [m, Object.fromEntries(Object.entries(k).map(([kind, [f, h]]) => [kind, f ? Math.round(1000 * h / f) / 10 : 100]))]));
}

export const belowFloors = (measured, floors) => Object.entries(floors).flatMap(([m, kinds]) => Object.entries(kinds)
  .filter(([kind, floor]) => (measured[m]?.[kind] ?? 0) < floor).map(([kind, floor]) => `${m} ${kind} ${measured[m]?.[kind] ?? 0} < ${floor}`));

// One line per knip finding: kind, file and name, without positions, so moving code does not change it.
export const knipFindings = (report) => report.issues.flatMap((i) => Object.entries(i)
  .filter(([, v]) => Array.isArray(v)).flatMap(([kind, v]) => v.map((x) => `${kind} ${i.file} ${x.name}`))).sort();

// Problems of a run against the baseline, and the baseline --write may keep (fixed findings out, lower line count).
export function compare(base, run) {
  const known = new Set(base.knip);
  const now = new Set(run.knip);
  return {
    problems: [
      ...run.knip.filter((f) => !known.has(f)).map((f) => `new knip finding: ${f}`),
      ...base.knip.filter((f) => !now.has(f)).map((f) => `fixed knip finding still in the baseline: ${f} (run with --write)`),
      ...Object.entries(run.duplicatedLines).flatMap(([area, n]) => {
        const b = base.duplicatedLines[area] ?? 0;
        if (n > b) return [`${area} duplicated lines ${n} > baseline ${b}`];
        return n < b ? [`${area} duplicated lines ${n} < baseline ${b} (run with --write)`] : [];
      }),
    ],
    shrunk: {
      knip: base.knip.filter((f) => now.has(f)),
      duplicatedLines: Object.fromEntries(Object.entries(run.duplicatedLines).map(([area, n]) => [area, Math.min(base.duplicatedLines[area] ?? 0, n)])),
    },
  };
}

function tool(bin, args) {
  const r = spawnSync(process.execPath, [join(here, 'node_modules', bin), ...args], { cwd: here, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error || r.status > 1) throw new Error(`${bin} failed: ${r.error ?? r.stderr}`);
  return r.stdout;
}

function duplicated(args) {
  const out = mkdtempSync(join(tmpdir(), 'bk-jscpd-'));
  try {
    tool('jscpd/run-jscpd.js', ['--ignore', '**/node_modules/**,**/dist/**', '--reporters', 'json', '--output', out, '--silent', ...args]);
    return JSON.parse(readFileSync(join(out, 'jscpd-report.json'), 'utf8')).statistics.total.duplicatedLines;
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const run = () => ({
  knip: knipFindings(JSON.parse(tool('knip/bin/knip.js', ['--reporter', 'json', '--no-progress']))),
  duplicatedLines: Object.fromEntries(Object.entries(AREAS).map(([area, args]) => [area, duplicated(args)])),
});

// True when this file is the script Node was started with. Node resolves symlinks for import.meta.url but keeps
// process.argv[1] as typed, so both are compared as real paths: started through a symlinked folder, the command line still runs.
const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (isMain()) {
  const [what, arg] = process.argv.slice(2);
  const quality = JSON.parse(readFileSync(QUALITY, 'utf8'));
  let problems;
  if (what === 'coverage') {
    const measured = perModule(readFileSync(arg, 'utf8'), modules());
    for (const [m, k] of Object.entries(measured)) console.log(`${m.padEnd(8)} lines ${k.lines}  branches ${k.branches}  functions ${k.functions}`);
    problems = belowFloors(measured, quality.coverage);
  } else if (what === 'baselines') {
    const r = compare(quality.baselines, run());
    if (arg === '--write') writeFileSync(QUALITY, `${JSON.stringify({ ...quality, baselines: r.shrunk }, null, 2)}\n`);
    problems = arg === '--write' ? r.problems.filter((p) => !p.endsWith('(run with --write)')) : r.problems;
  } else {
    console.error('usage: node scripts/quality.mjs coverage <lcov file> | baselines [--write]');
    process.exit(2);
  }
  for (const p of problems) console.error(`error ${p}`);
  process.exit(problems.length ? 1 : 0);
}
