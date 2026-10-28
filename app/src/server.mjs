// Local web UI server: 127.0.0.1 only, one-time URL token swapped for an HttpOnly session cookie, and checks against
// requests from other sites (Host, Origin, Sec-Fetch-Site, POST with a custom header for every change).
// shortcut: apply, undo, Update all and the open folder dialog run synchronously and block other requests meanwhile;
// one local user is fine.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountDoc, accountStatusAsync, accountsProblem, addChange, findAccount, listAccounts, login, newAccount, registrySettings, removeChange, store, useChange } from './accounts.mjs';
import { limitsFor, settingsOf } from './usage.mjs';
import { ADVISERS, adviseSetup } from './advise.mjs';
import { CSP as BOARD_CSP, boardHtml, registeredPaths, writeBoard } from './board.mjs';
import { agent, detect, unavailable } from './agents.mjs';
import { userEvals } from './cases.mjs';
import { evalPlan, runEval } from './eval.mjs';
import { contentDir, appVersion } from './content.mjs';
import { doctor, projectChecks } from './doctor.mjs';
import { collectInsights } from './insights.mjs';
import { readTriage, setTriage, withTriage } from './triage.mjs';
import { diffLines } from './diff.mjs';
import { exists, hashPath, inside, isDir, readText, realish } from './fsx.mjs';
import { blob } from './git.mjs';
import { inventory } from './inventory.mjs';
import { rehearsable, rehearse } from './prerun.mjs';
import { frameworkRows } from './frameworks.mjs';
import { exportPack, importPack, invalidPacks, libraryWith, removePack, savePack, warnings } from './packs.mjs';
import { exportProfile, importChoices, importPlan, installedPacks, readProfile } from './profile.mjs';
import { addProject, canon, checkAdd, listProjects, packsInUse, prefetchOrigins, projectsUsing, projectState, relocateProject, removeProject, removeSetup, renameProject, scan, setupOf, setupRemoval, status, updateAll, usersByPack } from './projects.mjs';
import { extensionsView } from './extensions.mjs';
import { RULE_AGENTS, ruleChanges, ruleText, rulesView } from './rules.mjs';
import { applyAsync, itemState, preview, runCommand, undo, windowsTool } from './runner.mjs';
import { dashboard } from './dashboard.mjs';
import { clearSessionCache, keepSessionsFor, scanSessions, sessionCache } from './sessions.mjs';
import { focusOn, globalUntracked, projectSkills } from './skills.mjs';
import { bundleEdits, isSettingsFile, listSettings, redact, settingsAgents, settingsChanges } from './settings.mjs';
import { detectLevel, levelFor } from './level.mjs';
import { LEVELS, benchkeeperPlugin, globalPlan, globalSkills } from './steps/global.mjs';
import { ENVS, TIERS, chosenSkills, projectCtx, projectPlan, resolveAnswers, scopeCtx, suggest, upToDate } from './steps/project.mjs';

export const HEADER = 'x-benchkeeper';
// Per port: browsers send a 127.0.0.1 cookie to every port, so two servers must not overwrite each other's session.
const cookieName = (port) => `bk_session_${port}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
// Byte lengths: timingSafeEqual throws on different lengths, and one character can be several bytes.
const same = (a, b) => { if (typeof a !== 'string') return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// null when the request may go on, else [status, reason]. API requests also need the key in the HEADER header: the
// cookie reaches every server on 127.0.0.1 whatever its port, the key only this origin's page.
export function rejectReason(req, { port, session, key, api = true }) {
  const self = `127.0.0.1:${port}`;
  if (req.headers.host !== self) return [421, 'wrong host'];
  if ('origin' in req.headers && req.headers.origin !== `http://${self}`) return [403, 'foreign origin'];
  // The page's own requests are same-origin: another port on this machine is same-site, and no more welcome.
  if ('sec-fetch-site' in req.headers && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return [403, 'cross-site request'];
  const name = `${cookieName(port)}=`;
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(name))?.slice(name.length);
  if (!session || !same(cookie, session)) return [401, 'no session'];
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return [405, 'method not allowed'];
  if (api && (!key || !same(req.headers[HEADER], key))) return [403, `missing ${HEADER} header`];
  return null;
}

const bad = (message) => Object.assign(new Error(message), { status: 400 });
// Errors of a user's input (a pack or profile file, a pack id) are 400s.
const input = (f) => { try { return f(); } catch (e) { throw Object.assign(e, { status: e.status ?? 400 }); } };

// The OS folder dialog, first tool found: exit 0 is the choice, 1 a cancel; other codes (127: not installed) try the next.
// Without a display (SSH, container) zenity also exits 1, so Linux needs DISPLAY or WAYLAND_DISPLAY first.
// shortcut: no xdg portal (needs async D-Bus); add it when zenity and kdialog are both missing on a target desktop.
export function pickFolder(ctx, platform = process.platform, env = process.env) {
  const display = platform !== 'linux' || env.DISPLAY || env.WAYLAND_DISPLAY;
  const tools = platform === 'darwin' ? [['osascript', '-e', 'POSIX path of (choose folder)']] : platform === 'win32' || !display ? [] : [['zenity', '--file-selection', '--directory'], ['kdialog', '--getexistingdirectory']];
  for (const argv of tools) {
    const r = ctx.run(argv);
    if (r.code === 0 && r.stdout.trim()) return { path: resolve(r.stdout.trim()) };
    if (r.code === 0 || r.code === 1) return { path: null };
  }
  return { path: null, unavailable: true };
}

// A file of a recorded session between its snapshots; null for binary or large files and a lost snapshot.
function sessionDiff(ctx, e, f) {
  const side = (tree, absent) => (absent ? '' : blob(ctx, e.cwd, tree, f.path));
  try {
    const [a, b] = [side(e.before, f.status === 'A'), side(e.after, f.status === 'D')];
    if (a.length + b.length > 1e6 || a.includes(0) || b.includes(0)) return null;
    return diffLines(f.status === 'A' ? null : a.toString('utf8'), f.status === 'D' ? null : b.toString('utf8'), f.path);
  } catch { return null; }
}

// An Update all change as its commit holds it: the run's worktree is gone. null for a folder or an older run.
function committed(ctx, run, e) {
  const { updateAll, commit } = run.note ?? {};
  if (!updateAll || !commit || !inside(e.path, [run.scope])) return null;
  try { return blob(ctx, updateAll, commit, relative(realish(run.scope), realish(e.path)).split(sep).join('/')).toString('utf8'); } catch { return null; }
}

