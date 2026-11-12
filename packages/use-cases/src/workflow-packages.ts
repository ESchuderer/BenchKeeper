import { accessSync, constants, readdirSync, realpathSync, rmdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  type AutomationLevel,
  type Finding,
  isTree,
  type Json,
  type Operation,
  PLAN_SCHEMA_VERSION,
  type Plan,
  type Result,
  semverAbove,
  WORKFLOW_MARKETPLACE,
  type WorkflowDefinition,
} from "@cedarloom/contracts";
import { buildPackage, builtFrom, type PackageFile, pluginOf } from "@cedarloom/emitter";
import { hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { programPath } from "@cedarloom/orchestration";
import { APP_VERSION, fileWrite, mergeSets } from "@cedarloom/profiles";
import { automationSettings } from "./automation.ts";
import { readSelection } from "./profiles.ts";
import { storedWorkflow } from "./store.ts";
import { readOptionalJson } from "./use-cases.ts";

/** The directory marketplace in CedarLoom's state that serves the installed packages in place to Claude Code and Codex. */
const marketplaceFolder = (state: string): string => join(state, "workflow-packages");

/**
 * The Node.js the hooks run with: the PATH's `node` where it is the running one through a link, as such a link stays put
 * over an upgrade and Homebrew's versioned Cellar folder does not; else the running one.
 */
export const stableNode = (running: string, env: Readonly<Record<string, string | undefined>>): string => {
  const found = programPath("node", env);
  try {
    return found !== undefined && realpathSync(found) === realpathSync(running) ? found : running;
  } catch {
    return running;
  }
};

/** What an install builds with besides the stored workflow: the hooks' bundles, the CLI's to hand in, and their Node.js. */
export type InstallOptions = {
  readonly level?: AutomationLevel | undefined;
  readonly allow?: readonly string[] | undefined;
  readonly bundles: { readonly guard: string; readonly exits: string };
  readonly node: string;
};

/** An install's or an uninstall's plan (null: nothing to change), what holds it back, and where the package lives. */
export type PackagePlan = {
  readonly plan: Plan | null;
  readonly findings: Finding[];
  readonly plugin: string;
  readonly level: AutomationLevel | null;
  readonly marketplace: string;
};

// The plugin as Claude Code names it in `enabledPlugins`, and the folder of its data (`${CLAUDE_PLUGIN_DATA}`).
const idOf = (plugin: string): string => `${plugin}@${WORKFLOW_MARKETPLACE}`;
const dataOf = (home: string, plugin: string): string =>
  join(home, "plugins", "data", `${plugin}-${WORKFLOW_MARKETPLACE}`);

// The plugin folder as Claude Code fills it into a skill, with forward slashes on Windows too (C:/Users/...).
const slashed = (folder: string): string => folder.replaceAll(sep, "/");
// The precheck's inline command as the start skill runs it, its plugin folder filled in by Claude Code.
const precheckRule = (folder: string): string => `Bash(sh "${slashed(folder)}/scripts/precheck.sh")`;
// A step's script as the stage runner's agent runs it, quoted as the runner quotes it.
const quoted = (text: string): string => text.replaceAll("'", `'\\''`);
const stepRule = (folder: string, script: string): string => `Bash(sh '${quoted(`${slashed(folder)}/${script}`)}')`;
// Reads of the package by a step's agent: `//` and the absolute path, on Windows as /c/x (Claude Code's permissions docs).
const readRule = (folder: string): string =>
  `Read(/${slashed(folder).replace(/^([A-Za-z]):/, (_drive, letter: string) => `/${letter.toLowerCase()}`)}/**)`;

// The rule of a script the package runs: the precheck, or a step's.
const scriptRule = (folder: string, path: string): string[] => {
  if (path === "scripts/precheck.sh") return [precheckRule(folder)];
  return /^steps\/[^/]+\/scripts\/run\.sh$/.test(path) ? [stepRule(folder, path)] : [];
};

// A plugin's settings hold no rules: approved scripts run unasked (an agent cannot ask in `claude -p`), later stages ask.
const rulesOf = (plugin: string, folder: string, files: readonly PackageFile[]): Json => {
  const stages = files.flatMap(({ path }) => /^workflows\/(run-[a-z0-9-]+)\.js$/.exec(path)?.slice(1) ?? []);
  const later = stages.filter((stage) => stage !== "run-start").map((stage) => `Workflow(${plugin}:${stage})`);
  const scripts = files.flatMap(({ path }) => scriptRule(folder, path));
  const allow = [`Workflow(${plugin}:run-start)`, readRule(folder), ...scripts];
  return { allow, ...(later.length > 0 ? { ask: later } : {}) };
};

// An object or a list that holds nothing counts as absent, so that taking a package out leaves no empty key behind.
const pruned = (json: Json | undefined): Json | undefined =>
  (Array.isArray(json) && json.length === 0) || (isTree(json) && Object.keys(json).length === 0) ? undefined : json;

// An object with each entry kept, changed or taken out (undefined) by `keep`, then pruned; another value as it is.
const filtered = (json: Json | undefined, keep: (key: string, value: Json) => Json | undefined): Json | undefined => {
  if (!isTree(json)) return json;
  const entries = Object.entries(json).flatMap(([key, value]) => {
    const kept = value === undefined ? undefined : pruned(keep(key, value));
    return kept === undefined ? [] : [[key, kept] as const];
  });
  return pruned(Object.fromEntries(entries));
};

// The settings without a package: its switch and its rules, and the marketplace too once no package is left.
const without = (json: Json, plugin: string, folder: string, last: boolean): Json => {
  if (!isTree(json)) return json;
  const owned = (rule: Json): boolean =>
    typeof rule === "string" &&
    (rule.startsWith(`Workflow(${plugin}:`) ||
      rule === readRule(folder) ||
      rule.startsWith(`Bash(sh "${slashed(folder)}/`) ||
      rule.startsWith(`Bash(sh '${quoted(slashed(folder))}/`));
  return {
    ...json,
    enabledPlugins: filtered(json["enabledPlugins"], (id, on) => (id === idOf(plugin) ? undefined : on)),
    extraKnownMarketplaces: filtered(json["extraKnownMarketplaces"], (name, entry) =>
      last && name === WORKFLOW_MARKETPLACE ? undefined : entry,
    ),
    permissions: filtered(json["permissions"], (key, rules) =>
      Array.isArray(rules) && (key === "allow" || key === "ask") ? rules.filter((rule) => !owned(rule)) : rules,
    ),
  };
};

// A file's write, none when it holds that already.
const writeOf = (path: string, content: string): Operation[] => {
  const before = hashFile(path);
  return before === sha256(content) ? [] : [{ kind: "write", path, before, content }];
};

const deletesOf = (paths: readonly string[]): Operation[] =>
  paths.flatMap((path): Operation[] => {
    const before = hashFile(path);
    return before === null ? [] : [{ kind: "delete", path, before }];
  });

// Every file under a folder, at any depth; none when it is missing.
const filesIn = (folder: string): string[] => {
  try {
    return readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
};

// The marketplace's file with `plugin` added (`description`) or taken out (null), and how many packages it then lists.
const manifestOps = (
  marketplace: string,
  plugin: string,
  description: string | null,
): Result<{ operations: Operation[]; left: number }> => {
  const path = join(marketplace, ".claude-plugin", "marketplace.json");
  const read = readOptionalJson(path);
  if (!read.ok) return read;
  const listed: unknown = Reflect.get(Object(read.value?.json), "plugins");
  const others = (Array.isArray(listed) ? listed : []).flatMap((entry: unknown) => {
    const [name, source, text] = ["name", "source", "description"].map((key) => Reflect.get(Object(entry), key));
    return typeof name === "string" && name !== plugin
      ? [{ name, source: String(source), description: String(text) }]
      : [];
  });
  const plugins = [...others, ...(description === null ? [] : [{ name: plugin, source: `./${plugin}`, description }])];
  if (plugins.length === 0) return { ok: true, value: { operations: deletesOf([path]), left: 0 } };
  const sorted = plugins.toSorted((a, b) => (a.name < b.name ? -1 : 1));
  const manifest = { name: WORKFLOW_MARKETPLACE, owner: { name: "CedarLoom" }, plugins: sorted };
  return {
    ok: true,
    value: { operations: writeOf(path, `${JSON.stringify(manifest, null, 2)}\n`), left: plugins.length },
  };
};

// What a package runs, as its approval lists it: the precheck, then each command step's command.
const commandsOf = (workflow: WorkflowDefinition): string[] => {
  const texts = (type: string, key: string): string[] =>
    workflow.nodes.flatMap((node) => {
      const text = node.with?.[key];
      return node.type === type && typeof text === "string" ? [text] : [];
    });
  return [...texts("trigger.manual", "precheck"), ...texts("command.run", "command")];
};

const planOf = (operations: Operation[]): Plan | null =>
  operations.length === 0 ? null : { schemaVersion: PLAN_SCHEMA_VERSION, operations };

/** Where an install or an uninstall writes: CedarLoom's config and state folders, and the user's Claude Code home. */
export type Folders = { readonly config: string; readonly state: string; readonly home: string };

// This machine's hub and memory repositories, which the guard lets a workflow's agent reach.
const bindingsOf = (config: string): Result<{ hub: string | null; memory: string | null }> => {
  const selection = readSelection(config);
  if (!selection.ok) return selection;
  const { hub = null, memory = null } = selection.value.selection?.bindings ?? {};
  return { ok: true, value: { hub, memory } };
};

// The package at the level asked for, else the default level, with this machine's hub and memory for its guard.
const buildOf = (config: string, workflow: WorkflowDefinition, options: InstallOptions) => {
  const settings = automationSettings(config);
  if (!settings.ok) return settings;
  const bindings = bindingsOf(config);
  if (!bindings.ok) return bindings;
  const level = options.level ?? settings.value?.default ?? "supervised";
  const built = buildPackage(workflow, level, { ...options.bundles, node: options.node, ...bindings.value });
  return built.ok ? { ok: true as const, value: { level, files: built.value } } : built;
};

// The package's files written into its folder, and what an earlier build left there removed.
const filesOps = (folder: string, files: readonly PackageFile[]): Operation[] => {
  const placed = files.map(({ path, content }) => ({ path: join(folder, path), content }));
  const kept = new Set(placed.map(({ path }) => path));
  return [
    ...placed.flatMap(({ path, content }) => writeOf(path, content)),
    ...deletesOf(filesIn(folder).filter((path) => !kept.has(path))),
  ];
};

const descriptionOf = (files: readonly PackageFile[]): string => {
  const manifest = files.find(({ path }) => path === ".claude-plugin/plugin.json")?.content ?? "{}";
  return String(Reflect.get(Object(JSON.parse(manifest)), "description"));
};

// The settings with the package: the marketplace, the plugin switched on, and its rules in place of earlier ones.
const withPackage = (json: Json, { plugin, folder, marketplace }: Place, files: readonly PackageFile[]): Json => {
  const known = { [WORKFLOW_MARKETPLACE]: { source: { source: "directory", path: marketplace } } };
  const set = { extraKnownMarketplaces: known, enabledPlugins: { [idOf(plugin)]: true } };
  return mergeSets(without(json, plugin, folder, false), [{ ...set, permissions: rulesOf(plugin, folder, files) }]);
};

type Place = { readonly plugin: string; readonly folder: string; readonly marketplace: string };

const placeOf = (state: string, id: string): Place => {
  const plugin = pluginOf(id);
  const marketplace = marketplaceFolder(state);
  return { plugin, folder: join(marketplace, plugin), marketplace };
};

// The workflow and level whose package a plugin folder holds, as its manifest names them.
const installedIn = (folder: string): ReturnType<typeof builtFrom> => {
  const read = readOptionalJson(join(folder, ".claude-plugin", "plugin.json"));
  return read.ok ? builtFrom(read.value?.json) : null;
};

// The names of a folder's subfolders; none when it is missing.
const foldersIn = (folder: string): string[] => {
  try {
    return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? [entry.name] : []));
  } catch {
    return [];
  }
};

