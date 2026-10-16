// Cross-step checks (ids X<k>-*) of a workspace against the previous step's snapshot. Run by cross.sh in the node
// container: `install` runs the CI's install commands (network on), `run` the other CI commands (network off) and prints
// {"checks":[...]}. Mounts: workspace copy /ws, previous snapshot /prev, bench/scorer /scorer (for `yaml`).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const YAML = createRequire(process.env.SCORER_PKG || '/scorer/package.json')('yaml');
const read = (root, p) => { try { return readFileSync(`${root}/${p}`, 'utf8'); } catch { return null; } };
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
// npm ci, install or i, after npm's own options (`--prefix site`, `--prefix=site`, `--silent`).
export const isInstall = (p) => {
  const t = p.split(/\s+/);
  let i = 1;
  while (t[i]?.startsWith('-')) i += t[i] === '--prefix' ? 2 : 1;
  return t[0] === 'npm' && ['ci', 'install', 'i'].includes(t[i]);
};
const CHANGELOGS = ['CHANGELOG.md', 'site/CHANGELOG.md'];

const workflows = (root) => {
  const dir = `${root}/.github/workflows`;
  return (existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort() : []).map((f) => {
    try { return { f, doc: YAML.parse(read(dir, f)) ?? {} }; } catch { return { f, doc: null }; }
  });
};