// Changes without their edit functions, with the item state the Dashboard groups by.
function serialize(changes, ctx) {
  return changes.map(({ edit, after, from, env, ...c }) => ({ ...c, ...(c.diff && isSettingsFile(c.path) ? { diff: redact(c.diff) } : {}), prerun: rehearsable(c), state: c.kind === 'write' && !from ? itemState(c.path, after, ctx) : c.destructive ? 'foreign' : null }));
}

const named = (src, query, body) => (src instanceof URLSearchParams ? src.has(query) : body in src);
// First-setup answers from a query or a request body: only these keys, as strings and string lists.
function setupAnswers(src) {
  if (!src || typeof src !== 'object') return {};
  const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
  const all = (k) => (src instanceof URLSearchParams ? src.getAll(k) : [src[k] ?? []].flat()).filter((x) => typeof x === 'string');
  const list = (k) => (src instanceof URLSearchParams ? all(k).flatMap((x) => x.split(',')).filter(Boolean) : all(k));
  return { agents: list('agents'), env: get('env') || undefined, sandbox: get('sandbox') === '1' || get('sandbox') === true, packs: list(src instanceof URLSearchParams ? 'pack' : 'packs'), skills: list(src instanceof URLSearchParams ? 'skill' : 'skills'),
    // Frameworks are kept unless the answers name them (a form of agents, packs and tier alone does not take them out).
    frameworks: named(src, 'framework', 'frameworks') ? list(src instanceof URLSearchParams ? 'framework' : 'frameworks') : undefined,
    agentFiles: named(src, 'agent-file', 'agentFiles') ? list(src instanceof URLSearchParams ? 'agent-file' : 'agentFiles') : undefined,
    // An empty tier clears the saved one; no tier keeps it.
    tier: (src instanceof URLSearchParams ? src.has('tier') : 'tier' in src) ? get('tier') || null : undefined,
    // No guards or share keeps the saved choice.
    guards: named(src, 'guards', 'guards') ? get('guards') === '1' || get('guards') === true : undefined,
    share: (src instanceof URLSearchParams ? src.has('share') : 'share' in src) ? get('share') === '1' || get('share') === true : undefined };
}

// The last session scan per app context: GET /board renders from it, and a reload soon after needs no scan.
const scans = new WeakMap();
const keepScan = (ctx, rows) => { const at = Date.now(); scans.set(ctx, { rows, at }); try { writeBoard(ctx, rows, new Date(at).toISOString()); } catch { /* the file is a convenience; the scan and the framed board still work */ } };
const FRESH_SCAN_MS = 60e3;
// GET /board is a frame, which cannot send the API key: it needs a one-time ticket that the page asks for with the key,
// so the cookie alone (which browsers send to every server on 127.0.0.1) does not show the board.
const tickets = new WeakMap();
const boardTickets = (ctx) => { if (!tickets.has(ctx)) tickets.set(ctx, new Map()); return tickets.get(ctx); };

