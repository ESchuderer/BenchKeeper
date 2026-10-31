// Agent-file sources (library.json, "sources"): agent files fetched at a pinned commit into the project, on when one of their
// files is picked. Ids and file paths come from the catalog, never from a project's files.
import { basename, join, relative, sep } from 'node:path';
import { stringify as tomlStringify } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { agent } from './agents.mjs';
import { library } from './content.mjs';
import { exists, hashPath, readText } from './fsx.mjs';
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

// One file of a source for one agent: its key in the state file (the bare path for Claude Code, as before other agents had
// copies; <agent>:<path> for the others) and where it lands.
const copiesOf = (dir, f, ids = f.install.agents) => ids.filter((id) => f.install.agents.includes(id)).flatMap((id) => f.install.files.map(({ path }) => ({ id, path, key: id === 'claude' ? path : `${id}:${path}`, target: targetOf(dir, f, id, path) })));
const keysOf = (lib) => new Set(sources(lib).flatMap((f) => copiesOf('', f).map((x) => x.key)));

// What a state file still says that this app's catalog knows: a path it does not know (a newer app, a renamed file) is
// ignored, so the project can still be planned.
export function keptFrom(prev, lib = library()) {
  return { agentFiles: agentFilesOf(prev?.agentFiles ?? [], lib), agentOwned: (prev?.agentOwned ?? []).filter((k) => keysOf(lib).has(k)) };
}

// Each agent reads agent files from its own folder, in its own format: Codex TOML, Copilot an .agent.md profile.
const EXT = { markdown: '.md', toml: '.toml', 'copilot-agent': '.agent.md' };
const rawUrl = (f, path) => `https://raw.githubusercontent.com/${f.install.source}/${f.install.ref}/${path}`;
const blobUrl = (f, path) => `https://github.com/${f.install.source}/blob/${f.install.ref}/${path}`;
function targetOf(dir, f, id, path) {
  const { path: folder, format } = agent(id).project[f.install.dest];
  return join(dir, folder, `${stemOf(path)}${EXT[format]}`);
}
// A file this setup fetched at another pin: fetched again at the source's pin.
const refetch = (prev, f, key) => (prev?.agentOwned ?? []).includes(key) && prev?.frameworkRefs?.[f.id] !== f.install.ref;
// A fetched file that no longer has the hash it had after the fetch was edited here.
const editedHere = (prev, target, key) => !!prev?.agentHashes?.[key] && exists(target) && hashPath(target) !== prev.agentHashes[key];
const unitOf = (dir, f) => unit({ id: `agent-files:${f.id}`, kind: 'agent-files', source: { type: 'git', repo: f.install.source, ref: f.install.ref }, agents: f.install.agents, scope: 'project',
  files: copiesOf(dir, f).map((x) => x.target), removal: 'files' });

// Codex reads a custom agent as TOML with name, description and developer_instructions: the source's own Codex mapping (the
// Markdown body as the instructions, other front matter left out). Text without front matter (none fetched yet, at plan time)
// stays as it is.
export function codexAgent(text) {
  const m = text?.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return text;
  const { name, description } = parseYaml(m[1]) ?? {};
  if (typeof name !== 'string' || typeof description !== 'string') throw new Error('the agent file has no name or description in its front matter');
  return tomlStringify({ name, description, developer_instructions: m[2] });
}

