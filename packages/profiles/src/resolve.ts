import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type Composed,
  composeProfile,
  type Finding,
  type LoadParent,
  PACK_SCHEMA_VERSION,
  PackManifest,
  type PartProbe,
  type Profile,
  type ProfileSelection,
  type Result,
  readDocument,
  semver,
  semverAbove,
} from "@cedarloom/contracts";
import { errorCode, parseDocument, readJson, readRegular } from "@cedarloom/engine";
import { BUNDLED } from "@cedarloom/packs";

type Ref = { pack: string; path: string };
export const LEVELS = ["machine", "workspace", "project"] as const;

/** The profile of a machine without a selection file: the default of the bundled core pack. */
export const DEFAULT_PROFILE: Ref = { pack: "cedarloom.core", path: "profiles/default.json" };

/** The CedarLoom release this is; the application packages share one version. */
export const APP_VERSION: string = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

/** What a reference names in a pack's manifest. */
export type EntryKind = "rules" | "template" | "profile" | "skill";

/** A fetched folder: each file with its path inside the folder, its Git mode and its bytes. */
export type Folder = { readonly files: readonly { path: string; mode: string; content: Buffer }[] };

/** A file's text, null when it is missing; `document.unreadable` when it cannot be read. */
export const textFile = (path: string): Result<string | null> => {
  try {
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: true, value: null };
    return refuse({ code: "document.unreadable", params: { path, error: errorCode(error) } });
  }
};

// A pack's file from its fetched folder, or from this release's bundled packs without one; null when it is absent.
const packFile = (pack: string, path: string, folder: Folder | undefined): Result<Buffer | null> => {
  if (folder !== undefined)
    return { ok: true, value: folder.files.find((file) => file.path === path)?.content ?? null };
  const file = join(BUNDLED, pack, path);
  try {
    return { ok: true, value: readFileSync(file) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: true, value: null };
    return refuse({ code: "document.unreadable", params: { path: file, error: errorCode(error) } });
  }
};

/** The files below a folder by their paths in it; a link is no file, so nothing outside it is read. */
export const filesIn = (folder: string): Folder["files"] =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .flatMap((entry) => {
      const path = join(entry.parentPath, entry.name);
      // shortcut: no size limit, as before; a cap needs a decision first: skip or refuse an oversized file.
      const found = readRegular(path, Number.POSITIVE_INFINITY);
      // Gone or no regular file since the listing: skipped, as a link is.
      if (found === undefined || found === null || found.bytes === null) return [];
      // Git's rule: a file its owner may run is 100755.
      const mode = (found.info.mode & 0o100) === 0 ? "100644" : "100755";
      return [{ path: relative(folder, path).split(sep).join("/"), mode, content: found.bytes }];
    });

type Entry = PackManifest["entries"][string];

// A pack's manifest; null when the pack has none here.
const manifestOf = (pack: string, folder: Folder | undefined): Result<PackManifest | null> => {
  const bytes = packFile(pack, "cedarloom-pack.json", folder);
  if (!bytes.ok || bytes.value === null) return bytes.ok ? { ok: true, value: null } : bytes;
  return parseDocument(bytes.value.toString("utf8"), (json) => readDocument(PackManifest, PACK_SCHEMA_VERSION, json));
};

/** A pack as `id@version` by its manifest, the id alone for a pack without one here. */
export const packVersion = (pack: string, folder: Folder | undefined): string => {
  const manifest = manifestOf(pack, folder);
  return manifest.ok && manifest.value !== null ? `${pack}@${manifest.value.version}` : pack;
};

/** The manifest's entry for a reference, only as an entry of that kind; a pack without a folder lists none. */
export const entryOf = (ref: Ref, kind: EntryKind, folder?: Folder): Result<Entry> => {
  const manifest = manifestOf(ref.pack, folder);
  if (!manifest.ok) return manifest;
  const entry = Object.entries(manifest.value?.entries ?? {}).find(([path]) => path === ref.path)?.[1];
  if (entry?.kind === kind) return { ok: true, value: entry };
  return refuse({ code: "profile.entry-unknown", params: { pack: ref.pack, path: ref.path, kind } });
};

