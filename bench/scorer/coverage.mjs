// Line and branch coverage of an app's own source (files() of erosion.mjs) while its own unit tests run under c8.
// The unit command is `npm test` if that is `node --test ...`, else `npm run test:unit` if that is; no e2e. Null with a reason
// when there is no such command or it fails (a suite that fails only under coverage is still measured, flagged fails_under_coverage). The app is copied to a temp dir first (tests may write).
// Usage: node bench/scorer/coverage.mjs <app-dir>   prints JSON; needs `c8` (bench/scorer/package.json)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { files } from './erosion.mjs';

const C8 = join(import.meta.dirname, 'node_modules/c8/bin/c8.js');
const UNIT = /^node\s+--test\b(?!.*\b(e2e|browser)\b)/;

export function unitCommand(pkg) {
  const s = pkg?.scripts ?? {};
  if (UNIT.test(s.test ?? '')) return ['test'];
  if (UNIT.test(s['test:unit'] ?? '')) return ['run', 'test:unit'];
  return null;
}

export function coverage(dir, timeout = 300_000) {
  const none = (reason) => ({ line: null, branch: null, reason });
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return none('no package.json');
  const cmd = unitCommand(JSON.parse(readFileSync(pkgPath, 'utf8')));
  if (!cmd) return none('no unit test command (npm test is not node --test)');
  const own = files(dir);
  const work = mkdtempSync(join(tmpdir(), 'cov-'));
  try {
    const app = join(work, 'app');
    cpSync(dir, app, { recursive: true });
    mkdirSync(`${work}/v8`);
    // NODE_TEST_CONTEXT is set when this runs inside `node --test`; the app's own `node --test` would then run as a child.
    const env = { ...process.env, CI: '1', NODE_V8_COVERAGE: `${work}/v8` };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync('npm', cmd, { cwd: app, encoding: 'utf8', timeout, env });
    // A suite that fails only under instrumentation (timing assertions) still counts; one that also fails plain gives null.
    let instrumented = false;
    if (r.status !== 0) {
      const plain = spawnSync('npm', cmd, { cwd: app, encoding: 'utf8', timeout, env: { ...env, NODE_V8_COVERAGE: '' } });
      if (plain.status !== 0) return none(`unit tests failed (exit ${r.status ?? r.signal})`);
      instrumented = true;
    }
    // Scripts run through vm or jsdom report a plain path or a bare file name as url; c8 only reads file:// urls.
    // A bare name not found at the app root maps to the one own file of that name, if there is exactly one.
    const byName = (n) => { const m = own.filter((f) => basename(f) === n); return m.length === 1 ? join(app, m[0]) : null; };
    for (const f of readdirSync(`${work}/v8`)) {
      const path = join(work, 'v8', f), j = JSON.parse(readFileSync(path, 'utf8'));
      for (const s of j.result) {
        let abs = s.url.startsWith('/') ? s.url : /^[\w.-]+(\/[\w.-]+)*$/.test(s.url) ? join(app, s.url) : null;
        if (abs && !existsSync(abs) && !s.url.includes('/')) abs = byName(s.url);
        if (abs && existsSync(abs)) s.url = pathToFileURL(abs).href;
      }
      writeFileSync(path, JSON.stringify(j));
    }
    const rep = spawnSync(process.execPath, [C8, 'report', '--all', '--reporter=json-summary', `--temp-directory=${work}/v8`, `--reports-dir=${work}/rep`,
      ...own.flatMap((f) => ['--include', f])], { cwd: app, encoding: 'utf8' });
    if (rep.status !== 0) return none(`c8 report failed: ${rep.stderr.slice(0, 200)}`);
    const t = JSON.parse(readFileSync(join(work, 'rep/coverage-summary.json'), 'utf8')).total;
    // A passing suite that covers no own line loaded the sources in a way c8 cannot map (for example vm without a file name).
    if (t.lines.covered === 0) return none('tests pass, but no own source line maps to coverage (sources loaded without a file name)');
    return { line: t.lines.pct, branch: t.branches.pct, lines: t.lines.total, covered_lines: t.lines.covered, command: `npm ${cmd.join(' ')}`, fails_under_coverage: instrumented, reason: null };
  } catch (e) {
    return none(`error: ${e.message}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(coverage(process.argv[2])));
