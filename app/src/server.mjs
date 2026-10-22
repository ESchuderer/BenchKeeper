// Local web UI server: 127.0.0.1 only, one-time URL token swapped for an HttpOnly session cookie, and checks against
// requests from other sites (Host, Origin, Sec-Fetch-Site, POST with a custom header for every change).
// shortcut: apply, undo, Update all and the open folder dialog run synchronously and block other requests meanwhile;
// one local user is fine.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVISERS, adviseSetup } from './advise.mjs';
import { agent, detect } from './agents.mjs';
import { userEvals } from './cases.mjs';
import { evalPlan, runEval } from './eval.mjs';
import { contentDir, appVersion } from './content.mjs';
import { doctor, projectChecks } from './doctor.mjs';
import { diffLines } from './diff.mjs';
import { exists, hashPath, inside, readText } from './fsx.mjs';
import { inventory } from './inventory.mjs';
import { exportPack, importPack, libraryWith, removePack, savePack, warnings } from './packs.mjs';
import { exportProfile, importChoices, importPlan, installedPacks, readProfile } from './profile.mjs';
import { addProject, listProjects, packsInUse, removeProject, scan, status, updateAll } from './projects.mjs';
import { applyAsync, itemState, preview, undo } from './runner.mjs';
import { globalPlan } from './steps/global.mjs';
import { ENVS, TIERS, chosenSkills, projectPlan, resolveAnswers, suggest, tryState } from './steps/project.mjs';

