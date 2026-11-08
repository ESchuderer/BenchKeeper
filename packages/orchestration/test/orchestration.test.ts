import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { delimiter, join, relative } from "node:path";
import {
  cleanEnv,
  managedProblems,
  managedSettingsDir,
  policyProblems,
  type Run,
  programPath,
} from "@cedarloom/orchestration";
import { expect, test } from "vitest";

// A launcher environment with lower- and mixed-case copies of the names, which only Windows takes for the real ones.
const parent = {
  PATH: "/usr/bin",
  path: "/tmp/hostile",
  HOME: "/home/dev",
  Home: "/tmp/hostile",
  LANG: "en_US.UTF-8",
  USER: "dev",
  user: "hostile",
  ANTHROPIC_API_KEY: "k",
  GITHUB_TOKEN: "ghp_launcher",
  CLAUDE_CODE_SIMPLE: "1",
  ANTHROPIC_MODEL: "claude-other",
  TZ: undefined,
  SystemRoot: "C:\\Windows",
};

test("a child's environment comes from an allowlist: no token, login variable or other case of a name", () => {
  expect(cleanEnv(parent, "linux")).toEqual({ PATH: "/usr/bin", HOME: "/home/dev", LANG: "en_US.UTF-8" });
  // macOS keeps USER for the keychain login.
  expect(cleanEnv(parent, "darwin")).toEqual({ PATH: "/usr/bin", HOME: "/home/dev", LANG: "en_US.UTF-8", USER: "dev" });
  // Windows names ignore case: its Path is PATH. Its system and temp folders stay there, and only there.
  const windows = { Path: "C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\Temp" };
  expect(cleanEnv(windows, "win32")).toEqual(windows);
});

test("a program is found by its file in an absolute folder of PATH only, never through a relative or empty entry", () => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-program-"));
  const file = process.platform === "win32" ? "tool.exe" : "tool";
  for (const folder of ["near", "far"]) {
    mkdirSync(join(root, folder));
    writeFileSync(join(root, folder, file), "");
    chmodSync(join(root, folder, file), 0o755);
  }
  // A relative entry first, as a project's folder would be: it is passed over.
  const near = relative(process.cwd(), join(root, "near"));
  expect(programPath("tool", { PATH: [near, "", join(root, "far")].join(delimiter) })).toBe(join(root, "far", file));
  expect(programPath("tool", { PATH: [near, ""].join(delimiter) })).toBeUndefined();
  expect(programPath(join(root, "near", file), { PATH: "" })).toBe(join(root, "near", file));
});

// A managed settings folder with these files, by name below it.
const managed = (files: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-managed-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
};
const drop = (name: string) => join("managed-settings.d", name);
const MAIN = "managed-settings.json";
// The keys the one managed-settings.json of `sandbox` loosens.
const loosened = (settings: unknown) => {
  const dir = managed({ [MAIN]: settings });
  return managedProblems(dir).map((problem) => (problem.kind === "loosens" ? problem.key : problem.error));
};

test("the managed settings folder is the platform's documented system folder", () => {
  expect(managedSettingsDir("darwin")).toBe("/Library/Application Support/ClaudeCode");
  expect(managedSettingsDir("linux")).toBe("/etc/claude-code");
  expect(managedSettingsDir("win32")).toBe("C:\\Program Files\\ClaudeCode");
  expect(managedSettingsDir("freebsd")).toBeNull();
});

test("each documented sandbox escape is found, with the file that sets it", () => {
  const escapes = {
    enabled: false,
    failIfUnavailable: "false",
    allowUnsandboxedCommands: true,
    allowAppleEvents: "true",
    allowNestedUserNamespaces: true,
    excludedCommands: ["docker"],
    filesystem: { disabled: true },
    network: { allowAllUnixSockets: true, allowUnixSockets: ["/var/run/docker.sock"], allowMachLookup: ["*"] },
  };
  expect(loosened({ sandbox: escapes }).toSorted()).toEqual(
    [
      "sandbox.enabled",
      "sandbox.failIfUnavailable",
      "sandbox.allowUnsandboxedCommands",
      "sandbox.allowAppleEvents",
      "sandbox.allowNestedUserNamespaces",
      "sandbox.excludedCommands",
      "sandbox.filesystem.disabled",
      "sandbox.network.allowAllUnixSockets",
      "sandbox.network.allowUnixSockets",
      "sandbox.network.allowMachLookup",
    ].toSorted(),
  );
  const dir = managed({ [MAIN]: { sandbox: { enabled: false } } });
  expect(managedProblems(dir)).toEqual([{ kind: "loosens", path: join(dir, MAIN), key: "sandbox.enabled" }]);
  // A strict policy, an invalid value (strict until fixed), empty lists and the keys left out loosen nothing.
  const strict = {
    enabled: "on",
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    allowAppleEvents: false,
    excludedCommands: [],
    filesystem: { disabled: false, allowWrite: ["/tmp/build"] },
    network: { allowedDomains: ["GitHub.com", "*.githubusercontent.com"], allowLocalBinding: true },
    enableWeakerNestedSandbox: true,
  };
  expect(loosened({ sandbox: strict })).toEqual([]);
  expect(managedProblems(managed({}))).toEqual([]);
});

test("managed keys that switch the guard hook or the deny rules off are found; false leaves them on", () => {
  const off = { disableAllHooks: true, allowManagedHooksOnly: "true", allowManagedPermissionRulesOnly: true };
  expect(loosened({ ...off, strictPluginOnlyCustomization: ["hooks"] }).toSorted()).toEqual(
    [
      "disableAllHooks",
      "allowManagedHooksOnly",
      "allowManagedPermissionRulesOnly",
      "strictPluginOnlyCustomization",
    ].toSorted(),
  );
  expect(loosened({ disableAllHooks: false, allowManagedHooksOnly: false })).toEqual([]);
});