/** Removes the empty folders under `folder`, and `folder` once empty: a plan deletes files, never their folders. */
export const removeEmptyFolders = (folder: string): void => {
  for (const name of foldersIn(folder)) removeEmptyFolders(join(folder, name));
  try {
    rmdirSync(folder);
  } catch {
    // Not empty, or gone.
  }
};

// Every installed package: its plugin, folder, and the workflow, version and level its manifest names.
const installedPackages = (marketplace: string) =>
  foldersIn(marketplace).map((plugin) => {
    const folder = join(marketplace, plugin);
    const { id = null, level = null, version = null } = installedIn(folder) ?? {};
    return { plugin, folder, id, level, version };
  });

// Every package's guard binds every workflow script's agents, so one below Auto refuses the merges of one at Auto.
const levelsMixed = ({ plugin, marketplace }: Place, id: string, level: AutomationLevel): Finding[] =>
  installedPackages(marketplace).flatMap(({ plugin: name, id: other, level: otherLevel }): Finding[] =>
    name !== plugin && other !== null && otherLevel !== null && (otherLevel === "auto") !== (level === "auto")
      ? [{ code: "package.levels-mixed", params: { id, level, other, otherLevel } }]
      : [],
  );

// Ids that fold to one plugin name (`a_b`, `a-b`) would share its folder and rules: the one installed keeps them.
const takenBy = ({ plugin, folder }: Place, id: string): Result<never> | null => {
  const other = installedIn(folder)?.id;
  if (other === undefined || other.toLowerCase() === id.toLowerCase()) return null;
  return { ok: false, finding: { code: "package.plugin-taken", params: { plugin, id: other } } };
};

