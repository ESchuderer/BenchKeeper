import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PackRef, Plan, Result } from "@cedarloom/contracts";
import { composedProfile, DEFAULT_PROFILE, type ProfileChange, profileChanges, readEntry } from "@cedarloom/profiles";
import { planChoice, readSelection, selectionPath } from "./profiles.ts";

/**
 * Plans a copy of a pack's profile into the new file `file`, which the selection then names: a profile of the owner's
 * to edit, whose differences from the pack's `diffProfile` shows (plan section 2.6). shortcut: bundled packs only, as
 * `readEntry` reads a Git pack's entry from its fetched folder; upgrade when a Git pack ships a profile to copy.
 */
export const planProfileCopy = (config: string, from: PackRef, file: string): Result<Plan> => {
  const path = resolve(file);
  if (existsSync(path) || path === selectionPath(config))
    return { ok: false, finding: { code: "profile.copy-exists", params: { path } } };
  const text = readEntry(from, "profile");
  if (!text.ok) return text;
  const choice = planChoice(config, { file: path });
  if (!choice.ok) return choice;
  const copy = { kind: "write" as const, path, before: null, content: text.value };
  return { ok: true, value: { ...choice.value, operations: [copy, ...choice.value.operations] } };
};

/**
 * How the profile this machine applies differs from a pack's, each composed with its parents, by field and by part:
 * `added` in this machine's, `removed` from it, or `changed`.
 */
export const diffProfile = (config: string, against: PackRef): Result<ProfileChange[]> => {
  const read = readSelection(config);
  if (!read.ok) return read;
  const mine = composedProfile(read.value.selection?.profile ?? DEFAULT_PROFILE);
  if (!mine.ok) return mine;
  const theirs = composedProfile(against);
  return theirs.ok ? { ok: true, value: profileChanges(mine.value, theirs.value) } : theirs;
};
