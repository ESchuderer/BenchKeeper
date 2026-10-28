// Audit (#359): where a project's CI and tests are in bad shape or bloated, from files only. Read only: it reads the
// checkout and runs no project command (no script, tool or test), so it writes no coverage folder and executes no project code.
// Decisions: checks are data (id, group, needs, run). A check whose need is missing is skipped and listed with the one-line way
// to enable it, never a failure, and a project is never told to install a tool. A finding has the shape of the Insights
// findings (id, signal, severity, message, evidence with file and line, fix) plus an effort. No check suggests lowering a
// threshold, raising a budget, removing a check or adding a suppression: a fix only removes waste or raises a floor.
// Not built (they need run history, the network or a project tool): jobs whose time dominates, required checks no workflow
// produces, workflows idle for 90 days, slowest and flaky tests, test count against coverage, mutation score, unused code
// and dependencies, large functions, quality gate and code scanning findings.
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LineCounter, isMap, isSeq, parseDocument } from 'yaml';
import { git } from './git.mjs';

export const GROUPS = ['workflows', 'tests', 'code', 'findings'];
const SEVERITY = ['error', 'warning', 'info'];
// shortcut: a file over 512 KiB is not read (so a very large generated file is not reported), at most 5000 files and 500000 tokens are scanned; upgrade when a project needs more.
const MAX_FILES = 5000, MAX_BYTES = 512 * 1024, MAX_TOKENS = 500000, MAX_FINDINGS = 20;
const COVERAGE_GAP = 10, SNAPSHOT_BYTES = 1024 * 1024, FILE_LINES = 1000, MATRIX_SIZE = 8;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage']);

// ---- the project: its file list and the files a check reads, each bounded

function walk(dir, rel = '', out = []) {
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (out.length >= MAX_FILES) break;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name)) walk(dir, p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// A repository lists its tracked files (generated folders ignored by git stay out); anything else is walked without dot folders.
function listProject(ctx, dir) {
  const r = git(ctx, dir, ['ls-files', '-z'], { timeout: 20000 });
  return (r.code === 0 ? r.stdout.split('\0').filter(Boolean) : walk(dir)).slice(0, MAX_FILES);
}

const SOURCE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift|scala)$/;
const TEST = /(?:^|\/)(?:tests?|__tests__|spec)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]*\.py$|_test\.(?:py|go)$/;
const SNAPSHOT = /\.snap$|(?:^|\/)__snapshots__\//;
const FIXTURE = /(?:^|\/)(?:__fixtures__|fixtures|testdata)\//;

function load(ctx, dir) {
  const files = listProject(ctx, dir);
  const cache = new Map();
  const info = (rel) => { try { const s = lstatSync(join(dir, rel)); return s.isFile() ? s : null; } catch { return null; } };
  const text = (rel) => {
    if (!cache.has(rel)) { const s = info(rel); cache.set(rel, s && s.size <= MAX_BYTES ? readFileSync(join(dir, rel), 'utf8') : null); }
    return cache.get(rel);
  };
  let names = [];
  try { names = readdirSync(join(dir, '.github/workflows')).filter((n) => /\.ya?ml$/.test(n)).sort(); } catch { /* none */ }
  const workflows = names.flatMap((n) => {
    const file = `.github/workflows/${n}`, body = text(file);
    if (body == null) return [];
    const lc = new LineCounter(), doc = parseDocument(body, { lineCounter: lc });
    return doc.errors.length ? [] : [{ file, doc, lc, js: doc.toJS() ?? {} }];
  });
  const source = files.filter((f) => SOURCE.test(f) && !TEST.test(f) && !/\.min\./.test(f));
  const tests = files.filter((f) => SOURCE.test(f) && TEST.test(f));
  const sized = (re) => files.filter((f) => re.test(f)).map((f) => ({ file: f, bytes: info(f)?.size ?? 0 }));
  const p = { dir, files, workflows, source, tests, text, snapshots: sized(SNAPSHOT), fixtures: sized(FIXTURE) };
  p.floors = floorsOf(p);
  p.coverage = measuredCoverage(p);
  return p;
}

// ---- finding helpers