// The changes for the agent files picked and for those the state records but the answers no longer pick.
// prev: the state file. Each change is { step, title, kind, ... } for the project plan to number.
export function frameworkChanges({ a, dir, prev, lib = library() }) {
  const out = [];
  const owned = new Set(prev?.agentOwned ?? []);
  for (const f of sources(lib)) {
    const installUnit = unitOf(dir, f);
    for (const { id, path, key, target } of copiesOf(dir, f)) {
      // Only a file this setup fetched (agentOwned) is refreshed or taken out again: one that was there before is the project's.
      const convert = agent(id).project[f.install.dest].format === 'toml';
      // A Codex file of the setup still in Markdown with no hash recorded is a fetch whose conversion failed: fetched again. One
      // with a hash was converted, so Markdown there is an edit and stays.
      const picked = a.agentFiles.includes(path) && a.agents.includes(id), mine = owned.has(key), outdated = exists(target) && (refetch(prev, f, key) || (convert && mine && !prev?.agentHashes?.[key] && /^---\r?\n/.test(readText(target) ?? '')));
      const step = `framework:${f.id}`, name = `${stemOf(path)}${id === 'claude' ? '' : ` for ${agent(id).name}`}`;
      if (picked && (!exists(target) || outdated)) {
        const title = `agent ${name} from ${f.install.source} at ${f.install.ref.slice(0, 12)}`;
        // Codex: the fetched Markdown becomes TOML in place; the fetch and the conversion go together, under one title so a
        // state count sees one item.
        out.push({ ...(convert ? { key: `fetch:${key}`, unit: `agent-file:${key}` } : { key: `file:${key}` }), step, title, kind: 'command', cwd: dir, snapshot: [target], installUnit, outdated,
          argv: ['curl', '-fsSL', '--remove-on-error', '--proto', '=https', '--proto-redir', '=https', '--create-dirs', '-o', target, rawUrl(f, path)] });
        if (convert) out.push({ key: `file:${key}`, unit: `agent-file:${key}`, step, title, kind: 'write', path: target, edit: codexAgent, always: true, installUnit });
      } else if (!picked && mine && exists(target)) out.push({ step, title: `remove agent ${name} (${a.agentFiles.includes(path) ? 'agent not chosen' : 'not picked'})`, kind: 'remove', path: target, selected: true, installUnit });
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
  const copies = cat.flatMap((f) => copiesOf(dir, f, a.agents).filter((x) => files.includes(x.path)).map((x) => ({ ...x, f })));
  // The source's ref moves on only when every fetch planned for it ran: a copy left at the old pin is fetched again.
  const planned = (f) => copies.filter((x) => x.f === f && ran(`file:${x.key}`) !== null);
  const fetched = (f) => planned(f).length > 0 && planned(f).every((x) => ran(`file:${x.key}`) === true);
  const frameworkRefs = Object.fromEntries(cat.filter((f) => fetched(f) || refs[f.id]).map((f) => [f.id, fetched(f) ? f.install.ref : refs[f.id]]));
  // A Codex fetch whose conversion failed is the setup's too: the next plan fetches it again, a dropped pick removes it.
  const mine = copies.filter((x) => ran(`file:${x.key}`) === true || ran(`fetch:${x.key}`) === true || was.has(x.key));
  const agentHashes = Object.fromEntries(mine.flatMap((x) => {
    const hash = ran(`file:${x.key}`) === true ? hashPath(x.target) : prev?.agentHashes?.[x.key];
    return hash ? [[x.key, hash]] : [];
  }));
  return { ...(files.length ? { agentFiles: files, agentOwned: mine.map((x) => x.key) } : {}), ...(Object.keys(frameworkRefs).length ? { frameworkRefs } : {}), ...(Object.keys(agentHashes).length ? { agentHashes } : {}) };
}

// Paths (relative to the project) the agent files take, for the git exclude list of a local setup.
export function frameworkPaths(a, dir, lib = library()) {
  return sources(lib).flatMap((f) => copiesOf(dir, f, a.agents).filter((x) => a.agentFiles.includes(x.path)).map((x) => relative(dir, x.target).split(sep).join('/')));
}

// The agent files the setup fetched as removals, for "Remove BenchKeeper setup". Keys from the state file count only when
// the catalog has them.
export function frameworkRemovals(dir, state, lib = library()) {
  const owned = state?.agentOwned ?? [];
  return sources(lib).flatMap((f) => copiesOf(dir, f).filter((x) => owned.includes(x.key) && exists(x.target))
    .map((x) => ({ step: 'framework', title: `remove agent ${stemOf(x.path)}${x.id === 'claude' ? '' : ` for ${agent(x.id).name}`}`, kind: 'remove', path: x.target })));
}

// The catalog as the setup form and `skills sources` show it: evidence next to each entry, what the install writes and its limits,
// and links to the source README and each file at the pinned commit.
export const sourceRows = (lib = library()) => sources(lib).map((f) => ({
  id: f.id, title: f.title, license: f.license, pin: f.pin, verdict: f.verdict, hooks: f.hooks, limits: f.limits ?? null,
  evaluation: f.evaluation, kind: f.install.kind, agents: f.install.agents ?? null, readme: blobUrl(f, 'README.md'),
  files: f.install.files.map(({ path, pickWhen }) => ({ path, name: stemOf(path), pickWhen, url: blobUrl(f, path) })),
}));

// Each agent file of the catalog in a project: picked or not, its state on disk (the first copy of a chosen agent that is not
// installed decides), and why it cannot be picked when the project has none of the agents its source installs for.
export function agentFileRows(a, dir, prev, lib = library()) {
  return sources(lib).flatMap((f) => f.install.files.map(({ path, pickWhen }) => {
    const ids = f.install.agents;
    const states = copiesOf(dir, f, a.agents).filter((x) => x.path === path)
      .map(({ key, target }) => (!exists(target) ? 'not installed' : editedHere(prev, target, key) ? 'modified' : refetch(prev, f, key) ? 'outdated' : 'installed'));
    return { path, name: stemOf(path), source: f.title, pickWhen, on: a.agentFiles.includes(path), state: states.find((x) => x !== 'installed') ?? states[0] ?? 'not installed',
      fixed: ids && !a.agents.some((x) => ids.includes(x)) ? `${f.title} installs for ${ids.map((x) => agent(x).name).join(', ')} only` : null };
  }));
}

// Plan notices: the evidence of each agent-file source newly picked, and each picked file edited here that a refetch replaces.
export function frameworkNotices({ a, dir, prev, lib = library() }) {
  const was = { agentFiles: prev?.agentFiles ?? [] };
  const edited = sources(lib).flatMap((f) => copiesOf(dir, f, a.agents).filter(({ path, key, target }) => a.agentFiles.includes(path) && refetch(prev, f, key) && editedHere(prev, target, key))
    .map(({ target }) => `${target} was edited since it was fetched: fetching it at ${f.install.ref.slice(0, 12)} replaces the edit. The run keeps a backup of the file, and undoing the run puts it back.`));
  return [...sources(lib).filter((f) => isOn(a, f) && !isOn(was, f)).map((f) => `${f.title}: ${f.verdict} ${f.hooks} ${f.limits ?? ''}`.trim()), ...edited];
}
