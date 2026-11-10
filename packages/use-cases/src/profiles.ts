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
  type ProfilePart,
  ProfileSelection,
  readDocument,
  type Result,
  SELECTION_SCHEMA_VERSION,
  severityOf,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { fetchTree, type Tree } from "@cedarloom/git";
import { programFound } from "@cedarloom/extension-host";
import {
  APP_VERSION,
  DEFAULT_PROFILE,
  type Fetched,
  hasContainer,
  type Level,
  LEVELS,
  onDisk,
  planMachine,
  planProject,
  projectWritten,
  type Probe,
  type Resolved,
  resolveProfile,
  sourceKey,
  sourcesOf,
  usesMantine,
} from "@cedarloom/profiles";
import { bundledExtensions } from "./bundled.ts";
import type { Fetch } from "./extensions.ts";
import { type ApplyTemplate, devcontainerCli, templatesOf } from "./devcontainer.ts";
import { fetchSources, readRecord, writeRecord } from "./sources.ts";
import { readOptionalJson, withView } from "./use-cases.ts";

/**
 * The Claude Code home the machine level writes: `CLAUDE_CONFIG_DIR`, else `~/.claude`
 * (https://code.claude.com/docs/en/env-vars).
 */
// A tool's home: the folder its variable names, else its dot folder in the user's home.
const homeOf = (env: Readonly<Record<string, string | undefined>>, variable: string, folder: string): string =>
  onDisk(resolve(env[variable] || join(homedir(), folder)));

export const claudeHome = (env: Readonly<Record<string, string | undefined>>): string =>
  homeOf(env, "CLAUDE_CONFIG_DIR", ".claude");

/** Codex's home, where it keeps its copies of the plugins it added: CODEX_HOME, else ~/.codex. */
export const codexHome = (env: Readonly<Record<string, string | undefined>>): string =>
  homeOf(env, "CODEX_HOME", ".codex");

export const selectionPath = (config: string): string => join(config, "profile.json");

export const readSelection = (
  config: string,
): Result<{ selection: ProfileSelection | null; before: string | null }> => {
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

// The folders the plan writes into with those no options file may reach, and what CedarLoom last left in the home.
const targetOf = (config: string, state: string, { home, user }: Machine) => {
  const written = writtenIn(state, home);
  if (!written.ok) return written;
  const guarded = [home, join(user, ".claude"), config, state];
  return { ok: true as const, value: { target: { home, user, guarded }, written: written.value } };
};

// Orca is here when its extension is on and host/exec finds its program; unreadable components count as not here.
const orcaHere = (app: string | undefined, config: string): boolean => {
  const bundled = app === undefined ? undefined : bundledExtensions(app, config);
  const orca = bundled?.ok === true ? bundled.value.find(({ id }) => id === "cedarloom.orca") : undefined;
  return orca !== undefined && orca.state !== "off" && programFound(orca.manifest, "orca");
};

// The probes, each asked once and only by a part that needs it: Orca, whether the project has a dev container and
// whether it uses Mantine.
const probeOf = (app: string | undefined, config: string, project: string | undefined) => {
  const container = project !== undefined && hasContainer(project);
  let orca: boolean | undefined;
  let mantine: boolean | undefined;
  return (when: Probe): boolean => {
    if (when === "orca") return (orca ??= orcaHere(app, config));
    if (when === "mantine") return project !== undefined && (mantine ??= usesMantine(project));
    return project !== undefined && (when === "devcontainer" ? container : when === "no-devcontainer" && !container);
  };
};

/** The profile this machine's selection names, resolved. */
export const selectedProfile = (
  config: string,
  app: string | undefined,
  project: string | undefined,
): Result<Resolved> => {
  const read = readSelection(config);
  return read.ok ? resolveProfile(read.value.selection, APP_VERSION, probeOf(app, config, project)) : read;
};

// What CedarLoom last left at each path of a folder, the Claude Code home or a project, from the run store.
const writtenIn = (state: string, home: string): Result<ReadonlyMap<string, string | null>> =>
  withView(state, (view) => ({ ok: true, value: view?.written(join(home, sep)) ?? new Map<string, string | null>() }));

// Fetches the level's packs and skill sources and keeps both levels' records, so no wait restarts; a check only reads.
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
 * How a profile plan runs: the parts approved by name, the app's folder of its own extensions (without it no Orca is
 * found), how Git sources are fetched, the project, if any, and how a dev container part's Template is applied.
 */