const finding = (id, signal, severity, message, evidence, fix, effort) => ({ id, signal, severity, message, evidence, fix, effort });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The line of a key (or sequence item) at a path of a parsed workflow.
function lineOf(wf, path) {
  let node = wf.doc.contents, at = node;
  for (const seg of path) {
    const next = isMap(node) ? node.items.find((x) => x.key?.value === seg) : isSeq(node) ? node.items[seg] : null;
    if (!next) break;
    at = next.key ?? next;
    node = next.value ?? next;
  }
  return at?.range ? wf.lc.linePos(at.range[0]).line : 1;
}

const events = (js) => {
  const on = js.on;
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, null]));
  return on && typeof on === 'object' ? on : {};
};
const jobsOf = (js) => Object.entries(js.jobs ?? {}).filter(([, j]) => j && typeof j === 'object');
const stepsOf = (job) => (Array.isArray(job.steps) ? job.steps.filter((s) => s && typeof s === 'object') : []);
const runText = (step) => (typeof step.run === 'string' ? step.run : '');
const list = (v) => [].concat(v ?? []);

// ---- workflows

function duplicateTrigger(p) {
  return p.workflows.flatMap((wf) => {
    const ev = events(wf.js);
    if (!('push' in ev) || !('pull_request' in ev)) return [];
    const push = ev.push ?? {};
    const filtered = push.branches || push['branches-ignore'] || push.tags || push['tags-ignore'];
    if (filtered && !list(push.branches).includes('**')) return [];
    return [finding(`workflows/duplicate-trigger:${wf.file}`, 'workflows', 'warning',
      `${wf.file} runs on every push and on every pull request, so a commit on a pull request branch runs twice`,
      { file: wf.file, line: lineOf(wf, ['on', 'push']) }, 'limit push to the default branch (push: branches: [main]); pull requests keep running through pull_request', 'small')];
  });
}

const cancels = (c) => !!c && typeof c === 'object' && c['cancel-in-progress'] !== undefined && c['cancel-in-progress'] !== false;
function noCancel(p) {
  return p.workflows.flatMap((wf) => {
    const jobs = jobsOf(wf.js);
    if (!('pull_request' in events(wf.js)) || !jobs.length || cancels(wf.js.concurrency) || jobs.every(([, j]) => cancels(j.concurrency))) return [];
    return [finding(`workflows/no-cancel:${wf.file}`, 'workflows', 'warning',
      `${wf.file} does not cancel a superseded run: every push to a pull request runs the whole workflow to the end`,
      { file: wf.file, line: lineOf(wf, ['on', 'pull_request']) }, 'add concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true } (limit the cancel to pull request runs when the default branch must finish every run)', 'small')];
  });
}

const WORK = /\b(?:test|tests|build|lint|pytest|jest|vitest|mocha|tsc|cargo|gradle|mvn|make)\b/;
function noPathFilter(p) {
  return p.workflows.flatMap((wf) => {
    const pr = events(wf.js).pull_request;
    if (pr === undefined || pr?.paths || pr?.['paths-ignore']) return [];
    if (!jobsOf(wf.js).some(([, j]) => stepsOf(j).some((s) => WORK.test(runText(s))))) return [];
    return [finding(`workflows/no-path-filter:${wf.file}`, 'workflows', 'info',
      `${wf.file} runs its tests or build on every pull request, also when only prose changed`,
      { file: wf.file, line: lineOf(wf, ['on', 'pull_request']) },
      'add paths-ignore for documentation files to pull_request; a required check that a filter skips never reports, so give a gate job a path-independent trigger first', 'small')];
  });
}

