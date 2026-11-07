import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Composed,
  composeProfile,
  type Finding,
  type LoadParent,
  type Profile,
  type ProfileSelection,
  type Result,
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

/**
 * A pack's entry as text. shortcut: only bundled packs, which ship in this release, are read; a Git pack's entries are
 * unknown until pack fetching lands.
 */
export const readEntry = (ref: Ref): Result<string> => {
  try {
    return { ok: true, value: readFileSync(join(BUNDLED, ref.pack, ref.path), "utf8") };
  } catch {
    return refuse({ code: "profile.entry-unknown", params: { pack: ref.pack, path: ref.path } });
  }
};

const parsed = (text: Result<string>): Result<unknown> => {
  if (!text.ok) return text;
  try {
    return { ok: true, value: JSON.parse(text.value) };
  } catch {
    return refuse({ code: "document.invalid", params: { issues: [{ path: "", code: "invalid_json" }] } });
  }
};

const loadParent: LoadParent = (parent) => {
  const read = parsed(readEntry(parent));
  return !read.ok && read.finding.code === "profile.entry-unknown" ? undefined : read;
};

// The selected profile file as JSON, and whether it ships in this release; the default without a selection.
const rootOf = (profile: ProfileSelection["profile"]): Result<{ json: unknown; bundled: boolean }> => {
  if ("pack" in profile) {
    const read = parsed(readEntry(profile));
    return read.ok ? { ok: true, value: { json: read.value, bundled: true } } : read;
  }
  let text: string;
  try {
    text = readFileSync(profile.file, "utf8");
  } catch (error) {
    return refuse({ code: "document.unreadable", params: { path: profile.file, error: errorCode(error) } });
  }
  const read = parsed({ ok: true, value: text });
  return read.ok ? { ok: true, value: { json: read.value, bundled: false } } : read;
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
