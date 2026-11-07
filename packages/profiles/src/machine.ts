import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
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

/** The operations of one level, and the files it leaves alone. */
export interface LevelPlan {
  readonly operations: Operation[];
  readonly findings: Finding[];
}

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
  // A placeholder's name form only, so a quoted GitHub Actions expression such as `${{ github.sha }}` stays text.
  const left = /\{\{([a-z][a-z0-9-]{0,39})\}\}/.exec(filled)?.[1];
  if (left === undefined) return { ok: true, value: filled };
  return refuse({ code: "profile.placeholder-unknown", params: { at: pointer, placeholder: left } });
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
  const plan: LevelPlan = { operations: [], findings: [] };
  for (const [path, each] of wanted) {
    const content = textOf(each, resolved.hub);
    if (!content.ok) return content;
    const hashed = hashOf(path);
    if (!hashed.ok) return hashed;
    const now = hashed.value;
    if (now === sha256(content.value)) continue;
    if (now !== null && now !== written.get(path)) plan.findings.push(ownerChanged(path));
    else plan.operations.push({ kind: "write", path, before: now, content: content.value });
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
    else plan.operations.push({ kind: "delete", path, before: now.value });
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

/**
 * Merges each settings part that is on into the settings file, in profile order, by the rule of every `set`.
 * shortcut: the file is written back as two-space JSON with every key in its order, comments refused; a format-keeping
 * edit is due once owners keep their own formatting there.
 */
const settingsPlan = ({ profile, on }: Resolved, path: string): Result<LevelPlan> => {
  const sets = Object.entries(profile.machine).flatMap(([id, part]) =>
    part.type === "settings" && on.has(`machine.${id}`) ? [part.set] : [],
  );
  const current = sets.length === 0 ? null : readSettings(path);
  if (current?.ok === false) return current;
  const { json, before } = current?.value ?? { json: {}, before: null };
  const merged = sets.reduce<Json>((value, set) => mergeJson(value, set, "", () => undefined), json);
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  const same = canonicalJson(merged) === canonicalJson(json);
  return { ok: true, value: { operations: same ? [] : [{ kind: "write", path, before, content }], findings: [] } };
};

/**
 * The machine level for one Claude Code home: each rules part as a file of its rules folder, the hub's question rule
 * with `{{hub}}` filled, and the settings parts merged into its settings file. `written` holds what CedarLoom last
 * left at each path of the rules folder (the run store's `written`), which tells its own files from the owner's.
 */
export const planMachine = (
  resolved: Resolved,
  home: string,
  written: ReadonlyMap<string, string | null>,
): Result<LevelPlan> => {
  const folder = rulesFolder(home);
  const files = rulesOf(resolved).map((each): [string, Wanted] => [join(folder, each.file), each]);
  // One file per name: of two parts on that name it, the later one's text is written, as a later value wins.
  const wanted = new Map(files.filter(([, each]) => each.on));
  const writes = rulesWrites(resolved, wanted, written);
  if (!writes.ok) return writes;
  const off = new Set(files.map(([path]) => path).filter((path) => !wanted.has(path)));
  const rules = rulesRemovals(writes.value, off, written);
  if (!rules.ok) return rules;
  const settings = settingsPlan(resolved, join(home, "settings.json"));
  if (!settings.ok) return settings;
  const operations = [...rules.value.operations, ...settings.value.operations];
  return { ok: true, value: { operations, findings: rules.value.findings } };
};
