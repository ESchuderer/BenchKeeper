import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
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
import { readEntry, type Resolved } from "./resolve.ts";

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
type Wanted = { file: string; text: Text; pointer: string };

const textOf = (text: Text, hub: string | undefined): Result<string> => {
  const read: Result<string> = "inline" in text ? { ok: true, value: text.inline } : readEntry(text);
  return read.ok && hub !== undefined ? { ok: true, value: read.value.replaceAll("{{hub}}", hub) } : read;
};

/** The file that set the value at a profile pointer: the one setBy lists at the pointer or the nearest above it. */
const setterOf = (setBy: Record<string, string>, pointer: string): string | null => {
  for (let at = pointer; at !== ""; at = at.slice(0, at.lastIndexOf("/"))) {
    const found = setBy[at];
    if (found !== undefined) return found;
  }
  return null;
};

const rulesWanted = ({ profile, on }: Resolved): Wanted[] => {
  const wanted: Wanted[] = [
    ...Object.entries(profile.machine).flatMap(([id, part]) =>
      part.type === "rules" && on.has(`machine.${id}`)
        ? [{ file: part.file, text: part.text, pointer: `/machine/${id}/text` }]
        : [],
    ),
    ...Object.entries(profile.workspace).flatMap(([id, part]) =>
      part.type === "hub" && part.rules !== undefined && on.has(`workspace.${id}`)
        ? [{ file: HUB_RULES, text: part.rules, pointer: `/workspace/${id}/rules` }]
        : [],
    ),
  ];
  // One file per name: of two parts naming the same file, the later one's text is written, as a later value wins.
  return [...new Map(wanted.map((each): [string, Wanted] => [each.file, each])).values()];
};

const ownerChanged = (path: string): Finding => ({ code: "profile.owner-changed", params: { path } });

// A rules file is written while it is absent or as CedarLoom last left it; a file the owner changed or made stays.
const rulesWrites = (resolved: Resolved, folder: string, written: ReadonlyMap<string, string | null>) => {
  const plan: LevelPlan = { operations: [], changes: [], findings: [] };
  for (const { file, text, pointer } of rulesWanted(resolved)) {
    const path = join(folder, file);
    const content = textOf(text, resolved.hub);
    if (!content.ok) return content;
    const now = hashFile(path);
    if (now === sha256(content.value)) continue;
    if (now !== (written.get(path) ?? null)) plan.findings.push(ownerChanged(path));
    else {
      plan.operations.push({ kind: "write", path, before: now, content: content.value });
      plan.changes.push({ path, key: null, setBy: setterOf(resolved.setBy, pointer) });
    }
  }
  return { ok: true as const, value: plan };
};

// A rules file CedarLoom wrote for a part that is off now goes, while it is still as CedarLoom left it.
const rulesRemovals = (plan: LevelPlan, wanted: ReadonlySet<string>, written: ReadonlyMap<string, string | null>) => {
  for (const [path, last] of written) {
    const now = wanted.has(path) || last === null ? null : hashFile(path);
    if (now === null) continue;
    if (now !== last) plan.findings.push(ownerChanged(path));
    else {
      plan.operations.push({ kind: "delete", path, before: now });
      plan.changes.push({ path, key: null, setBy: null });
    }
  }
};

const unreadable = (path: string, error: string): Result<never> => ({
  ok: false,
  finding: { code: "document.unreadable", params: { path, error } },
});

// The settings as an object with the hash of the text read; none yet is an empty one. A file that is no JSON object
// is never rewritten.
const readSettings = (path: string): Result<{ json: Json; before: string | null }> => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return errorCode(error) === "ENOENT"
      ? { ok: true, value: { json: {}, before: null } }
      : unreadable(path, errorCode(error));
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return unreadable(path, "not JSON");
  }
  const read = JsonValue.safeParse(json);
  const object = read.success && typeof read.data === "object" && read.data !== null && !Array.isArray(read.data);
  return object
    ? { ok: true, value: { json: read.data, before: sha256(text) } }
    : unreadable(path, "not a JSON object");
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

/**
 * Merges each settings part that is on into the settings file, in profile order, by the rule of every `set`. Each
 * changed value names the file that set it; an item a list gains, the file that set the list. shortcut: the file is
 * written back as two-space JSON, as Claude Code writes it; a format-keeping edit is due once owners keep their own.
 */
const settingsPlan = ({ profile, on, setBy }: Resolved, path: string): Result<LevelPlan> => {
  const parts = Object.entries(profile.machine).flatMap(([id, part]) =>
    part.type === "settings" && on.has(`machine.${id}`) ? [{ id, set: part.set }] : [],
  );
  if (parts.length === 0) return { ok: true, value: { operations: [], changes: [], findings: [] } };
  const current = readSettings(path);
  if (!current.ok) return current;
  const { json, before } = current.value;
  let merged: Json = json;
  const marked = new Map<string, string>();
  for (const { id, set } of parts)
    merged = mergeJson(merged, set, "", (at) => marked.set(at, `/machine/${id}/set${at}`));
  const changes = [...marked]
    .filter(([at]) => !same(valueAt(json, at), valueAt(merged, at)))
    .map(([at, pointer]): Change => {
      const list = Array.isArray(valueAt(merged, at.slice(0, at.lastIndexOf("/"))));
      return { path, key: at, setBy: setterOf(setBy, list ? pointer.slice(0, pointer.lastIndexOf("/")) : pointer) };
    });
  if (changes.length === 0) return { ok: true, value: { operations: [], changes: [], findings: [] } };
  const content = `${JSON.stringify(merged, null, 2)}\n`;
  return {
    ok: true,
    value: { operations: [{ kind: "write", path, before, content }], changes, findings: [] },
  };
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
  const rules = rulesWrites(resolved, folder, written);
  if (!rules.ok) return rules;
  rulesRemovals(rules.value, new Set(rulesWanted(resolved).map(({ file }) => join(folder, file))), written);
  const settings = settingsPlan(resolved, join(home, "settings.json"));
  if (!settings.ok) return settings;
  const { operations, changes, findings } = rules.value;
  return {
    ok: true,
    value: {
      operations: [...operations, ...settings.value.operations],
      changes: [...changes, ...settings.value.changes],
      findings,
    },
  };
};
