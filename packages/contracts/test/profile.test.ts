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
])("a profile with %s is refused", ([, key, value]) => {
  const path = `machine.settings.claude-code.set.${key}`;
  const finding = { code: "profile.forbidden-setting", params: { path } };
  expect(outcome(readProfile(set(defaults, [...claude, ...key.split(".")], value)))).toEqual(finding);
});

test.for<[string, (string | number)[], unknown, unknown]>([
  [
    "a token in inline text",
    ["project", "agent-docs", "files", "docs/agents/domain.md"],
    { inline: "use ghp_0123456789abcdefghij0123456789abcdef" },
    secret("project.agent-docs.files.docs/agents/domain.md.inline"),
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
    "a project plugin that would be committed",
    ["project", "plugin"],
    { type: "plugin", commit: true },
    ["project.plugin.type"],
  ],
])("a profile file with %s is refused", ([, path, value, expected]) => {
  expect(outcome(readProfile(set(defaults, path, value)))).toEqual(expected);
});

test.for<[string, (string | number)[], unknown]>([
  ["a token budget, no credential", [...claude, "env", "MAX_THINKING_TOKENS"], "32000"],
  ["npm settings named in text", ["project", "agent-docs", "files", "x.md"], { inline: "Set npm_config_registry." }],
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
])("a composed profile with %s is refused", ([, path, value, issue]) => {
  expect(outcome(readDocument(Profile, PROFILE_SCHEMA_VERSION, set(defaults, path, value)))).toEqual([issue]);
});
