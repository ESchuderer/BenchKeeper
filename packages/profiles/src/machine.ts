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
import { errorCode, hashFile } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { jsonFile, readEntry, type Resolved } from "./resolve.ts";

/** A planned change and the profile file that set it: a whole file (`key` null) or one settings value by its pointer. */
export interface Change {
  readonly path: string;
  readonly key: string | null;
  readonly setBy: string | null;
}
/** The operations of one level, what they change, and the files they leave alone. */
export interface LevelPlan {
  readonly operations: Operation[];
  readonly changes: Change[];
  readonly findings: Finding[];
}

/** The hub's question rule, a file of the rules folder while a hub part is on. */
export const HUB_RULES = "cedarloom-hub.md";
/** The rules folder of a Claude Code home, as the run store's `written` takes it. */
export const rulesFolder = (home: string): string => join(home, "rules") + sep;

type Text = { pack: string; path: string } | { inline: string };
type Wanted = { file: string; text: Text; pointer: string; on: boolean };

const refuse = (finding: Finding): Result<never> => ({ ok: false, finding });

// The text with this machine's values filled in; a placeholder left without one stops the plan.
const textOf = ({ text, pointer }: Wanted, hub: string | undefined): Result<string> => {
  const read: Result<string> = "inline" in text ? { ok: true, value: text.inline } : readEntry(text, "rules");
  if (!read.ok) return read;
  const filled = hub === undefined ? read.value : read.value.replaceAll("{{hub}}", hub);
  const left = /\{\{([^{}\n]{0,40})\}\}/.exec(filled)?.[1];
  if (left === undefined) return { ok: true, value: filled };
  return refuse({ code: "profile.placeholder-unknown", params: { at: pointer, placeholder: left } });
};

/** The file that set the value at a profile pointer: the one setBy lists at the pointer or the nearest above it. */
const setterOf = (setBy: Record<string, string>, pointer: string): string | null => {
  for (let at = pointer; at !== ""; at = at.slice(0, at.lastIndexOf("/"))) {
    const found = setBy[at];
    if (found !== undefined) return found;
  }
  return null;
};

