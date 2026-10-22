// Local web UI server: 127.0.0.1 only, one-time URL token swapped for an HttpOnly session cookie, and checks against
// requests from other sites (Host, Origin, Sec-Fetch-Site, POST with a custom header for every change).
// shortcut: apply, undo and Update all run synchronously and block other requests meanwhile; one local user is fine.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, detect } from './agents.mjs';
import { contentDir, appVersion } from './content.mjs';
import { doctor } from './doctor.mjs';
import { diffLines } from './diff.mjs';
import { exists, hashPath, inside, readText } from './fsx.mjs';
import { libraryWith } from './packs.mjs';
import { addProject, listProjects, removeProject, status, updateAll } from './projects.mjs';
import { apply, itemState, preview, undo } from './runner.mjs';
import { globalPlan } from './steps/global.mjs';
import { projectPlan, readState } from './steps/project.mjs';

export const HEADER = 'x-benchkeeper';
const COOKIE = 'bk_session';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const same = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// null when the request may go on, else [status, reason].
export function rejectReason(req, { port, session }) {
  const self = `127.0.0.1:${port}`;
  if (req.headers.host !== self) return [421, 'wrong host'];
  if ('origin' in req.headers && req.headers.origin !== `http://${self}`) return [403, 'foreign origin'];
  if (req.headers['sec-fetch-site'] === 'cross-site') return [403, 'cross-site request'];
  const cookie = (req.headers.cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!session || !same(cookie, session)) return [401, 'no session'];
  if (!['GET', 'HEAD', 'POST'].includes(req.method)) return [405, 'method not allowed'];
  if (req.method === 'POST' && req.headers[HEADER] !== '1') return [403, `missing ${HEADER} header`];
  return null;
}

// Changes without their edit functions, with the item state the Dashboard groups by.
function serialize(changes, ctx) {
  return changes.map(({ edit, after, from, env, ...c }) => ({ ...c, state: c.kind === 'write' && !from ? itemState(c.path, after, ctx) : c.destructive ? 'foreign' : null }));
}

export function api(ctx) {
  const plans = new Map();
  const keep = (changes, pctx, scope) => { const id = randomBytes(8).toString('hex'); plans.set(id, { changes, ctx: pctx, scope }); return id; };
  const agentsNow = () => detect(ctx);
  const installed = () => agentsNow().filter((a) => a.installed).map((a) => a.id);
  const projectCtx = (dir) => ({ ...ctx, roots: [dir] });
  const registered = (dir) => listProjects(ctx).some((p) => p.path === dir);
  return {
    'GET /api/overview': () => ({ version: appVersion, agents: agentsNow().map((a) => ({ ...a, rules: agent(a.id).global.rules.path, skills: agent(a.id).global.skills })), projects: listProjects(ctx).map((p) => ({ path: p.path, agents: readState(p.path)?.agents ?? [], setupVersion: readState(p.path)?.setupVersion ?? null })) }),
    'GET /api/global-plan': (q) => {
      const agents = q.get('agents') ? q.get('agents').split(',') : installed();
      const changes = preview(globalPlan({ ctx, agents, options: { packs: q.getAll('pack') } }));
      return { planId: keep(changes, ctx, 'global'), agents, changes: serialize(changes, ctx) };
    },
    'POST /api/apply': (b) => {
      const p = plans.get(b.planId);
      if (!p) throw Object.assign(new Error('plan expired: load it again'), { status: 409 });
      plans.delete(b.planId);
      return apply(p.changes, p.ctx, { scope: p.scope, select: b.select });
    },
    'GET /api/projects': () => listProjects(ctx).map((p) => { const s = status(ctx, p.path); return { ...s, changes: s.changes && serialize(s.changes, projectCtx(p.path)) }; }),
    'POST /api/projects': (b) => (b.action === 'remove' ? removeProject(ctx, b.path) : addProject(ctx, b.path), listProjects(ctx)),
    'GET /api/project-plan': (q) => {
      const dir = resolve(q.get('dir') ?? '');
      if (!registered(dir)) throw Object.assign(new Error('register the project first'), { status: 400 });
      const p = projectPlan({ ctx: projectCtx(dir), dir, answers: {} });
      const changes = preview(p.changes);
      return { planId: keep(changes, projectCtx(dir), dir), changes: serialize(changes, projectCtx(dir)), prompts: p.prompts, skills: p.skills, warnings: p.warnings };
    },
    'POST /api/update-all': (b) => updateAll(ctx, { paths: (b.paths ?? []).filter(registered), push: b.push !== false }),
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
      const scope = ctx.ledger.get(b.run).scope;
      return undo(b.run, scope === 'global' ? ctx : projectCtx(scope), { step: b.step || undefined });
    },
    'GET /api/catalog': () => {
      const lib = libraryWith(ctx);
      const projects = listProjects(ctx).map((p) => readState(p.path)).filter(Boolean);
      return { ...lib, skills: lib.skills.map((s) => ({ ...s, projects: projects.filter((st) => st.skills?.some((x) => x.name === s.name)).length })) };
    },
    'GET /api/skill': (q) => {
      const name = q.get('name');
      if (!libraryWith(ctx).skills.some((s) => s.name === name)) throw Object.assign(new Error('unknown skill'), { status: 404 });
      return { name, text: readText(join(contentDir, 'library', name, 'SKILL.md')) };
    },
    'GET /api/doctor': () => doctor(ctx, { agents: installed() }),
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
      return send(303, '', 'text/plain', { location: '/', 'set-cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/` });
    }
    const why = rejectReason(req, { port: p, session });
    if (why) return send(why[0], { error: why[1] });
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) {
      try { return send(200, await route(req.method === 'POST' ? await body(req) : url.searchParams)); } catch (e) { return send(e.status ?? 500, { error: e.message }); }
    }
    if (url.pathname.startsWith('/api/')) return send(req.method === 'GET' && routes[`POST ${url.pathname}`] ? 405 : 404, { error: 'no such endpoint' });
    if (req.method !== 'GET') return send(405, { error: 'method not allowed' });
    let file = resolve(dist, `.${decodeURIComponent(url.pathname)}`);
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
