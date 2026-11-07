import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  canonicalJson,
  type Finding,
  type Json,
  JsonValue,
  mergeJson,
  type Operation,
  type Result,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { type LevelPlan, ownedFiles, type Wanted } from "./owned.ts";
import { type Folder, jsonFile, readEntry, type Resolved } from "./resolve.ts";
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

type Text = { pack: string; path: string } | { inline: string };
type Rules = { file: string; text: Text; pointer: string; on: boolean };

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// The text with this machine's values filled in; a placeholder left without one stops the plan.
const textOf = ({ text, pointer }: Rules, resolved: Resolved, fetched: Fetched): Result<string> => {
  const { hub } = resolved;
  const read: Result<string> =
    "inline" in text
      ? { ok: true, value: text.inline }
      : readEntry(text, "rules", packFolder(resolved, text.pack, fetched));
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

// Each rules part that is on as its file's text, and the files of the parts that are off. Of two parts on that name
// one file, the later one's text is written, as a later value wins.
const rulesFiles = (resolved: Resolved, home: string, fetched: Fetched) => {
  const folder = rulesFolder(home);
  const files = rulesOf(resolved).map((each): [string, Rules] => [join(folder, each.file), each]);
  const wanted = new Map<string, Wanted>();
  for (const [path, each] of files.filter(([, rule]) => rule.on)) {
    const content = textOf(each, resolved, fetched);
    if (!content.ok) return content;
    wanted.set(path, { content: content.value });
  }
  const off = files.map(([path]) => path).filter((path) => !wanted.has(path));
  return { ok: true as const, value: { wanted, off } };
};

// The settings as an object with the hash of the text read; none yet is an empty one. A file that is no JSON object
// is never rewritten.
const readSettings = (path: string): Result<{ json: Json; before: string | null }> => {
  const file = jsonFile(path);
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

// The file's write when merging changes it; shortcut: the file is written back as two-space JSON with every key in its
// order, comments refused; a format-keeping edit is due once owners keep their own formatting there.
const fileWrite = (path: string, merge: (json: Json) => Json): Result<{ operations: Operation[]; merged: Json }> => {
  const current = readSettings(path);
  if (!current.ok) return current;
  const { json, before } = current.value;
  const merged = merge(json);
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const same = canonicalJson(merged) === canonicalJson(json);
  return { ok: true, value: { operations: same ? [] : [{ kind: "write", path, before, content }], merged } };
};
const mergeSet = (json: Json, set: Json): Json => mergeJson(json, set, "", () => undefined);

type Plugin = Extract<Resolved["profile"]["machine"][string], { type: "plugin" }>;
type Tree = { [key: string]: Json | undefined };
const isTree = (value: Json | undefined): value is Tree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// What a plugin part writes into the user settings: its marketplace when it names one, and the plugin switched on.
// https://code.claude.com/docs/en/settings-reference#extraknownmarketplaces
const pluginSet = ({ plugin, marketplace }: Plugin): Json => {
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

// The plugins merged into the settings. Claude Code reads a marketplace entry whole, so the profile's replaces one of
// the same name instead of mixing their fields.
const withPlugins = (json: Json, plugins: Plugin[]): Json => {
  const names = new Set(plugins.flatMap(({ marketplace }) => (marketplace === undefined ? [] : [marketplace.name])));
  const known = isTree(json) ? json["extraKnownMarketplaces"] : undefined;
  const kept = isTree(known) ? Object.fromEntries(Object.entries(known).filter(([name]) => !names.has(name))) : known;
  const base = isTree(json) && kept !== undefined ? { ...json, extraKnownMarketplaces: kept } : json;
  return plugins.reduce((value, plugin) => mergeSet(value, pluginSet(plugin)), base);
};

/** The folders a plan writes into: the Claude Code home, the user's home, and the folders no options file may reach. */
export interface Target {
  readonly home: string;
  readonly user: string;
  readonly guarded: readonly string[];
}

const within = (path: string, root: string): boolean => {
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
    const write = fileWrite(path, (json) => sets.reduce((value, set) => mergeSet(value, set), json));
    if (!write.ok) return write;
    operations.push(...write.value.operations);
  }
  return { ok: true, value: operations };
};

// A marketplace's repository: `owner/repo` on GitHub, else its Git URL.
const repository = (marketplace: NonNullable<Plugin["marketplace"]>): string =>
  "github" in marketplace ? marketplace.github : marketplace.git;

// A plugin part not approved by name whose writes would change something: a named approval line, never preselected
// (owner, hub issue 130), as its plugin's hooks, MCP servers and commands run in every session.
const waiting = (plugins: [string, Plugin][], settings: Json, target: Target): Finding[] =>
  plugins
    .filter(([, plugin]) => {
      const changed = canonicalJson(withPlugins(settings, [plugin])) !== canonicalJson(settings);
      const options = plugin.options === undefined ? null : plugin.options;
      const write =
        options === null ? null : fileWrite(join(target.user, options.file), (json) => mergeSet(json, options.set));
      return changed || (write !== null && (!write.ok || write.value.operations.length > 0));
    })
    .map(([id, { plugin, marketplace }]): Finding => {
      const source = marketplace === undefined ? null : repository(marketplace);
      const params = { ref: marketplace?.ref ?? null, autoUpdate: marketplace?.autoUpdate === true };
      return { code: "profile.approval-needed", params: { part: `machine.${id}`, plugin, source, ...params } };
    });

/**
 * The settings parts and the plugin parts `approved` names merged into the settings file, in that order, and those
 * plugins' options files. The settings parts may set no plugin key (the profile's allow list), so the order changes
 * nothing between them.
 */
const settingsPlan = ({ profile, on }: Resolved, target: Target, approved: ReadonlySet<string>): Result<LevelPlan> => {
  const parts = Object.entries(profile.machine).filter(([id]) => on.has(`machine.${id}`));
  const sets = parts.flatMap(([, part]) => (part.type === "settings" ? [part.set] : []));
  const plugins = parts.flatMap(([id, part]): [string, Plugin][] => (part.type === "plugin" ? [[id, part]] : []));
  const allowed = plugins.filter(([id]) => approved.has(`machine.${id}`));
  if (sets.length + plugins.length === 0) return { ok: true, value: { operations: [], findings: [] } };
  const settings = fileWrite(join(target.home, "settings.json"), (json) =>
    withPlugins(
      sets.reduce((value, set) => mergeSet(value, set), json),
      allowed.map(([, plugin]) => plugin),
    ),
  );
  if (!settings.ok) return settings;
  const options = optionsWrites(allowed, target);
  if (!options.ok) return options;
  const others = plugins.filter(([id]) => !approved.has(`machine.${id}`));
  const operations = [...settings.value.operations, ...options.value];
  return { ok: true, value: { operations, findings: waiting(others, settings.value.merged, target) } };
};

// An --allow that names no plugin part of the profile, so a typo never passes as an approval.
const unknownApprovals = ({ profile }: Resolved, approved: ReadonlySet<string>): Finding[] =>
  [...approved]
    .filter((part) => profile.machine[part.slice("machine.".length)]?.type !== "plugin" || !part.startsWith("machine."))
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
  }: { approved?: ReadonlySet<string>; fetched?: Fetched } = {},
): Result<LevelPlan> => {
  const unknown = unknownApprovals(resolved, approved);
  if (unknown.length > 0) return { ok: true, value: { operations: [], findings: unknown } };
  const rules = rulesFiles(resolved, target.home, fetched);
  if (!rules.ok) return rules;
  const skills = skillFiles(resolved, target.home, fetched, written);
  if (!skills.ok) return skills;
  const wanted = new Map([...rules.value.wanted, ...skills.value.wanted]);
  const files = ownedFiles(wanted, [...rules.value.off, ...skills.value.stale], written);
  if (!files.ok) return files;
  const settings = settingsPlan(resolved, target, approved);
  if (!settings.ok) return settings;
  const operations = [...files.value.operations, ...settings.value.operations];
  return { ok: true, value: { operations, findings: [...files.value.findings, ...settings.value.findings] } };
};
