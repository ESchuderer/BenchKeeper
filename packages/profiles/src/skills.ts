import { isUtf8 } from "node:buffer";
import { join, sep } from "node:path";
import { type GitSource, type Result, skillFolder } from "@cedarloom/contracts";
import type { Wanted } from "./owned.ts";
import { entryFiles, entryOf, type Folder, packVersion, type Resolved, skillEntries } from "./resolve.ts";

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

// The skills of a level, on or off: the machine's skill parts, or each skill entry of the packs a project's packs part
// lists, once those packs are here.
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

// The Git source a skill's files come from: its own, or its pack entry's once the pack's folder is known.
const gitOf = (resolved: Resolved, source: Source, fetched: Fetched): GitSource | undefined => {
  if ("git" in source) return source;
  const entry = entryOf(source, "skill", packFolder(resolved, source.pack, fetched));
  return entry.ok && entry.value.kind === "skill" ? entry.value.source : undefined;
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
): { source: GitSource; pack: boolean }[] => {
  const skills = listed(resolved, fetched, level);
  return [
    ...Object.values(resolved.profile.packs).flatMap((source) => ("bundled" in source ? [] : [{ source, pack: true }])),
    ...(skills.ok ? skills.value : [])
      .filter(({ part }) => every || resolved.on.has(part))
      .flatMap(({ source }) => {
        const git = gitOf(resolved, source, fetched);
        return git === undefined ? [] : [{ source: git, pack: false }];
      }),
  ];
};

// The files a skill installs: its Git source's folder, else its pack entry's folder in a fetched pack.
const filesOf = (resolved: Resolved, source: Source, fetched: Fetched): Result<Folder["files"]> => {
  const git = gitOf(resolved, source, fetched);
  if (git !== undefined) return { ok: true, value: fetched.get(sourceKey(git))?.files ?? [] };
  const folder = "git" in source ? undefined : packFolder(resolved, source.pack, fetched);
  if ("git" in source || folder === undefined) {
    const ref = "git" in source ? { pack: "", path: source.git } : source;
    return { ok: false, finding: { code: "profile.entry-unknown", params: { ...ref, kind: "skill" } } };
  }
  const entry = entryOf(source, "skill", folder);
  return entry.ok ? { ok: true, value: entryFiles(source, folder) } : entry;
};

// The pack a skill's files come from as `id@version`, for a project's record; none for a skill from Git or a machine.
const packOf = (resolved: Resolved, source: Source, { fetched, level }: { fetched: Fetched; level: Level }) =>
  "git" in source || level === "machine"
    ? {}
    : { pack: packVersion(source.pack, packFolder(resolved, source.pack, fetched)) };

// How a finding names a skill: its pack entry, or its repository.
const labelOf = (source: Source): string => ("git" in source ? source.git : `${source.pack}/${source.path}`);

/**
 * Each skill of a level that is on, its files in `<home>/skills/<name>/` (a project's `.claude` folder for a project),
 * made executable when Git has them so; and the files CedarLoom wrote in the skills folder that no skill that is on
 * wants now: a part switched off, a pack taken out of a list, or a file its source dropped. Two skills of one name
 * refuse the plan, as their files would mix in one folder.
 */
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
    // Claude Code loads a skills folder with `.claude-plugin/` as a plugin, hooks and servers included, which a plugin
    // part brings only with its approval by name (https://code.claude.com/docs/en/plugins/loading).
    // In any case, as macOS's and Windows' file systems read `.Claude-Plugin` as `.claude-plugin`.
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