export function api(ctx) {
  const plans = new Map(), jobs = new Map(), rehearsals = new Map();
  // Origin's setup per project, read without blocking before the routes that show it (setupOf then hits the cache).
  const originsOfProjects = () => prefetchOrigins(ctx, listProjects(ctx).map((p) => p.path));
  // Changes wait while a job runs: an undo or Update all in between would edit files and runs an apply still writes.
  // Every route that changes files calls it first: rehearsals still running would diff against the files it changes,
  // and rehearsed results from before are out of date.
  const idle = () => {
    if ([...jobs.values()].some((j) => !j.done && !j.readOnly)) throw Object.assign(new Error('an apply or eval is still running: wait for it to finish'), { status: 409 });
    for (const j of jobs.values()) if (j.kind === 'prerun') j.ctl.abort();
    rehearsals.clear();
  };
  // A removal runs only when the request says it was confirmed: an id of a destructive change in select is not enough.
  // Without a select the plan's preselected changes run, so a destructive one among them needs the flag too.
  const confirmed = (p, select, ok) => {
    const ids = new Set((select ?? []).filter((i) => typeof i === 'string'));
    const named = p.changes.filter((c) => c.destructive && (select ? ids.has(c.id) : c.selected && !c.error));
    if (named.length && ok !== true) throw bad(`confirmDestructive is needed to apply: ${named.map((c) => c.title).join('; ')}`);
  };
  // A job runs work(job) in the background; the newest 20 finished jobs are kept.
  const start = (total, work, { kind, title, readOnly = false }) => {
    const job = { id: randomBytes(8).toString('hex'), kind, title, total, run: null, output: {}, done: false, readOnly, ctl: new AbortController() };
    jobs.set(job.id, job);
    for (const [id, j] of [...jobs].slice(0, -20)) if (j.done) jobs.delete(id);
    work(job).catch((e) => { job.error = e.message; }).finally(() => { job.done = true; memo.clear(); });
    return { job: job.id, total };
  };
  const evalPlanFor = (src) => {
    if (process.env.CI) throw bad('evals start agent sessions on a subscription and do not run in CI');
    const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
    const agents = String(get('agents') ?? 'claude').split(',').filter((a) => ['claude', 'codex'].includes(a));
    const only = src instanceof URLSearchParams ? src.getAll('target') : [src.targets ?? []].flat().filter((t) => typeof t === 'string');
    return evalPlan(ctx, { agents: agents.length ? agents : ['claude'], all: get('all') === '1' || get('all') === true, only: only.length ? only : undefined });
  };
  // Plans wait for Apply 30 minutes; the newest 50 are kept.
  const keep = (changes, pctx, scope) => {
    const id = randomBytes(8).toString('hex');
    plans.set(id, { changes, ctx: pctx, scope, at: Date.now() });
    for (const old of [...plans.keys()].slice(0, -50)) plans.delete(old);
    return id;
  };
  // Machine reads that start agent commands (versions, doctor, inventory) are kept 15 s and dropped by every change.
  const memo = new Map();
  const cached = (key, f) => {
    const m = memo.get(key);
    if (m && Date.now() - m.at < 15e3) return m.value;
    const value = f();
    memo.set(key, { at: Date.now(), value });
    return value;
  };
  const agentsNow = () => cached('agents', () => detect(ctx));
  const installed = () => agentsNow().filter((a) => a.installed).map((a) => a.id);
  const inventoryNow = () => cached('inventory', () => inventory(ctx, installed(), { level: levelFor(ctx, installed()) }));
  const registered = (dir) => listProjects(ctx).some((p) => p.path === canon(dir));
  const routes = {
    'GET /api/overview': async () => (await originsOfProjects(), { version: appVersion, level: cached('level', () => detectLevel(ctx, installed())), agents: agentsNow().map((a) => ({ ...a, ...(a.installed && agent(a.id).plugins ? { plugin: cached(`plugin:${a.id}`, () => { try { return benchkeeperPlugin(ctx, a.id); } catch { return null; } }) } : {}), rules: agent(a.id).global.rules.path, skills: agent(a.id).global.skills, unavailable: unavailable(a.id) })), projects: listProjects(ctx).map((p) => { const s = setupOf(ctx, p.path, projectState(ctx, p.path)).state; return { path: p.path, agents: s?.agents ?? [], setupVersion: s?.contentVersion ?? null, current: upToDate(s) }; }) }),
    'GET /api/global-plan': (q) => {
      const agents = q.get('agents') ? q.get('agents').split(',') : installed();
      const level = q.get('level') ?? levelFor(ctx, agents);
      if (!LEVELS.includes(level)) throw bad(`level must be one of ${LEVELS.join(', ')}`);
      const changes = preview(globalPlan({ ctx, agents, options: { packs: q.getAll('pack'), packsInUse: packsInUse(ctx), level } }));
      return { planId: keep(changes, ctx, 'global'), agents, changes: serialize(changes, ctx) };
    },
    // Starts the apply and answers at once; GET /api/job shows each change as it runs. One job at a time.
    'POST /api/apply': (b) => {
      idle();
      if (b.select !== undefined && !(Array.isArray(b.select) && b.select.every((i) => typeof i === 'string'))) throw bad('select must be a list of change ids');
      const p = plans.get(b.planId);
      if (!p || Date.now() - p.at > 30 * 60e3) throw Object.assign(new Error('plan expired: load it again'), { status: 409 });
      confirmed(p, b.select, b.confirmDestructive);
      plans.delete(b.planId);
      // Output is kept per change, its last 8 kB.
      return start(b.select?.length ?? p.changes.filter((c) => c.selected).length, (job) => applyAsync(p.changes, p.ctx, { scope: p.scope, select: b.select, stop: () => job.ctl.signal.aborted }, (e) => {
        if (e.run) job.run = e.run;
        if (e.output) job.output[e.entry.id] = ((job.output[e.entry.id] ?? '') + e.output).slice(-8192);
      }).then((run) => { job.run = run; }), { kind: 'apply', title: p.scope === 'global' ? 'global setup' : p.scope });
    },
    // One-run setup: several plans (the global one, projects) applied as one job, one section per plan, in order. Each
    // section is a run of its own, so undo stays per run. A failed section leaves the others; a cancel stops after the
    // change that runs and the sections after it never start.
    'POST /api/apply-all': (b) => {
      idle();
      if (!Array.isArray(b.sections) || !b.sections.length) throw bad('sections must be a list of plans');
      // Every plan is checked before any is taken, so a refused request leaves them all usable.
      const list = b.sections.map((x) => {
        const p = plans.get(x?.planId);
        if (!p || Date.now() - p.at > 30 * 60e3) throw Object.assign(new Error('plan expired: load it again'), { status: 409 });
        return { id: x.planId, p, select: Array.isArray(x.select) ? x.select.filter((i) => typeof i === 'string') : undefined };
      });
      if (new Set(list.map((x) => x.id)).size < list.length) throw bad('a plan can be applied once: each section needs its own planId');
      for (const { p, select } of list) confirmed(p, select, b.confirmDestructive);
      for (const { id } of list) plans.delete(id);
      return start(list.length, async (job) => {
        job.sections = list.map(({ p, select }) => ({ scope: p.scope, title: p.scope === 'global' ? 'Global setup' : p.scope, total: select?.length ?? p.changes.filter((c) => c.selected).length, status: 'waiting', run: null, error: null }));
        for (const [i, { p, select }] of list.entries()) {
          const s = job.sections[i];
          if (job.ctl.signal.aborted) { s.status = 'cancelled'; continue; }
          s.status = 'running';
          try {
            const run = await applyAsync(p.changes, p.ctx, { scope: p.scope, select, stop: () => job.ctl.signal.aborted }, (e) => { if (e.run) s.run = e.run; });
            s.run = run;
            s.status = run.status;
            if (run.status === 'failed') s.error = run.entries.filter((e) => e.status === 'failed').map((e) => `${e.title}: ${e.error}`).join('; ');
          } catch (e) { s.status = 'failed'; s.error = e.message; }
        }
      }, { kind: 'apply-all', title: 'one-run setup' });
    },
    // Each skills CLI command of a plan, rehearsed in a scratch folder: the files it would write, per change id. Three
    // run at a time; a result is kept 10 minutes or until files change through the app. They run in an OS sandbox; where
    // none starts the result is `unavailable`, and only `unconfined: true` (the user's click) runs them without one.
    'POST /api/prerun': (b) => {
      const p = plans.get(b.planId);
      if (!p) throw Object.assign(new Error('plan expired: load it again'), { status: 409 });
      const list = p.changes.filter(rehearsable), unconfined = b.unconfined === true;
      if (!list.length) return { job: null, total: 0 };
      return start(list.length, async (job) => {
        job.results = {};
        const queue = [...list];
        const worker = async () => {
          for (let c; (c = queue.shift()) && !job.ctl.signal.aborted;) {
            const key = JSON.stringify([c.argv, c.cwd ?? null, c.snapshot ?? null, unconfined]), hit = rehearsals.get(key);
            if (hit && Date.now() - hit.at < 10 * 60e3) { job.results[c.id] = hit.result; continue; }
            let result;
            try { result = await rehearse(p.ctx, c, { signal: job.ctl.signal, unconfined }); } catch (e) { result = { files: [], error: e.message }; }
            job.results[c.id] = result;
            if (!result.error) rehearsals.set(key, { at: Date.now(), result });
          }
        };
        await Promise.all([1, 2, 3].map(worker));
      }, { kind: 'prerun', title: 'skill install preview', readOnly: true });
    },
    // An apply stops after the change that runs (a half-done install is worse); evals and suggestions stop their session.
    'POST /api/job-cancel': (b) => {
      const job = jobs.get(b.id ?? '');
      if (!job) throw Object.assign(new Error('no such job'), { status: 404 });
      if (job.done) return { cancelled: false };
      job.ctl.abort();
      return { cancelled: true };
    },
    // Running jobs, so a reloaded page finds them again; a plan starts its rehearsal itself.
    'GET /api/jobs': () => [...jobs.values()].filter((j) => !j.done && !['prerun', 'scan', 'login'].includes(j.kind)).map((j) => ({ id: j.id, kind: j.kind, title: j.title, total: j.total })),
    'GET /api/job': (q) => {
      const job = jobs.get(q.get('id') ?? '');
      if (!job) throw Object.assign(new Error('no such job'), { status: 404 });
      return { total: job.total, done: job.done, cancelled: job.ctl.signal.aborted, error: job.error ?? null, output: job.output, run: job.run && { ...job.run, entries: [...job.run.entries] }, progress: job.progress ?? null, results: job.results ?? null, login: job.login ?? null,
      sections: job.sections?.map((x) => ({ ...x, run: x.run && { ...x.run, entries: [...x.run.entries] } })) ?? null };
    },
    // Trigger evals start real agent sessions on the user's subscription: the plan first, then a job.
    'GET /api/eval-plan': (q) => {
      const plan = evalPlanFor(q);
      return { targets: plan.map((p) => ({ target: p.target, agent: p.agent, cases: p.cases.length })), sessions: plan.reduce((n, p) => n + p.cases.length, 0) };
    },
    'POST /api/eval': (b) => {
      idle();
      const plan = evalPlanFor(b);
      if (!plan.length) throw bad('every target is unchanged since its last result');
      return start(plan.reduce((n, p) => n + p.cases.length, 0), (job) => runEval(ctx, plan, { onCase: (c) => { job.progress = c; }, onResult: ({ details, ...x }) => { (job.results ??= []).push(x); }, signal: job.ctl.signal }), { kind: 'eval', title: 'evals' });
    },
    // seen: the skills each chosen agent loads there, its global ones included.
    'GET /api/projects': async () => {
      await originsOfProjects();
      // The newest run per project folder (the ledger lists newest first): the last change, for sorting.
      const last = new Map();
      for (const r of ctx.ledger.list()) { const key = r.note?.updateAll ?? r.scope; if (!last.has(key)) last.set(key, r.time); }
      return listProjects(ctx).map((p) => {
        const s = status(ctx, p.path);
        const seen = Object.fromEntries(Object.entries(s.skills).map(([a, n]) => [a, n + cached(`skills:${a}`, () => globalSkills(ctx, a))]));
        return { ...s, seen, name: p.name ?? null, notes: p.notes ?? null, added: p.added ?? null, last: last.get(p.path) ?? null, changes: s.changes && serialize(s.changes, projectCtx(ctx, p.path)) };
      });
    },
    // What adding a folder runs into: registered already, another worktree of a registered repository, inside a project.
    'GET /api/project-check': (q) => input(() => checkAdd(ctx, q.get('path') ?? '')),
    'POST /api/projects': (b) => input(() => {
      const paths = [b.paths ?? b.path].flat();
      if (!paths.length || !paths.every((x) => typeof x === 'string' && isAbsolute(x))) throw bad('path must be an absolute path');
      const action = b.action ?? 'add';
      if (action === 'add') paths.forEach((x) => addProject(ctx, x, { worktree: b.worktree === true }));
      else if (action === 'remove') removeProject(ctx, paths);
      else if (action === 'rename') renameProject(ctx, paths[0], { name: b.name, notes: b.notes });
      else if (action === 'relocate') {
        idle();
        if (typeof b.to !== 'string' || !isAbsolute(b.to)) throw bad('to must be an absolute path');
        relocateProject(ctx, paths[0], b.to);
      } else throw bad('action must be add, remove, rename or relocate');
      return listProjects(ctx);
    }),
    // The files "Remove BenchKeeper setup" would change in a project, before it runs; shared: it becomes a pull request.
    'GET /api/remove-setup-plan': (q) => {
      const dir = resolve(q.get('dir') ?? '');
      if (!registered(dir)) throw bad('register the project first');
      const { shared, changes } = input(() => setupRemoval(ctx, dir));
      return { shared, changes: serialize(changes, projectCtx(ctx, dir)) };
    },
    'POST /api/remove-setup': (b) => {
      idle();
      const paths = [b.paths ?? []].flat().filter((x) => typeof x === 'string' && registered(x));
      return paths.map((x) => removeSetup(ctx, canon(x), { push: b.push !== false }));
    },
    // With setup=1 the answers come from the query (a project's first setup), else from its state file.
    'GET /api/project-plan': (q) => {
      const dir = resolve(q.get('dir') ?? '');
      if (!registered(dir)) throw bad('register the project first');
      const setup = q.get('setup') === '1' ? setupAnswers(q) : {};
      // Pack switches and single-skill actions of the Projects and Catalog views, on top of the saved answers.
      const switches = { packOn: q.getAll('pack-on'), packOff: q.getAll('pack-off'), pick: q.getAll('pick'), drop: q.getAll('drop'), reset: q.getAll('reset'), update: q.getAll('update'), partial: q.has('focus') };
      // Skill toggles name skills of this project only.
      const own = input(() => chosenSkills(resolveAnswers(dir, { ...setup, ...switches }), libraryWith(ctx)).map((s) => s.name));
      const disable = q.getAll('disable'), enable = q.getAll('enable');
      const unknown = [...disable, ...enable, ...switches.reset].filter((n) => !own.includes(n));
      if (unknown.length) throw bad(`not a skill of this project: ${unknown.join(', ')}`);
      const notInLibrary = switches.pick.filter((n) => !libraryWith(ctx).skills.some((x) => x.name === n));
      if (notInLibrary.length) throw bad(`not in the library: ${notInLibrary.join(', ')}`);
      const p = input(() => projectPlan({ ctx: projectCtx(ctx, dir), dir, answers: { ...setup, ...switches, disable, enable } }));
      // Plugin installs change the machine, not the project: the global plan does them, as in Update all.
      // focus: one skill's action shows only that skill's changes and the records of them.
      const focus = q.getAll('focus');
      const all = preview(p.changes).filter((c) => c.kind !== 'command' || c.cwd);
      const changes = focus.length ? focusOn(all, focus) : all;
      return { planId: keep(changes, projectCtx(ctx, dir), dir), changes: serialize(changes, projectCtx(ctx, dir)), prompts: p.prompts, skills: p.skills, warnings: p.warnings,
        chosen: own.map((name) => ({ name, disabled: p.answers.disabled.includes(name) })),
        packs: libraryWith(ctx).packs.map((x) => ({ id: x.id, title: x.title ?? x.id, own: !!x.own, skills: x.skills?.length ?? null, enabled: p.answers.packs.includes(x.id) })) };
    },
    // Every registered project's skills with their state, and the folders no setup installed, for the Catalog.
    // ?check=1 asks each skill source for its default branch (the one network call), to mark skills outdated.
    'GET /api/skills': (q = new URLSearchParams()) => ({
      projects: listProjects(ctx).filter((p) => !p.missing && registered(p.path)).map((p) => ({ path: p.path, name: p.name ?? null, ...projectSkills(ctx, p.path, { check: q.get('check') === '1' }) })).filter((p) => p.skills),
      global: globalUntracked(ctx, installed()),
    }),
    // What a project's first setup offers: the installed agents, environments, tiers, library packs and skills, and the
    // packs its files point to.
    'GET /api/project-setup': (q) => {
      const dir = resolve(q.get('dir') ?? '');
      if (!registered(dir)) throw bad('register the project first');
      const lib = libraryWith(ctx);
      const agents = agentsNow().filter((a) => a.installed).map((a) => ({ id: a.id, name: a.name }));
      return { agents, advisers: agents.filter((a) => ADVISERS.includes(a.id)), state: projectState(ctx, dir), envs: ENVS, tiers: TIERS, suggested: suggest(dir),
        packs: lib.packs.map((p) => ({ id: p.id, title: p.title, pickWhen: p.pickWhen, skills: p.skills ?? [] })), skills: lib.skills.map((s) => ({ name: s.name, pickWhen: s.pickWhen, agents: s.agents ?? null })), frameworks: frameworkRows() };
    },
    // What a one-run setup starts from: the installed agents and advisers, and each project with its setup state. A
    // blocked project is left to Update all: one-run writes local setups in the checkout, and that is not possible for a
    // folder without a repository, a shared setup (a pull request) or one still committed (a pull request removes it).
    'GET /api/one-run': async () => {
      await originsOfProjects();
      const agents = agentsNow().filter((a) => a.installed).map((a) => ({ id: a.id, name: a.name }));
      return { agents, level: levelFor(ctx, agents.map((a) => a.id)), advisers: agents.filter((a) => ADVISERS.includes(a.id)), projects: listProjects(ctx).map((p) => {
        const s = status(ctx, p.path);
        const blocked = s.error ?? (!s.repo ? 'no repository' : s.share ? 'shared setup: Update all opens its pull request' : s.committed ? 'setup still committed: Update all moves it to this machine' : null);
        return { path: p.path, blocked, state: !s.setupVersion ? 'none' : !s.current || s.changes?.length ? 'behind' : 'current', setupVersion: s.setupVersion };
      }) };
    },
    // An agent reads the project and suggests env, packs and skills: one read-only session, after the user agreed in the UI.
    'POST /api/setup-advice': (b) => {
      if (process.env.CI) throw bad('setup advice starts an agent session on a subscription and does not run in CI');
      const dir = resolve(String(b.dir ?? ''));
      if (!registered(dir)) throw bad('register the project first');
      if (!ADVISERS.includes(b.agent) || !installed().includes(b.agent)) throw bad(`agent must be an installed one of ${ADVISERS.join(', ')}`);
      return start(1, (job) => adviseSetup(ctx, { dir, agent: b.agent, lib: libraryWith(ctx), signal: job.ctl.signal }).then((r) => { job.results = r; }), { kind: 'advice', title: `setup suggestions for ${dir}`, readOnly: true });
    },
    // Reads the transcripts into the session cache, so GET /board answers at once; one scan at a time. A scan less
    // than a minute old is reused unless force is set (Rescan).
    'POST /api/board-ticket': () => {
      const t = boardTickets(ctx), now = Date.now();
      for (const [k, at] of t) if (now - at > FRESH_SCAN_MS) t.delete(k);
      const ticket = randomBytes(24).toString('base64url');
      t.set(ticket, now);
      return { ticket };
    },
    // The page's Stop button: refused while an apply or eval runs; scans, suggestions and rehearsals stop with the server.
    'POST /api/shutdown': () => {
      idle();
      for (const j of jobs.values()) if (!j.done) j.ctl.abort();
      return { stopping: true };
    },
    'POST /api/sessions-scan': (b) => {
      const last = scans.get(ctx);
      if (b.force !== true && last && Date.now() - last.at < FRESH_SCAN_MS) return { fresh: true };
      const running = [...jobs.values()].find((j) => j.kind === 'scan' && !j.done);
      if (running) return { job: running.id, total: 0 };
      return start(0, async (job) => {
        const notes = [];
        const rows = await scanSessions(ctx, { onFile: (p) => { job.progress = p; }, ledger: true, onNote: (n) => notes.push(n) });
        keepScan(ctx, rows);
        job.results = { sessions: rows.length, ...(notes.length ? { notes } : {}) };
      }, { kind: 'scan', title: 'sessions', readOnly: true });
    },
    // The sessions cache keeps a summary after the agent deletes its transcript: how long, and a way to clear it. Refused
    // during a scan, which would write the old cache back.
    'GET /api/sessions-cache': () => sessionCache(ctx),
    'POST /api/sessions-cache': (b) => {
      if ([...jobs.values()].some((j) => j.kind === 'scan' && !j.done)) throw Object.assign(new Error('a scan is running: wait for it to finish'), { status: 409 });
      if (b.clear === true) clearSessionCache(ctx);
      else if ('keepDays' in b) input(() => keepSessionsFor(ctx, b.keepDays));
      else throw bad('send clear: true or keepDays');
      scans.delete(ctx);
      return sessionCache(ctx);
    },
    'POST /api/update-all': (b) => {
      idle();
      const paths = (b.paths ?? []).filter(registered);
      const answers = Object.fromEntries(Object.entries(b.answers ?? {}).filter(([p]) => paths.includes(p)).map(([p, a]) => [p, setupAnswers(a)]));
      // dryRun: what each project would get (setup version, changes, whether it is clean), nothing changed.
      if (b.dryRun === true) return paths.map((p) => { const s = status(ctx, p); return { ...s, changes: s.changes && serialize(s.changes, projectCtx(ctx, p)) }; });
      return input(() => updateAll(ctx, { paths, push: b.push !== false, answers, max: Number.isInteger(b.max) && b.max > 0 ? b.max : undefined }));
    },
    'GET /api/history': () => ctx.ledger.list().map(({ entries, ...r }) => ({ ...r, changes: entries.length })),
    // One run with the diff of each file it wrote: its backup (or nothing) against the file as the change left it,
    // which is the backup a later change of the run took, or the file while nothing changed it since.
    // A session's files diff between its git snapshots.
    'GET /api/run': (q) => {
      const run = ctx.ledger.get(q.get('id') ?? '');
      return { ...run, entries: run.entries.map((e, i) => {
        // shortcut: git runs twice per file and blocks the server, so only the first 50 files get a diff; stream them when sessions get larger.
        if (e.kind === 'session' && e.files) return { ...e, files: e.files.map((f, n) => ({ ...f, diff: n < 50 ? sessionDiff(ctx, e, f) : null })) };
        if (!e.path || e.kind !== 'write' || e.status !== 'done') return e;
        // Deleted, for example the undo of a file the run created: the backup against nothing.
        if (e.hashAfter === null && !exists(e.path)) return { ...e, removed: true, diff: e.backup && !isDir(e.backup) ? diffLines(readText(e.backup), null, e.path) : null };
        if (isDir(e.path)) return { ...e, folder: true };
        const next = run.entries.slice(i + 1).find((x) => x.path === e.path && x.backup && x.hashBefore === e.hashAfter);
        const now = next ? readText(next.backup) : hashPath(e.path) === e.hashAfter ? readText(e.path) : committed(ctx, run, e);
        const d = now == null ? null : diffLines(e.backup ? readText(e.backup) : null, now, e.path);
        return { ...e, diff: isSettingsFile(e.path) ? redact(d) : d };
      }) };
    },
    'POST /api/undo': (b) => {
      idle();
      const scope = ctx.ledger.get(b.run).scope;
      return undo(b.run, input(() => scopeCtx(ctx, scope)), { step: b.step || undefined });
    },
    'GET /api/catalog': () => {
      const lib = libraryWith(ctx), users = usersByPack(ctx);
      const projects = listProjects(ctx).map((p) => projectState(ctx, p.path)).filter(Boolean);
      return { ...lib, packs: lib.packs.map((x) => ({ ...x, usedBy: users.get(x.id) ?? [] })), invalidPacks: invalidPacks(ctx), skills: lib.skills.map((s) => ({ ...s, projects: projects.filter((st) => st.skills?.some((x) => x.name === s.name)).length })) };
    },
    'GET /api/skill': (q) => {
      const name = q.get('name');
      if (!libraryWith(ctx).skills.some((s) => s.name === name)) throw Object.assign(new Error('unknown skill'), { status: 404 });
      return { name, text: readText(join(contentDir, 'library', name, 'SKILL.md')) };
    },
    'GET /api/doctor': (q) => {
      if (!q.has('dir')) return cached('doctor', () => doctor(ctx, { agents: installed() }));
      const dir = resolve(q.get('dir'));
      if (!registered(dir)) throw bad('register the project first');
      return projectChecks(ctx, dir);
    },
    // The findings of `insights --json` with their triage (dismissed, snoozed until a date); a triage click does not scan again.
    'GET /api/insights': async () => {
      const found = await cached('insights', () => collectInsights(ctx, { agents: installed() }));
      return { ...found, findings: withTriage(found.findings, readTriage(ctx)) };
    },
    'POST /api/insights-triage': (b) => input(() => setTriage(ctx, b.key, b.action)),
    'POST /api/pick-folder': () => pickFolder(ctx),
    // Opens a registered project in the file manager.
    'POST /api/reveal': (b) => {
      const dir = resolve(String(b.path ?? ''));
      if (!registered(dir)) throw bad('register the project first');
      (ctx.open ?? openFolder)(dir);
      return { opened: dir };
    },
    // Eval results without the per-case details; lines that do not parse are left out.
    'GET /api/evals': () => (readText(join(userEvals(ctx), 'results.jsonl')) ?? '').split('\n').filter(Boolean).flatMap((l) => {
      try { const { details, ...r } = JSON.parse(l); return [r]; } catch { return []; }
    }),
    'GET /api/pack-warnings': (q) => warnings((q.get('skills') ?? '').split(',').filter(Boolean)),
    'GET /api/pack-export': (q) => input(() => ({ name: `${q.get('id')}.json`, text: exportPack(ctx, q.get('id')) })),
    'POST /api/packs': (b) => input(() => {
      if (b.action === 'save') return savePack(ctx, { id: b.id, title: b.title || b.id, skills: b.skills });
      if (b.action === 'import') return importPack(ctx, b.text ?? '', b.id || undefined);
      if (b.action === 'remove') return removePack(ctx, b.id, { usedBy: projectsUsing(ctx, b.id) }), { removed: b.id };
      throw bad('action must be save, import or remove');
    }),
    'GET /api/profile-export': (q) => ({ text: exportProfile(ctx, { agents: q.get('agents') ? q.get('agents').split(',') : installed(), packs: installedPacks(ctx) }) }),
    // First what the file holds; with register, the own packs and projects are saved first (project plans can name
    // those packs), then the global and project plans come back to apply like any other.
    'POST /api/profile-import': (b) => {
      const p = input(() => readProfile(b.text ?? ''));
      if (!b.register) return { agents: p.global.agents, globalPacks: p.global.packs ?? [], packs: (p.packs ?? []).map((x) => x.id), projects: (p.projects ?? []).map((x) => ({ path: x.path, here: exists(x.path) })) };
      const done = input(() => importChoices(ctx, p));
      const plan = importPlan(ctx, p);
      return { ...done, missing: plan.missing, global: { planId: keep(plan.global, ctx, 'global'), changes: serialize(plan.global, ctx) },
        plans: plan.projects.filter((x) => x.changes.length).map((x) => ({ path: x.path, planId: keep(x.changes, x.ctx, x.path), changes: serialize(x.changes, x.ctx) })) };
    },
    'POST /api/scan': (b) => {
      if (typeof b.root !== 'string' || !isAbsolute(b.root)) throw bad('root must be an absolute path');
      return input(() => scan(ctx, b.root)).filter((d) => !registered(d));
    },
    // Agent settings of one layer set (user, plus a registered project's project and local files) with their notes. Values
    // of secret-looking names are masked by the module.
    'GET /api/settings': (q) => {
      const agentId = q.get('agent') ?? 'claude';
      if (!settingsAgents.includes(agentId)) throw bad(`agent must be one of ${settingsAgents.join(', ')}`);
      const dir = q.get('dir') ? resolve(q.get('dir')) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      return input(() => listSettings(ctx, agentId, { dir, advanced: q.get('advanced') === '1', env: process.env }));
    },
    // A plan for edits { key: value | null } (null removes the key) or a bundle in one layer; applied through /api/apply.
    'POST /api/settings-plan': (b) => {
      const agentId = b.agent ?? 'claude';
      if (!settingsAgents.includes(agentId)) throw bad(`agent must be one of ${settingsAgents.join(', ')}`);
      const layer = b.layer ?? 'user';
      const dir = layer === 'user' ? undefined : resolve(String(b.dir ?? ''));
      if (dir && !registered(dir)) throw bad('register the project first');
      const edits = b.bundle ? input(() => bundleEdits(agentId, b.bundle)) : b.edits;
      if (!edits || typeof edits !== 'object' || Array.isArray(edits)) throw bad('edits must be an object of key and value');
      const sctx = dir ? projectCtx(ctx, dir) : ctx;
      const changes = preview(input(() => settingsChanges(sctx, agentId, { layer, dir, edits })));
      return { planId: keep(changes, sctx, dir ?? 'global'), changes: serialize(changes, sctx) };
    },
    // The instruction files of the global folders, or of a registered project, with owner, load state and the context they cost.
    'GET /api/rules': (q) => {
      const dir = q.get('dir') ? resolve(q.get('dir')) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      const agents = installed().filter((a) => RULE_AGENTS.includes(a));
      return rulesView(ctx, { agents: agents.length ? agents : RULE_AGENTS, dir });
    },
    // MCP servers, hooks, subagents, commands and output styles of the global folders or a registered project, read from files.
    'GET /api/extensions': (q) => {
      const dir = q.get('dir') ? resolve(q.get('dir')) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      return extensionsView(ctx, { agents: RULE_AGENTS, dir });
    },
    // The text of one listed file: any other path is refused. For the page on this machine only.
    'GET /api/rule-text': (q) => {
      const dir = q.get('dir') ? resolve(q.get('dir')) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      return input(() => ruleText(ctx, { agent: q.get('agent') || undefined, file: q.get('file'), dir }));
    },
    // A plan that turns one listed file on or off; applied through /api/apply, undone in History.
    'POST /api/rules-plan': (b) => {
      if (!RULE_AGENTS.includes(b.agent)) throw bad(`agent must be one of ${RULE_AGENTS.join(', ')}`);
      if (typeof b.on !== 'boolean') throw bad('on must be true or false');
      const dir = b.dir ? resolve(String(b.dir)) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      const rctx = dir ? projectCtx(ctx, dir) : ctx;
      const changes = preview(input(() => ruleChanges(ctx, { agent: b.agent, file: b.file, dir, on: b.on })));
      return { planId: keep(changes, rctx, dir ?? 'global'), changes: serialize(changes, rctx) };
    },
    // Accounts: the registry as `accounts list` shows it, the status of one account (reads only), plans for add, use and
    // remove (applied through /api/apply, undone in History), and the guided sign-in as a job that polls like an apply.
    // The page never sees a credential: the registry holds none, a pasted code goes to the agent and into no record.
    'GET /api/accounts': () => {
      const problem = accountsProblem(ctx);
      if (problem) throw Object.assign(new Error(problem), { status: 409 });
      const settings = registrySettings(ctx);
      return { accounts: listAccounts(ctx).map((a) => accountDoc(a, settings)), settings: { ...settingsOf(settings), warn: limitsFor(settings).warn }, store: store(ctx).name, login: [...jobs.values()].find((j) => j.kind === 'login' && !j.done)?.id ?? null };
    },
    'GET /api/accounts-status': async (q) => {
      const a = input(() => findAccount(ctx, q.get('name') ?? ''));
      const dir = q.get('project') ? resolve(q.get('project')) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      return accountStatusAsync(ctx, a, { dir });
    },
    'POST /api/accounts-plan': (b) => {
      const text = (v) => (typeof v === 'string' && v ? v : undefined);
      const change = input(() => {
        if (b.op === 'add') return addChange(ctx, newAccount(ctx, { name: text(b.name), agent: text(b.agent), container: b.container === true, label: text(b.label), dir: text(b.dir), mount: text(b.mount) }));
        const a = findAccount(ctx, String(b.name ?? ''));
        if (b.op === 'use') return useChange(ctx, a.name);
        if (b.op !== 'remove') throw new Error('op must be add, use or remove');
        // A stored token is deleted by the command, which the page does not offer.
        if (a.token) throw new Error(`account ${a.name} keeps a token: remove it in a terminal with benchkeeper accounts remove ${a.name}, which also deletes the token`);
        return removeChange(ctx, a.name);
      });
      const changes = preview([change]);
      return { planId: keep(changes, ctx, 'global'), changes: serialize(changes, ctx) };
    },
    // The user asked for this sign-in with the button: it opens the sign-in link in a private browser window, or shows it.
    'POST /api/accounts-login': (b) => {
      idle();
      const a = input(() => findAccount(ctx, String(b.name ?? '')));
      const dir = b.project ? resolve(String(b.project)) : undefined;
      if (dir && !registered(dir)) throw bad('register the project first');
      if (a.mode === 'container' && !dir) throw bad('a container account signs in inside the dev container of a project: choose the project');
      const email = typeof b.email === 'string' && b.email ? b.email : undefined;
      return start(1, async (job) => {
        const state = job.login = { step: 'start', url: null, browser: null, awaitingCode: false, lines: [], loggedIn: null };
        const io = {
          say: (line) => { state.lines.push(line); state.lines.splice(0, state.lines.length - 200); },
          step: (name, info) => { state.step = name; if (info?.url) Object.assign(state, { url: info.url, browser: info.browser ?? null }); if (name === 'done') state.loggedIn = info?.loggedIn ?? null; },
          // What the user pastes goes to the agent; it is not kept in the lines or anywhere else.
          code: () => new Promise((ok) => {
            state.awaitingCode = true;
            job.sendCode = (c) => { state.awaitingCode = false; ok(c); };
            job.ctl.signal.addEventListener('abort', () => ok(null), { once: true });
          }),
        };
        try { await login(ctx, a, { io, dir: dir ?? process.cwd(), email, signal: job.ctl.signal }); } finally { state.awaitingCode = false; }
      }, { kind: 'login', title: `sign in ${a.name}` });
    },
    'POST /api/accounts-code': (b) => {
      const job = jobs.get(b.job ?? '');
      if (!job?.login?.awaitingCode || !job.sendCode) throw bad('no sign-in waits for a code');
      job.sendCode(String(b.code ?? '').slice(0, 4096));
      return { sent: true };
    },
    'GET /api/inventory': inventoryNow,
    // The Dashboard: installed, health, coverage and catalog by pack, from one read of the inventory and the projects.
    'GET /api/dashboard': () => cached('dashboard', () => dashboard(ctx, installed(), inventoryNow())),
  };
  // Registry, pack and profile writes wait for a running apply too: they change what a plan reads or an apply writes.
  const guarded = { 'POST /api/projects': () => true, 'POST /api/packs': () => true, 'POST /api/profile-import': (b) => b.register };
  for (const [k, when] of Object.entries(guarded)) { const f = routes[k]; routes[k] = (b) => { if (when(b)) idle(); return f(b); }; }
  // A change drops the cached machine reads; a triage click changes none of them (GET /api/insights reads the triage file each time).
  for (const k of Object.keys(routes)) if (k.startsWith('POST ') && k !== 'POST /api/insights-triage') { const f = routes[k]; routes[k] = (b) => { memo.clear(); return f(b); }; }
  return routes;
}