/**
 * A pack's entry of that kind as text: from the pack's fetched folder for a Git pack, else from this release's bundled
 * packs. shortcut: a parent profile is read from bundled packs only; a Git pack's parent needs that pack fetched
 * before the composition, due when a shared profile extends one.
 */
export const readEntry = (ref: Ref, kind: EntryKind, folder?: Folder): Result<string> => {
  const entry = entryOf(ref, kind, folder);
  if (!entry.ok) return entry;
  const bytes = packFile(ref.pack, ref.path, folder);
  if (!bytes.ok) return bytes;
  if (bytes.value === null)
    return refuse({ code: "profile.entry-unknown", params: { pack: ref.pack, path: ref.path, kind } });
  return { ok: true, value: bytes.value.toString("utf8") };
};

/** The paths of a pack's skill entries; none for a pack without a manifest here. */
export const skillEntries = (pack: string, folder: Folder | undefined): Result<string[]> => {
  const manifest = manifestOf(pack, folder);
  if (!manifest.ok) return manifest;
  const entries = Object.entries(manifest.value?.entries ?? {});
  return { ok: true, value: entries.filter(([, entry]) => entry.kind === "skill").map(([path]) => path) };
};

/** The files under a fetched pack's folder entry, paths relative to it. */
export const entryFiles = (ref: Ref, folder: Folder): Folder["files"] => {
  const prefix = `${ref.path}/`;
  return folder.files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
};

// A file's JSON; a missing one is unreadable.
const jsonAt = (path: string): Result<unknown> => {
  const file = readJson(path);
  return file.ok ? { ok: true, value: file.value.json } : file;
};

const profileEntry = (ref: Ref): Result<unknown> => {
  const text = readEntry(ref, "profile");
  return text.ok ? parseDocument(text.value, (json) => ({ ok: true, value: json })) : text;
};

const loadParent: LoadParent = (parent) => {
  const json = profileEntry(parent);
  return !json.ok && json.finding.code === "profile.entry-unknown" ? undefined : json;
};

// The JSON of the profile file a selection names: a pack's entry, or a file of the owner's.
const profileJson = (profile: ProfileSelection["profile"]): Result<unknown> =>
  "pack" in profile ? profileEntry(profile) : jsonAt(profile.file);

// The selected profile file as JSON, and whether it ships in this release; the default without a selection.
const rootOf = (profile: ProfileSelection["profile"]): Result<{ json: unknown; bundled: boolean }> => {
  const json = profileJson(profile);
  return json.ok ? { ok: true, value: { json: json.value, bundled: "pack" in profile } } : json;
};

/**
 * A composed profile with the parts switched on (`level.id`), this machine's hub and gate workflow source, the `auto`
 * parts that wait for that source, the parts selected on that stay off without Orca, the parts the selection switches
 * off, and what keeps it from applying.
 */
export interface Resolved extends Composed {
  readonly on: ReadonlySet<string>;
  readonly hub: string | undefined;
  readonly gates: string | undefined;
  readonly unbound: readonly string[];
  readonly unmet: readonly string[];
  readonly switchedOff: readonly string[];
  readonly problems: Finding[];
}

type Part = Profile["machine"][string] | Profile["workspace"][string] | Profile["project"][string];
/** Each part of a profile by its key `level.id`. */
export const partsOf = (profile: Profile): [string, Part][] =>
  LEVELS.flatMap((level) =>
    Object.entries(profile[level]).map(([id, part]): [string, Part] => [`${level}.${id}`, part]),
  );

const unknown = (part: string, by: string): Finding => ({ code: "profile.part-unknown", params: { part, by } });

// Each part a part that is on requires: one the profile lacks, or one that is off.
const requiresOf = (parts: ReadonlyMap<string, Part>, on: ReadonlySet<string>, key: string): Finding[] =>
  (parts.get(key)?.requires ?? []).flatMap((required): Finding[] => {
    if (!parts.has(required)) return [unknown(required, key)];
    return on.has(required) ? [] : [{ code: "profile.part-requires", params: { part: key, requires: required } }];
  });

