import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join, win32 } from "node:path";
import { GITHUB_DOMAINS } from "./env.ts";

/**
 * The system folder of Claude Code's file-based managed settings per platform
 * (https://code.claude.com/docs/en/managed-settings#where-each-mechanism-stores-the-policy); null where there is none.
 */
export const managedSettingsDir = (platform: NodeJS.Platform): string | null => {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode";
  return platform === "linux" ? "/etc/claude-code" : null;
};

/**
 * A managed settings file that loosens the worker sandbox, by the key it sets, or that the preflight cannot read or
 * parse and so cannot clear.
 */
export type ManagedProblem =
  | { readonly kind: "loosens"; readonly path: string; readonly key: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly error: string };

// Values that loosen the sandbox, each with its anchor in https://code.claude.com/docs/en/settings-reference.
const SWITCHES = [
  ["enabled", false], // #sandbox-enabled
  ["failIfUnavailable", false], // #sandbox-failifunavailable: commands run unsandboxed when the sandbox cannot start
  ["allowUnsandboxedCommands", true], // #sandbox-allowunsandboxedcommands
  ["allowAppleEvents", true], // #sandbox-allowappleevents: removes code-execution isolation on macOS
  ["allowNestedUserNamespaces", true], // #sandbox-allownestedusernamespaces
  ["network.allowAllUnixSockets", true], // #sandbox-network-allowallunixsockets
  ["filesystem.disabled", true], // #sandbox-filesystem-disabled: unrestricted read and write of the host
] as const;
// Top-level keys that switch the workers' guard hook or deny rules off (#disableallhooks and the like).
const HOOK_SWITCHES = ["disableAllHooks", "allowManagedHooksOnly", "allowManagedPermissionRulesOnly"] as const;
// Each Boolean by its full key, and the value that loosens it.
const SWITCH_VALUES = new Map<string, boolean>([
  ...SWITCHES.map(([name, loose]): [string, boolean] => [`sandbox.${name}`, loose]),
  ...HOOK_SWITCHES.map((name): [string, boolean] => [name, true]),
]);
// Lists of which any entry reaches past the sandbox.
const LISTS = [
  "excludedCommands", // #sandbox-excludedcommands: commands that run outside the sandbox
  "network.allowUnixSockets", // #sandbox-network-allowunixsockets: a socket such as Docker's grants broad access
  "network.allowMachLookup", // #sandbox-network-allowmachlookup: services outside the sandbox act for the command
] as const;
// A policy's own proxy replaces Claude Code's domain lists: docs/agents/cedarloom-rationale.md#managed-settings
const PORTS = ["network.httpProxyPort", "network.socksProxyPort"] as const;
// Hosts beyond the workers' GitHub-only network (#sandbox-network-alloweddomains; owner decision, 2026-11-06).
const DOMAINS = "network.allowedDomains";
const GITHUB = new Set<string>(GITHUB_DOMAINS);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// A dotted key below an object, own properties only.
const at = (object: Json, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (value, part) => (isObject(value) && Object.hasOwn(value, part) ? value[part] : undefined),
      object,
    );

// A quoted Boolean counts, other invalid values keep it strict: docs/agents/cedarloom-rationale.md#managed-settings
const loosens = (value: unknown, loose: boolean): boolean => value === loose || value === String(loose);

interface Settings {
  readonly path: string;
  readonly settings: Json;
}

const codeOf = (error: unknown): string => String(Reflect.get(Object(error), "code"));

type Read = Settings | ManagedProblem | null;

// null for no file; one unreadable or not a JSON object (a BOM too) cannot be cleared, so it counts against the launch.
const readManaged = (path: string): Read => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return codeOf(error) === "ENOENT" ? null : { kind: "unreadable", path, error: codeOf(error) };
  }
  return parsed(path, text);
};

const parsed = (path: string, text: string): Settings | ManagedProblem => {
  try {
    // An empty file holds no settings, as Claude Code reads it.
    const settings: unknown = text.trim() === "" ? {} : JSON.parse(text);
    return isObject(settings) ? { path, settings } : { kind: "unreadable", path, error: "not a JSON object" };
  } catch {
    return { kind: "unreadable", path, error: "not JSON" };
  }
};