test("hosts beyond GitHub, a proxy of the policy's own, and a policy helper are found", () => {
  expect(loosened({ sandbox: { network: { allowedDomains: ["github.com", "registry.npmjs.org"] } } })).toEqual([
    "sandbox.network.allowedDomains",
  ]);
  expect(loosened({ sandbox: { network: { httpProxyPort: 8080, socksProxyPort: 8081 } } })).toEqual([
    "sandbox.network.httpProxyPort",
    "sandbox.network.socksProxyPort",
  ]);
  // A port set to null names no proxy.
  expect(loosened({ sandbox: { network: { httpProxyPort: null } } })).toEqual([]);
  // Its output replaces the files, so what they say is not what applies.
  expect(loosened({ policyHelper: { path: "/usr/local/bin/policy" } })).toEqual(["policyHelper"]);
});

test("a managed file that cannot be read or holds no JSON object counts against the launch", () => {
  // A byte order mark, text that is no JSON, a top level that is no object, and a folder in a file's place.
  expect(loosened(`\uFEFF${JSON.stringify({ sandbox: { enabled: true } })}`)).toEqual(["not JSON"]);
  expect(loosened("{")).toEqual(["not JSON"]);
  // An empty file holds no settings, as Claude Code reads it.
  expect(loosened("")).toEqual([]);
  expect(loosened(" \n")).toEqual([]);
  expect(loosened([])).toEqual(["not a JSON object"]);
  const folder = managed({ [join(MAIN, "inner.json")]: {} });
  expect(managedProblems(folder)).toEqual([{ kind: "unreadable", path: join(folder, MAIN), error: "EISDIR" }]);
  // A drop-in folder that is a file cannot be listed.
  const dropFile = managed({ "managed-settings.d": "not a folder" });
  expect(managedProblems(dropFile)).toEqual([
    { kind: "unreadable", path: join(dropFile, "managed-settings.d"), error: "ENOTDIR" },
  ]);
});

test("drop-in files merge after managed-settings.json in name order, the later value winning", () => {
  const dir = managed({
    [MAIN]: { sandbox: { enabled: true, failIfUnavailable: "false" } },
    [drop("10-off.json")]: { sandbox: { enabled: false } },
    [drop("20-on.json")]: { sandbox: { enabled: true } },
    [drop("30-fail.json")]: { sandbox: { failIfUnavailable: true } },
    // Hidden, not JSON by name, or no sandbox block: none of them counts.
    [drop(".hidden.json")]: { sandbox: { enabled: false } },
    [drop("notes.txt")]: { sandbox: { enabled: false } },
    [drop("50-other.json")]: { model: "claude-sonnet-5-5", sandbox: "off" },
  });
  expect(managedProblems(dir)).toEqual([]);
  const off = managed({
    [MAIN]: { sandbox: { enabled: true } },
    [drop("90-off.json")]: { sandbox: { enabled: false } },
  });
  expect(managedProblems(off)).toEqual([
    { kind: "loosens", path: join(off, drop("90-off.json")), key: "sandbox.enabled" },
  ]);
  // A broken drop-in counts against the launch like a broken main file.
  const broken = managed({ [drop("40-broken.json")]: "{" });
  expect(managedProblems(broken)).toEqual([
    { kind: "unreadable", path: join(broken, drop("40-broken.json")), error: "not JSON" },
  ]);
});

// reg.exe's answers, as Windows prints them: a key with its Settings value, and one that is absent.
const REG_FOUND = (json: string) =>
  `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\ClaudeCode\r\n    Settings    REG_SZ    ${json}\r\n\r\n`;
const REG_ABSENT = "ERROR: The system was unable to find the specified registry key or value.\r\n";

test("a configuration profile's plist and a policy registry value are read like the files, each source on its own", () => {
  const preferences = mkdtempSync(join(tmpdir(), "cedarloom-preferences-"));
  const files = managed({ [MAIN]: { disableAllHooks: false } });
  mkdirSync(join(preferences, userInfo().username));
  const device = join(preferences, "com.anthropic.claudecode.plist");
  const user = join(preferences, userInfo().username, "com.anthropic.claudecode.plist");
  for (const path of [device, user]) writeFileSync(path, "plist");
  // plutil's JSON per plist; reg's answer per hive.
  const answers: Record<string, ReturnType<Run>> = {
    [device]: { status: 0, stdout: JSON.stringify({ disableAllHooks: true }), stderr: "" },
    [user]: { status: 1, stdout: "", stderr: "invalid object in plist for destination format" },
    "HKLM\\SOFTWARE\\Policies\\ClaudeCode": {
      status: 0,
      stdout: REG_FOUND('{"sandbox":{"enabled":false}}'),
      stderr: "",
    },
    "HKCU\\SOFTWARE\\Policies\\ClaudeCode": { status: 1, stdout: "", stderr: REG_ABSENT },
  };
  const run: Run = (_, args) =>
    answers[args.at(-1) === "Settings" ? (args[1] ?? "") : (args.at(-1) ?? "")] ?? {
      status: null,
      stdout: "",
      stderr: "",
    };
  expect(policyProblems({ files: [files], preferences, reg: "reg.exe" }, run)).toEqual([
    { kind: "unreadable", path: user, error: "plutil" },
    // Though the files keep hooks on, the device's profile switches them off.
    { kind: "loosens", path: device, key: "disableAllHooks" },
    { kind: "loosens", path: "HKLM\\SOFTWARE\\Policies\\ClaudeCode\\Settings", key: "sandbox.enabled" },
  ]);
});
