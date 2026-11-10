import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  canonicalJson,
  type Finding,
  isTree,
  type Json,
  JsonValue,
  mergeJson,
  type Operation,
  type Result,
} from "@cedarloom/contracts";
import { readOptionalJson } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { folderOffers, type Named, type Offer, offerLine, removalsOf, settingsOffers } from "./drift.ts";
import { type LevelPlan, ownedFiles, type Wanted } from "./owned.ts";
import { type Folder, readEntry, type Resolved } from "./resolve.ts";
import { type Fetched, packFolder, skillFiles } from "./skills.ts";

/** The hub's question rule, a file of the rules folder while a hub part is on. */
export const HUB_RULES = "cedarloom-hub.md";
/**
 * A path as the disk names it: through links and in the case the disk stores, from its nearest existing folder when
 * it is not made yet, so CedarLoom's records of a file always match it.
 */
export const onDisk = (path: string): string => {
  if (existsSync(path)) {
    try {
      return realpathSync.native(path);
    } catch {
      return path;
    }
  }
  return dirname(path) === path ? path : join(onDisk(dirname(path)), basename(path));
};

// The rules folder of a Claude Code home.
const rulesFolder = (home: string): string => join(home, "rules") + sep;

/** A text a part names: a pack's entry, or inline text. */
export type Text = { pack: string; path: string } | { inline: string };
type Rules = { file: string; text: Text; pointer: string; on: boolean };

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// A text with this machine's values filled in; a placeholder left without one stops the plan, named by its pointer.
export const textOf = (
  text: Text,
  { kind, pointer }: { kind: "rules" | "template"; pointer: string },
  resolved: Resolved,
  fetched: Fetched,
): Result<string> => {
  const { hub } = resolved;
  const read: Result<string> =
    "inline" in text
      ? { ok: true, value: text.inline }
      : readEntry(text, kind, packFolder(resolved, text.pack, fetched));
  if (!read.ok) return read;
  const filled = hub === undefined ? read.value : read.value.replaceAll("{{hub}}", hub);
  // A placeholder's name form only, so a quoted GitHub Actions expression such as `${{ github.sha }}` stays text.
  const left = /\{\{([a-z][a-z0-9-]{0,39})\}\}/.exec(filled)?.[1];
  if (left === undefined) return { ok: true, value: filled };
  return refuse({ code: "profile.placeholder-unknown", params: { at: pointer, placeholder: left } });
};

// Every rules file the profile names, on or off: each rules part's, and the hub's question rule.
const rulesOf = ({ profile, on }: Resolved): Rules[] => [
  ...Object.entries(profile.machine).flatMap(([id, part]) =>
    part.type === "rules"
      ? [{ file: part.file, text: part.text, pointer: `/machine/${id}/text`, on: on.has(`machine.${id}`) }]
      : [],
  ),
  ...Object.entries(profile.workspace).flatMap(([id, part]) =>
    part.type === "hub" && part.rules !== undefined
      ? [{ file: HUB_RULES, text: part.rules, pointer: `/workspace/${id}/rules`, on: on.has(`workspace.${id}`) }]
      : [],
  ),
];

// Each on rules part's file and text, and the files of parts that are off; of two on one file, the later's text wins.
const rulesFiles = (resolved: Resolved, home: string, fetched: Fetched) => {
  const folder = rulesFolder(home);
  const files = rulesOf(resolved).map((each): [string, Rules] => [join(folder, each.file), each]);
  const wanted = new Map<string, Wanted>();
  for (const [path, each] of files.filter(([, rule]) => rule.on)) {
    const content = textOf(each.text, { kind: "rules", pointer: each.pointer }, resolved, fetched);
    if (!content.ok) return content;
    wanted.set(path, { content: content.value });
  }
  const off = files.map(([path]) => path).filter((path) => !wanted.has(path));
  return { ok: true as const, value: { wanted, off } };
};

