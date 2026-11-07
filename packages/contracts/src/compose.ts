import { type Result, readDocument } from "./documents.ts";
import type { Finding } from "./findings.ts";
import { canonicalJson, type Json } from "./json.ts";
import { PROFILE_SCHEMA_VERSION, Profile, type ProfileFile, readProfile } from "./profile.ts";

/** A parent profile as a file names it: an entry of one of the file's packs. */
export type ParentRef = { pack: string; path: string };
/**
 * Reads a parent's file through the packs of the file that names it, as parsed JSON; `composeProfile` reads it as a
 * profile. Undefined when the pack has no such entry.
 */
export type LoadParent = (parent: ParentRef, child: ProfileFile) => Result<unknown> | undefined;
/** The most profile files one composition reads, the root among them: each parent may be a Git fetch. */
export const MAX_PROFILE_FILES = 50;
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

// The pointer of every value inside a value, as setBy keys them.
const inside = (value: Json | undefined, at: string): string[] => {
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => [pointer(at, key), ...inside(item, pointer(at, key))]);
};
// Records the file that set the value at a pointer. A value replaced whole forgets who set what was inside it, by the
// pointers of that value alone, so the cost follows the replaced value, never the whole record.
/** Called with the JSON Pointer of each value a merge sets, and the value it replaces there. */
export type Mark = (at: string, replaced?: Json) => void;
type Level = "machine" | "workspace" | "project";
const recorder =
  (setBy: Record<string, string>, layer: string): Mark =>
  (at, replaced) => {
    for (const key of inside(replaced, at)) delete setBy[key];
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

/** The merge of every `set` and part field: lists grow, objects merge key by key, anything else takes the later value. */
export const mergeJson = (before: Json | undefined, after: Json, at: string, mark: Mark): Json => {
  if (Array.isArray(before) && Array.isArray(after)) return union(before, after, at, mark);
  if (!isTree(before) || !isTree(after)) {
    mark(at, before);
    return after;
  }
  const merged = { ...before };
  for (const [key, item] of present(after)) merged[key] = mergeJson(before[key], item, pointer(at, key), mark);
  return merged;
};

// A record whose values are each one value: a later file's replaces an entry whole.
const wholes = (before: Json | undefined, after: Tree, at: string, mark: Mark): Tree => {
  const merged = isTree(before) ? { ...before } : {};
  for (const [key, item] of present(after)) {
    mark(pointer(at, key), merged[key]);
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
    else if (!SOURCES.has(key) || Array.isArray(item)) merged[key] = mergeJson(before[key], item, field, mark);
    else {
      mark(field, before[key]);
      merged[key] = item;
    }
  }
  return merged;
};

// The files in the order they apply: each parent after its own parents, a parent reached twice at its first place,
// then the root; each read as a profile, so no file skips the reader's refusals.
const layersOf = (root: ProfileFile, load: LoadParent): Result<ProfileFile[]> => {
  const layers: ProfileFile[] = [];
  const done = new Set<string>();
  const visit = (file: ProfileFile, chain: string[]): Finding | undefined => {
    for (const parent of file.extends ?? []) {
      const key = `${parent.pack}/${parent.path}`;
      if (chain.includes(key)) return { code: "profile.parent-cycle", params: { chain: [...chain, key] } };
      if (done.has(key)) continue;
      if (layers.length + chain.length + 1 >= MAX_PROFILE_FILES) {
        return { code: "profile.parent-limit", params: { chain: [...chain, key], limit: MAX_PROFILE_FILES } };
      }
      const loaded = load(parent, file);
      if (loaded === undefined) return { code: "profile.parent-unknown", params: parent };
      const read = loaded.ok ? readProfile(loaded.value) : loaded;
      if (!read.ok) return read.finding;
      const failed = visit(read.value, [...chain, key]);
      if (failed !== undefined) return failed;
      done.add(key);
      layers.push(read.value);
    }
    return undefined;
  };
  const failed = visit(root, []);
  return failed === undefined ? { ok: true, value: [...layers, root] } : { ok: false, finding: failed };
};

// A pack id names one source in every file of a composition, so a text a parent names comes from where it chose.
const packConflict = (layer: ProfileFile, head: Tree, setBy: Record<string, string>): Finding | undefined => {
  const packs = isTree(head["packs"]) ? head["packs"] : {};
  for (const [pack, source] of Object.entries(layer.packs ?? {})) {
    const before = packs[pack];
    if (before !== undefined && canonicalJson(before) !== canonicalJson(source)) {
      return {
        code: "profile.pack-sources",
        params: { pack, files: [setBy[pointer("/packs", pack)] ?? "", layer.id] },
      };
    }
  }
  return undefined;
};

const mergeLayer = (layer: ProfileFile, head: Tree, parts: Record<Level, Tree>, mark: Mark): void => {
  if (layer.agents !== undefined) head["agents"] = mergeJson(head["agents"], layer.agents, "/agents", mark);
  if (layer.packs !== undefined) head["packs"] = wholes(head["packs"], layer.packs, "/packs", mark);
  for (const level of ["machine", "workspace", "project"] as const) {
    for (const [id, each] of Object.entries(layer[level] ?? {})) {
      const at = pointer(pointer("", level), id);
      const before = parts[level][id];
      if (isTree(before) && before["type"] === each.type) {
        parts[level][id] = mergePart(before, each, at, mark);
      } else {
        mark(at, before);
        parts[level][id] = each;
      }
    }
  }
};

/**
 * Reads a profile file and merges it with its parents, Renovate-style: each parent in the order `extends` lists it,
 * after its own parents, then the file; of two files, the later wins. A part of the same type merges into the earlier
 * one field by field: lists grow, objects merge key by key, a source and any other value is replaced. A part of another
 * type replaces the earlier one whole, the one way a later file drops what an earlier one set (a deny list included);
 * otherwise nothing is removed, and a child switches a part off with `default: off`. The file's own `id`, `version`,
 * `name` and `minApp` are kept, a parent's are not.
 *
 * Three rules differ from Renovate on purpose: a parent reached twice applies once, at its first place (Renovate merges
 * it again on each path, so the second application would take back the first branch's changes); a cycle is refused
 * (Renovate skips it); every list grows without duplicates (Renovate concatenates only its mergeable options, keeps
 * duplicates and replaces other arrays). A pack id with two sources, a parent a pack lacks and more than
 * `MAX_PROFILE_FILES` files are refused too.
 */
export const composeProfile = (value: unknown, load: LoadParent): Result<Composed> => {
  const root = readProfile(value);
  if (!root.ok) return root;
  const layers = layersOf(root.value, load);
  if (!layers.ok) return layers;
  const setBy: Record<string, string> = {};
  const head: Tree = { packs: {} };
  const parts: Record<Level, Tree> = { machine: {}, workspace: {}, project: {} };
  for (const layer of layers.value) {
    const conflict = packConflict(layer, head, setBy);
    if (conflict !== undefined) return { ok: false, finding: conflict };
    mergeLayer(layer, head, parts, recorder(setBy, layer.id));
  }
  const { schemaVersion, kind, id, version, name, description, license, minApp } = root.value;
  const own = { schemaVersion, kind, id, version, name, description, license, minApp };
  const read = readDocument(Profile, PROFILE_SCHEMA_VERSION, { ...head, ...parts, ...own });
  return read.ok ? { ok: true, value: { profile: read.value, setBy } } : read;
};
