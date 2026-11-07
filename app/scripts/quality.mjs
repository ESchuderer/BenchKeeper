// Baselines of quality.json: knip findings and duplicated lines (jscpd). A baseline may only shrink: a new finding fails,
// and so does a fixed one still listed.
// Usage: node scripts/quality.mjs baselines [--write]. --write drops fixed findings, never adds one.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('..', import.meta.url));
const QUALITY = join(here, 'quality.json');
// jscpd arguments per area of baselines.duplicatedLines, paths relative to app/. `tests` counts tests with the source they repeat,
// .jsx included.
const JS = ['--format', 'javascript,jsx'];
const AREAS = {
  app: [...JS, 'src', 'ui', 'scripts', 'bin'],
  tests: [...JS, '--cross-formats', 'javascript,jsx', 'src', 'ui', 'scripts', 'bin', 'test'],
  web: ['../web/src', '../web/scripts', '../web/tests'],
  plugins: ['../plugins'],
};

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

// import.meta.main (Node 22.18 and later) is true for the entry module, also through a symlink, but false while a
// preload (--import) imports it first. So also compare real paths, as Node keeps process.argv[1] as given (macOS /var is
// /private/var), except under -e or -p, where process.argv[1] is an argument and not the entry module.
const evalOrPrint = process.execArgv.some((a) => /^-[ep]+$/.test(a) || a === '--eval' || a === '--print' || a.startsWith('--eval=') || a.startsWith('--print='));
if (import.meta.main || (!evalOrPrint && process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)))) {
  const [what, arg] = process.argv.slice(2);
  const quality = JSON.parse(readFileSync(QUALITY, 'utf8'));
  let problems;
  if (what === 'baselines') {
    const r = compare(quality.baselines, run());
    if (arg === '--write') writeFileSync(QUALITY, `${JSON.stringify({ ...quality, baselines: r.shrunk }, null, 2)}\n`);
    problems = arg === '--write' ? r.problems.filter((p) => !p.endsWith('(run with --write)')) : r.problems;
  } else {
    console.error('usage: node scripts/quality.mjs baselines [--write]');
    process.exit(2);
  }
  for (const p of problems) console.error(`error ${p}`);
  process.exit(problems.length ? 1 : 0);
}
