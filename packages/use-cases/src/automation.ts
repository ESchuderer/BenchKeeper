import { join } from "node:path";
import {
  AUTOMATION_SCHEMA_VERSION,
  type AutomationLevel,
  AutomationSettings,
  type ModeSwitch,
  type Plan,
  readDocument,
  type Result,
} from "@cedarloom/contracts";
import { levelAt } from "@cedarloom/engine";
import { sha256 } from "@cedarloom/ledger";
import { readJson, withStore, withView } from "./use-cases.ts";

const settingsPath = (config: string): string => join(config, "automation.json");

// What a fresh install runs with: Supervised everywhere.
const FRESH: AutomationSettings = { schemaVersion: AUTOMATION_SCHEMA_VERSION, default: "supervised", projects: {} };

// The settings file with its text; null when there is none.
const readSettings = (path: string): Result<{ text: string; settings: AutomationSettings } | null> => {
  const file = readJson(path);
  if (!file.ok) {
    // Only a missing file is no settings; one the process cannot read is reported.
    const missing = file.finding.code === "document.unreadable" && file.finding.params.error === "ENOENT";
    return missing ? { ok: true, value: null } : file;
  }
  const settings = readDocument(AutomationSettings, AUTOMATION_SCHEMA_VERSION, file.value.json);
  return settings.ok ? { ok: true, value: { text: file.value.text, settings: settings.value } } : settings;
};

/** The automation settings of the config folder; null when there are none, as on a fresh install (Supervised). */
export const automationSettings = (config: string): Result<AutomationSettings | null> => {
  const read = readSettings(settingsPath(config));
  return read.ok ? { ok: true, value: read.value?.settings ?? null } : read;
};

/** A change of the settings: the default level, or one project's level; null gives the project the default again. */
export type LevelChange =
  | { readonly project: null; readonly level: AutomationLevel }
  | { readonly project: string; readonly level: AutomationLevel | null };

/**
 * Plans a change of the automation settings in the config folder, as one write that fails at apply time if the file
 * changed since. Settings that do not exist yet start from a Supervised default, as a fresh install runs.
 */
export const planLevel = (config: string, change: LevelChange): Result<Plan> => {
  const path = settingsPath(config);
  const read = readSettings(path);
  if (!read.ok) return read;
  const current = read.value?.settings ?? FRESH;
  // Own entries only, sorted by folder, so the file reads the same for the same settings.
  const projects = new Map<string, AutomationLevel | null>(Object.entries(current.projects));
  if (change.project !== null) projects.set(change.project, change.level);
  const kept = [...projects].filter((entry) => entry[1] !== null).toSorted(([a], [b]) => (a < b ? -1 : 1));
  const next = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    default: change.project === null ? change.level : current.default,
    projects: Object.fromEntries(kept),
  };
  // A project folder that is no absolute path is refused before anything is planned.
  const checked = readDocument(AutomationSettings, AUTOMATION_SCHEMA_VERSION, next);
  if (!checked.ok) return checked;
  const before = read.value === null ? null : sha256(read.value.text);
  const content = `${JSON.stringify(checked.value, null, 2)}\n`;
  return { ok: true, value: { schemaVersion: 1, operations: [{ kind: "write", path, before, content }] } };
};

export interface Mode {
  /** The level the latest switch set for running work; null: each project's level applies. */
  readonly running: AutomationLevel | null;
  readonly settings: AutomationSettings | null;
}

/** The switch for running work and the settings. Reads never write: no lock, no state folder created. */
export const mode = (state: string, config: string): Result<Mode> => {
  const settings = automationSettings(config);
  if (!settings.ok) return settings;
  return withView(state, (view) => ({
    ok: true,
    value: { running: view?.runningLevel() ?? null, settings: settings.value },
  }));
};

/** The level that applies at a gate of a run in `project`, read at the gate itself. */
export const levelAtGate = (state: string, config: string, project: string): Result<AutomationLevel> => {
  const current = mode(state, config);
  return current.ok ? { ok: true, value: levelAt(current.value.settings, project, current.value.running) } : current;
};

/** Switches the level of running work, null back to each project's level; written to the ledger, in effect at each run's next gate. */
export const switchMode = (
  state: string,
  level: AutomationLevel | null,
  at: string = new Date().toISOString(),
): Result<ModeSwitch> =>
  withStore(state, (store) => {
    store.recordModeSwitch({ at, level });
    return { ok: true, value: { at, level } };
  });
