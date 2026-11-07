import { isUtf8 } from "node:buffer";
import { join, sep } from "node:path";
import type { GitSource, Result } from "@cedarloom/contracts";
import type { Wanted } from "./owned.ts";
import { entryFiles, entryOf, type Folder, type Resolved } from "./resolve.ts";

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

type Skill = Extract<Resolved["profile"]["machine"][string], { type: "skill" }>;

// A skill installs into a folder of its name: the last part of its path, or of its repository's name.
const nameOf = ({ source }: Skill): string => {
  const path = "git" in source ? (source.path ?? source.git.replace(/\.git$/, "")) : source.path;
  return path.slice(path.lastIndexOf("/") + 1);
};

const skills = ({ profile }: Resolved): [string, Skill][] =>
  Object.entries(profile.machine).flatMap(([id, part]): [string, Skill][] =>
    part.type === "skill" ? [[id, part]] : [],
  );

// The Git source a skill part's files come from: its own, or its pack entry's once the pack's folder is known.
const gitOf = (resolved: Resolved, { source }: Skill, fetched: Fetched): GitSource | undefined => {
  if ("git" in source) return source;
  const entry = entryOf(source, "skill", packFolder(resolved, source.pack, fetched));
  return entry.ok && entry.value.kind === "skill" ? entry.value.source : undefined;
};

/**
 * The Git sources a plan needs: the profile's Git packs, and the source of each skill part that is on, a pack entry's
 * as soon as its pack is fetched; a planner asks again after each fetch until nothing new comes.
 */
export const sourcesOf = (resolved: Resolved, fetched: Fetched): GitSource[] => [
  ...Object.values(resolved.profile.packs).flatMap((source) => ("bundled" in source ? [] : [source])),
  ...skills(resolved)
    .filter(([id]) => resolved.on.has(`machine.${id}`))
    .flatMap(([, skill]) => gitOf(resolved, skill, fetched) ?? []),
];

// The files a skill part installs: its Git source's folder, else its pack entry's.
const filesOf = (resolved: Resolved, skill: Skill, fetched: Fetched): Result<Folder["files"]> => {
  const git = gitOf(resolved, skill, fetched);
  if (git !== undefined) return { ok: true, value: fetched.get(sourceKey(git))?.files ?? [] };
  const { source } = skill;
  if ("git" in source) return { ok: true, value: [] };
  const folder = packFolder(resolved, source.pack, fetched);
  const entry = entryOf(source, "skill", folder);
  return entry.ok ? entryFiles(source, folder) : entry;
};

/**
 * Each skill part's files in `<home>/skills/<name>/`, made executable when Git has them so, and the files CedarLoom
 * wrote in a skill's folder that no part that is on wants now: a part switched off, or a file its source dropped.
 */
export const skillFiles = (
  resolved: Resolved,
  home: string,
  fetched: Fetched,
  written: ReadonlyMap<string, string | null>,
): Result<{ wanted: Map<string, Wanted>; stale: string[] }> => {
  const wanted = new Map<string, Wanted>();
  const folders = skills(resolved).map(([id, skill]) => ({ id, skill, folder: join(home, "skills", nameOf(skill)) }));
  for (const { skill, folder } of folders.filter(({ id }) => resolved.on.has(`machine.${id}`))) {
    const files = filesOf(resolved, skill, fetched);
    if (!files.ok) return files;
    for (const { path, mode, content } of files.value) {
      const target = join(folder, ...path.split("/"));
      if (!isUtf8(content)) return { ok: false, finding: { code: "apply.not-text", params: { path: target } } };
      wanted.set(target, { content: content.toString("utf8"), ...(mode === "100755" ? { mode: 0o755 } : {}) });
    }
  }
  const roots = folders.map(({ folder }) => folder + sep);
  const stale = [...written.keys()].filter((path) => !wanted.has(path) && roots.some((root) => path.startsWith(root)));
  return { ok: true, value: { wanted, stale } };
};