// The run: steps of pull_request workflows. Plain: every line and every `&&` part is an npm or node call without
// expressions, pipes, redirects or substitutions; the others are listed as not checked.
export function ciCommands(root) {
  const plain = [], skipped = [], seen = new Set();
  for (const { f, doc } of workflows(root)) {
    if (!doc) { skipped.push(`${f}: invalid YAML`); continue; }
    const on = doc.on;
    if (!(typeof on === 'string' || Array.isArray(on) ? list(on) : Object.keys(on ?? {})).includes('pull_request')) continue;
    for (const [name, job] of Object.entries(doc.jobs ?? {})) {
      for (const st of list(job?.steps)) {
        if (!st?.run) continue;
        const cwd = posix.normalize(String(st['working-directory'] ?? job.defaults?.run?.['working-directory'] ?? doc.defaults?.run?.['working-directory'] ?? '.')).replace(/(.)\/+$/, '$1');
        const parts = String(st.run).split(/\n|&&/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
        if (parts.length && parts.every((p) => /^(npm|node)\s/.test(p) && !/\$\{\{|[|;<>`$]/.test(p))) {
          const key = JSON.stringify([cwd, parts]);
          if (!seen.has(key)) seen.add(key), plain.push({ where: `${f}: ${name}`, cwd, parts });
        } else skipped.push(`${f}: ${name}: ${String(st.run).trim().split('\n')[0].slice(0, 60)}`);
      }
    }
  }
  return { plain, skipped };
}

// Lines of `cur` not in `prev` (as a multiset), with their line index in `cur`.
export function added(cur, prev) {
  const left = new Map();
  for (const l of (prev ?? '').split('\n')) left.set(l, (left.get(l) || 0) + 1);
  return (cur ?? '').split('\n').flatMap((l, i) => (left.get(l) ? (left.set(l, left.get(l) - 1), []) : [{ l, i }]));
}
const ENTRY = /^\s*([-*+]|#{1,6})\s+\S/;

export function changelog(ws, prev) {
  const file = CHANGELOGS.find((p) => read(ws, p) !== null);
  if (!file) return { ok: false, detail: 'no CHANGELOG.md' };
  const entries = added(read(ws, file), read(prev, file)).filter((a) => ENTRY.test(a.l));
  return { ok: entries.length > 0, file, entries, detail: `${file}: ${entries.length} entry lines added since the previous step` };
}

const SOURCES = [['VERSION', (t) => t.trim()], ['package.json', (t) => JSON.parse(t).version], ['site/package.json', (t) => JSON.parse(t).version]];
const version = (root, p, get) => { try { return get(read(root, p)) || null; } catch { return null; } };
const greater = (a, b) => {
  const n = (v) => String(v).split(/[^0-9]+/).filter(Boolean).slice(0, 3).map(Number);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

// A bump in the first version source that exists (VERSION, package.json, site/package.json); or the bump deferred by
// the strategy: release-please configured and a feat or fix commit since the previous step, or the added CHANGELOG
// entry under an Unreleased heading (Keep a Changelog).
export function bump(ws, prev, subjects, log = changelog(ws, prev)) {
  const src = SOURCES.find(([p, get]) => version(ws, p, get));
  const [a, b] = src ? [version(prev, src[0], src[1]), version(ws, src[0], src[1])] : [];
  if (src && a && greater(b, a)) return { ok: true, detail: `${src[0]}: ${a} to ${b}` };
  const rp = read(ws, 'release-please-config.json') !== null
    || workflows(ws).some(({ doc }) => Object.values(doc?.jobs ?? {}).some((j) => list(j?.steps).some((s) => /release-please-action@/.test(s?.uses ?? ''))));
  if (rp && subjects.some((s) => /^(feat|fix)(\([^()]+\))?!?: /.test(s))) return { ok: true, detail: 'release-please: feat or fix commit since the previous step' };
  if (log.entries?.length) {
    const lines = read(ws, log.file).split('\n');
    const u = lines.findIndex((l) => /^##\s+\[?unreleased\]?/i.test(l));
    const end = u < 0 ? -1 : lines.findIndex((l, i) => i > u && /^##\s/.test(l));
    if (u >= 0 && log.entries.some((e) => e.i > u && (end < 0 || e.i < end))) return { ok: true, detail: `${log.file}: entry under Unreleased` };
  }
  return { ok: false, detail: src ? `${src[0]}: ${a ?? 'none'} to ${b}, not bumped${rp ? '; release-please without a feat or fix commit' : ''}` : 'no version source' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2], k = process.env.K;
  const { plain, skipped } = ciCommands('/prev');
  const run = (cmd, cwd) => spawnSync('sh', ['-c', cmd], { cwd: `/ws/${cwd}`, stdio: ['ignore', 2, 2], timeout: 15 * 60 * 1000 }).status ?? 124;
  // The install pass records each install's exit code for the offline pass (/state, a directory cross.sh mounts).
  const key = (c, p) => `${c.cwd} ${p}`;
  if (mode === 'install') {
    const done = {};
    for (const c of plain) for (const p of c.parts.filter(isInstall)) console.error(`${c.cwd}: ${p}: exit ${(done[key(c, p)] = run(p, c.cwd))}`);
    writeFileSync('/state/install.json', JSON.stringify(done));
  } else {
    let done = {};
    try { done = JSON.parse(readFileSync('/state/install.json', 'utf8')); } catch { /* install pass failed */ }
    const git = (...a) => { try { return execFileSync('git', ['-c', 'safe.directory=*', ...a], { encoding: 'utf8' }).trim(); } catch { return ''; } };
    const base = git('-C', '/prev', 'rev-parse', 'HEAD');
    const subjects = base ? git('-C', '/ws', 'log', '--format=%s', `${base}..HEAD`).split('\n').filter(Boolean) : [];
    const results = plain.map((c) => {
      let exit = 0;
      for (const p of c.parts) if ((exit = isInstall(p) ? done[key(c, p)] ?? 1 : run(p, c.cwd)) !== 0) break;
      return `${c.where} (${c.cwd}) "${c.parts.join(' && ')}": exit ${exit}`;
    });
    const log = changelog('/ws', '/prev');
    const checks = [
      { id: `X${k}-ci`, ok: plain.length ? results.every((r) => r.endsWith(': exit 0')) : null,
        detail: `${plain.length ? results.join('; ') : 'no plain npm or node run: step in a pull_request workflow of the previous step'}${skipped.length ? `; not checked: ${skipped.join('; ')}` : ''}` },
      { id: `X${k}-changelog`, ok: log.ok, detail: log.detail },
      { id: `X${k}-version`, ...bump('/ws', '/prev', subjects, log) },
    ];
    process.stdout.write(JSON.stringify({ checks }, null, 2) + '\n');
  }
}
