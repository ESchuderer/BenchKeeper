import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

// The keys below, each with its entry in https://code.claude.com/docs/en/settings-reference (the anchor in the comment).
// Boolean keys and the value that lets a command out of the sandbox or past its file and process isolation.
const SWITCHES = [
  ["enabled", false], // #sandbox-enabled
  ["failIfUnavailable", false], // #sandbox-failifunavailable: commands run unsandboxed when the sandbox cannot start
  ["allowUnsandboxedCommands", true], // #sandbox-allowunsandboxedcommands
  ["allowAppleEvents", true], // #sandbox-allowappleevents: removes code-execution isolation on macOS
  ["allowNestedUserNamespaces", true], // #sandbox-allownestedusernamespaces
  ["network.allowAllUnixSockets", true], // #sandbox-network-allowallunixsockets
  ["filesystem.disabled", true], // #sandbox-filesystem-disabled: unrestricted read and write of the host
] as const;
// Top-level keys that switch the workers' guard hook or their deny rules off (#disableallhooks,
// #allowmanagedhooksonly, #allowmanagedpermissionrulesonly).
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
// A proxy of the policy's own takes over filtering: Claude Code stops applying its domain lists to it
// (#sandbox-network-httpproxyport, #sandbox-network-socksproxyport).
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

// A quoted "true" or "false" counts as that Boolean, as Claude Code reads it; any other invalid value keeps the sandbox
// strict (https://code.claude.com/docs/en/managed-settings#invalid-values-inside-sandbox).
const loosens = (value: unknown, loose: boolean): boolean => value === loose || value === String(loose);

interface Settings {
  readonly path: string;
  readonly settings: Json;
}

const codeOf = (error: unknown): string => String(Reflect.get(Object(error), "code"));

// One managed file: null when there is none. A file that cannot be read, or holds no JSON object (a byte order mark
// included), cannot be cleared, so it counts against the launch.
const readManaged = (path: string): Settings | ManagedProblem | null => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return codeOf(error) === "ENOENT" ? null : { kind: "unreadable", path, error: codeOf(error) };
  }
  try {
    // An empty file holds no settings, as Claude Code reads it.
    const settings: unknown = text.trim() === "" ? {} : JSON.parse(text);
    return isObject(settings) ? { path, settings } : { kind: "unreadable", path, error: "not a JSON object" };
  } catch {
    return { kind: "unreadable", path, error: "not JSON" };
  }
};

// The files in the order Claude Code merges them: managed-settings.json, then managed-settings.d/*.json by name, hidden
// files left out (https://code.claude.com/docs/en/managed-settings#split-a-file-based-policy-across-teams).
const managedFiles = (dir: string): (Settings | ManagedProblem | null)[] => {
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

// What one file loosens whatever comes after it: list entries, hosts beyond GitHub, and a policy helper, whose output
// replaces the files this preflight reads (https://code.claude.com/docs/en/settings-reference#policyhelper).
const listed = ({ path, settings }: Settings): ManagedProblem[] => {
  const entries = (key: string): unknown[] => {
    const value = at(sandboxOf(settings), key);
    return Array.isArray(value) ? value : [];
  };
  const keys = [
    ...LISTS.filter((key) => entries(key).length > 0).map((key) => `sandbox.${key}`),
    ...(entries(DOMAINS).some((host) => !GITHUB.has(String(host).toLowerCase())) ? [`sandbox.${DOMAINS}`] : []),
    ...(Object.hasOwn(settings, "policyHelper") ? ["policyHelper"] : []),
  ];
  return keys.map((key) => ({ kind: "loosens", path, key }));
};

/**
 * The managed settings files that loosen the worker sandbox or switch its guard hook off, whatever the worker's own
 * settings say: a managed key outranks --settings. For a Boolean or a port, the last file that sets it wins, as Claude
 * Code merges them; every list entry counts. A file that cannot be read or parsed counts too.
 * shortcut: reads the files only. MDM profiles, the Windows HKLM registry and server-managed settings rank above them,
 * the Windows HKCU registry applies when no admin source does, and wslInheritsWindowsSettings can make WSL read the
 * Windows chain instead; all stay unchecked until a live sandbox
 * probe joins the contract check. Left out on purpose, as common policies set them for ordinary reasons:
 * filesystem.allowWrite, enableWeakerNestedSandbox, enableWeakerNetworkIsolation and network.allowLocalBinding.
 */
export const managedProblems = (dir: string): ManagedProblem[] => {
  const last = new Map<string, { path: string; value: unknown }>();
  const problems: ManagedProblem[] = [];
  for (const read of managedFiles(dir)) {
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
