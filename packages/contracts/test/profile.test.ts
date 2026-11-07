import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Profile,
  PROFILE_SCHEMA_VERSION,
  ProfileSelection,
  readDocument,
  readProfile,
  type Result,
  SELECTION_SCHEMA_VERSION,
  targetClass,
} from "@cedarloom/contracts";
import { expect, test } from "vitest";
import { set } from "./published.ts";

const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(join(import.meta.dirname, "..", "corpus", path), "utf8"));
const defaults = await read("CedarLoomProfile/1/valid-default.json");

const outcome = (result: Result<unknown>) => {
  if (result.ok) return "ok";
  return result.finding.code === "document.invalid"
    ? result.finding.params.issues.map((issue) => issue.path)
    : result.finding;
};
const secret = (path: string) => ({ code: "profile.secret-like", params: { path } });
const claude = ["machine", "settings.claude-code", "set"];

test.for(["benchkeeper-profile", "benchkeeper-preset"])("a BenchKeeper file of kind %s is not read", (kind) => {
  expect(outcome(readProfile(set(defaults, ["kind"], kind)))).toEqual({
    code: "profile.foreign-kind",
    params: { kind },
  });
});

test.for<[string, string, unknown]>([
  ["a skipped bypass prompt", "skipDangerousModePermissionPrompt", true],
  ["a hook, which runs a command", "hooks", {}],
  ["bypass as the default mode", "permissions.defaultMode", "bypassPermissions"],
  ["the owner's bypass switch", "permissions.disableBypassPermissionsMode", "disable"],
  ["updates switched off", "env.DISABLE_UPDATES", "1"],
  ["the auto-updater switched off", "env.DISABLE_AUTOUPDATER", "1"],
  ["a base URL, which sends the login elsewhere", "env.ANTHROPIC_BASE_URL", "https://x.example"],
  ["a plugin outside a plugin part", "enabledPlugins", { "x@x": true }],
  ["the sandbox switched off", "sandbox.enabled", false],
])("a profile with %s is refused", ([, key, value]) => {
  const path = `machine.settings.claude-code.set.${key}`;
  const finding = { code: "profile.forbidden-setting", params: { path } };
  expect(outcome(readProfile(set(defaults, [...claude, ...key.split(".")], value)))).toEqual(finding);
});

test("a project's settings, which a commit shares with everyone, are held to the same list", () => {
  const finding = { code: "profile.forbidden-setting", params: { path: "project.guards.set.hooks" } };
  expect(outcome(readProfile(set(defaults, ["project", "guards", "set", "hooks"], {})))).toEqual(finding);
});

test.for<[string, (string | number)[], unknown, unknown]>([
  [
    "a token in inline text",
    ["project", "agent-docs", "files", "docs/agents/domain.md"],
    { inline: "use ghp_0123456789abcdefghij0123456789abcdef" },
    secret("project.agent-docs.files.docs/agents/domain.md.inline"),
  ],
  [
    "a private key in inline text",
    ["project", "agent-docs", "files", "docs/agents/domain.md"],
    { inline: "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n" },
    secret("project.agent-docs.files.docs/agents/domain.md.inline"),
  ],
  [
    "a URL with a password",
    ["project", "agent-docs", "files", "docs/agents/domain.md"],
    { inline: "Proxy: http://bot:hunter22@proxy.example:3128" },
    secret("project.agent-docs.files.docs/agents/domain.md.inline"),
  ],
  [
    "a token as a key, reported where it sits",
    ["workspace", "hub", "labels", "ghp_0123456789abcdefghij0123456789abcdef"],
    { color: "ffffff" },
    secret("workspace.hub.labels"),
  ],
  [
    "a credential in the environment",
    [...claude, "env", "ANTHROPIC_API_KEY"],
    "x",
    secret("machine.settings.claude-code.set.env.ANTHROPIC_API_KEY"),
  ],
  [
    "a pack the file does not name",
    ["machine", "rules.global", "text", "pack"],
    "acme.rules",
    ["machine.rules.global.text.pack"],
  ],
  [
    "the cedarloom publisher from Git",
    ["packs", "cedarloom.core"],
    { git: "https://x.example/a.git", ref: "main" },
    ["packs.cedarloom.core"],
  ],
  ["another publisher bundled", ["packs", "acme.rules"], { bundled: true }, ["packs.acme.rules"]],
  [
    "an undeclared pack in a part called set",
    ["machine", "set"],
    { type: "rules", text: { pack: "acme.rules", path: "a.md" } },
    ["machine.set.text.pack"],
  ],
  ["Codex, which comes with its adapter (PF5)", ["agents"], ["codex"], ["agents.0"]],
  [
    "a requirement without its level",
    ["project", "agent-docs", "requires"],
    ["hub"],
    ["project.agent-docs.requires.0"],
  ],
  [
    "a pack in a packs part the file does not name",
    ["project", "packs", "packs"],
    ["acme.x"],
    ["project.packs.packs.0"],
  ],
  [
    "a project plugin that would be committed",
    ["project", "plugin"],
    { type: "plugin", commit: true },
    ["project.plugin.type"],
  ],
])("a profile file with %s is refused", ([, path, value, expected]) => {
  expect(outcome(readProfile(set(defaults, path, value)))).toEqual(expected);
});