/**
 * Plans installing a stored workflow as a package into CedarLoom's marketplace and the user's Claude Code settings, at
 * `level` or the default level; it waits for approval by the plugin's name, as its hooks run in every session.
 */
export const planPackageInstall = (
  { config, state, home }: Folders,
  id: string,
  options: InstallOptions,
): Result<PackagePlan> => {
  const stored = storedWorkflow(state, id);
  if (!stored.ok) return stored;
  const { workflow } = stored.value;
  const { minApp } = workflow.metadata;
  if (minApp !== undefined && semverAbove(minApp, APP_VERSION)) {
    const params = { id: workflow.metadata.id, minApp, app: APP_VERSION };
    return { ok: false, finding: { code: "package.app-too-old", params } };
  }
  const built = buildOf(config, workflow, options);
  if (!built.ok) return built;
  const { level, files } = built.value;
  const place = placeOf(state, workflow.metadata.id);
  const { plugin, folder, marketplace } = place;
  const taken = takenBy(place, workflow.metadata.id);
  if (taken !== null) return taken;
  const manifest = manifestOps(marketplace, plugin, descriptionOf(files));
  if (!manifest.ok) return manifest;
  const user = fileWrite(join(home, "settings.json"), (json) => withPackage(json, place, files));
  if (!user.ok) return user;
  const operations = [...filesOps(folder, files), ...manifest.value.operations, ...user.value.operations];
  const params = { id: workflow.metadata.id, plugin, level, commands: commandsOf(workflow) };
  const approved = options.allow?.includes(plugin) === true;
  const findings: Finding[] = [
    ...(approved ? [] : [{ code: "package.approval-needed" as const, params }]),
    ...levelsMixed(place, workflow.metadata.id, level),
  ];
  return { ok: true, value: { plan: planOf(operations), findings, plugin, level, marketplace } };
};

