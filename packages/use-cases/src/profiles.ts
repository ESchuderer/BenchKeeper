import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Finding,
  PLAN_SCHEMA_VERSION,
  type Plan,
  ProfileSelection,
  readDocument,
  type Result,
  SELECTION_SCHEMA_VERSION,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { DEFAULT_PROFILE, onDisk, planMachine, resolveProfile, rulesFolder } from "@cedarloom/profiles";
import { loadRegistry } from "./accounts.ts";
import { readOptionalJson, withView } from "./use-cases.ts";

/**
 * The Claude Code home the machine level writes: `CLAUDE_CONFIG_DIR`, else `~/.claude`
 * (https://code.claude.com/docs/en/env-vars). The accounts' homes are CedarLoom's worker homes, which get their
 * settings per launch, and their aliases are only read.
 */
export const claudeHome = (env: Readonly<Record<string, string | undefined>>): string =>
  onDisk(resolve(env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude")));

const selectionPath = (config: string): string => join(config, "profile.json");

const readSelection = (config: string): Result<{ selection: ProfileSelection | null; before: string | null }> => {
  const file = readOptionalJson(selectionPath(config));
  if (!file.ok) return file;
  if (file.value === null) return { ok: true, value: { selection: null, before: null } };
  const read = readDocument(ProfileSelection, SELECTION_SCHEMA_VERSION, file.value.json);
  return read.ok ? { ok: true, value: { selection: read.value, before: sha256(file.value.text) } } : read;
};

/** The profile's plan for this machine (null: it matches), and what keeps parts from applying. */
export interface ProfilePlan {
  readonly plan: Plan | null;
  readonly findings: Finding[];
}

/** This machine's folders: its Claude Code home and the user's home. */
export interface Machine {
  readonly home: string;
  readonly user: string;
}

// The folders no plugin options file may reach: every Claude Code home, the default one included, an account's
// folders, and CedarLoom's own config and state, which hold the worker homes.
const guardedFolders = (config: string, state: string, { home, user }: Machine): Result<string[]> => {
  const registry = loadRegistry(config);
  if (!registry.ok) return registry;
  const accounts = (registry.value?.accounts ?? []).flatMap((account) => [account.home, ...(account.aliases ?? [])]);
  return { ok: true, value: [home, join(user, ".claude"), config, state, ...accounts] };
};

/**
 * Plans the selected profile's machine level; a profile with problems gets no plan, only its findings. A plugin part
 * is planned only when `allow` names it.
 */
export const planProfile = (
  config: string,
  state: string,
  { home, user }: Machine,
  allow: readonly string[] = [],
): Result<ProfilePlan> => {
  const read = readSelection(config);
  if (!read.ok) return read;
  const resolved = resolveProfile(read.value.selection);
  if (!resolved.ok) return resolved;
  if (resolved.value.problems.length > 0) {
    return { ok: true, value: { plan: null, findings: resolved.value.problems } };
  }
  const written = withView(state, (view) => ({
    ok: true,
    value: view?.written(rulesFolder(home)) ?? new Map<string, string | null>(),
  }));
  if (!written.ok) return written;
  const guarded = guardedFolders(config, state, { home, user });
  if (!guarded.ok) return guarded;
  const target = { home, user, guarded: guarded.value };
  const level = planMachine(resolved.value, target, written.value, new Set(allow));
  if (!level.ok) return level;
  const { operations, findings } = level.value;
  const plan: Plan | null = operations.length === 0 ? null : { schemaVersion: PLAN_SCHEMA_VERSION, operations };
  return { ok: true, value: { plan, findings } };
};

/** One change of the selection: a part on, off or back to its default (null), or this machine's hub repository. */
export type Choice = { readonly part: string; readonly on: boolean | null } | { readonly hub: string };

const chosen = (current: ProfileSelection, choice: Choice): unknown => {
  if ("hub" in choice) return { ...current, bindings: { ...current.bindings, hub: choice.hub } };
  const select = Object.entries(current.select).filter(([part]) => part !== choice.part);
  return {
    ...current,
    select: Object.fromEntries(choice.on === null ? select : [...select, [choice.part, choice.on]]),
  };
};

/**
 * Plans the selection file with one choice made, from the default profile when there is none yet. A part switched on
 * or off must be one of the profile's; going back to the default also clears a part the profile no longer has.
 */
export const planChoice = (config: string, choice: Choice): Result<Plan> => {
  const read = readSelection(config);
  if (!read.ok) return read;
  const { selection, before } = read.value;
  const current = selection ?? {
    schemaVersion: SELECTION_SCHEMA_VERSION,
    kind: "cedarloom.profile-selection",
    profile: DEFAULT_PROFILE,
    select: {},
  };
  const next = readDocument(ProfileSelection, SELECTION_SCHEMA_VERSION, chosen(current, choice));
  if (!next.ok) return next;
  if ("part" in choice && choice.on !== null) {
    const resolved = resolveProfile(next.value);
    if (!resolved.ok) return resolved;
    const unknown = resolved.value.problems.find(
      (finding) => finding.code === "profile.part-unknown" && finding.params.part === choice.part,
    );
    if (unknown !== undefined) return { ok: false, finding: unknown };
  }
  const path = selectionPath(config);
  const content = `${JSON.stringify(next.value, null, 2)}\n`;
  return {
    ok: true,
    value: { schemaVersion: PLAN_SCHEMA_VERSION, operations: [{ kind: "write", path, before, content }] },
  };
};
