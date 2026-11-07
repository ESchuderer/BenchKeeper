import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/** What a reference names in a pack's manifest: a rules text, a template or a profile. */
export type EntryKind = "rules" | "template" | "profile";

/** A JSON file's text and value, null when it is missing: `document.unreadable` or `document.invalid` otherwise. */
export const jsonFile = (path: string): Result<{ text: string; json: unknown } | null> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: true, value: null };
    return refuse({ code: "document.unreadable", params: { path, error: errorCode(error) } });
  }
  try {
    return { ok: true, value: { text, json: JSON.parse(text) } };
  } catch {
    return refuse({ code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } });
  }
};

/**
 * Where a pack's entry is, only as an entry of the kind its manifest lists. shortcut: only bundled packs, which ship
 * in this release, are read; a Git pack's entries are unknown until pack fetching lands.
 */
const entryPath = (ref: Ref, kind: EntryKind): Result<string> => {
  const file = jsonFile(join(BUNDLED, ref.pack, "cedarloom-pack.json"));
  if (!file.ok) return file;
  const manifest = file.value === null ? null : readDocument(PackManifest, PACK_SCHEMA_VERSION, file.value.json);
  if (manifest?.ok === false) return manifest;
  const entry = Object.entries(manifest?.value.entries ?? {}).find(([path]) => path === ref.path)?.[1];
  if (entry?.kind !== kind)
    return refuse({ code: "profile.entry-unknown", params: { pack: ref.pack, path: ref.path, kind } });
  return { ok: true, value: join(BUNDLED, ref.pack, ref.path) };
};

/** A pack's entry of that kind as text. */
export const readEntry = (ref: Ref, kind: EntryKind): Result<string> => {
  const path = entryPath(ref, kind);
  if (!path.ok) return path;
  try {
    return { ok: true, value: readFileSync(path.value, "utf8") };
  } catch (error) {
    return refuse({ code: "document.unreadable", params: { path: path.value, error: errorCode(error) } });
  }
};

// A file's JSON; a missing one is unreadable.
const jsonAt = (path: string): Result<unknown> => {
  const file = jsonFile(path);
  if (!file.ok) return file;
  if (file.value === null) return refuse({ code: "document.unreadable", params: { path, error: "ENOENT" } });
  return { ok: true, value: file.value.json };
};

const loadParent: LoadParent = (parent) => {
  const path = entryPath(parent, "profile");
  if (path.ok) return jsonAt(path.value);
  return path.finding.code === "profile.entry-unknown" ? undefined : path;
};

// The selected profile file as JSON, and whether it ships in this release; the default without a selection.
const rootOf = (profile: ProfileSelection["profile"]): Result<{ json: unknown; bundled: boolean }> => {
  const path = "pack" in profile ? entryPath(profile, "profile") : { ok: true as const, value: profile.file };
  const json = path.ok ? jsonAt(path.value) : path;
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
