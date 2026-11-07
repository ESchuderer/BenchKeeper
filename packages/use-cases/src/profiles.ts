import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import {
  canonicalJson,
  type Finding,
  type Operation,
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
  hasContainer,
  type Level,
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
import { type ApplyTemplate, devcontainerCli, templatesOf } from "./devcontainer.ts";
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
  const container = hasContainer(project);
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

// Fetches the Git sources the level needs: the profile's packs and the level's skills' own sources, then each pack's
// skill entry's source once that pack's folder is here; then keeps the record of the followed ones, and of the other
// level's, so neither level's wait starts over.
// A check only reads: it keeps the record as it is.
const fetchAll = async (
  state: string,
  resolved: Resolved,
  fetch: Fetch,
  { project, readOnly }: { project: boolean; readOnly: boolean },
) => {
  const level: Level = project ? "project" : "machine";
  const record = readRecord(state);
  if (!record.ok) return record;
  const fetched = new Map<string, Tree>();
  const entries: PackSources["sources"] = {};
  const findings: Finding[] = [];
  // Two passes reach every source: a pack's skill entry names its own source, never another pack.
  for (let pass = 0; pass < 2; pass += 1) {
    const missing = sourcesOf(resolved, fetched, level).filter(({ source }) => !fetched.has(sourceKey(source)));
    const got = await fetchSources(state, missing, fetch, record.value);
    if (!got.ok) return got;
    for (const [key, tree] of got.value.trees) fetched.set(key, tree);
    Object.assign(entries, got.value.entries);
    findings.push(...got.value.findings);
  }
  // A project's skills are kept on or off, as another project's probes may switch them on.
  const other = [
    ...sourcesOf(resolved, fetched, "project", true),
    ...(project ? sourcesOf(resolved, fetched, "machine") : []),
  ];
  const keys = new Set(other.map(({ source }) => sourceKey(source)));
  const next = { ...Object.fromEntries(Object.entries(record.value).filter(([key]) => keys.has(key))), ...entries };
  if (!readOnly && canonicalJson(next) !== canonicalJson(record.value)) writeRecord(state, next);
  return { ok: true as const, value: { fetched, findings } };
};

/**
 * How a profile plan runs: the parts approved by name, how Git sources are fetched, the project, if any, and how a dev
 * container part's Template is applied.
 */
export type PlanOptions = {
  allow?: readonly string[];
  fetch?: Fetch | undefined;
  project?: string | undefined;
  template?: ApplyTemplate | undefined;
  /** The offered removals the run takes, by item (`plugin:<id>`, `rules:<file>`…); the machine level offers them. */
  remove?: readonly string[];
  /** A check: nothing is written, the record of followed sources included. */
  readOnly?: boolean;
};

// A project's level, with its dev container parts' Templates applied first.
const projectLevel = async (state: string, project: string, given: Given, apply: ApplyTemplate) => {
  const { approved } = given.options;
  const { templates, findings } = await templatesOf(state, given.resolved, { project, approved, apply });
  const written = writtenIn(state, project);
  if (!written.ok) return written;
  const level = planProject(given.resolved, project, written.value, { ...given.options, templates });
  return level.ok
    ? { ok: true as const, value: { ...level.value, findings: [...findings, ...level.value.findings] } }
    : level;
};

type Given = {
  resolved: Resolved;
  project?: string | undefined;
  options: { approved: ReadonlySet<string>; fetched: Fetched; remove: readonly string[] };
};
// The plan of the machine level, or of the project's level when there is one.
const levelOf = async (
  config: string,
  state: string,
  machine: Machine,
  given: Given & { apply: ApplyTemplate | undefined },
) => {
  const { resolved, project, options } = given;
  // A project's level offers no removal.
  const [stray] = project === undefined ? [] : options.remove;
  if (stray !== undefined) {
    const unknown: Finding = { code: "profile.remove-unknown", params: { item: stray } };
    return { ok: false as const, finding: unknown };
  }
  if (project !== undefined) return projectLevel(state, project, given, given.apply ?? devcontainerCli);
  const where = targetOf(config, state, machine);
  return where.ok ? planMachine(resolved, where.value.target, where.value.written, options) : where;
};

// The project's folder as the disk names it; one that is no folder is refused, rather than made by the plan.
const folderOf = (project: string | undefined): Result<string | undefined> => {
  const folder = project === undefined ? undefined : onDisk(resolve(project));
  if (folder === undefined || statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true) {
    return { ok: true, value: folder };
  }
  return { ok: false, finding: { code: "document.unreadable", params: { path: folder, error: "not a folder" } } };
};

// A run's options with their defaults: nothing approved or removed, Git fetched by the git package, files written.
const withDefaults = ({ allow = [], fetch = fetchTree, remove = [], readOnly = false, ...rest }: PlanOptions) => ({
  ...rest,
  allow,
  fetch,
  remove,
  readOnly,
});

/**
 * Plans the selected profile's machine level, or with `project` that project's level; a profile with problems gets no
 * plan, only its findings. A plugin or files part that may run code is planned only when `allow` names it. Git sources
 * are fetched first, through `fetch`.
 */
export const planProfile = async (
  config: string,
  state: string,
  machine: Machine,
  options: PlanOptions = {},
): Promise<Result<ProfilePlan>> => {
  const { allow, fetch, project, template, remove, readOnly } = withDefaults(options);
  const where = folderOf(project);
  if (!where.ok) return where;
  const folder = where.value;
  const resolved = selectedProfile(config, folder);
  if (!resolved.ok) return resolved;
  if (resolved.value.problems.length > 0) {
    return { ok: true, value: { plan: null, findings: resolved.value.problems } };
  }
  const sources = await fetchAll(state, resolved.value, fetch, {
    project: folder !== undefined,
    readOnly,
  });
  if (!sources.ok) return sources;
  const level = await levelOf(config, state, machine, {
    resolved: resolved.value,
    project: folder,
    options: { approved: new Set(allow), fetched: sources.value.fetched, remove },
    apply: template,
  });
  if (!level.ok) return level;
  const { operations, findings } = level.value;
  const plan: Plan | null = operations.length === 0 ? null : { schemaVersion: PLAN_SCHEMA_VERSION, operations };
  return { ok: true, value: { plan, findings: [...sources.value.findings, ...findings] } };
};

// A drift line about an operation the next apply would run: a write where the file lacks the profile's text, or over
// CedarLoom's own last text (outdated), or a delete of a file whose part is off.
const driftOf = (operation: Operation, written: ReadonlyMap<string, string | null>): Finding[] => {
  if (!("path" in operation)) return [];
  const own = operation.before !== null && written.get(operation.path) === operation.before;
  const write = own ? "outdated" : "missing";
  const status = operation.kind === "delete" ? "deselected-present" : write;
  return [{ code: "profile.drift", params: { status, subject: operation.path, remove: null } }];
};

/**
 * The drift of the machine level, or with `project` that project's level, read only (plan section 2.9): a line for
 * each write or delete the next apply would run, and the plan's own lines (an owner's change, a waiting approval or
 * commit, an offered removal); `not-run` when a Git source could not be fetched. None: the level is as the profile
 * wants it.
 */
export const checkProfile = async (
  config: string,
  state: string,
  machine: Machine,
  { fetch, project }: Pick<PlanOptions, "fetch" | "project"> = {},
): Promise<Result<Finding[]>> => {
  const planned = await planProfile(config, state, machine, { fetch, project, readOnly: true });
  const level = project === undefined ? machine.home : onDisk(resolve(project));
  if (!planned.ok && planned.finding.code.startsWith("git.")) {
    const params = { status: "not-run" as const, subject: level, remove: null };
    return { ok: true, value: [{ code: "profile.drift", params }, planned.finding] };
  }
  if (!planned.ok) return planned;
  const written = writtenIn(state, level);
  if (!written.ok) return written;
  const lines = (planned.value.plan?.operations ?? []).flatMap((operation) => driftOf(operation, written.value));
  return { ok: true, value: [...lines, ...planned.value.findings] };
};

/**
 * The machine's drift for the doctor, once this machine has chosen a profile, none before; a Git source it could not
 * fetch is its `not-run` line alone, as being offline is no problem of the machine.
 */
export const profileDoctor = async (config: string, state: string, machine: Machine, fetch?: Fetch) => {
  if (!existsSync(selectionPath(config))) return [];
  const checked = await checkProfile(config, state, machine, { fetch });
  return checked.ok ? checked.value.filter(({ code }) => !code.startsWith("git.")) : [checked.finding];
};

/** One change of the selection: a part on, off or back to its default (null), or one of this machine's bindings. */
export type Choice =
  | { readonly part: string; readonly on: boolean | null }
  | { readonly hub: string }
  | { readonly gates: string };

const chosen = (current: ProfileSelection, choice: Choice): unknown => {
  if (!("part" in choice)) return { ...current, bindings: { ...current.bindings, ...choice } };
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
