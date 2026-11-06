import { type Result, readDocument } from "./documents.ts";
import { canonicalJson, type Json } from "./json.ts";
import { PROFILE_SCHEMA_VERSION, Profile, type ProfileFile } from "./profile.ts";

/** A parent profile as a file names it: an entry of one of the file's packs. */
export type ParentRef = { pack: string; path: string };
/** Reads a parent through the packs of the file that names it; undefined when the pack has no such entry. */
export type LoadParent = (parent: ParentRef, child: ProfileFile) => Result<ProfileFile> | undefined;
/**
 * The composed profile, and for each value the id of the profile file that set it last, keyed by JSON Pointer
 * (RFC 6901): a value's setter is the one at its longest listed pointer, the "set by" of a drift line.
 */
export type Composed = { profile: Profile; setBy: Record<string, string> };

type Tree = { [key: string]: Json | undefined };
const isTree = (value: Json | undefined): value is Tree =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// An object's entries, without the absent ones a `Json` object type allows.
const present = (tree: Tree): [string, Json][] =>
  Object.entries(tree).flatMap(([key, item]) => (item === undefined ? [] : [[key, item]]));
const pointer = (at: string, key: string | number): string =>
  `${at}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

type Mark = (at: string) => void;
type Level = "machine" | "workspace" | "project";
// Records the file that set the value at a pointer; a value set whole forgets who set what was inside it.
const recorder =
  (setBy: Record<string, string>, layer: string): Mark =>
  (at) => {
    for (const key of Object.keys(setBy)) if (key.startsWith(`${at}/`)) delete setBy[key];
    setBy[at] = layer;
  };

// A list grows: the earlier items in their order, then each new one.
const union = (before: Json[], after: Json[], at: string, mark: Mark): Json[] => {
  const merged = [...before];
  const known = new Set(before.map(canonicalJson));
  for (const item of after) {
    const text = canonicalJson(item);
    if (known.has(text)) continue;
    known.add(text);
    mark(pointer(at, merged.length));
    merged.push(item);
  }
  return merged;
};

// Lists grow, objects merge key by key, and anything else takes the later value.
const merge = (before: Json | undefined, after: Json, at: string, mark: Mark): Json => {
  if (Array.isArray(before) && Array.isArray(after)) return union(before, after, at, mark);
  if (!isTree(before) || !isTree(after)) {
    mark(at);
    return after;
  }
  const merged = { ...before };
  for (const [key, item] of present(after)) merged[key] = merge(before[key], item, pointer(at, key), mark);
  return merged;
};

// A record whose values are each one value: a later file's replaces an entry whole.
const wholes = (before: Json | undefined, after: Tree, at: string, mark: Mark): Tree => {
  const merged = isTree(before) ? { ...before } : {};
  for (const [key, item] of Object.entries(after)) {
    mark(pointer(at, key));
    merged[key] = item;
  }
  return merged;
};

// Part fields that hold a source (a text, a pack or Git source, a marketplace) are one value, so `{ inline }` never
// mixes with a parent's `{ pack, path }`; `files` maps paths to such texts. A list of texts grows as any list does.
const SOURCES = new Set(["text", "rules", "source", "marketplace", "scaffold"]);
const mergePart = (before: Tree, after: Tree, at: string, mark: Mark): Tree => {
  const merged = { ...before };
  for (const [key, item] of present(after)) {
    const field = pointer(at, key);
    if (key === "files" && isTree(item)) merged[key] = wholes(before[key], item, field, mark);
    else if (!SOURCES.has(key) || Array.isArray(item)) merged[key] = merge(before[key], item, field, mark);
    else {
      mark(field);
      merged[key] = item;
    }
  }
  return merged;
};

// The files in the order they apply: each parent after its own parents, a parent reached twice at its first place,
// then the root.
const layersOf = (root: ProfileFile, load: LoadParent): Result<ProfileFile[]> => {
  const layers: ProfileFile[] = [];
  const done = new Set<string>();
  const visit = (file: ProfileFile, chain: string[]): Result<undefined> => {
    for (const parent of file.extends ?? []) {
      // One parent is one entry of one source: two files may give a pack id different sources.
      const key = `${parent.pack}/${parent.path} ${canonicalJson(file.packs?.[parent.pack] ?? null)}`;
      if (chain.includes(key)) {
        const names = [...chain, key].map((each) => each.slice(0, each.indexOf(" ")));
        return { ok: false, finding: { code: "profile.parent-cycle", params: { chain: names } } };
      }
      if (done.has(key)) continue;
      const read = load(parent, file);
      if (read === undefined) return { ok: false, finding: { code: "profile.parent-unknown", params: parent } };
      if (!read.ok) return read;
      const parents = visit(read.value, [...chain, key]);
      if (!parents.ok) return parents;
      done.add(key);
      layers.push(read.value);
    }
    return { ok: true, value: undefined };
  };
  const visited = visit(root, []);
  return visited.ok ? { ok: true, value: [...layers, root] } : visited;
};

const mergeLayer = (layer: ProfileFile, head: Tree, parts: Record<Level, Tree>, mark: Mark): void => {
  if (layer.agents !== undefined) head["agents"] = merge(head["agents"], layer.agents, "/agents", mark);
  if (layer.packs !== undefined) head["packs"] = wholes(head["packs"], layer.packs, "/packs", mark);
  for (const level of ["machine", "workspace", "project"] as const) {
    for (const [id, each] of Object.entries(layer[level] ?? {})) {
      const at = pointer(pointer("", level), id);
      const before = parts[level][id];
      if (isTree(before) && before["type"] === each.type) {
        parts[level][id] = mergePart(before, each, at, mark);
      } else {
        mark(at);
        parts[level][id] = each;
      }
    }
  }
};

/**
 * Merges a profile file with its parents, Renovate-style: each parent in the order `extends` lists it, after its own
 * parents, then the file; a parent reached twice counts once, at its first place. Of two files, the later wins: a part
 * of the same type merges into the earlier one field by field (lists grow, objects merge key by key, a source and any
 * other value is replaced), a part of another type replaces it. The file's own `id`, `version`,
 * `name` and `minApp` are kept; a parent's are not. A parent that extends a file on the way to it is refused, the root's own entry
 * included once it is read as a parent.
 */
export const composeProfile = (root: ProfileFile, load: LoadParent): Result<Composed> => {
  const layers = layersOf(root, load);
  if (!layers.ok) return layers;
  const setBy: Record<string, string> = {};
  const head: Tree = { packs: {} };
  const parts: Record<Level, Tree> = { machine: {}, workspace: {}, project: {} };
  for (const layer of layers.value) mergeLayer(layer, head, parts, recorder(setBy, layer.id));
  const { schemaVersion, kind, id, version, name, description, license, minApp } = root;
  const own = { schemaVersion, kind, id, version, name, description, license, minApp };
  const read = readDocument(Profile, PROFILE_SCHEMA_VERSION, { ...head, ...parts, ...own });
  return read.ok ? { ok: true, value: { profile: read.value, setBy } } : read;
};