// A part named by the selection or a `requires` that the profile lacks, a required part that is off, a missing binding.
const problemsOf = (parts: ReadonlyMap<string, Part>, on: ReadonlySet<string>, selection: ProfileSelection | null) => [
  ...Object.keys(selection?.select ?? {})
    .filter((key) => !parts.has(key))
    .map((key) => unknown(key, "The selection")),
  ...[...on].flatMap((key) => requiresOf(parts, on, key)),
  ...[...on]
    .filter((key) => parts.get(key)?.type === "hub" && selection?.bindings?.hub === undefined)
    .map((part): Finding => ({ code: "profile.binding-missing", params: { part, binding: "hub" } })),
];

/** What an `auto` part is on by. */
export type Probe = PartProbe;
const defaultOn = (part: Part, probe: (when: Probe) => boolean): boolean =>
  part.default === "on" || (part.default === "auto" && part.when !== undefined && probe(part.when));

// A profile file's minApp before the strict parse, as a newer release's file may hold fields this one refuses.
const minAppOf = (json: unknown): string | undefined => {
  const head = typeof json === "object" && json !== null ? json : {};
  const at = semver.safeParse("minApp" in head ? head.minApp : undefined);
  return "kind" in head && head.kind === "cedarloom.profile" && at.success ? at.data : undefined;
};

// The selected profile with its parents; a bundled one ships with this release, so only another file can be newer.
const composedOf = (selection: ProfileSelection | null, app: string): Result<Composed> => {
  const root = rootOf(selection?.profile ?? DEFAULT_PROFILE);
  if (!root.ok) return root;
  const minApp = root.value.bundled ? undefined : minAppOf(root.value.json);
  if (minApp !== undefined && semverAbove(minApp, app))
    return refuse({ code: "profile.app-too-old", params: { minApp, app } });
  return composeProfile(root.value.json, loadParent);
};

/** A profile file composed with its parents, only to read: a pack's entry or a file of the owner's, whatever its `minApp`. */
export const composedProfile = (profile: ProfileSelection["profile"]): Result<Profile> => {
  const json = profileJson(profile);
  if (!json.ok) return json;
  const composed = composeProfile(json.value, loadParent);
  return composed.ok ? { ok: true, value: composed.value.profile } : composed;
};

// An Orca part is on only while Orca is here, also when selected (hub issue 146); a dev container part still adds one.
const switchedOn = (parts: Map<string, Part>, select: Record<string, boolean>, probe: (when: Probe) => boolean) =>
  new Set(
    [...parts]
      .filter(([key, part]) => (select[key] ?? defaultOn(part, probe)) && (part.when !== "orca" || probe("orca")))
      .map(([key]) => key),
  );

/**
 * The profile the selection names (the bundled default without one), composed with its parents, and its parts switched
 * on: the selection's choice, else the part's default, an `auto` part's by its probe; an Orca part only with Orca.
 */
export const resolveProfile = (
  selection: ProfileSelection | null,
  app = APP_VERSION,
  probe: (when: Probe) => boolean = () => false,
): Result<Resolved> => {
  const composed = composedOf(selection, app);
  if (!composed.ok) return composed;
  const parts = new Map(partsOf(composed.value.profile));
  const { hub, gates } = selection?.bindings ?? {};
  const select = selection?.select ?? {};
  const on = switchedOn(parts, select, (when) => (when === "gates" ? gates !== undefined : probe(when)));
  // An auto part the selection leaves to its probe, off until this machine names a gate workflow source.
  const unbound = [...parts]
    .filter(([key, part]) => part.when === "gates" && select[key] === undefined && !on.has(key))
    .map(([key]) => key);
  const unmet = [...parts].filter(([key]) => select[key] === true && !on.has(key)).map(([key]) => key);
  const switchedOff = [...parts.keys()].filter((key) => select[key] === false);
  const problems = problemsOf(parts, on, selection);
  return { ok: true, value: { ...composed.value, on, hub, gates, unbound, unmet, switchedOff, problems } };
};