/** Plans removing an installed package: its files and data folder, its marketplace entry, its settings entries. */
export const planPackageUninstall = ({ state, home }: Omit<Folders, "config">, id: string): Result<PackagePlan> => {
  const place = placeOf(state, id);
  const { plugin, folder, marketplace } = place;
  const installed = filesIn(folder);
  if (installed.length === 0) return { ok: false, finding: { code: "package.not-installed", params: { id } } };
  const taken = takenBy(place, id);
  if (taken !== null) return taken;
  const manifest = manifestOps(marketplace, plugin, null);
  if (!manifest.ok) return manifest;
  const last = manifest.value.left === 0;
  const user = fileWrite(join(home, "settings.json"), (json) => without(json, plugin, folder, last));
  if (!user.ok) return user;
  const operations = [
    ...deletesOf([...installed, ...filesIn(dataOf(home, plugin))]),
    ...manifest.value.operations,
    ...user.value.operations,
  ];
  return { ok: true, value: { plan: planOf(operations), findings: [], plugin, level: null, marketplace } };
};

// Every `command` field in a JSON value, at any depth.
const commandsIn = (json: unknown): string[] => {
  if (Array.isArray(json)) return json.flatMap(commandsIn);
  if (typeof json !== "object" || json === null) return [];
  return Object.entries(json).flatMap(([key, value]) =>
    key === "command" && typeof value === "string" ? [value] : commandsIn(value),
  );
};