export type PlanOptions = {
  allow?: readonly string[];
  app?: string | undefined;
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
  // At the user's home, the project's `.claude/` and `.codex/` files are the tools' user config, which no profile writes.
  if (project !== undefined && project === onDisk(machine.user)) {
    const home: Finding = { code: "profile.project-is-home", params: { project } };
    return { ok: false as const, finding: home };
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
  const { allow, app, fetch, project, template, remove, readOnly } = withDefaults(options);
  const where = folderOf(project);
  if (!where.ok) return where;
  const folder = where.value;
  const resolved = selectedProfile(config, app, folder);
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
  // A part of this level selected on that stays off without Orca.
  const unmet = resolved.value.unmet
    .filter((part) => part.startsWith("project.") === (folder !== undefined))
    .map((part): Finding => ({ code: "profile.when-unmet", params: { part, when: "orca" } }));
  const plan: Plan | null = operations.length === 0 ? null : { schemaVersion: PLAN_SCHEMA_VERSION, operations };
  return { ok: true, value: { plan, findings: [...sources.value.findings, ...findings, ...unmet] } };
};

// What CedarLoom last left in a level's folder: the run store's record, with a project's committed one.
const writtenAt = (state: string, level: string, project: boolean): Result<ReadonlyMap<string, string | null>> => {
  const stored = writtenIn(state, level);
  return stored.ok && project ? projectWritten(level, stored.value) : stored;
};

// A drift line for the next apply's operation: a write over a changed or outdated file, or a delete of a part now off.
const driftOf = (operation: Operation, written: ReadonlyMap<string, string | null>): Finding[] => {
  if (!("path" in operation)) return [];
  const own = operation.before !== null && written.get(operation.path) === operation.before;
  const write = own ? "outdated" : "missing";
  const status = operation.kind === "delete" ? "deselected-present" : write;
  return [{ code: "profile.drift", params: { status, subject: operation.path, remove: null } }];
};

// The level's plan, read only, with its drift lines in place of its findings (see checkProfile).
const driftPlan = async (
  config: string,
  state: string,
  machine: Machine,
  { app, fetch, project }: Pick<PlanOptions, "app" | "fetch" | "project">,
): Promise<Result<ProfilePlan>> => {
  const planned = await planProfile(config, state, machine, { app, fetch, project, readOnly: true });
  const level = project === undefined ? machine.home : onDisk(resolve(project));
  if (!planned.ok && planned.finding.code.startsWith("git.")) {
    const params = { status: "not-run" as const, subject: level, remove: null };
    return { ok: true, value: { plan: null, findings: [{ code: "profile.drift", params }, planned.finding] } };
  }
  if (!planned.ok) return planned;
  const written = writtenAt(state, level, project !== undefined);
  if (!written.ok) return written;
  const { plan, findings } = planned.value;
  const lines = (plan?.operations ?? []).flatMap((operation) => driftOf(operation, written.value));
  return { ok: true, value: { plan, findings: [...lines, ...findings] } };
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
  options: Pick<PlanOptions, "app" | "fetch" | "project"> = {},
): Promise<Result<Finding[]>> => {
  const checked = await driftPlan(config, state, machine, options);
  return checked.ok ? { ok: true, value: checked.value.findings } : checked;
};

/** Whether a plan's lines hold it back: any error, which `profiles apply` refuses. */
export const heldBack = (findings: readonly Finding[]): boolean =>
  findings.some((finding) => severityOf(finding) === "error");

/**
 * The Profile view, read only: the selected profile's parts, each on or off at this machine's level, with the probe of
 * an auto part the selection leaves to it; and the machine level's plan with its drift lines, and whether they hold it
 * back.
 */
export const showProfile = async (
  config: string,
  state: string,
  machine: Machine,
  options: Pick<PlanOptions, "app" | "fetch"> = {},
): Promise<Result<ProfilePlan & { parts: ProfilePart[]; held: boolean }>> => {
  const read = readSelection(config);
  if (!read.ok) return read;
  const resolved = resolveProfile(read.value.selection, APP_VERSION, probeOf(options.app, config, undefined));
  if (!resolved.ok) return resolved;
  const { profile, on } = resolved.value;
  const select = read.value.selection?.select ?? {};
  const parts = LEVELS.flatMap((level) =>
    Object.entries(profile[level]).map(([name, part]): ProfilePart => {
      const id = `${level}.${name}`;
      const left = part.default === "auto" && select[id] === undefined;
      const when = left ? (part.when ?? null) : null;
      return { id, level, title: part.title, description: part.description ?? null, on: on.has(id), when };
    }),
  );
  const planned = await driftPlan(config, state, machine, options);
  if (!planned.ok) return planned;
  return { ok: true, value: { ...planned.value, parts, held: heldBack(planned.value.findings) } };
};

/**
 * The machine's drift for the doctor, once this machine has chosen a profile, none before; a Git source it could not
 * fetch is its `not-run` line alone, as being offline is no problem of the machine.
 */
export const profileDoctor = async (
  config: string,
  state: string,
  machine: Machine,
  { app, fetch }: Pick<PlanOptions, "app" | "fetch"> = {},
) => {
  if (!existsSync(selectionPath(config))) return [];
  const checked = await checkProfile(config, state, machine, { app, fetch });
  return checked.ok ? checked.value.filter(({ code }) => !code.startsWith("git.")) : [checked.finding];
};

/**
 * One change of the selection: a part on, off or back to its default (null), one of this machine's bindings, or the
 * profile file it applies, by its absolute path.
 */
export type Choice =
  | { readonly part: string; readonly on: boolean | null }
  | { readonly hub: string }
  | { readonly memory: string }
  | { readonly gates: string }
  | { readonly file: string };

const chosen = (current: ProfileSelection, choice: Choice): unknown => {
  if ("file" in choice) return { ...current, profile: { file: choice.file } };
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