export const HEADER = 'x-benchkeeper';
// Per port: browsers send a 127.0.0.1 cookie to every port, so two servers must not overwrite each other's session.
const cookieName = (port) => `bk_session_${port}`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
// Byte lengths: timingSafeEqual throws on different lengths, and one character can be several bytes.
const same = (a, b) => { if (typeof a !== 'string') return false; const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// null when the request may go on, else [status, reason].
export function rejectReason(req, { port, session }) {
  const self = `127.0.0.1:${port}`;
  if (req.headers.host !== self) return [421, 'wrong host'];
  if ('origin' in req.headers && req.headers.origin !== `http://${self}`) return [403, 'foreign origin'];
  if (req.headers['sec-fetch-site'] === 'cross-site') return [403, 'cross-site request'];
  const name = `${cookieName(port)}=`;
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(name))?.slice(name.length);
  if (!session || !same(cookie, session)) return [401, 'no session'];
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return [405, 'method not allowed'];
  if (req.method === 'POST' && req.headers[HEADER] !== '1') return [403, `missing ${HEADER} header`];
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

// Changes without their edit functions, with the item state the Dashboard groups by.
function serialize(changes, ctx) {
  return changes.map(({ edit, after, from, env, ...c }) => ({ ...c, state: c.kind === 'write' && !from ? itemState(c.path, after, ctx) : c.destructive ? 'foreign' : null }));
}

// First-setup answers from a query or a request body: only these keys, as strings and string lists.
function setupAnswers(src) {
  if (!src || typeof src !== 'object') return {};
  const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
  const all = (k) => (src instanceof URLSearchParams ? src.getAll(k) : [src[k] ?? []].flat()).filter((x) => typeof x === 'string');
  const list = (k) => (src instanceof URLSearchParams ? all(k).flatMap((x) => x.split(',')).filter(Boolean) : all(k));
  return { agents: list('agents'), env: get('env') || undefined, sandbox: get('sandbox') === '1' || get('sandbox') === true, packs: list(src instanceof URLSearchParams ? 'pack' : 'packs'), skills: list(src instanceof URLSearchParams ? 'skill' : 'skills'), tier: get('tier') || undefined };
}

export function api(ctx) {
  const plans = new Map(), jobs = new Map();
  // Changes wait while a job runs: an undo or Update all in between would edit files and runs an apply still writes.
  const idle = () => { if ([...jobs.values()].some((j) => !j.done && !j.readOnly)) throw Object.assign(new Error('an apply or eval is still running: wait for it to finish'), { status: 409 }); };
  // A job runs work(job) in the background; the newest 20 finished jobs are kept.
  const start = (total, work, { readOnly = false } = {}) => {
    const job = { id: randomBytes(8).toString('hex'), total, run: null, output: {}, done: false, readOnly };
    jobs.set(job.id, job);
    for (const [id, j] of [...jobs].slice(0, -20)) if (j.done) jobs.delete(id);
    work(job).catch((e) => { job.error = e.message; }).finally(() => { job.done = true; });
    return { job: job.id, total };
  };
  const evalPlanFor = (src) => {
    if (process.env.CI) throw bad('evals start agent sessions on a subscription and do not run in CI');
    const get = (k) => (src instanceof URLSearchParams ? src.get(k) : src[k]);
    const agents = String(get('agents') ?? 'claude').split(',').filter((a) => ['claude', 'codex'].includes(a));
    const only = src instanceof URLSearchParams ? src.getAll('target') : [src.targets ?? []].flat().filter((t) => typeof t === 'string');
    return evalPlan(ctx, { agents: agents.length ? agents : ['claude'], all: get('all') === '1' || get('all') === true, only: only.length ? only : undefined });
  };
  const keep = (changes, pctx, scope) => { const id = randomBytes(8).toString('hex'); plans.set(id, { changes, ctx: pctx, scope }); return id; };
  const agentsNow = () => detect(ctx);
  const installed = () => agentsNow().filter((a) => a.installed).map((a) => a.id);
  const projectCtx = (dir) => ({ ...ctx, roots: [dir] });
  const registered = (dir) => listProjects(ctx).some((p) => p.path === dir);
  return {
    'GET /api/overview': () => ({ version: appVersion, agents: agentsNow().map((a) => ({ ...a, rules: agent(a.id).global.rules.path, skills: agent(a.id).global.skills })), projects: listProjects(ctx).map((p) => { const s = tryState(p.path); return { path: p.path, agents: s?.agents ?? [], setupVersion: s?.setupVersion ?? null }; }) }),
    'GET /api/global-plan': (q) => {
      const agents = q.get('agents') ? q.get('agents').split(',') : installed();
      const changes = preview(globalPlan({ ctx, agents, options: { packs: q.getAll('pack'), packsInUse: packsInUse(ctx) } }));
      return { planId: keep(changes, ctx, 'global'), agents, changes: serialize(changes, ctx) };
    },
    // Starts the apply and answers at once; GET /api/job shows each change as it runs. One job at a time.
    'POST /api/apply': (b) => {
      idle();
      const p = plans.get(b.planId);
      if (!p) throw Object.assign(new Error('plan expired: load it again'), { status: 409 });
      plans.delete(b.planId);
      // Output is kept per change, its last 8 kB.
      return start(b.select?.length ?? p.changes.filter((c) => c.selected).length, (job) => applyAsync(p.changes, p.ctx, { scope: p.scope, select: b.select }, (e) => {
        if (e.run) job.run = e.run;
        if (e.output) job.output[e.entry.id] = ((job.output[e.entry.id] ?? '') + e.output).slice(-8192);
      }).then((run) => { job.run = run; }));
    },
    'GET /api/job': (q) => {
      const job = jobs.get(q.get('id') ?? '');
      if (!job) throw Object.assign(new Error('no such job'), { status: 404 });
      return { total: job.total, done: job.done, error: job.error ?? null, output: job.output, run: job.run && { ...job.run, entries: [...job.run.entries] }, progress: job.progress ?? null, results: job.results ?? null };
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
      return start(plan.reduce((n, p) => n + p.cases.length, 0), (job) => runEval(ctx, plan, { onCase: (c) => { job.progress = c; } }).then((r) => { job.results = r.map(({ details, ...x }) => x); }));
    },
    'GET /api/projects': () => listProjects(ctx).map((p) => { const s = status(ctx, p.path); return { ...s, changes: s.changes && serialize(s.changes, projectCtx(p.path)) }; }),
    'POST /api/projects': (b) => (b.action === 'remove' ? removeProject(ctx, b.path) : addProject(ctx, b.path), listProjects(ctx)),
    // With setup=1 the answers come from the query (a project's first setup), else from its state file.
    'GET /api/project-plan': (q) => {
      const dir = resolve(q.get('dir') ?? '');
      if (!registered(dir)) throw bad('register the project first');
      const setup = q.get('setup') === '1' ? setupAnswers(q) : {};
      // Skill toggles name skills of this project only.
      const own = input(() => chosenSkills(resolveAnswers(dir, setup), libraryWith(ctx)).map((s) => s.name));
      const disable = q.getAll('disable'), enable = q.getAll('enable');
      const unknown = [...disable, ...enable].filter((n) => !own.includes(n));
      if (unknown.length) throw bad(`not a skill of this project: ${unknown.join(', ')}`);
      const p = input(() => projectPlan({ ctx: projectCtx(dir), dir, answers: { ...setup, disable, enable } }));
      // Plugin installs change the machine, not the project: the global plan does them, as in Update all.
      const changes = preview(p.changes).filter((c) => c.kind !== 'command' || c.cwd);
      return { planId: keep(changes, projectCtx(dir), dir), changes: serialize(changes, projectCtx(dir)), prompts: p.prompts, skills: p.skills, warnings: p.warnings,
        chosen: own.map((name) => ({ name, disabled: p.answers.disabled.includes(name) })) };
    },
    // What a project's first setup offers: the installed agents, environments, tiers, library packs and skills, and the
    // packs its files point to.
    'GET /api/project-setup': (q) => {
      const dir = resolve(q.get('dir') ?? '');
      if (!registered(dir)) throw bad('register the project first');
      const lib = libraryWith(ctx);
      const agents = agentsNow().filter((a) => a.installed).map((a) => ({ id: a.id, name: a.name }));
      return { agents, advisers: agents.filter((a) => ADVISERS.includes(a.id)), state: tryState(dir), envs: ENVS, tiers: TIERS, suggested: suggest(dir),
        packs: lib.packs.map((p) => ({ id: p.id, title: p.title, pickWhen: p.pickWhen, skills: p.skills ?? [] })), skills: lib.skills.map((s) => ({ name: s.name, pickWhen: s.pickWhen, agents: s.agents ?? null })) };
    },
    // An agent reads the project and suggests env, packs and skills: one read-only session, after the user agreed in the UI.
    'POST /api/setup-advice': (b) => {
      if (process.env.CI) throw bad('setup advice starts an agent session on a subscription and does not run in CI');
      const dir = resolve(String(b.dir ?? ''));
      if (!registered(dir)) throw bad('register the project first');
      if (!ADVISERS.includes(b.agent) || !installed().includes(b.agent)) throw bad(`agent must be an installed one of ${ADVISERS.join(', ')}`);
      return start(1, (job) => adviseSetup(ctx, { dir, agent: b.agent, lib: libraryWith(ctx) }).then((r) => { job.results = r; }), { readOnly: true });
    },
    'POST /api/update-all': (b) => {
      idle();
      const paths = (b.paths ?? []).filter(registered);
      const answers = Object.fromEntries(Object.entries(b.answers ?? {}).filter(([p]) => paths.includes(p)).map(([p, a]) => [p, setupAnswers(a)]));
      return updateAll(ctx, { paths, push: b.push !== false, answers });
    },
    'GET /api/history': () => ctx.ledger.list().map(({ entries, ...r }) => ({ ...r, changes: entries.length })),
    // One run with the diff of each file it wrote: its backup (or nothing) against the file as the run left it.
    'GET /api/run': (q) => {
      const run = ctx.ledger.get(q.get('id') ?? '');
      return { ...run, entries: run.entries.map((e) => {
        if (!e.path || e.kind !== 'write' || e.status !== 'done') return e;
        const now = hashPath(e.path) === e.hashAfter ? readText(e.path) : null;
        return { ...e, diff: now == null ? null : diffLines(e.backup ? readText(e.backup) : null, now, e.path) };
      }) };
    },
    'POST /api/undo': (b) => {
      idle();
      const scope = ctx.ledger.get(b.run).scope;
      return undo(b.run, scope === 'global' ? ctx : projectCtx(scope), { step: b.step || undefined });
    },
    'GET /api/catalog': () => {
      const lib = libraryWith(ctx);
      const projects = listProjects(ctx).map((p) => tryState(p.path)).filter(Boolean);
      return { ...lib, skills: lib.skills.map((s) => ({ ...s, projects: projects.filter((st) => st.skills?.some((x) => x.name === s.name)).length })) };
    },
    'GET /api/skill': (q) => {
      const name = q.get('name');
      if (!libraryWith(ctx).skills.some((s) => s.name === name)) throw Object.assign(new Error('unknown skill'), { status: 404 });
      return { name, text: readText(join(contentDir, 'library', name, 'SKILL.md')) };
    },
    'GET /api/doctor': (q) => {
      if (!q.has('dir')) return doctor(ctx, { agents: installed() });
      const dir = resolve(q.get('dir'));
      if (!registered(dir)) throw bad('register the project first');
      return projectChecks(ctx, dir);
    },
    'POST /api/pick-folder': () => pickFolder(ctx),
    // Eval results without the per-case details; lines that do not parse are left out.
    'GET /api/evals': () => (readText(join(userEvals(ctx), 'results.jsonl')) ?? '').split('\n').filter(Boolean).flatMap((l) => {
      try { const { details, ...r } = JSON.parse(l); return [r]; } catch { return []; }
    }),
    'GET /api/pack-warnings': (q) => warnings((q.get('skills') ?? '').split(',').filter(Boolean)),
    'GET /api/pack-export': (q) => input(() => ({ name: `${q.get('id')}.json`, text: exportPack(ctx, q.get('id')) })),
    'POST /api/packs': (b) => input(() => {
      if (b.action === 'save') return savePack(ctx, { id: b.id, title: b.title || b.id, skills: b.skills });
      if (b.action === 'import') return importPack(ctx, b.text ?? '', b.id || undefined);
      if (b.action === 'remove') return removePack(ctx, b.id), { removed: b.id };
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
      return scan(b.root).filter((d) => !registered(d));
    },
    'GET /api/inventory': () => inventory(ctx, installed()),
  };
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1e6) throw Object.assign(new Error('body too large'), { status: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw Object.assign(new Error('body is not JSON'), { status: 400 }); }
}

export function startServer(ctx, { port = 0, token = randomBytes(32).toString('base64url'), dist = distDir, routes = api(ctx) } = {}) {
  let urlToken = token, session = null;
  const server = createServer(async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8', headers = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'", ...headers });
      res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
    };
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = server.address().port;
    // The URL token works once: it becomes the session cookie, then the address bar is cleaned.
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('token') && req.headers.host === `127.0.0.1:${p}` && urlToken && same(url.searchParams.get('token'), urlToken)) {
      urlToken = null;
      session = randomBytes(32).toString('base64url');
      return send(303, '', 'text/plain', { location: '/', 'set-cookie': `${cookieName(p)}=${session}; HttpOnly; SameSite=Strict; Path=/` });
    }
    const why = rejectReason(req, { port: p, session });
    if (why) return send(why[0], { error: why[1] });
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      try { return send(200, await route(req.method === 'POST' ? await body(req) : url.searchParams)); } catch (e) { return send(e.status ?? 500, { error: e.message }); }
    }
    if (url.pathname.startsWith('/api/')) return send(req.method === 'GET' && routes[`POST ${url.pathname}`] ? 405 : 404, { error: 'no such endpoint' });
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return send(400, { error: 'bad path' }); }
    let file = resolve(dist, `.${path}`);
    if (!inside(file, [dist]) || !exists(file) || file === resolve(dist)) file = join(dist, 'index.html');
    if (!exists(file)) return send(500, 'the UI is not built: npm run build in app/', 'text/plain');
    return send(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}/?token=${token}` })));
}

export function openBrowser(url) {
  const argv = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""', url] : ['xdg-open', url];
  try { spawn(argv[0], argv.slice(1), { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* the URL is printed */ }
}
