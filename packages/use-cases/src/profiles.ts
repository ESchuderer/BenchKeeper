import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  canonicalJson,
  type Finding,
  type PackSources,
  PLAN_SCHEMA_VERSION,
  type Plan,
  ProfileSelection,
  readDocument,
  type Result,
  SELECTION_SCHEMA_VERSION,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { fetchTree, type Tree } from "@cedarloom/git";
import {
  APP_VERSION,
  DEFAULT_PROFILE,
  type Fetched,
  onDisk,
  planMachine,
  planProject,
  type Probe,
  type Resolved,
  resolveProfile,
  sourceKey,
  sourcesOf,
} from "@cedarloom/profiles";
import { loadRegistry } from "./accounts.ts";
import type { Fetch } from "./extensions.ts";
import { fetchSources, readRecord, writeRecord } from "./sources.ts";
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

// The folders the plan writes into with those no options file may reach, and what CedarLoom last left in the home.
const targetOf = (config: string, state: string, { home, user }: Machine) => {
  const guarded = guardedFolders(config, state, { home, user });
  if (!guarded.ok) return guarded;
  const written = writtenIn(state, home);
  if (!written.ok) return written;
  return { ok: true as const, value: { target: { home, user, guarded: guarded.value }, written: written.value } };
};

// The profile this machine's selection names, resolved.
// A project's probes: whether it has a dev container. No Orca probe runs (see resolveProfile).
const projectProbe = (project: string) => {
  const container = existsSync(join(project, ".devcontainer"));
  return (when: Probe): boolean => (when === "devcontainer" ? container : when === "no-devcontainer" && !container);
};

const selectedProfile = (config: string, project: string | undefined): Result<Resolved> => {
  const read = readSelection(config);
  const probe = project === undefined ? undefined : projectProbe(project);
  return read.ok ? resolveProfile(read.value.selection, APP_VERSION, probe) : read;
};

// What CedarLoom last left at each path of a folder, the Claude Code home or a project, from the run store.
const writtenIn = (state: string, home: string): Result<ReadonlyMap<string, string | null>> =>
  withView(state, (view) => ({ ok: true, value: view?.written(join(home, sep)) ?? new Map<string, string | null>() }));

// Fetches the Git sources the profile needs, in rounds: its packs and the skills' own sources, then each pack's skill
// entry's source once that pack's folder is here, until nothing new comes; then keeps the record of the followed ones.
const fetchAll = async (state: string, resolved: Resolved, fetch: Fetch) => {
  const record = readRecord(state);
  if (!record.ok) return record;
  const fetched = new Map<string, Tree>();
  const entries: PackSources["sources"] = {};
  const findings: Finding[] = [];
  const tried = new Set<string>();
  for (let round = 0; round < 5; round += 1) {
    const missing = sourcesOf(resolved, fetched).filter((source) => !tried.has(sourceKey(source)));
    if (missing.length === 0) break;
    for (const source of missing) tried.add(sourceKey(source));
    const got = await fetchSources(state, missing, fetch, record.value);
    if (!got.ok) return got;
    for (const [key, tree] of got.value.trees) fetched.set(key, tree);
    Object.assign(entries, got.value.entries);
    findings.push(...got.value.findings);
  }
  if (canonicalJson(entries) !== canonicalJson(record.value)) writeRecord(state, entries);
  return { ok: true as const, value: { fetched, findings } };
};

/**
 * Plans the selected profile's machine level; a profile with problems gets no plan, only its findings. A plugin part
 * is planned only when `allow` names it. Git sources are fetched first, through `fetch`.
 */
/** How a profile plan runs: the parts approved by name, how Git sources are fetched, and the project, if any. */
export type PlanOptions = { allow?: readonly string[]; fetch?: Fetch | undefined; project?: string | undefined };

// The plan of the machine level, or of the project's level when there is one.
const levelOf = (
  config: string,
  state: string,
  machine: Machine,
  given: {
    resolved: Resolved;
    project?: string | undefined;
    options: { approved: ReadonlySet<string>; fetched: Fetched };
  },
) => {
  const { resolved, project, options } = given;
  if (project !== undefined) {
    const written = writtenIn(state, project);
    return written.ok ? planProject(resolved, project, written.value, options) : written;
  }
  const where = targetOf(config, state, machine);
  return where.ok ? planMachine(resolved, where.value.target, where.value.written, options) : where;
};

export const planProfile = async (
  config: string,
  state: string,
  machine: Machine,
  { allow = [], fetch = fetchTree, project }: PlanOptions = {},
): Promise<Result<ProfilePlan>> => {
  const folder = project === undefined ? undefined : onDisk(resolve(project));
  const resolved = selectedProfile(config, folder);
  if (!resolved.ok) return resolved;
  if (resolved.value.problems.length > 0) {
    return { ok: true, value: { plan: null, findings: resolved.value.problems } };
  }
  const sources = await fetchAll(state, resolved.value, fetch);
  if (!sources.ok) return sources;
  const options = { approved: new Set(allow), fetched: sources.value.fetched };
  const level = levelOf(config, state, machine, { resolved: resolved.value, project: folder, options });
  if (!level.ok) return level;
  const { operations, findings } = level.value;
  const plan: Plan | null = operations.length === 0 ? null : { schemaVersion: PLAN_SCHEMA_VERSION, operations };
  return { ok: true, value: { plan, findings: [...sources.value.findings, ...findings] } };
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
