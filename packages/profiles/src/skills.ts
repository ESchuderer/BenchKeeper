import { isUtf8 } from "node:buffer";
import { join, sep } from "node:path";
import { type GitSource, type Result, skillFolder } from "@cedarloom/contracts";
import { errorCode } from "@cedarloom/engine";
import { BUNDLED } from "@cedarloom/packs";
import type { Wanted } from "./owned.ts";
import { entryFiles, entryOf, filesIn, type Folder, packVersion, type Resolved, skillEntries } from "./resolve.ts";

/** The folders fetched for a plan, by `sourceKey`: the profile's Git packs, and skills that come from Git. */
export type Fetched = ReadonlyMap<string, Folder>;

/** How a plan names a Git source: its repository, its branch, tag or commit, and its folder. */
export const sourceKey = (source: GitSource): string =>
  JSON.stringify([source.git, "ref" in source ? source.ref : source.commit, source.path ?? ""]);

/** A pack's fetched folder for a Git pack (empty until fetched); none for a bundled one, which this release reads. */
export const packFolder = ({ profile }: Resolved, pack: string, fetched: Fetched): Folder | undefined => {
  const source = profile.packs[pack];
  return source === undefined || "bundled" in source ? undefined : (fetched.get(sourceKey(source)) ?? { files: [] });
};

type Source = Extract<Resolved["profile"]["machine"][string], { type: "skill" }>["source"];
/** The level whose skills a plan installs. */
export type Level = "machine" | "project";
// A skill a level installs: its source, and its part as `level.id`.
type Listed = { part: string; source: Source };

// A skill installs into a folder of its name: its pack entry's last part, or its Git source's (checked by the profile).
const nameOf = (source: Source): string =>
  "git" in source ? skillFolder(source) : source.path.slice(source.path.lastIndexOf("/") + 1);

// A level's skills, on or off: the machine's skill parts, or each skill entry of a project's listed packs once fetched.
const listed = (resolved: Resolved, fetched: Fetched, level: Level): Result<Listed[]> => {
  const parts = Object.entries(resolved.profile[level]);
  if (level === "machine")
    return {
      ok: true,
      value: parts.flatMap(([id, part]) =>
        part.type === "skill" ? [{ part: `machine.${id}`, source: part.source }] : [],
      ),
    };
  const skills: Listed[] = [];
  for (const [id, part] of parts) {
    for (const pack of part.type === "packs" ? part.packs : []) {
      const paths = skillEntries(pack, packFolder(resolved, pack, fetched));
      if (!paths.ok) return paths;
      skills.push(...paths.value.map((path) => ({ part: `project.${id}`, source: { pack, path } })));
    }
  }
  return { ok: true, value: skills };
};

// The Git source a skill's files come from: its own, or its pack entry's once the pack's folder is known. A pack
// that lacks the entry (or is not fetched yet) names none; one whose manifest is refused may, so that is a failure.
const gitOf = (resolved: Resolved, source: Source, fetched: Fetched): Result<GitSource | undefined> => {
  if ("git" in source) return { ok: true, value: source };
  const entry = entryOf(source, "skill", packFolder(resolved, source.pack, fetched));
  if (!entry.ok) return entry.finding.code === "profile.entry-unknown" ? { ok: true, value: undefined } : entry;
  return { ok: true, value: entry.value.kind === "skill" ? entry.value.source : undefined };
};

/**
 * The Git sources a plan of a level needs, each marked as a pack's folder or a skill's: the profile's Git packs, and
 * the source of each of the level's skills that is on (`every`: on or off), a pack entry's once its pack is fetched.
 */
export const sourcesOf = (
  resolved: Resolved,
  fetched: Fetched,
  level: Level,
  every = false,
): Result<{ source: GitSource; pack: boolean }[]> => {
  const skills = listed(resolved, fetched, level);
  if (!skills.ok) return skills;
  const sources = Object.values(resolved.profile.packs).flatMap((source) =>
    "bundled" in source ? [] : [{ source, pack: true }],
  );
  for (const { source } of skills.value.filter(({ part }) => every || resolved.on.has(part))) {
    const git = gitOf(resolved, source, fetched);
    if (!git.ok) return git;
    if (git.value !== undefined) sources.push({ source: git.value, pack: false });
  }
  return { ok: true, value: sources };
};