// Every rules file the profile names, on or off: each rules part's, and the hub's question rule.
const rulesOf = ({ profile, on }: Resolved): Wanted[] => [
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

const ownerChanged = (path: string): Finding => ({ code: "profile.owner-changed", params: { path } });

// A file's hash, null when it is absent; one that cannot be read, a folder among them, stops the plan by name.
const hashOf = (path: string): Result<string | null> => {
  try {
    return { ok: true, value: hashFile(path) };
  } catch (error) {
    return refuse({ code: "document.unreadable", params: { path, error: errorCode(error) } });
  }
};

// A rules file is written while it is absent or as CedarLoom last left it; a file the owner changed or made stays.
const rulesWrites = (resolved: Resolved, wanted: Map<string, Wanted>, written: ReadonlyMap<string, string | null>) => {
  const plan: LevelPlan = { operations: [], changes: [], findings: [] };
  for (const [path, each] of wanted) {
    const content = textOf(each, resolved.hub);
    if (!content.ok) return content;
    const hashed = hashOf(path);
    if (!hashed.ok) return hashed;
    const now = hashed.value;
    if (now === sha256(content.value)) continue;
    if (now !== null && now !== written.get(path)) plan.findings.push(ownerChanged(path));
    else {
      plan.operations.push({ kind: "write", path, before: now, content: content.value });
      plan.changes.push({ path, key: null, setBy: setterOf(resolved.setBy, each.pointer) });
    }
  }
  return { ok: true as const, value: plan };
};

// The file of a rules part that is off goes while it is as CedarLoom last left it; other files are never touched.
const rulesRemovals = (plan: LevelPlan, off: Set<string>, written: ReadonlyMap<string, string | null>) => {
  for (const path of off) {
    const last = written.get(path);
    const now = last === undefined || last === null ? null : hashOf(path);
    if (now?.ok === false) return now;
    if (now === null || now.value === null) continue;
    if (now.value !== last) plan.findings.push(ownerChanged(path));
    else {
      plan.operations.push({ kind: "delete", path, before: now.value });
      plan.changes.push({ path, key: null, setBy: null });
    }
  }
  return { ok: true as const, value: plan };
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

const valueAt = (value: Json | undefined, pointer: string): Json | undefined =>
  pointer
    .split("/")
    .slice(1)
    .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<Json | undefined>(
      (item, key) =>
        typeof item === "object" && item !== null
          ? Object.entries(item).find(([name]) => name === key)?.[1]
          : undefined,
      value,
    );
const same = (a: Json | undefined, b: Json | undefined): boolean =>
  a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);

/** What a part merges into a JSON file, and the pointer of that value in the composed profile, for its setter. */
type Source = { set: Json; pointer: string };

/**
 * Merges each source into a JSON file, in order, by the rule of every `set`. Each changed value names the file that
 * set it; an item a list gains, the file that set the list. shortcut: the file is written back as two-space JSON with
 * every key in its order, comments refused; a format-keeping edit is due once owners keep their own formatting there.
 */
const mergeFile = (path: string, sources: Source[], setBy: Record<string, string>): Result<LevelPlan> => {
  const current = sources.length === 0 ? null : readSettings(path);
  if (current?.ok === false) return current;
  const { json, before } = current?.value ?? { json: {}, before: null };
  let merged: Json = json;
  const marked = new Map<string, string>();
  for (const { set, pointer } of sources)
    merged = mergeJson(merged, set, "", (at) => marked.set(at, `${pointer}${at}`));
  const changes = [...marked]
    .filter(([at]) => !same(valueAt(json, at), valueAt(merged, at)))
    .map(([at, pointer]): Change => {
      const list = Array.isArray(valueAt(merged, at.slice(0, at.lastIndexOf("/"))));
      return { path, key: at, setBy: setterOf(setBy, list ? pointer.slice(0, pointer.lastIndexOf("/")) : pointer) };
    });
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const operations: Operation[] = changes.length === 0 ? [] : [{ kind: "write", path, before, content }];
  return { ok: true, value: { operations, changes, findings: [] } };
};

type Plugin = Extract<Resolved["profile"]["machine"][string], { type: "plugin" }>;

// What a plugin part writes into the user settings: its marketplace when it names one, and the plugin switched on.
// https://code.claude.com/docs/en/settings-reference#extraknownmarketplaces
const pluginSources = (id: string, { plugin, marketplace }: Plugin): Source[] => {
  const enabled = { set: { enabledPlugins: { [plugin]: true } }, pointer: `/machine/${id}/plugin` };
  if (marketplace === undefined) return [enabled];
  const { name, ref, autoUpdate } = marketplace;
  const where =
    "github" in marketplace ? { source: "github", repo: marketplace.github } : { source: "git", url: marketplace.git };
  const entry = {
    source: { ...where, ...(ref === undefined ? {} : { ref }) },
    ...(autoUpdate === undefined ? {} : { autoUpdate }),
  };
  return [{ set: { extraKnownMarketplaces: { [name]: entry } }, pointer: `/machine/${id}/marketplace` }, enabled];
};

/** The folders a plan writes into: the Claude Code home, the user's home, and the folders no options file may reach. */
export interface Target {
  readonly home: string;
  readonly user: string;
  readonly guarded: readonly string[];
}

// The path as the file system resolves it: its deepest existing folder through links, the rest as written.
const real = (path: string): string => {
  const rest: string[] = [];
  let at = path;
  for (; !existsSync(at) && dirname(at) !== at; at = dirname(at)) rest.unshift(basename(at));
  return join(realpathSync.native(at), ...rest);
};
const within = (path: string, root: string): boolean => {
  const way = relative(real(root), real(path));
  return way === "" || !(way === ".." || way.startsWith(`..${sep}`) || isAbsolute(way));
};

const optionsSources = (id: string, plugin: Plugin): Source[] =>
  plugin.options === undefined ? [] : [{ set: plugin.options.set, pointer: `/machine/${id}/options/set` }];

// A plugin's options file, merged like the settings; never inside a Claude Code home or CedarLoom's state folder.
const optionsPlan = (id: string, plugin: Plugin, target: Target, setBy: Record<string, string>): Result<LevelPlan> => {
  const path = join(target.user, plugin.options?.file ?? "");
  if (plugin.options !== undefined && target.guarded.some((root) => within(path, root))) {
    return refuse({ code: "profile.options-guarded", params: { part: `machine.${id}`, path } });
  }
  return mergeFile(path, optionsSources(id, plugin), setBy);
};

// A plugin part not approved by name whose writes would change something: a named approval line, never preselected
// (owner, hub issue 130), since a plugin's hooks, MCP servers and commands run in every session.
const pending = (plugins: [string, Plugin][], target: Target, setBy: Record<string, string>): Finding[] =>
  plugins
    .filter(([id, plugin]) =>
      [
        mergeFile(join(target.home, "settings.json"), pluginSources(id, plugin), setBy),
        mergeFile(join(target.user, plugin.options?.file ?? ""), optionsSources(id, plugin), setBy),
      ].some((merged) => !merged.ok || merged.value.changes.length > 0),
    )
    .map(([id, { plugin }]) => ({ code: "profile.approval-needed", params: { part: `machine.${id}`, plugin } }));

const joined = (plans: LevelPlan[]): LevelPlan => ({
  operations: plans.flatMap((plan) => plan.operations),
  changes: plans.flatMap((plan) => plan.changes),
  findings: plans.flatMap((plan) => plan.findings),
});

// The settings file with the settings parts and the approved plugin parts, then each approved plugin's options file.
const settingsPlans = (resolved: Resolved, target: Target, approved: ReadonlySet<string>): Result<LevelPlan> => {
  const { profile, on, setBy } = resolved;
  const parts = Object.entries(profile.machine).filter(([id]) => on.has(`machine.${id}`));
  const plugins = parts.flatMap(([id, part]): [string, Plugin][] => (part.type === "plugin" ? [[id, part]] : []));
  const allowed = plugins.filter(([id]) => approved.has(`machine.${id}`));
  const sources = [
    ...parts.flatMap(([id, part]) =>
      part.type === "settings" ? [{ set: part.set, pointer: `/machine/${id}/set` }] : [],
    ),
    ...allowed.flatMap(([id, plugin]) => pluginSources(id, plugin)),
  ];
  const plans = [mergeFile(join(target.home, "settings.json"), sources, setBy)];
  plans.push(...allowed.map(([id, plugin]) => optionsPlan(id, plugin, target, setBy)));
  const failed = plans.find((plan) => !plan.ok);
  if (failed !== undefined) return failed;
  const waiting = pending(
    plugins.filter(([id]) => !approved.has(`machine.${id}`)),
    target,
    setBy,
  );
  return {
    ok: true,
    value: joined([
      ...plans.flatMap((plan) => (plan.ok ? [plan.value] : [])),
      { operations: [], changes: [], findings: waiting },
    ]),
  };
};

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
  approved: ReadonlySet<string> = new Set(),
): Result<LevelPlan> => {
  const folder = rulesFolder(target.home);
  const files = rulesOf(resolved).map((each): [string, Wanted] => [join(folder, each.file), each]);
  // One file per name: of two parts on that name it, the later one's text is written, as a later value wins.
  const wanted = new Map(files.filter(([, each]) => each.on));
  const writes = rulesWrites(resolved, wanted, written);
  if (!writes.ok) return writes;
  const off = new Set(files.map(([path]) => path).filter((path) => !wanted.has(path)));
  const rules = rulesRemovals(writes.value, off, written);
  if (!rules.ok) return rules;
  const settings = settingsPlans(resolved, target, approved);
  return settings.ok ? { ok: true, value: joined([rules.value, settings.value]) } : settings;
};