// In Claude Code's merge order, hidden files left out: docs/agents/cedarloom-rationale.md#managed-settings
const managedFiles = (dir: string): Read[] => {
  const dropIns = join(dir, "managed-settings.d");
  let names: string[] = [];
  try {
    names = readdirSync(dropIns).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  } catch (error) {
    if (codeOf(error) !== "ENOENT") return [{ kind: "unreadable", path: dropIns, error: codeOf(error) }];
  }
  // Code-unit order; the docs say alphabetical (unverified for names that differ in case or beyond ASCII).
  const ordered = names.toSorted((a, b) => (a < b ? -1 : 1)).map((name) => join(dropIns, name));
  return [join(dir, "managed-settings.json"), ...ordered].map(readManaged);
};

// strictPluginOnlyCustomization with hooks stops settings hooks (#strictpluginonlycustomization-hooks).
const pluginHooksOnly = (value: unknown): boolean =>
  loosens(value, true) || (Array.isArray(value) && value.includes("hooks"));

const sandboxOf = (settings: Json): Json => (isObject(settings["sandbox"]) ? settings["sandbox"] : {});

// The Booleans and ports a file sets, by their full key.
const keyed = (settings: Json): [string, unknown][] =>
  [
    ...[...SWITCHES.map(([name]) => name), ...PORTS].map((key): [string, unknown] => [
      `sandbox.${key}`,
      at(sandboxOf(settings), key),
    ]),
    ...HOOK_SWITCHES.map((key): [string, unknown] => [key, at(settings, key)]),
  ].filter(([, value]) => value !== undefined);

// Loosening whatever follows: docs/agents/cedarloom-rationale.md#managed-settings
const listed = ({ path, settings }: Settings): ManagedProblem[] => {
  const entries = (key: string): unknown[] => {
    const value = at(sandboxOf(settings), key);
    return Array.isArray(value) ? value : [];
  };
  const keys = [
    ...LISTS.filter((key) => entries(key).length > 0).map((key) => `sandbox.${key}`),
    ...(entries(DOMAINS).some((host) => !GITHUB.has(String(host).toLowerCase())) ? [`sandbox.${DOMAINS}`] : []),
    ...(Object.hasOwn(settings, "policyHelper") ? ["policyHelper"] : []),
    ...(pluginHooksOnly(settings["strictPluginOnlyCustomization"]) ? ["strictPluginOnlyCustomization"] : []),
  ];
  return keys.map((key) => ({ kind: "loosens", path, key }));
};

// One source's documents in Claude Code's merge order: the last that sets a Boolean or port wins, every list entry counts.
const problemsOf = (reads: readonly Read[]): ManagedProblem[] => {
  const last = new Map<string, { path: string; value: unknown }>();
  const problems: ManagedProblem[] = [];
  for (const read of reads) {
    if (read === null || "kind" in read) {
      if (read !== null) problems.push(read);
      continue;
    }
    for (const [key, value] of keyed(read.settings)) last.set(key, { path: read.path, value });
    problems.push(...listed(read));
  }
  for (const [key, { path, value }] of last) {
    // A Boolean loosens with its value; a port loosens once it is set to anything but null.
    const loose = SWITCH_VALUES.get(key);
    const loosened = loose === undefined ? value !== null : loosens(value, loose);
    if (loosened) problems.push({ kind: "loosens", path, key });
  }
  return problems;
};

/**
 * The managed settings files that loosen the worker sandbox or switch its guard hook off, whatever the worker's own
 * settings say: a managed key outranks --settings. Left out on purpose, as common policies set them for ordinary
 * reasons: filesystem.allowWrite, enableWeakerNestedSandbox, enableWeakerNetworkIsolation and network.allowLocalBinding.
 */
export const managedProblems = (dir: string): ManagedProblem[] => problemsOf(managedFiles(dir));

/** Where a machine holds Claude Code's managed policy: file folders, macOS managed preferences, and a reg.exe to ask. */
export interface ManagedPlaces {
  readonly files: readonly string[];
  readonly preferences: string | null;
  readonly reg: string | null;
}

// WSL reaches the Windows policy through these when wslInheritsWindowsSettings is on (Claude Code 2.1.316's own paths).
const WSL_REG = "/mnt/c/Windows/System32/reg.exe";
const WSL_FILES = "/mnt/c/Program Files/ClaudeCode";