// Claude Code's settings, MCP lists and Git's folder in every spelling a file system would read as them.
test.for([
  ".claude/settings.json",
  "sub/.claude/settings.local.json",
  "sub/.MCP.json",
  "./.claude/settings.json",
  ".claude//settings.json",
  ".mcp.json.",
  ".git/hooks/pre-commit",
  ".git./hooks/pre-commit",
])("a files part may not write %s", (target) => {
  const changed = set(defaults, ["project", "agent-docs", "files", target], { inline: "{}" });
  expect(outcome(readProfile(changed))).toEqual([`project.agent-docs.files.${target}`]);
});

test.for<[string, (string | number)[], unknown]>([
  ["a token budget, no credential", [...claude, "env", "MAX_THINKING_TOKENS"], "32000"],
  ["npm settings named in text", ["project", "agent-docs", "files", "x.md"], { inline: "Set npm_config_registry." }],
  ["a sandbox that only tightens", [...claude, "sandbox"], { enabled: true, filesystem: { denyRead: ["~/.ssh"] } }],
  ["a packs part that requires a part", ["project", "packs", "requires"], ["workspace.hub"]],
])("a profile file with %s is read", ([, path, value]) => {
  expect(outcome(readProfile(set(defaults, path, value)))).toBe("ok");
});

test.for<[string, (string | number)[], unknown]>([
  ["a part without its level", ["select", "memory"], false],
  ["a profile file by a relative path", ["profile"], { file: "profiles/mine.json" }],
])("a selection with %s is refused", async ([, path, value]) => {
  const selection = set(await read("ProfileSelection/1/valid-selection.json"), path, value);
  expect(readDocument(ProfileSelection, SELECTION_SCHEMA_VERSION, selection).ok).toBe(false);
});

test.for<[string, (string | number)[], unknown, string]>([
  ["a part without its title", ["machine", "rules.global", "title"], undefined, "machine.rules.global.title"],
  ["an auto part without its probe", ["project", "orca", "when"], undefined, "project.orca.when"],
  [
    "a plugin's options in Claude Code's settings",
    ["machine", "plugin.ponytail", "options", "file"],
    ".claude/settings.json",
    "machine.plugin.ponytail.options.file",
  ],
  [
    "a plugin's options in gh's credential folder, its own by name",
    ["machine", "plugin.ponytail"],
    { type: "plugin", title: "x", default: "on", plugin: "gh@x", options: { file: ".config/gh/hosts.yml", set: {} } },
    "machine.plugin.ponytail.options.file",
  ],
])("a composed profile with %s is refused", ([, path, value, issue]) => {
  expect(outcome(readDocument(Profile, PROFILE_SCHEMA_VERSION, set(defaults, path, value)))).toEqual([issue]);
});

test("a selection names its profile file by an absolute path, also a UNC path", async () => {
  const selection = set(await read("ProfileSelection/1/valid-selection.json"), ["profile"], {
    file: "\\\\host\\share\\p.json",
  });
  expect(readDocument(ProfileSelection, SELECTION_SCHEMA_VERSION, selection).ok).toBe(true);
});

test.for<[string, string, string]>([
  ["docs/agents/domain.md", "# Domain", "text"],
  ["scripts/dc", "#!/bin/sh\n", "executable"],
  ["tools/check.py", "print(1)", "executable"],
  ["orca.yaml", "scripts: {}", "configuration"],
  [".claude/agents/reviewer.md", "---", "configuration"],
])("a target %s is %s", ([target, text, expected]) => {
  expect(targetClass(target, text)).toBe(expected);
});