/** A settings object with its text's hash; none yet is empty, and a file that is no JSON object is never rewritten. */
export const readSettings = (path: string): Result<{ json: Json; before: string | null }> => {
  const file = readOptionalJson(path);
  if (!file.ok) {
    if (file.finding.code !== "document.invalid") return file;
    return refuse({ code: "document.unreadable", params: { path, error: "not JSON" } });
  }
  if (file.value === null) return { ok: true, value: { json: {}, before: null } };
  const read = JsonValue.safeParse(file.value.json);
  if (!read.success || typeof read.data !== "object" || read.data === null || Array.isArray(read.data)) {
    return refuse({ code: "document.unreadable", params: { path, error: "not a JSON object" } });
  }
  return { ok: true, value: { json: read.data, before: sha256(file.value.text) } };
};

// A settings file's write when merging changes it, and the merged value.
// shortcut: written back as two-space JSON in key order, comments refused; keep formats once owners keep their own.
export const fileWrite = (
  path: string,
  merge: (json: Json) => Json,
): Result<{ operations: Operation[]; merged: Json }> => {
  const current = readSettings(path);
  if (!current.ok) return current;
  const { json, before } = current.value;
  const merged = merge(json);
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const same = canonicalJson(merged) === canonicalJson(json);
  return { ok: true, value: { operations: same ? [] : [{ kind: "write", path, before, content }], merged } };
};
/** The sets merged into a settings value in order: objects key by key, lists grown by the entries they lack. */
export const mergeSets = (json: Json, sets: readonly Json[]): Json =>
  sets.reduce((value: Json, set) => mergeJson(value, set, "", () => undefined), json);

type Plugin = Extract<Resolved["profile"]["machine"][string], { type: "plugin" }>;
/** What a plugin part of either level declares in a settings file. */
export type Declared = Pick<Plugin, "plugin" | "marketplace">;

// Its marketplace and the plugin switched on: https://code.claude.com/docs/en/settings-reference#extraknownmarketplaces
const pluginSet = ({ plugin, marketplace }: Declared): Json => {
  const enabledPlugins = { [plugin]: true };
  if (marketplace === undefined) return { enabledPlugins };
  const { name, ref, autoUpdate } = marketplace;
  const where =
    "github" in marketplace ? { source: "github", repo: marketplace.github } : { source: "git", url: marketplace.git };
  const source = ref === undefined ? where : { ...where, ref };
  return {
    extraKnownMarketplaces: { [name]: autoUpdate === undefined ? { source } : { source, autoUpdate } },
    enabledPlugins,
  };
};

// The plugins merged into the settings; a marketplace entry is replaced whole, as Claude Code reads it whole.
export const withPlugins = (json: Json, plugins: readonly Declared[]): Json => {
  const names = new Set(plugins.flatMap(({ marketplace }) => (marketplace === undefined ? [] : [marketplace.name])));
  const known = isTree(json) ? json["extraKnownMarketplaces"] : undefined;
  const kept = isTree(known) ? Object.fromEntries(Object.entries(known).filter(([name]) => !names.has(name))) : known;
  const base = isTree(json) && kept !== undefined ? { ...json, extraKnownMarketplaces: kept } : json;
  return mergeSets(
    base,
    plugins.map((plugin) => pluginSet(plugin)),
  );
};

/** The folders a plan writes into: the Claude Code home, the user's home, and the folders no options file may reach. */
export interface Target {
  readonly home: string;
  readonly user: string;
  readonly guarded: readonly string[];
}

/** Whether a path lies in a folder or is it, through links and as the disk names both. */
export const within = (path: string, root: string): boolean => {
  const way = relative(onDisk(root), onDisk(path));
  return way === "" || !(way === ".." || way.startsWith(`..${sep}`) || isAbsolute(way));
};

// Each options file of the plugins, their sets merged in profile order; never one inside a guarded folder.
const optionsWrites = (plugins: [string, Plugin][], target: Target): Result<Operation[]> => {
  const files = new Map<string, { part: string; sets: Json[] }>();
  for (const [id, { options }] of plugins) {
    if (options === undefined) continue;
    const path = join(target.user, options.file);
    const file = files.get(path) ?? { part: `machine.${id}`, sets: [] };
    files.set(path, { ...file, sets: [...file.sets, options.set] });
  }
  const operations: Operation[] = [];
  for (const [path, { part, sets }] of files) {
    if (target.guarded.some((root) => within(path, root))) {
      return refuse({ code: "profile.options-guarded", params: { part, path } });
    }
    const write = fileWrite(path, (json) => mergeSets(json, sets));
    if (!write.ok) return write;
    operations.push(...write.value.operations);
  }
  return { ok: true, value: operations };
};

