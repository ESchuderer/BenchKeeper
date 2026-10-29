// Agent-file sources (library.json, "sources"): agent files fetched at a pinned commit into the project, on when one of their
// files is picked. Ids and file paths come from the catalog, never from a project's files.
import { basename, join } from 'node:path';
import { agent } from './agents.mjs';
import { library } from './content.mjs';
import { exists, hashPath } from './fsx.mjs';
import { unit } from './units.mjs';

export const sources = (lib = library()) => lib.sources ?? [];
const isOn = (a, f) => f.install.files.some((x) => a.agentFiles.includes(x.path));
const stemOf = (path) => basename(path, '.md');

// The agent files a project keeps. A path the catalog does not name is refused: the state file comes with the repository.
export function resolveFrameworks(a, lib = library()) {
  const offered = new Map(sources(lib).flatMap((f) => f.install.files.map((x) => [x.path, f])));
  const bad = a.agentFiles.filter((p) => !offered.has(p));
  if (bad.length) throw new Error(`not an agent file of the catalog: ${bad.join(', ')}`);
  for (const f of sources(lib).filter((x) => isOn(a, x))) {
    const ids = f.install.agents;
    if (ids && !a.agents.some((x) => ids.includes(x))) throw new Error(`${f.title} installs for ${ids.map((x) => agent(x).name).join(', ')} only: choose it among the agents or leave ${f.title} out`);
  }
  return { agentFiles: a.agentFiles };
}

// Agent files of the catalog among files.
const filesOf = (lib) => new Set(sources(lib).flatMap((f) => f.install.files.map((x) => x.path)));
const agentFilesOf = (files, lib = library()) => files.filter((p) => filesOf(lib).has(p));

// What a state file still says that this app's catalog knows: a path it does not know (a newer app, a renamed file) is
// ignored, so the project can still be planned.
export function keptFrom(prev, lib = library()) {
  return { agentFiles: agentFilesOf(prev?.agentFiles ?? [], lib), agentOwned: agentFilesOf(prev?.agentOwned ?? [], lib) };
}

// Where an agent file lands for the first agent that reads agent files in the project.
const agentDir = (dir, f) => join(dir, agent(f.install.agents[0]).project[f.install.dest].path);
const rawUrl = (f, path) => `https://raw.githubusercontent.com/${f.install.source}/${f.install.ref}/${path}`;
const blobUrl = (f, path) => `https://github.com/${f.install.source}/blob/${f.install.ref}/${path}`;
const targetOf = (dir, f, path) => join(agentDir(dir, f), `${stemOf(path)}.md`);
// A file this setup fetched at another pin: fetched again at the source's pin.
const refetch = (prev, f, path) => (prev?.agentOwned ?? []).includes(path) && prev?.frameworkRefs?.[f.id] !== f.install.ref;
// A fetched file that no longer has the hash it had after the fetch was edited here.
const editedHere = (prev, target, path) => !!prev?.agentHashes?.[path] && exists(target) && hashPath(target) !== prev.agentHashes[path];
const unitOf = (dir, f) => unit({ id: `agent-files:${f.id}`, kind: 'agent-files', source: { type: 'git', repo: f.install.source, ref: f.install.ref }, agents: f.install.agents, scope: 'project',
  files: f.install.files.map(({ path }) => targetOf(dir, f, path)), removal: 'files' });

// The changes for the agent files picked and for those the state records but the answers no longer pick.
// prev: the state file. Each change is { step, title, kind, ... } for the project plan to number.
export function frameworkChanges({ a, dir, prev, lib = library() }) {
  const out = [];
  for (const f of sources(lib)) {
    const installUnit = unitOf(dir, f);
    const owned = new Set(prev?.agentOwned ?? []);
    for (const { path } of f.install.files) {
      const target = targetOf(dir, f, path);
      // Only a file this setup fetched (agentOwned) is refreshed or taken out again: one that was there before is the project's.
      const picked = a.agentFiles.includes(path), mine = owned.has(path), outdated = exists(target) && refetch(prev, f, path);
      if (picked && (!exists(target) || outdated)) {
        out.push({ key: `file:${path}`, step: `framework:${f.id}`, title: `agent ${stemOf(path)} from ${f.install.source} at ${f.install.ref.slice(0, 12)}`, kind: 'command', cwd: dir, snapshot: [target], installUnit, outdated,
          argv: ['curl', '-fsSL', '--remove-on-error', '--proto', '=https', '--proto-redir', '=https', '--create-dirs', '-o', target, rawUrl(f, path)] });
      } else if (!picked && mine && exists(target)) out.push({ step: `framework:${f.id}`, title: `remove agent ${stemOf(path)} (not picked)`, kind: 'remove', path: target, selected: true, installUnit });
    }
  }
  return out;
}