const INSTALL = /\b(?:npm (?:ci|install|i)|pnpm (?:install|i)|yarn install|pip3? install -r|poetry install|bundle install|composer install)\b/;
const GLOBAL = /\s(?:-g|--global)\b/;
const cached = (s) => {
  const w = s.with ?? {}, uses = String(s.uses ?? '');
  return /^actions\/cache(?:\/|@)/.test(uses) || (w.cache !== undefined && w.cache !== false && w.cache !== '') || !!w['bundler-cache'] || !!w['enable-cache'] || /^actions\/setup-go@/.test(uses) && w.cache !== false;
};
// A workflow that publishes (a job with id-token: write) is left out: a cache there is a cache-poisoning risk.
const publishes = (wf) => [wf.js.permissions, ...jobsOf(wf.js).map(([, j]) => j.permissions)].some((x) => x && typeof x === 'object' && x['id-token'] === 'write');
function noCache(p) {
  return p.workflows.filter((wf) => !publishes(wf)).flatMap((wf) => jobsOf(wf.js).flatMap(([name, job]) => {
    const steps = stepsOf(job);
    const at = steps.findIndex((s) => runText(s).split('\n').some((l) => INSTALL.test(l) && !GLOBAL.test(l)));
    if (at < 0 || steps.some(cached)) return [];
    return [finding(`workflows/no-cache:${wf.file}#${name}`, 'workflows', 'warning',
      `job ${name} of ${wf.file} installs dependencies on every run without a cache`,
      { file: wf.file, line: lineOf(wf, ['jobs', name, 'steps', at]), job: name },
      'let the setup action cache the package manager (cache: npm on actions/setup-node, cache: pip on actions/setup-python) or add an actions/cache step keyed on the lock file', 'small')];
  }));
}

const norm = (s) => runText(s).replace(/\s+/g, ' ').trim();
function repeatedBuild(p) {
  return p.workflows.flatMap((wf) => {
    const seen = new Map(), out = [];
    for (const [name, job] of jobsOf(wf.js)) {
      const cwd = job.defaults?.run?.['working-directory'] ?? '';
      for (const s of stepsOf(job)) {
        const cmd = norm(s);
        if (!/\bbuild\b/.test(cmd)) continue;
        const key = `${s['working-directory'] ?? cwd}|${cmd}`;
        if (!seen.has(key)) seen.set(key, name);
        else if (seen.get(key) !== name && !out.some((f) => f.evidence.job === name && f.evidence.sameAs === seen.get(key))) {
          out.push(finding(`workflows/repeat-build:${wf.file}#${name}`, 'workflows', 'warning',
            `jobs ${seen.get(key)} and ${name} of ${wf.file} run the same build command`,
            { file: wf.file, line: lineOf(wf, ['jobs', name]), job: name, sameAs: seen.get(key) },
            'build once and pass the output on with upload-artifact and download-artifact, or merge the two jobs', 'medium'));
        }
      }
    }
    return out;
  });
}

const SHA = /^[0-9a-f]{40}$/;
function unpinned(p) {
  return p.workflows.flatMap((wf) => {
    const found = [];
    for (const [name, job] of jobsOf(wf.js)) {
      if (typeof job.uses === 'string') found.push({ uses: job.uses, path: ['jobs', name, 'uses'] });
      stepsOf(job).forEach((s, i) => { if (typeof s.uses === 'string') found.push({ uses: s.uses, path: ['jobs', name, 'steps', i, 'uses'] }); });
    }
    const loose = found.filter(({ uses }) => !uses.startsWith('./') && !/^docker:\/\/.*@sha256:[0-9a-f]{64}$/.test(uses) && !SHA.test(uses.split('@')[1] ?? ''));
    if (!loose.length) return [];
    return [finding(`workflows/unpinned-action:${wf.file}`, 'workflows', 'info',
      `Security, not bloat: ${plural(loose.length, 'action')} of ${wf.file} ${loose.length === 1 ? 'is' : 'are'} not pinned to a commit`,
      { file: wf.file, line: lineOf(wf, loose[0].path), actions: [...new Set(loose.map((l) => l.uses))].slice(0, 10) },
      'pin each action to the full commit SHA with the version in a comment (Dependabot updates the pin)', 'small')];
  });
}

function broadPermissions(p) {
  return p.workflows.flatMap((wf) => {
    const top = wf.js.permissions, jobs = jobsOf(wf.js);
    const write = top === 'write-all' || (top && typeof top === 'object' && Object.values(top).includes('write'));
    const open = top === undefined && jobs.some(([, j]) => j.permissions === undefined);
    if (!write && !open) return [];
    return [finding(`workflows/broad-permissions:${wf.file}`, 'workflows', 'info',
      `Security, not bloat: ${wf.file} ${write ? 'grants write access to every job' : 'sets no permissions, so a job gets the default token rights'}`,
      { file: wf.file, line: top === undefined ? 1 : lineOf(wf, ['permissions']) },
      'set permissions: {} at the top and the rights a job needs in the job', 'small')];
  });
}

