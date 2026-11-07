import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import type { AccountRegistry } from "@cedarloom/contracts";
import {
  deniedPaths,
  ghProbe,
  managedProblems,
  managedSettingsDir,
  programPath,
  readResult,
  resultPrompt,
  workerEnv,
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
};

test("a worker's environment comes from an allowlist, with the profile's token and an empty gh folder", () => {
  const input = { parent, platform: "linux", ghToken: "github_pat_profile", ghConfigDir: "/w/gh" } as const;
  expect(workerEnv(input)).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/dev",
    LANG: "en_US.UTF-8",
    GH_CONFIG_DIR: "/w/gh",
    GH_TOKEN: "github_pat_profile",
  });
  // macOS keeps USER for the keychain login; a profile without a token sets no GH_TOKEN.
  expect(workerEnv({ ...input, platform: "darwin", ghToken: null })).toEqual({
    PATH: "/usr/bin",
    HOME: "/home/dev",
    LANG: "en_US.UTF-8",
    USER: "dev",
    GH_CONFIG_DIR: "/w/gh",
  });
  // Windows names ignore case: its Path is PATH.
  expect(workerEnv({ ...input, parent: { Path: "C:\\Windows" }, platform: "win32" })).toMatchObject({
    Path: "C:\\Windows",
  });
});

const home = (...path: string[]) => join("/home/dev", ...path);

const account = (name: string) =>
  ({ name, agent: "claude", home: `/accounts/${name}`, pool: null, added: "" }) as const;

test("a worker may not read any account's home or alias or the user's credential folders, and reaches GitHub only", () => {
  const registry: AccountRegistry = {
    schemaVersion: 1,
    accounts: [{ ...account("work"), aliases: ["/ade/work"] }, account("spare")],
    pools: {},
  };
  const denied = deniedPaths(registry, "/home/dev", "/home/dev/xdg");
  expect(denied.slice(0, 3)).toEqual(["/accounts/work", "/ade/work", "/accounts/spare"]);
  expect(denied).toEqual(
    expect.arrayContaining([
      home(".ssh"),
      home(".config", "gh"),
      home(".git-credentials"),
      home(".cargo", "credentials.toml"),
      home("Library", "Keychains"),
    ]),
  );
  expect(denied.at(-1)).toBe(join("/home/dev/xdg", "gh"));
  expect(deniedPaths(registry, "/home/dev", undefined)).not.toContain(join("/home/dev/xdg", "gh"));
});

const gh = [process.execPath, join(import.meta.dirname, "fixtures", "fake-gh.ts")] as const;
const env = workerEnv({
  parent: process.env,
  platform: process.platform,
  ghToken: "github_pat_profile",
  ghConfigDir: "/w/gh",
});

test("a launch is refused while gh finds a token without GH_TOKEN, and whenever the check cannot tell", async () => {
  // The profile's own GH_TOKEN is not what the probe looks for: gh runs without it.
  await expect(ghProbe(env, gh)).resolves.toEqual({ ok: true, value: null });
  await expect(ghProbe({ ...env, FAKE_GH_TOKEN: "gho_keyring" }, gh)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.gh-login", params: { error: null } },
  });
  await expect(ghProbe({ ...env, FAKE_GH_EXIT: "4" }, gh)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.gh-login", params: { error: "4" } },
  });
  // No gh installed: nothing to fall back to.
  await expect(ghProbe(env, [join(import.meta.dirname, "no-such-gh")])).resolves.toEqual({ ok: true, value: null });
});

test.skipIf(process.platform === "win32")("a gh that is killed or cannot start refuses the launch too", async () => {
  const killed = ghProbe({ ...env, FAKE_GH_KILL: "1" }, gh);
  await expect(killed).resolves.toMatchObject({ finding: { params: { error: "killed" } } });
  // One that ignores SIGTERM is killed when the time is up.
  const stubborn = ghProbe({ ...env, FAKE_GH_STUBBORN: "1" }, gh, 500);
  await expect(stubborn).resolves.toMatchObject({ finding: { params: { error: "killed" } } });
  // A path through a file: spawn throws ENOTDIR at once, which becomes the same typed refusal.
  await expect(ghProbe(env, [join(gh[1], "gh")])).resolves.toMatchObject({ finding: { params: { error: "ENOTDIR" } } });
  // The fixture is no executable: spawning it fails with EACCES.
  await expect(ghProbe(env, [gh[1]])).resolves.toMatchObject({ finding: { params: { error: "EACCES" } } });
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

const runId = "0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e6f";
const result = { schemaVersion: 1, runId, verdict: "findings", summary: "Two tests fail on Windows." } as const;
const resultFile = (content: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), "cedarloom-result-")), "result.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
};

test("a worker's result counts only as a valid result of its own run", () => {
  expect(readResult(resultFile(result), runId)).toEqual(result);
  expect(readResult(resultFile(result), runId.replace("0b", "1b"))).toBeNull();
  for (const wrong of [
    { ...result, verdict: "done" },
    { ...result, extra: 1 },
    { ...result, summary: "x".repeat(2001) },
  ]) {
    expect(readResult(resultFile(wrong), runId)).toBeNull();
  }
  expect(readResult(resultFile("not json"), runId)).toBeNull();
  expect(readResult(resultFile(" ".repeat(64 * 1024 + 1)), runId)).toBeNull();
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-result-"));
  expect(readResult(join(dir, "missing.json"), runId)).toBeNull();
  mkdirSync(join(dir, "folder"));
  expect(readResult(join(dir, "folder"), runId)).toBeNull();
});

test.skipIf(process.platform === "win32")("a result file that is a link or a FIFO is refused without blocking", () => {
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-result-"));
  symlinkSync(resultFile(result), join(dir, "link.json"));
  expect(readResult(join(dir, "link.json"), runId)).toBeNull();
  execFileSync("mkfifo", [join(dir, "fifo.json")]);
  expect(readResult(join(dir, "fifo.json"), runId)).toBeNull();
});

test("the prompt names the result file and the run, in the form the result is read in", () => {
  const prompt = resultPrompt("/state/workers/0b9f4c1e/out/result.json", runId);
  expect(prompt).toContain("/state/workers/0b9f4c1e/out/result.json");
  expect(prompt).toContain(`"runId":"${runId}"`);
  expect(prompt).toContain('"schemaVersion":1');
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
