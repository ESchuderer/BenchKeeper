import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The system folder of Claude Code's file-based managed settings per platform
 * (https://code.claude.com/docs/en/managed-settings#where-each-mechanism-stores-the-policy); null where there is none.
 */
export const managedSettingsDir = (platform: NodeJS.Platform): string | null => {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return platform === "linux" ? "/etc/claude-code" : null;
};

/** A managed setting that lets a worker's commands run outside the sandbox, and the file that sets it. */
export interface SandboxOverride {
  readonly path: string;
  readonly key: "enabled" | "failIfUnavailable" | "allowUnsandboxedCommands" | "excludedCommands";
}

// The files in the order Claude Code merges them: managed-settings.json, then managed-settings.d/*.json alphabetically.
const managedFiles = (dir: string): string[] => {
  const dropIns = join(dir, "managed-settings.d");
  let names: string[] = [];
  try {
    names = readdirSync(dropIns).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  } catch {
    // No drop-in folder.
  }
  // Code-unit order; the docs say alphabetical (unverified for names that differ in case or beyond ASCII).
  const ordered = names.toSorted((a, b) => (a < b ? -1 : 1));
  return [join(dir, "managed-settings.json"), ...ordered.map((name) => join(dropIns, name))];
};

// The sandbox block of one file; a file that is missing or no JSON object gives none (Claude Code refuses to start on
// one that cannot be parsed).
const sandboxOf = (path: string): Record<string, unknown> => {
  try {
    const sandbox: unknown = Reflect.get(Object(JSON.parse(readFileSync(path, "utf8"))), "sandbox");
    return typeof sandbox === "object" && sandbox !== null ? { ...sandbox } : {};
  } catch {
    return {};
  }
};

// The value of each Boolean key that lets commands run outside the sandbox. A quoted "true" or "false" counts as that
// Boolean; any other invalid value keeps the sandbox strict
// (https://code.claude.com/docs/en/managed-settings#invalid-values-inside-sandbox).
const LOOSENED = { enabled: false, failIfUnavailable: false, allowUnsandboxedCommands: true } as const;
const SWITCHES = ["enabled", "failIfUnavailable", "allowUnsandboxedCommands"] as const;
const loosens = (key: keyof typeof LOOSENED, value: unknown): boolean =>
  value === LOOSENED[key] || value === String(LOOSENED[key]);

/**
 * The managed settings files that let commands run outside the sandbox, whatever the worker's own settings say: a
 * managed key outranks --settings. Later files win for a key, as Claude Code merges them; every excluded command counts.
 * shortcut: reads the files only. MDM profiles, the Windows registry and server-managed settings rank above them and
 * stay unchecked until a live sandbox probe joins the contract check.
 */
export const sandboxOverrides = (dir: string): SandboxOverride[] => {
  const last = new Map<keyof typeof LOOSENED, { path: string; value: unknown }>();
  const excluded: SandboxOverride[] = [];
  for (const path of managedFiles(dir)) {
    const sandbox = sandboxOf(path);
    for (const key of SWITCHES) {
      if (Object.hasOwn(sandbox, key)) last.set(key, { path, value: sandbox[key] });
    }
    const commands = sandbox["excludedCommands"];
    if (Array.isArray(commands) && commands.length > 0) excluded.push({ path, key: "excludedCommands" });
  }
  const loosened = [...last].filter(([key, set]) => loosens(key, set.value));
  return [...loosened.map(([key, set]) => ({ path: set.path, key })), ...excluded];
};