function matrixSize(p) {
  return p.workflows.flatMap((wf) => jobsOf(wf.js).flatMap(([name, job]) => {
    const m = job.strategy?.matrix;
    if (!m || typeof m !== 'object') return [];
    const axes = Object.entries(m).filter(([k]) => k !== 'include' && k !== 'exclude');
    if (!axes.length || axes.some(([, v]) => !Array.isArray(v))) return [];
    const size = axes.reduce((n, [, v]) => n * v.length, 1) + list(m.include).length;
    if (size <= MATRIX_SIZE) return [];
    return [finding(`workflows/matrix-size:${wf.file}#${name}`, 'workflows', 'info',
      `job ${name} of ${wf.file} runs ${size} matrix combinations (${axes.map(([k, v]) => `${k} ${v.length}`).join(', ')})`,
      { file: wf.file, line: lineOf(wf, ['jobs', name, 'strategy', 'matrix']), job: name, combinations: size },
      'keep a combination only where it can fail differently from the others: the oldest and newest version of each axis, or one operating system per run of the full matrix', 'medium')];
  }));
}

// ---- findings of the project's own tools

const LINT = /\b(?:eslint|ruff|pylint|flake8|rubocop|golangci-lint|biome|stylelint|clippy|(?:npm|pnpm|yarn) (?:run )?lint)\b/;
function lintNonFailing(p) {
  return p.workflows.flatMap((wf) => jobsOf(wf.js).flatMap(([name, job]) => stepsOf(job).flatMap((s, i) => {
    const cmd = runText(s);
    if (!LINT.test(cmd) || !(s['continue-on-error'] === true || /\|\|\s*(?:true|exit 0)\b/.test(cmd))) return [];
    return [finding(`findings/lint-non-failing:${wf.file}#${name}:${i}`, 'findings', 'warning',
      `a lint step of job ${name} in ${wf.file} cannot fail the run, so its warnings pile up unread`,
      { file: wf.file, line: lineOf(wf, ['jobs', name, 'steps', i]), job: name },
      'fix or configure away the current warnings, then let the step fail the run', 'medium')];
  })));
}

// ---- tests

const METRICS = ['lines', 'branches', 'functions', 'statements'];
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : null);
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };
const lineIn = (t, needle) => t.slice(0, Math.max(0, t.indexOf(needle))).split('\n').length;

// Floors the project enforces: flags of node's test runner, c8 and nyc in package.json scripts, c8 and nyc configuration, jest thresholds.
function floorsOf(p) {
  const out = [], add = (metric, floor, file, line) => { if (floor !== null) out.push({ metric, floor, file, line }); };
  const pkgText = p.text('package.json'), pkg = pkgText && json(pkgText);
  if (pkg) {
    for (const cmd of Object.values(pkg.scripts ?? {})) {
      for (const m of String(cmd).matchAll(/--test-coverage-(lines|branches|functions)=(\d+(?:\.\d+)?)/g)) add(m[1], Number(m[2]), 'package.json', lineIn(pkgText, m[0]));
      for (const m of String(cmd).matchAll(/--(lines|branches|functions|statements)[= ](\d+(?:\.\d+)?)/g)) add(m[1], Number(m[2]), 'package.json', lineIn(pkgText, m[0]));
    }
    for (const key of ['c8', 'nyc']) for (const k of METRICS) add(k, num(pkg[key]?.[k]), 'package.json', lineIn(pkgText, `"${key}"`));
    for (const k of METRICS) add(k, num(pkg.jest?.coverageThreshold?.global?.[k]), 'package.json', lineIn(pkgText, 'coverageThreshold'));
  }
  for (const file of ['.c8rc.json', '.nycrc', '.nycrc.json']) {
    const t = p.text(file), cfg = t && json(t);
    if (cfg) for (const k of METRICS) add(k, num(cfg[k]), file, lineIn(t, `"${k}"`));
  }
  return out;
}