// The files a skill installs: its Git source's folder, else its pack entry's folder in a fetched or bundled pack.
const filesOf = (resolved: Resolved, source: Source, fetched: Fetched): Result<Folder["files"]> => {
  const git = gitOf(resolved, source, fetched);
  if (!git.ok) return git;
  if (git.value !== undefined) return { ok: true, value: fetched.get(sourceKey(git.value))?.files ?? [] };
  if ("git" in source)
    return {
      ok: false,
      finding: { code: "profile.entry-unknown", params: { pack: "", path: source.git, kind: "skill" } },
    };
  const folder = packFolder(resolved, source.pack, fetched);
  const entry = entryOf(source, "skill", folder);
  if (!entry.ok) return entry;
  if (folder !== undefined) return { ok: true, value: entryFiles(source, folder) };
  const root = join(BUNDLED, source.pack, source.path);
  try {
    return { ok: true, value: filesIn(root) };
  } catch (error) {
    // A damaged install: the manifest lists the skill, but its folder cannot be read.
    return { ok: false, finding: { code: "document.unreadable", params: { path: root, error: errorCode(error) } } };
  }
};

// The pack a skill's files come from as `id@version`, for a project's record; none for a skill from Git or a machine.
const packOf = (resolved: Resolved, source: Source, { fetched, level }: { fetched: Fetched; level: Level }) =>
  "git" in source || level === "machine"
    ? {}
    : { pack: packVersion(source.pack, packFolder(resolved, source.pack, fetched)) };

// How a finding names a skill: its pack entry, or its repository.
const labelOf = (source: Source): string => ("git" in source ? source.git : `${source.pack}/${source.path}`);

// Two skills of one name refuse the plan, as their files would mix in one folder; CedarLoom's files no skill wants go.
export const skillFiles = (
  resolved: Resolved,
  home: string,
  { fetched, written, level }: { fetched: Fetched; written: ReadonlyMap<string, string | null>; level: Level },
): Result<{ wanted: Map<string, Wanted>; stale: string[] }> => {
  const skills = listed(resolved, fetched, level);
  if (!skills.ok) return skills;
  const wanted = new Map<string, Wanted>();
  // The skill each folder takes its files from: one skill listed by two parts installs once.
  const taken = new Map<string, string>();
  for (const { source } of skills.value.filter(({ part }) => resolved.on.has(part))) {
    const [folder, label] = [join(home, "skills", nameOf(source)), labelOf(source)];
    const other = taken.get(folder) ?? label;
    if (other !== label)
      return { ok: false, finding: { code: "profile.skill-twice", params: { folder, skills: [other, label] } } };
    taken.set(folder, label);
    const files = filesOf(resolved, source, fetched);
    if (!files.ok) return files;
    // A `.claude-plugin/` folder, in any case: docs/agents/cedarloom-rationale.md#skills-as-plugins
    const plugin = files.value.find(({ path }) =>
      path.split("/").some((segment) => segment.toLowerCase() === ".claude-plugin"),
    );
    if (plugin !== undefined)
      return { ok: false, finding: { code: "profile.skill-plugin", params: { skill: label, path: plugin.path } } };
    const pack = packOf(resolved, source, { fetched, level });
    for (const { path, mode, content } of files.value) {
      const target = join(folder, ...path.split("/"));
      if (!isUtf8(content)) return { ok: false, finding: { code: "apply.not-text", params: { path: target } } };
      wanted.set(target, { content: content.toString("utf8"), ...(mode === "100755" ? { mode: 0o755 } : {}), ...pack });
    }
  }
  const root = join(home, "skills") + sep;
  // A path whose last write was a delete is no longer CedarLoom's: a file there again is the owner's.
  const stale = [...written]
    .filter(([path, hash]) => hash !== null && !wanted.has(path) && path.startsWith(root))
    .map(([path]) => path);
  return { ok: true, value: { wanted, stale } };
};
