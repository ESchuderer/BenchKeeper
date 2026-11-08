import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AUTOMATION_SCHEMA_VERSION,
  type AutomationLevel,
  AutomationSettings,
  type Plan,
  readDocument,
  type Result,
} from "@cedarloom/contracts";
import { sha256 } from "@cedarloom/ledger";
import { readOptionalJson } from "./use-cases.ts";

const settingsPath = (config: string): string => join(config, "automation.json");

// What a fresh install runs with: Supervised everywhere.
const FRESH: AutomationSettings = { schemaVersion: AUTOMATION_SCHEMA_VERSION, default: "supervised", projects: {} };

// The settings file with its text; null when there is none.
const readSettings = (path: string): Result<{ text: string; settings: AutomationSettings } | null> => {
  const file = readOptionalJson(path);
  if (!file.ok || file.value === null) return file.ok ? { ok: true, value: null } : file;
  const settings = readDocument(AutomationSettings, AUTOMATION_SCHEMA_VERSION, file.value.json);
  return settings.ok ? { ok: true, value: { text: file.value.text, settings: settings.value } } : settings;
};

/** The automation settings of the config folder; null when there are none, as on a fresh install (Supervised). */
export const automationSettings = (config: string): Result<AutomationSettings | null> => {
  const read = readSettings(settingsPath(config));
  return read.ok ? { ok: true, value: read.value?.settings ?? null } : read;
};

// On-disk case, so one folder has one entry: https://nodejs.org/api/fs.html#fsrealpathsyncnativepath-options
const projectFolder = (folder: string): string | null => {
  try {
    const real = realpathSync.native(folder);
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
};

/** A change of the settings: the default level, or one project's level; null gives the project the default again. */
export type LevelChange =
  | { readonly project: null; readonly level: AutomationLevel }
  | { readonly project: string; readonly level: AutomationLevel | null };

// The entry a change touches: null for the default, else the real path; a folder now gone keeps the path it was set by.
const entryOf = (change: LevelChange): Result<string | null> => {
  if (change.project === null) return { ok: true, value: null };
  const real = projectFolder(change.project);
  if (real !== null) return { ok: true, value: real };
  if (change.level === null) return { ok: true, value: change.project };
  return { ok: false, finding: { code: "automation.unknown-folder", params: { path: change.project } } };
};

/**
 * Plans a change of the automation settings in the config folder, as one write that fails at apply time if the file
 * changed since. Settings that do not exist yet start from a Supervised default, as a fresh install runs.
 */
export const planLevel = (config: string, change: LevelChange): Result<Plan> => {
  const entry = entryOf(change);
  if (!entry.ok) return entry;
  const path = settingsPath(config);
  const read = readSettings(path);
  if (!read.ok) return read;
  const current = read.value?.settings ?? FRESH;
  // Own entries only, sorted by folder, so the file reads the same for the same settings.
  const projects = new Map<string, AutomationLevel | null>(Object.entries(current.projects));
  if (entry.value !== null) projects.set(entry.value, change.level);
  const kept = [...projects].filter((pair) => pair[1] !== null).toSorted(([a], [b]) => (a < b ? -1 : 1));
  const next = {
    ...current,
    default: change.project === null ? change.level : current.default,
    projects: Object.fromEntries(kept),
  };
  const before = read.value === null ? null : sha256(read.value.text);
  // Every entry is a real, so absolute, path; the parse puts the keys in the format's order.
  const content = `${JSON.stringify(AutomationSettings.parse(next), null, 2)}\n`;
  return { ok: true, value: { schemaVersion: 1, operations: [{ kind: "write", path, before, content }] } };
};