// What the last coverage run measured, from a json-summary or an lcov report in coverage/.
function measuredCoverage(p) {
  const summary = p.text('coverage/coverage-summary.json'), total = summary && json(summary)?.total;
  if (total) {
    const m = Object.fromEntries(METRICS.map((k) => [k, num(total[k]?.pct)]).filter(([, v]) => v !== null));
    if (Object.keys(m).length) return { file: 'coverage/coverage-summary.json', ...m };
  }
  const lcov = p.text('coverage/lcov.info');
  if (lcov) {
    const sum = (tag) => lcov.split('\n').reduce((n, l) => n + (l.startsWith(`${tag}:`) ? Number(l.slice(tag.length + 1)) || 0 : 0), 0);
    const pct = (hit, found) => (sum(found) ? Math.round((sum(hit) / sum(found)) * 10000) / 100 : null);
    const m = { lines: pct('LH', 'LF'), branches: pct('BRH', 'BRF'), functions: pct('FNH', 'FNF') };
    m.statements = m.lines;
    if (m.lines !== null) return { file: 'coverage/lcov.info', ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)) };
  }
  return null;
}

function coverageFloor(p) {
  const far = [];
  for (const metric of METRICS) {
    const floors = p.floors.filter((f) => f.metric === metric);
    if (!floors.length || p.coverage[metric] === undefined) continue;
    const top = floors.reduce((a, b) => (b.floor > a.floor ? b : a));
    if (p.coverage[metric] - top.floor > COVERAGE_GAP) far.push({ metric, floor: top.floor, measured: p.coverage[metric], file: top.file, line: top.line });
  }
  if (!far.length) return [];
  return [finding('tests/coverage-floor', 'tests', 'warning',
    `the coverage floor is far below what the tests reach: ${far.map((f) => `${f.metric} ${f.floor} against ${f.measured}`).join(', ')}`,
    { file: far[0].file, line: far[0].line, report: p.coverage.file, metrics: far.map(({ metric, floor, measured }) => ({ metric, floor, measured })) },
    `raise each floor to a little under the measured value (${far.map((f) => `${f.metric} ${Math.max(f.floor, Math.floor(f.measured) - 1)}`).join(', ')}); a floor only ever rises`, 'small')];
}

function snapshotSize(p) {
  return [['snapshots', p.snapshots], ['fixtures', p.fixtures]].flatMap(([kind, items]) => {
    const bytes = items.reduce((n, f) => n + f.bytes, 0);
    if (bytes <= SNAPSHOT_BYTES) return [];
    const largest = [...items].sort((a, b) => b.bytes - a.bytes).slice(0, 3);
    return [finding(`tests/snapshot-size:${kind}`, 'tests', 'info',
      `${plural(items.length, 'file')} of ${kind} hold ${(bytes / 1048576).toFixed(1)} MiB`,
      { file: largest[0].file, line: 1, bytes, files: items.length, largest },
      `trim the ${kind} to what an assertion reads; a snapshot of a whole page or a recorded response rarely fails for a real change`, 'medium')];
  });
}

// ---- code: a token scan of the project's own source (identical token runs, comments and import lines left out)

const TOKEN = /[A-Za-z_$][\w$]*|\d[\w.]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|\S/g;
const SKIPPED_LINE = /^\s*(?:\/\/|#|\*|\/\*|import\s|from\s+\S+\s+import\s|use\s|#include)/;
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return h >>> 0; };

function tokenize(text) {
  const hashes = [], lines = [];
  text.split('\n').forEach((l, n) => {
    if (SKIPPED_LINE.test(l)) return;
    for (const t of l.match(TOKEN) ?? []) { hashes.push(fnv(t)); lines.push(n + 1); }
  });
  return { hashes, lines };
}

// Keys of every window of n tokens: two rolling hashes folded into one safe integer.
function windows({ hashes }, n) {
  const B1 = 1000003, B2 = 998244353, keys = [];
  let p1 = 1, p2 = 1, h1 = 0, h2 = 0;
  for (let i = 0; i < n - 1; i++) { p1 = Math.imul(p1, B1); p2 = Math.imul(p2, B2); }
  for (let i = 0; i < hashes.length; i++) {
    if (i >= n) { h1 = (h1 - Math.imul(hashes[i - n], p1)) | 0; h2 = (h2 - Math.imul(hashes[i - n], p2)) | 0; }
    h1 = (Math.imul(h1, B1) + hashes[i]) | 0; h2 = (Math.imul(h2, B2) + hashes[i]) | 0;
    if (i >= n - 1) keys.push((h1 >>> 0) * 2097152 + ((h2 >>> 0) & 0x1fffff));
  }
  return keys;
}