// A marketplace's repository: `owner/repo` on GitHub, else its Git URL.
const repository = (marketplace: NonNullable<Plugin["marketplace"]>): string =>
  "github" in marketplace ? marketplace.github : marketplace.git;

// A named line, never preselected (owner, hub issue 130), as its plugin's hooks, MCP servers and commands run in every session.
export const waiting = <P extends Declared>(
  { level, project }: { level: "machine" | "project"; project: string | null },
  plugins: readonly [string, P][],
  settings: Json,
  changes: (plugin: P) => boolean = () => false,
): Finding[] =>
  plugins
    .filter(
      ([, plugin]) => canonicalJson(withPlugins(settings, [plugin])) !== canonicalJson(settings) || changes(plugin),
    )
    .map(([id, { plugin, marketplace }]): Finding => {
      const source = marketplace === undefined ? null : repository(marketplace);
      const params = { ref: marketplace?.ref ?? null, autoUpdate: marketplace?.autoUpdate === true, project };
      return { code: "profile.approval-needed", params: { part: `${level}.${id}`, plugin, source, ...params } };
    });

// Whether a plugin's options would change its options file.
const optionsChange =
  (target: Target) =>
  ({ options }: Plugin): boolean => {
    if (options === undefined) return false;
    const write = fileWrite(join(target.user, options.file), (json) => mergeSets(json, [options.set]));
    return !write.ok || write.value.operations.length > 0;
  };

type Removed = { plugins: readonly string[]; marketplaces: readonly string[] };
// The settings without the plugins and marketplaces whose removal the run names.
const without = (json: Json, { plugins, marketplaces }: Removed): Json => {
  if (!isTree(json)) return json;
  const drop = (key: string, names: readonly string[]) => {
    const value = json[key];
    return isTree(value)
      ? { [key]: Object.fromEntries(Object.entries(value).filter(([name]) => !names.includes(name))) }
      : {};
  };
  return { ...json, ...drop("enabledPlugins", plugins), ...drop("extraKnownMarketplaces", marketplaces) };
};

// Settings parts set no plugin key (the profile's allow list), so their order before the plugin parts changes nothing.
const settingsPlan = (
  { profile, on }: Resolved,
  target: Target,
  { approved, removed }: { approved: ReadonlySet<string>; removed: Removed },
): Result<LevelPlan> => {
  const parts = Object.entries(profile.machine).filter(([id]) => on.has(`machine.${id}`));
  const sets = parts.flatMap(([, part]) => (part.type === "settings" ? [part.set] : []));
  const plugins = parts.flatMap(([id, part]): [string, Plugin][] => (part.type === "plugin" ? [[id, part]] : []));
  const allowed = plugins.filter(([id]) => approved.has(`machine.${id}`));
  const changes = sets.length + plugins.length + removed.plugins.length + removed.marketplaces.length;
  if (changes === 0) return { ok: true, value: { operations: [], findings: [] } };
  const settings = fileWrite(join(target.home, "settings.json"), (json) =>
    withPlugins(
      mergeSets(without(json, removed), sets),
      allowed.map(([, plugin]) => plugin),
    ),
  );
  if (!settings.ok) return settings;
  const options = optionsWrites(allowed, target);
  if (!options.ok) return options;
  const others = plugins.filter(([id]) => !approved.has(`machine.${id}`));
  const operations = [...settings.value.operations, ...options.value];
  const findings = waiting({ level: "machine", project: null }, others, settings.value.merged, optionsChange(target));
  return { ok: true, value: { operations, findings } };
};

