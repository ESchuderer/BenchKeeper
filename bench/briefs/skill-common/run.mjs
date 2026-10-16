// Runs a targeted task's checks (/brief/checks/checks.mjs: an object of id to async check) on /ws, each in its own
// process on its own copy of /ws, 120 s each; prints {"checks":[{id, ok, detail}]}. A check returns true, false, null
// (not checkable) or {ok, detail}; a throw or a time-out is ok false. S1-regressions is added to every task (after its
// own checks): the baseline's test files (/base), copied over the workspace's, pass.
// Usage (in the container of checks.sh): node /common/run.mjs [id]
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = '/base';
const testFiles = (root, dir = root) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  if (d.name === '.git' || d.name === 'node_modules') return [];
  const p = join(dir, d.name);
  return d.isDirectory() ? testFiles(root, p) : /\.test\.[cm]?js$/.test(d.name) ? [relative(root, p)] : [];
});

// Helpers for a check, on its own copy `ws` of the workspace.
function helpers(ws) {
  const sh = (cmd, cwd = ws) => {
    const r = spawnSync('sh', ['-c', cmd], { cwd, encoding: 'utf8', timeout: 90000 });
    return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  return {
    ws, base: BASE, sh,
    read: (rel, root = ws) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null),
    load: (rel) => import(pathToFileURL(join(ws, rel)).href),
    testFiles,
  };
}

const builtin = {
  'S1-regressions': async ({ ws, sh }) => {
    const files = testFiles(BASE);
    if (!files.length) return null;
    for (const f of files) cpSync(join(BASE, f), join(ws, f));
    const r = sh(`node --test ${files.map((f) => `'${f}'`).join(' ')}`);
    return { ok: r.code === 0, detail: r.code === 0 ? `${files.length} files` : r.out.slice(-400) };
  },
};
// A task can leave a built-in check out by setting it to null (when another of its checks already covers it).
const checks = async () => Object.fromEntries(Object.entries({ ...builtin, ...(await import('/brief/checks/checks.mjs')).default })
  .sort(([a], [b]) => (a in builtin) - (b in builtin)).filter(([, f]) => f));

const id = process.argv[2];
if (id) {
  const ws = mkdtempSync('/tmp/ws-');
  cpSync('/ws', ws, { recursive: true });
  let r;
  try { r = await (await checks())[id](helpers(ws)); } catch (e) { r = { ok: false, detail: String(e?.message ?? e).slice(0, 400) }; }
  const o = r && typeof r === 'object' ? r : { ok: r };
  // Exit at once: a server or timer the agent's code left open must not hold the check until its time-out.
  process.stdout.write(`\n${JSON.stringify({ ok: o.ok ?? null, ...(o.detail ? { detail: String(o.detail) } : {}) })}\n`, () => process.exit(0));
} else {
  const out = [];
  for (const c of Object.keys(await checks())) {
    const r = spawnSync(process.execPath, [new URL(import.meta.url).pathname, c], { encoding: 'utf8', timeout: 120000 });
    let o;
    try { o = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { o = { ok: false, detail: (r.error ? `${r.error.code}` : `exit ${r.status}: `) + (r.stderr || '').slice(-400) }; }
    out.push({ id: c, ...o });
  }
  process.stdout.write(`${JSON.stringify({ checks: out }, null, 1)}\n`);
}