/**
 * The places Claude Code reads a managed policy from on `platform`
 * (https://code.claude.com/docs/en/managed-settings#where-each-mechanism-stores-the-policy); under WSL also the Windows
 * ones, as wslInheritsWindowsSettings can turn them on.
 */
export const managedPlaces = (
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): ManagedPlaces => {
  const files = managedSettingsDir(platform);
  const wsl = platform === "linux" && existsSync(WSL_REG);
  let reg = wsl ? WSL_REG : null;
  if (platform === "win32") reg = win32.join(env["SystemRoot"] ?? "C:\\Windows", "System32", "reg.exe");
  return {
    files: [...(files === null ? [] : [files]), ...(wsl ? [WSL_FILES] : [])],
    preferences: platform === "darwin" ? "/Library/Managed Preferences" : null,
    reg,
  };
};

/** A program's run: its exit status (null when it did not start or was killed) and what it printed. */
export type Run = (file: string, args: readonly string[]) => { status: number | null; stdout: string; stderr: string };

const run: Run = (file, args) => {
  const ran = spawnSync(file, args, { encoding: "utf8", timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return { status: ran.status, stdout: ran.stdout ?? "", stderr: ran.stderr ?? "" };
};

const DOMAIN = "com.anthropic.claudecode";

// Through the plutil Claude Code uses; a plist it cannot convert (a date or data value) cannot be cleared.
const readPlist = (path: string, runs: Run): Read => {
  try {
    statSync(path);
  } catch (error) {
    const code = codeOf(error);
    return code === "ENOENT" || code === "ENOTDIR" ? null : { kind: "unreadable", path, error: code };
  }
  const converted = runs("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", path]);
  return converted.status === 0 ? parsed(path, converted.stdout) : { kind: "unreadable", path, error: "plutil" };
};

// None when reg finds no key or value (Claude Code's own test of its message), or cannot run, as Claude Code cannot then.
const readRegistry = (reg: string, key: string, runs: Run): Read => {
  const path = `${key}\\Settings`;
  const queried = runs(reg, ["query", key, "/v", "Settings"]);
  if (queried.status === null) return null;
  if (queried.status !== 0) {
    const absent = /unable to find the specified registry key or value/i.test(queried.stdout + queried.stderr);
    return absent ? null : { kind: "unreadable", path, error: "reg" };
  }
  const value = /^[ \t]+Settings[ \t]+REG_(?:EXPAND_)?SZ[ \t]+(.*)$/m.exec(queried.stdout)?.[1];
  return value === undefined ? { kind: "unreadable", path, error: "not a string" } : parsed(path, value);
};

/**
 * Every place of the machine's managed policy that loosens the worker sandbox or switches its guard hook off: the
 * configuration profile's plists (per user, then the device's), the HKLM and HKCU Settings values, and the files. Each
 * source counts on its own, though Claude Code applies only the highest-ranked one that holds a policy key, so a
 * loosening value outranked by a stricter source still refuses (docs/agents/cedarloom-rationale.md#managed-settings).
 */
export const policyProblems = (places: ManagedPlaces, runs: Run = run): ManagedProblem[] => {
  const { preferences, reg } = places;
  const plists = preferences === null ? [] : [...userPlist(preferences), join(preferences, `${DOMAIN}.plist`)];
  const keys = ["HKLM", "HKCU"].map((hive) => `${hive}\\SOFTWARE\\Policies\\ClaudeCode`);
  return [
    ...plists.flatMap((path) => problemsOf([readPlist(path, runs)])),
    ...(reg === null ? [] : keys.flatMap((key) => problemsOf([readRegistry(reg, key, runs)]))),
    ...places.files.flatMap((dir) => managedProblems(dir)),
  ];
};

// The per-user profile, which Claude Code skips when the user has no name (a UID without a passwd entry).
const userPlist = (preferences: string): string[] => {
  try {
    return [join(preferences, userInfo().username, `${DOMAIN}.plist`)];
  } catch {
    return [];
  }
};

/**
 * What the server-managed settings cached in a Claude Code home loosen; a cache that is no JSON object counts as none,
 * as Claude Code treats it as absent. The startup fetch may bring a newer policy that no launch can read before.
 */
export const cachedPolicyProblems = (home: string): ManagedProblem[] => {
  const read = readManaged(join(home, "remote-settings.json"));
  return read === null || "kind" in read ? [] : problemsOf([read]);
};