async function body(req) {
  let size = 0;
  const chunks = [];
  // Read to the end even when too large: stopping early destroys the connection before the 413 reaches the client.
  for await (const c of req) { size += c.length; if (size <= 1e6) chunks.push(c); }
  if (size > 1e6) throw Object.assign(new Error('body too large'), { status: 413 });
  let b;
  try { b = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('body is not JSON'), { status: 400 }); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('body must be a JSON object');
  return b;
}

// The link works once and for this long: a token printed with --no-open does not stay valid until the server stops.
export const TOKEN_MS = 10 * 60e3;
export function startServer(ctx, { port = 0, token = randomBytes(32).toString('base64url'), dist = distDir, routes = api(ctx), tokenMs = TOKEN_MS } = {}) {
  let urlToken = token, session = null, key = null;
  const expires = Date.now() + tokenMs;
  // A failure nobody handled ends this request, never the server.
  const server = createServer((req, res) => handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"internal error"}'); }));
  const handle = async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8', headers = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'", ...headers });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return send(400, { error: 'bad request' }); }
    const p = server.address().port;
    // The URL token works once: it becomes the session cookie and the API key, which the page reads from the fragment
    // (never sent to a server) and keeps in this origin's storage.
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('token') && req.headers.host === `127.0.0.1:${p}` && urlToken && Date.now() < expires && same(url.searchParams.get('token'), urlToken)) {
      urlToken = null;
      session = randomBytes(32).toString('base64url');
      key = randomBytes(32).toString('base64url');
      // A page of this origin moves on, not a redirect: after the file openBrowser hands the browser, a redirect would
      // count as cross-site, and the browser would hold back the SameSite=Strict cookie.
      return send(200, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/#k=${key}"><title>BenchKeeper</title>`, 'text/html; charset=utf-8', { 'set-cookie': `${cookieName(p)}=${session}; HttpOnly; SameSite=Strict; Path=/` });
    }
    const why = rejectReason(req, { port: p, session, key, api: url.pathname.startsWith('/api/') });
    if (why) return send(why[0], { error: why[1] });
    // The sessions board: a page of its own, framed by the app; only its script by hash runs there.
    if (req.method === 'GET' && url.pathname === '/board') {
      const t = boardTickets(ctx), ticket = url.searchParams.get('ticket') ?? '';
      const issued = t.get(ticket);
      t.delete(ticket);
      if (!issued || Date.now() - issued > FRESH_SCAN_MS) return send(403, { error: 'open the board from the app' });
      try {
        // The last scan, or one now; the page says when it was read.
        if (!scans.has(ctx)) keepScan(ctx, await scanSessions(ctx, { ledger: true }));
        const { rows, at } = scans.get(ctx);
        return send(200, boardHtml(rows, new Date(at).toISOString(), registeredPaths(ctx)), 'text/html; charset=utf-8', { 'content-security-policy': `${BOARD_CSP}; frame-ancestors 'self'` }); } catch (e) { return send(500, { error: e.message }); }
    }
    const route = routes[`${req.method} ${url.pathname}`];
    // A form post cannot send JSON: only a script of this origin gets through (the Origin and key checks above stand too).
    if (route && req.method === 'POST' && !/^application\/json(;|$)/i.test(req.headers['content-type'] ?? '')) return send(415, { error: 'content-type must be application/json' });
    if (route) {
      try { send(200, await route(req.method === 'POST' ? await body(req) : url.searchParams)); } catch (e) { return send(e.status ?? 500, { error: e.message }); }
      // After the answer: closing ends the CLI's ui command, as Ctrl+C does.
      if (url.pathname === '/api/shutdown') setImmediate(() => { server.close(); server.closeAllConnections(); });
      return;
    }
    if (url.pathname.startsWith('/api/')) return send(req.method === 'GET' && routes[`POST ${url.pathname}`] ? 405 : 404, { error: 'no such endpoint' });
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return send(400, { error: 'bad path' }); }
    let file = resolve(dist, `.${path}`);
    // Files only: reading a folder (/assets) would throw outside any handler and end the server.
    if (!inside(file, [dist]) || !isFile(file)) file = join(dist, 'index.html');
    if (!isFile(file)) return send(500, 'the UI is not built: npm run build in app/', 'text/plain');
    // Vite names built assets by their content hash, so they never change under one name; the page itself always reloads.
    const hashed = file.startsWith(join(dist, 'assets') + sep);
    return send(200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream', hashed ? { 'cache-control': 'public, max-age=31536000, immutable' } : {});
  };
  // Longer than the browser keeps an idle connection: a request the page sends just as Node closes one would fail as a
  // network error (browsers retry only GETs). Headers must be allowed longer than that.
  server.keepAliveTimeout = 65e3;
  server.headersTimeout = 70e3;
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/?token=${token}` })));
}

const isFile = (f) => { try { return statSync(f).isFile(); } catch { return false; } };

// Windows: start takes a quoted first argument as the window title, and Node would escape the quotes of an empty one,
// so cmd gets the arguments as written; the target is a temporary file path or a URL without quotes.
export function launch(target) {
  const win = process.platform === 'win32';
  const argv = process.platform === 'darwin' ? ['open', target] : win ? ['cmd', '/c', 'start', '""', `"${target}"`] : ['xdg-open', target];
  try { spawn(argv[0], argv.slice(1), { stdio: 'ignore', detached: true, windowsVerbatimArguments: win }).on('error', () => {}).unref(); } catch { /* the URL is printed */ }
}

// A snap or Flatpak browser has its own /tmp and cannot read the file openBrowser writes there; handing it the URL would put
// the token into the arguments, which other local users read with ps. It is not launched: the CLI prints the URL to paste.
export function confinedBrowser(run = runCommand, home = process.env.HOME ?? '') {
  if (process.platform !== 'linux') return false;
  const app = run(['xdg-settings', 'get', 'default-web-browser'], { timeout: 5e3 }).stdout.trim();
  return !!app && !app.includes('/') && ['/var/lib/snapd/desktop/applications', '/var/lib/flatpak/exports/share/applications', join(home, '.local/share/flatpak/exports/share/applications')]
    .some((d) => exists(join(d, app)));
}

// Other local users can read process arguments, so the opener and the browser get a file only this user can read,
// which forwards to the URL with the token. It goes once the browser had time to load it, or when the app ends.
// A confined browser, or a file that cannot be written, launches nothing (returns null): the URL goes to the user to paste.
export function openBrowser(url, { wait = 120e3, open = launch, confined = confinedBrowser } = {}) {
  if (confined()) return null;
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'bk-open-'));
    const file = join(dir, 'open.html');
    const safe = url.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}"><title>BenchKeeper</title><a href="${safe}">Open BenchKeeper</a>\n`, { mode: 0o600 });
    const clean = () => rmSync(dir, { recursive: true, force: true });
    process.once('exit', clean);
    setTimeout(() => { clean(); process.off('exit', clean); }, wait).unref();
    open(file);
    return file;
  } catch {
    if (dir) rmSync(dir, { recursive: true, force: true });
    return null;
  }
}
// On Windows through explorer: cmd would read & or ^ in a folder name as its own syntax.
export function openFolder(dir) {
  if (process.platform !== 'win32') return launch(dir);
  try { spawn(windowsTool('explorer.exe'), [dir], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* nothing to open */ }
}