// The home's own files: on rules parts' and skills', and those of parts now off or dropped; `mine` gets no removal.
const ownedOf = (resolved: Resolved, home: string, fetched: Fetched, written: ReadonlyMap<string, string | null>) => {
  const rules = rulesFiles(resolved, home, fetched);
  if (!rules.ok) return rules;
  const skills = skillFiles(resolved, home, { fetched, written, level: "machine" });
  if (!skills.ok) return skills;
  const wanted = new Map([...rules.value.wanted, ...skills.value.wanted]);
  const files = ownedFiles(wanted, [...rules.value.off, ...skills.value.stale], written);
  if (!files.ok) return files;
  const mine = new Set([...wanted.keys(), ...rules.value.off, ...skills.value.stale]);
  return { ok: true as const, value: { ...files.value, mine } };
};

// What the home holds that no on part names, each removal offered, none preselected (owner, PF4).
const offersOf = (
  { profile, on }: Resolved,
  home: string,
  owned: { mine: ReadonlySet<string>; removing: string[] },
): Offer[] => {
  // Settings the plan cannot read offer nothing; a part that writes them reports why.
  const settings = readSettings(join(home, "settings.json"));
  const json = settings.ok ? settings.value.json : {};
  const parts = Object.entries(profile.machine).flatMap(([id, part]): [boolean, Plugin][] =>
    part.type === "plugin" ? [[on.has(`machine.${id}`), part]] : [],
  );
  const names = (pick: (plugin: Plugin) => string | undefined, state: boolean) =>
    new Set(parts.flatMap(([isOn, part]) => (isOn === state ? [pick(part) ?? ""] : [])));
  const named = (pick: (plugin: Plugin) => string | undefined): Named => ({
    on: names(pick, true),
    off: names(pick, false),
  });
  const plugins = named((plugin) => plugin.plugin);
  const marketplaces = named((plugin) => plugin.marketplace?.name);
  return [...settingsOffers(json, { plugins, marketplaces }, owned.removing), ...folderOffers(home, owned.mine)];
};

/** Each --allow that names no part of `type` at `level` in the profile, so a typo never passes as an approval. */
export const unknownApprovals = (
  { profile }: Resolved,
  approved: ReadonlySet<string>,
  level: "machine" | "project",
  types: readonly string[],
): Finding[] =>
  [...approved]
    .filter((part) => {
      const type = part.startsWith(`${level}.`) ? profile[level][part.slice(level.length + 1)]?.type : undefined;
      return type === undefined || !types.includes(type);
    })
    .map((part) => ({ code: "profile.part-unknown", params: { part, by: "--allow" } }));

/**
 * The machine level for one Claude Code home: each rules part as a file of its rules folder, the hub's question rule
 * with `{{hub}}` filled, the settings parts and the plugin parts `approved` names merged into its settings file, and
 * those plugins' options files. `written` holds what CedarLoom last left at each path of the rules folder (the run
 * store's `written`), which tells its own files from the owner's.
 */
export const planMachine = (
  resolved: Resolved,
  target: Target,
  written: ReadonlyMap<string, string | null>,
  {
    approved = new Set<string>(),
    fetched = new Map<string, Folder>(),
    remove = [],
  }: { approved?: ReadonlySet<string>; fetched?: Fetched; remove?: readonly string[] } = {},
): Result<LevelPlan> => {
  const unknown = unknownApprovals(resolved, approved, "machine", ["plugin"]);
  if (unknown.length > 0) return { ok: true, value: { operations: [], findings: unknown } };
  const owned = ownedOf(resolved, target.home, fetched, written);
  if (!owned.ok) return owned;
  const items = [...new Set(remove)];
  const offers = offersOf(resolved, target.home, { mine: owned.value.mine, removing: items });
  const stray = items.find((item) => !offers.some((each) => each.item === item));
  if (stray !== undefined) return refuse({ code: "profile.remove-unknown", params: { item: stray } });
  const removals = removalsOf(target.home, items);
  if (!removals.ok) return removals;
  const settings = settingsPlan(resolved, target, { approved, removed: removals.value });
  if (!settings.ok) return settings;
  const operations = [...owned.value.operations, ...removals.value.files, ...settings.value.operations];
  const offered = offers.filter(({ item }) => !remove.includes(item)).map((each) => offerLine(each));
  const findings = [...owned.value.findings, ...settings.value.findings, ...offered];
  return { ok: true, value: { operations, findings } };
};
