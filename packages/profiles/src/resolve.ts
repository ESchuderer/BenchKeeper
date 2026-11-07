import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type Composed,
  composeProfile,
  type Finding,
  type LoadParent,
  PACK_SCHEMA_VERSION,
  PackManifest,
  type Profile,
  type ProfileSelection,
  type Result,
  readDocument,
  semverAbove,
} from "@cedarloom/contracts";
import { errorCode } from "@cedarloom/engine";
import { BUNDLED } from "@cedarloom/packs";

type Ref = { pack: string; path: string };
const LEVELS = ["machine", "workspace", "project"] as const;

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

const parseJson = (text: string): Result<unknown> => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return refuse({ code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } });
  }
};

/** A JSON file's text and value, null when it is missing: `document.unreadable` or `document.invalid` otherwise. */
export const jsonFile = (path: string): Result<{ text: string; json: unknown } | null> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: true, value: null };
    return refuse({ code: "document.unreadable", params: { path, error: errorCode(error) } });
  }
  const json = parseJson(text);
  return json.ok ? { ok: true, value: { text, json: json.value } } : json;
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

type Entry = PackManifest["entries"][string];

// A pack's manifest; null when the pack has none here.
const manifestOf = (pack: string, folder: Folder | undefined): Result<PackManifest | null> => {
  const bytes = packFile(pack, "cedarloom-pack.json", folder);
  if (!bytes.ok || bytes.value === null) return bytes.ok ? { ok: true, value: null } : bytes;
  const json = parseJson(bytes.value.toString("utf8"));
  return json.ok ? readDocument(PackManifest, PACK_SCHEMA_VERSION, json.value) : json;
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

/** The files under a pack's folder entry, paths relative to it. */
export const entryFiles = (ref: Ref, folder?: Folder): Result<Folder["files"]> => {
  const prefix = `${ref.path}/`;
  if (folder !== undefined) {
    const files = folder.files.filter((file) => file.path.startsWith(prefix));
    return { ok: true, value: files.map((file) => ({ ...file, path: file.path.slice(prefix.length) })) };
  }
  const root = join(BUNDLED, ref.pack, ref.path);
  try {
    const found = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    const files = found.map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path: relative(root, path).split(sep).join("/"), mode: "100644", content: readFileSync(path) };
    });
    return { ok: true, value: files };
  } catch (error) {
    return refuse({ code: "document.unreadable", params: { path: root, error: errorCode(error) } });
  }
};

// A file's JSON; a missing one is unreadable.
const jsonAt = (path: string): Result<unknown> => {
  const file = jsonFile(path);
  if (!file.ok) return file;
  if (file.value === null) return refuse({ code: "document.unreadable", params: { path, error: "ENOENT" } });
  return { ok: true, value: file.value.json };
};

const profileEntry = (ref: Ref): Result<unknown> => {
  const text = readEntry(ref, "profile");
  return text.ok ? parseJson(text.value) : text;
};

const loadParent: LoadParent = (parent) => {
  const json = profileEntry(parent);
  return !json.ok && json.finding.code === "profile.entry-unknown" ? undefined : json;
};

// The selected profile file as JSON, and whether it ships in this release; the default without a selection.
const rootOf = (profile: ProfileSelection["profile"]): Result<{ json: unknown; bundled: boolean }> => {
  const json = "pack" in profile ? profileEntry(profile) : jsonAt(profile.file);
  return json.ok ? { ok: true, value: { json: json.value, bundled: "pack" in profile } } : json;
};

/** A composed profile with the parts switched on (`level.id`), this machine's hub, and what keeps it from applying. */
export interface Resolved extends Composed {
  readonly on: ReadonlySet<string>;
  readonly hub: string | undefined;
  readonly problems: Finding[];
}

type Part = Profile["machine"][string] | Profile["workspace"][string] | Profile["project"][string];
const partsOf = (profile: Profile): [string, Part][] =>
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

/**
 * The profile the selection names (the bundled default without one), composed with its parents, and its parts switched
 * on: the selection's choice, else the part's default. shortcut: no probe runs yet, so an `auto` part is on only when
 * selected; each probe lands with the first parts that need it (Orca with skills, the dev container with projects).
 */
export const resolveProfile = (selection: ProfileSelection | null, app = APP_VERSION): Result<Resolved> => {
  const root = rootOf(selection?.profile ?? DEFAULT_PROFILE);
  if (!root.ok) return root;
  const composed = composeProfile(root.value.json, loadParent);
  if (!composed.ok) return composed;
  const { minApp } = composed.value.profile;
  // A bundled profile ships with this release, so only another file can need a newer one.
  if (!root.value.bundled && semverAbove(minApp, app))
    return refuse({ code: "profile.app-too-old", params: { minApp, app } });
  const parts = new Map(partsOf(composed.value.profile));
  const on = new Set(
    [...parts].filter(([key, part]) => selection?.select[key] ?? part.default === "on").map(([key]) => key),
  );
  const hub = selection?.bindings?.hub;
  return { ok: true, value: { ...composed.value, on, hub, problems: problemsOf(parts, on, selection) } };
};
