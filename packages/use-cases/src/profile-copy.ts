import { resolve } from "node:path";
import { canonicalJson, type Finding, JsonValue, type Plan, type Result } from "@cedarloom/contracts";
import { hashFile } from "@cedarloom/engine";
import { DEFAULT_PROFILE, profileJson, readEntry } from "@cedarloom/profiles";
import { planChoice, readSelection } from "./profiles.ts";

// A pack's profile entry, named `<pack>/<path>` as in `cedarloom.core/profiles/default.json`.
const refOf = (from: string): Result<{ pack: string; path: string }> => {
  const at = from.indexOf("/");
  if (at > 0) return { ok: true, value: { pack: from.slice(0, at), path: from.slice(at + 1) } };
  const finding: Finding = { code: "profile.entry-unknown", params: { pack: from, path: "", kind: "profile" } };
  return { ok: false, finding };
};

/**
 * Plans a copy of a pack's profile into `file`, which the selection then names: a profile of the owner's to edit,
 * whose differences from the pack's `diffProfile` shows (plan section 2.6).
 */
export const planProfileCopy = (config: string, from: string, file: string): Result<Plan> => {
  const ref = refOf(from);
  if (!ref.ok) return ref;
  const text = readEntry(ref.value, "profile");
  if (!text.ok) return text;
  const path = resolve(file);
  const choice = planChoice(config, { file: path });
  if (!choice.ok) return choice;
  const copy = { kind: "write" as const, path, before: hashFile(path), content: text.value };
  return { ok: true, value: { ...choice.value, operations: [copy, ...choice.value.operations] } };
};

/** How a profile differs from another by one of its fields or parts. */
export type ProfileChange = { change: "added" | "removed" | "changed"; key: string };

const LEVELS = ["machine", "workspace", "project"];
// An object's entries; none for anything else.
const entriesOf = (value: unknown): [string, unknown][] =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.entries(value) : [];
// A value's canonical JSON, so the order of keys makes no difference.
const canonical = (value: unknown): string => {
  const json = JsonValue.safeParse(value);
  return json.success ? canonicalJson(json.data) : JSON.stringify(value);
};
// Each field of a profile file and each of its parts as `level.id`, by its canonical JSON.
const flat = (json: unknown): Map<string, string> =>
  new Map(
    entriesOf(json).flatMap(([key, value]): [string, string][] =>
      LEVELS.includes(key)
        ? entriesOf(value).map(([id, part]) => [`${key}.${id}`, canonical(part)])
        : [[key, canonical(value)]],
    ),
  );

/**
 * How the profile this machine applies differs from a pack's profile, by field and by part: `added` in this
 * machine's, `removed` from it, or `changed`.
 */
export const diffProfile = (config: string, against: string): Result<ProfileChange[]> => {
  const ref = refOf(against);
  if (!ref.ok) return ref;
  const read = readSelection(config);
  if (!read.ok) return read;
  const mine = profileJson(read.value.selection?.profile ?? DEFAULT_PROFILE);
  if (!mine.ok) return mine;
  const theirs = profileJson(ref.value);
  if (!theirs.ok) return theirs;
  const [a, b] = [flat(mine.value), flat(theirs.value)];
  const changes = [...new Set([...b.keys(), ...a.keys()])].flatMap((key): ProfileChange[] => {
    if (!b.has(key)) return [{ change: "added", key }];
    if (!a.has(key)) return [{ change: "removed", key }];
    return a.get(key) === b.get(key) ? [] : [{ change: "changed", key }];
  });
  return { ok: true, value: changes };
};
