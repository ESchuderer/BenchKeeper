// Reads the web UI and the command line share: the overview, one run with the diff of each file, the library with its users,
// eval results.
import { join, relative, sep } from 'node:path';
import { agent, unavailable } from './agents.mjs';
import { userEvals } from './cases.mjs';
import { appVersion } from './content.mjs';
import { diffLines } from './diff.mjs';
import { exists, hashPath, inside, isDir, readText, realish } from './fsx.mjs';
import { blob } from './git.mjs';
import { invalidPacks, libraryWith } from './packs.mjs';
import { detectLevel } from './level.mjs';
import { listProjects, prefetchOrigins, projectState, setupOf, usersByPack } from './projects.mjs';
import { isSettingsFile, redact } from './settings.mjs';
import { benchkeeperPlugin } from './steps/global.mjs';
import { upToDate } from './steps/project.mjs';

// The app version, the install level, the agents with their BenchKeeper plugin, and the setup of each registered project.
// memo(key, read) keeps the slow reads: the server caches them for 15 s.
export async function overview(ctx, detected, memo = (key, read) => read()) {
  const paths = listProjects(ctx).map((p) => p.path);
  await prefetchOrigins(ctx, paths);
  const installed = detected.filter((a) => a.installed).map((a) => a.id);
  return {
    version: appVersion, level: memo('level', () => detectLevel(ctx, installed)),
    agents: detected.map((a) => ({ ...a, ...(a.installed && agent(a.id).plugins ? { plugin: memo(`plugin:${a.id}`, () => { try { return benchkeeperPlugin(ctx, a.id); } catch { return null; } }) } : {}), rules: agent(a.id).global.rules.path, skills: agent(a.id).global.skills, unavailable: unavailable(a.id) })),
    projects: paths.map((path) => { const s = setupOf(ctx, path, projectState(ctx, path)).state; return { path, agents: s?.agents ?? [], setupVersion: s?.contentVersion ?? null, current: upToDate(s) }; }),
  };
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

// One run with the diff of each file it wrote: its backup (or nothing) against the file as the change left it,
// which is the backup a later change of the run took, or the file while nothing changed it since.
// A session's files diff between its git snapshots.
export function runReport(ctx, id) {
  const run = ctx.ledger.get(id);
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
}

// Library skills with the number of registered projects that have each, packs with the projects that use them.
export function catalog(ctx) {
  const lib = libraryWith(ctx), users = usersByPack(ctx);
  const projects = listProjects(ctx).map((p) => projectState(ctx, p.path)).filter(Boolean);
  return { ...lib, packs: lib.packs.map((x) => ({ ...x, usedBy: users.get(x.id) ?? [] })), invalidPacks: invalidPacks(ctx), skills: lib.skills.map((s) => ({ ...s, projects: projects.filter((st) => st.skills?.some((x) => x.name === s.name)).length })) };
}

// Eval results without the per-case details; lines that do not parse are left out.
export const evalResults = (ctx) => (readText(join(userEvals(ctx), 'results.jsonl')) ?? '').split('\n').filter(Boolean).flatMap((l) => {
  try { const { details, ...r } = JSON.parse(l); return [r]; } catch { return []; }
});