// The programs a package's hooks file starts; none when there is no such file.
const hookPrograms = (folder: string): string[] => {
  const read = readOptionalJson(join(folder, "hooks", "claude-code.json"));
  return read.ok ? [...new Set(commandsIn(read.value?.json))] : [];
};

const runnable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

// Whether a folder's copy holds the same files, byte for byte, and no others; a copy it cannot read differs.
const sameFiles = (folder: string, copy: string): boolean => {
  const files = filesIn(folder);
  const same = (path: string): boolean => hashFile(path) === hashFile(join(copy, relative(folder, path)));
  try {
    return files.length === filesIn(copy).length && files.every(same);
  } catch {
    return false;
  }
};

// Codex runs its copy of a package (`codex plugin add`), which a later install leaves behind; nothing while it has none.
const codexDoctor = (installed: ReturnType<typeof installedPackages>, codex: string): Finding[] => {
  const cache = join(codex, "plugins", "cache", WORKFLOW_MARKETPLACE);
  const copied = foldersIn(cache);
  if (copied.length === 0) return [];
  return [
    ...installed.flatMap(({ plugin, folder, id, version }): Finding[] => {
      if (id === null || version === null) return [];
      if (!copied.includes(plugin)) return [{ code: "package.codex-missing", params: { plugin, id } }];
      return sameFiles(folder, join(cache, plugin, version))
        ? []
        : [{ code: "package.codex-stale", params: { plugin, id } }];
    }),
    ...copied
      .filter((plugin) => !installed.some((other) => other.plugin === plugin))
      .map((plugin): Finding => ({ code: "package.codex-left", params: { plugin } })),
  ];
};

/**
 * The doctor's findings on the installed packages: hooks whose Node.js is gone, which refuse every call they guard, and
 * Codex's copies (`codex`: its home) that are missing, stale or left over.
 */
export const packageDoctor = (state: string, codex: string): Finding[] => {
  const installed = installedPackages(marketplaceFolder(state));
  const nodes = installed.flatMap(({ plugin, folder, id, level }) =>
    hookPrograms(folder)
      .filter((path) => !runnable(path))
      .map((path): Finding => ({ code: "package.node-missing", params: { plugin, path, id, level } })),
  );
  return [...nodes, ...codexDoctor(installed, codex)];
};