// Runs of identical tokens (at least minTokens and six lines) between two places; a run is reported where it appears second.
export function clones(parsed, minTokens) {
  const seen = new Map(), found = [];
  parsed.forEach((a, fi) => {
    const keys = windows(a, minTokens);
    let run = null;
    const close = () => {
      if (run) {
        const b = parsed[run.fj], last = run.i + minTokens - 1, lastJ = run.j + minTokens - 1;
        const span = { line: a.lines[run.start], endLine: a.lines[last] };
        if (span.endLine - span.line >= 5) found.push({ file: a.file, ...span, tokens: last - run.start + 1, clone: { file: b.file, line: b.lines[run.startJ], endLine: b.lines[lastJ] } });
      }
      run = null;
    };
    keys.forEach((k, i) => {
      const prev = seen.get(k);
      const hit = prev && (prev[0] !== fi || i - prev[1] >= minTokens) ? prev : null;
      if (hit && run && run.fj === hit[0] && run.j + 1 === hit[1]) { run.i = i; run.j = hit[1]; }
      else { close(); if (hit) run = { start: i, startJ: hit[1], i, j: hit[1], fj: hit[0] }; }
      if (!prev) seen.set(k, [fi, i]);
    });
    close();
  });
  return found.sort((x, y) => y.tokens - x.tokens || (x.file < y.file ? -1 : 1));
}

function scan(p, files, minTokens, id, group, what) {
  let budget = MAX_TOKENS;
  const parsed = [];
  for (const file of files) {
    const body = p.text(file);
    if (body == null || budget <= 0) continue;
    const t = tokenize(body);
    budget -= t.hashes.length;
    parsed.push({ file, ...t });
  }
  return clones(parsed, minTokens).slice(0, MAX_FINDINGS).map((c) => finding(`${id}:${c.file}:${c.line}`, group, 'info',
    `${c.tokens} identical tokens in ${c.file}:${c.line}-${c.endLine} also appear in ${c.clone.file}:${c.clone.line}-${c.clone.endLine}`,
    { file: c.file, line: c.line, endLine: c.endLine, clone: c.clone, tokens: c.tokens }, what, 'medium'));
}
const duplication = (p) => scan(p, p.source, 100, 'code/duplication', 'code', 'move the shared part into one function or module that both places call');
const duplicateTests = (p) => scan(p, p.tests, 120, 'tests/duplicate', 'tests', 'keep one of the tests, or turn the copies into one table-driven test; a copy that asserts the same thing cannot fail differently');

function largeFile(p) {
  const rc = json(p.text('.eslintrc.json') ?? '') ?? json(p.text('.eslintrc') ?? '');
  const rule = rc?.rules?.['max-lines'], max = Array.isArray(rule) ? (typeof rule[1] === 'object' ? rule[1]?.max : rule[1]) : undefined;
  const limit = Number.isInteger(max) && max > 0 ? max : FILE_LINES;
  return p.source.flatMap((file) => {
    const lines = (p.text(file) ?? '').split('\n').length;
    return lines > limit ? [{ file, lines }] : [];
  }).sort((a, b) => b.lines - a.lines).slice(0, MAX_FINDINGS).map(({ file, lines }) => finding(`code/large-file:${file}`, 'code', 'info',
    `${file} has ${lines} lines, over the limit of ${limit}`, { file, line: 1, lines, limit },
    'split it along the seams it already has (one concern per module)', 'large'));
}

// ---- the catalogue