// What the state file records of the agent files. ran(key): whether the fetch planned under that key ran in this run
// (null: none was planned). A file is the setup's own (agentOwned) once fetched, and its ref and hash are the ones fetched.
// Nothing is recorded for files and refs of a run that failed or skipped them.
export function frameworkState({ a, dir, prev, ran, lib = library() }) {
  const cat = sources(lib).filter((f) => isOn(a, f));
  const was = new Set(prev?.agentOwned ?? []), refs = prev?.frameworkRefs ?? {};
  const files = cat.flatMap((f) => f.install.files.map((x) => x.path)).filter((p) => a.agentFiles.includes(p));
  const fetched = (f) => f.install.files.some((x) => ran(`file:${x.path}`) === true);
  const frameworkRefs = Object.fromEntries(cat.filter((f) => fetched(f) || refs[f.id]).map((f) => [f.id, fetched(f) ? f.install.ref : refs[f.id]]));
  const agentOwned = files.filter((p) => ran(`file:${p}`) === true || was.has(p));
  const sourceOf = new Map(cat.flatMap((f) => f.install.files.map((x) => [x.path, f])));
  const agentHashes = Object.fromEntries(agentOwned.flatMap((p) => {
    const hash = ran(`file:${p}`) === true ? hashPath(targetOf(dir, sourceOf.get(p), p)) : prev?.agentHashes?.[p];
    return hash ? [[p, hash]] : [];
  }));
  return { ...(files.length ? { agentFiles: files, agentOwned } : {}), ...(Object.keys(frameworkRefs).length ? { frameworkRefs } : {}), ...(Object.keys(agentHashes).length ? { agentHashes } : {}) };
}

// Paths (relative to the project) the agent files take, for the git exclude list of a local setup.
export function frameworkPaths(a, dir, lib = library()) {
  return sources(lib).flatMap((f) => f.install.files.filter(({ path }) => a.agentFiles.includes(path)).map(({ path }) => `${agent(f.install.agents[0]).project[f.install.dest].path}/${stemOf(path)}.md`));
}

// The agent files the setup fetched as removals, for "Remove BenchKeeper setup". Paths from the state file count only when
// the catalog has them.
export function frameworkRemovals(dir, state, lib = library()) {
  const out = [];
  for (const f of sources(lib)) for (const { path } of f.install.files.filter((x) => (state?.agentOwned ?? []).includes(x.path))) {
    const target = targetOf(dir, f, path);
    if (exists(target)) out.push({ step: 'framework', title: `remove agent ${stemOf(path)}`, kind: 'remove', path: target });
  }
  return out;
}

// The catalog as the setup form and `skills sources` show it: evidence next to each entry, what the install writes and its limits,
// and links to the source README and each file at the pinned commit.
export const sourceRows = (lib = library()) => sources(lib).map((f) => ({
  id: f.id, title: f.title, license: f.license, pin: f.pin, verdict: f.verdict, hooks: f.hooks, limits: f.limits ?? null,
  evaluation: f.evaluation, kind: f.install.kind, agents: f.install.agents ?? null, readme: blobUrl(f, 'README.md'),
  files: f.install.files.map(({ path, pickWhen }) => ({ path, name: stemOf(path), pickWhen, url: blobUrl(f, path) })),
}));

// Each agent file of the catalog in a project: picked or not, its state on disk, and why it cannot be picked when the
// project has none of the agents its source installs for.
export function agentFileRows(a, dir, prev, lib = library()) {
  return sources(lib).flatMap((f) => f.install.files.map(({ path, pickWhen }) => {
    const target = targetOf(dir, f, path), ids = f.install.agents;
    const state = !exists(target) ? 'not installed' : editedHere(prev, target, path) ? 'modified' : refetch(prev, f, path) ? 'outdated' : 'installed';
    return { path, name: stemOf(path), source: f.title, pickWhen, on: a.agentFiles.includes(path), state,
      fixed: ids && !a.agents.some((x) => ids.includes(x)) ? `${f.title} installs for ${ids.map((x) => agent(x).name).join(', ')} only` : null };
  }));
}

// Plan notices: the evidence of each agent-file source newly picked, and each picked file edited here that a refetch replaces.
export function frameworkNotices({ a, dir, prev, lib = library() }) {
  const was = { agentFiles: prev?.agentFiles ?? [] };
  const edited = sources(lib).flatMap((f) => f.install.files.filter(({ path }) => a.agentFiles.includes(path) && refetch(prev, f, path) && editedHere(prev, targetOf(dir, f, path), path))
    .map(({ path }) => `${targetOf(dir, f, path)} was edited since it was fetched: fetching it at ${f.install.ref.slice(0, 12)} replaces the edit. The run keeps a backup of the file, and undoing the run puts it back.`));
  return [...sources(lib).filter((f) => isOn(a, f) && !isOn(was, f)).map((f) => `${f.title}: ${f.verdict} ${f.hooks} ${f.limits ?? ''}`.trim()), ...edited];
}