const NEEDS = {
  workflows: { met: (p) => p.workflows.length > 0, missing: 'no workflow in .github/workflows', enable: 'the check answers once the project has a GitHub Actions workflow' },
  source: { met: (p) => p.source.length > 0, missing: 'no source files of a known language', enable: 'the check answers once the checkout holds source files (JavaScript, TypeScript, Python, Go and others)' },
  tests: { met: (p) => p.tests.length > 0, missing: 'no test files', enable: 'the check answers once the project has test files (*.test.*, *.spec.*, test_*.py, a tests folder)' },
  snapshots: { met: (p) => p.snapshots.length + p.fixtures.length > 0, missing: 'no snapshot or fixture files', enable: 'the check answers once the project keeps snapshots (*.snap, __snapshots__) or fixture folders' },
  'coverage-floor': { met: (p) => p.floors.length > 0, missing: 'no coverage floor in package.json, .c8rc.json or .nycrc', enable: 'if the project already measures coverage, set the floor it should hold (for example --test-coverage-lines=80 for node --test, --lines 80 for c8)' },
  'coverage-report': { met: (p) => p.coverage !== null, missing: 'no coverage report in coverage/', enable: 'run the tests with a json-summary or lcov reporter you already have and keep coverage/ in the checkout' },
};

export const CATALOGUE = [
  { id: 'workflows/duplicate-trigger', group: 'workflows', needs: ['workflows'], run: duplicateTrigger },
  { id: 'workflows/no-cancel', group: 'workflows', needs: ['workflows'], run: noCancel },
  { id: 'workflows/no-path-filter', group: 'workflows', needs: ['workflows'], run: noPathFilter },
  { id: 'workflows/no-cache', group: 'workflows', needs: ['workflows'], run: noCache },
  { id: 'workflows/repeat-build', group: 'workflows', needs: ['workflows'], run: repeatedBuild },
  { id: 'workflows/matrix-size', group: 'workflows', needs: ['workflows'], run: matrixSize },
  { id: 'workflows/unpinned-action', group: 'workflows', needs: ['workflows'], run: unpinned },
  { id: 'workflows/broad-permissions', group: 'workflows', needs: ['workflows'], run: broadPermissions },
  { id: 'tests/coverage-floor', group: 'tests', needs: ['coverage-floor', 'coverage-report'], run: coverageFloor },
  { id: 'tests/duplicate', group: 'tests', needs: ['tests'], run: duplicateTests },
  { id: 'tests/snapshot-size', group: 'tests', needs: ['snapshots'], run: snapshotSize },
  { id: 'code/duplication', group: 'code', needs: ['source'], run: duplication },
  { id: 'code/large-file', group: 'code', needs: ['source'], run: largeFile },
  { id: 'findings/lint-non-failing', group: 'findings', needs: ['workflows'], run: lintNonFailing },
];

// The checks of the chosen groups: those whose needs are met run, the others are listed as skipped with the way to enable them.
export function audit(ctx, dir, { only = GROUPS } = {}) {
  const project = load(ctx, dir), findings = [], skipped = [];
  let ran = 0;
  for (const c of CATALOGUE.filter((x) => only.includes(x.group))) {
    const unmet = c.needs.filter((n) => !NEEDS[n].met(project));
    if (unmet.length) skipped.push({ id: c.id, group: c.group, reason: unmet.map((n) => NEEDS[n].missing).join('; '), enable: unmet.map((n) => NEEDS[n].enable).join('; ') });
    else { ran++; findings.push(...c.run(project)); }
  }
  findings.sort((a, b) => SEVERITY.indexOf(a.severity) - SEVERITY.indexOf(b.severity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { dir, ran, findings, skipped, summary: Object.fromEntries(SEVERITY.map((s) => [s, findings.filter((f) => f.severity === s).length])) };
}

export function auditMarkdown(r) {
  const out = [`# Audit of ${r.dir}`, '', `${plural(r.findings.length, 'finding')} (${SEVERITY.map((s) => `${r.summary[s]} ${s}`).join(', ')}); ${r.ran} checks ran, ${r.skipped.length} skipped.`];
  for (const g of GROUPS) {
    const own = r.findings.filter((f) => f.signal === g);
    if (!own.length) continue;
    out.push('', `## ${g}`, '');
    for (const f of own) out.push(`- **${f.severity}** \`${f.id}\` ${f.message} (${f.evidence.file}:${f.evidence.line})`, `  - fix (${f.effort}): ${f.fix}`);
  }
  if (r.skipped.length) {
    out.push('', '## Skipped', '');
    for (const s of r.skipped) out.push(`- \`${s.id}\`: ${s.reason}. ${s.enable}.`);
  }
  return `${out.join('\n')}\n`;
}
