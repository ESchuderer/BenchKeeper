import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  composeProfile,
  FILES_SCHEMA_VERSION,
  type LoadParent,
  MAX_PROFILE_FILES,
  Profile,
  PROFILE_SCHEMA_VERSION,
  ProfileFile,
  ProfileFiles,
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
const defaults = await read("CedarLoomProfile/1/valid-full.json");
const child = ProfileFile.parse(await read("CedarLoomProfile/1/valid-child.json"));

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
    ["project.plugin.commit"],
  ],
  [
    "a dev container Template by tag, whose files could change between the preview and the apply",
    ["project", "container", "template"],
    "ghcr.io/devcontainers/templates/alpine:3",
    ["project.container.template"],
  ],
  [
    "a cooldown of 0 days, which Dependabot refuses",
    ["project", "gates", "dependabotCooldownDays"],
    0,
    ["project.gates.dependabotCooldownDays"],
  ],
  [
    "an unknown key shaped like a token, reported at its object",
    ["machine", "rules.global", "ghp_0123456789abcdefghij0123456789abcdef"],
    1,
    ["machine.rules.global"],
  ],
  [
    "a broken label named like a token, reported at its object",
    ["workspace", "hub", "labels", "ghp_0123456789abcdefghij0123456789abcdef"],
    { color: "white" },
    ["workspace.hub.labels"],
  ],
])("a profile file with %s is refused", ([, path, value, expected]) => {
  expect(outcome(readProfile(set(defaults, path, value)))).toEqual(expected);
});

// Claude Code's settings, MCP lists, Git's folder and CedarLoom's record in every spelling a file system would read as them.
test.for([
  ".claude/settings.json",
  "sub/.claude/settings.local.json",
  "sub/.MCP.json",
  "./.claude/settings.json",
  ".claude//settings.json",
  ".mcp.json.",
  ".git/hooks/pre-commit",
  ".git./hooks/pre-commit",
  "AGENTS.md",
  "claude.local.md",
  ".cedarloom/profile-files.json",
  "sub/.CedarLoom/profile-files.json",
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
  ["a gates source at a branch, which can move", ["bindings", "gates"], "acme/workflows@main"],
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
  [
    "a plugin's options in Claude Code's folder by its XDG name",
    ["machine", "plugin.ponytail"],
    {
      type: "plugin",
      title: "x",
      default: "on",
      plugin: "claude@x",
      options: { file: ".config/claude/settings.json", set: {} },
    },
    "machine.plugin.ponytail.options.file",
  ],
  [
    "a plugin's marketplace named apart from its plugin id",
    ["machine", "plugin.ponytail", "marketplace", "name"],
    "pony",
    "machine.plugin.ponytail.marketplace.name",
  ],
  [
    "a skill from Git whose folder would be no skill's name",
    ["machine", "skill.review", "source"],
    { git: "https://github.com/acme/skills.git", ref: "main", path: "skills/find--skills" },
    "machine.skill.review.source",
  ],
  [
    "two skills that install into one folder",
    ["machine", "skill.twin"],
    { type: "skill", title: "twin", default: "on", source: { git: "https://github.com/acme/review.git", ref: "main" } },
    "machine.skill.twin.source",
  ],
])("a composed profile with %s is refused", ([, path, value, issue]) => {
  expect(outcome(readDocument(Profile, PROFILE_SCHEMA_VERSION, set(defaults, path, value)))).toEqual([issue]);
});

const base = { schemaVersion: 1, kind: "cedarloom.profile", version: "1.0.0", name: "x", minApp: "0.1.0" };
const file = (fields: object): ProfileFile => ProfileFile.parse({ ...base, ...fields });
const own = { packs: { "acme.x": { git: "https://x.example/x.git", ref: "main" } }, agents: ["claude-code"] };
const loader =
  (files: Record<string, ProfileFile>): LoadParent =>
  (parent) => {
    const found = files[`${parent.pack}/${parent.path}`];
    return found === undefined ? undefined : { ok: true, value: found };
  };
const alone = (part: object) =>
  outcome(composeProfile(file({ ...own, id: "acme.root", machine: { x: part } }), loader({})));
const library = loader({ "acme.shared/profiles/full.json": ProfileFile.parse(defaults) });
const tier = (id: string, value: string | null, parents: string[] = []) =>
  file({
    ...own,
    id,
    ...(parents.length > 0 ? { extends: parents.map((path) => ({ pack: "acme.x", path })) } : {}),
    project: { tier: { type: "tier", title: id, default: "on", tier: value } },
  });

test("a child states only what it changes: the later value wins, lists grow, and each value names who set it", () => {
  const composed = composeProfile(child, library);
  if (!composed.ok) throw new Error(composed.finding.code);
  const { profile, setBy } = composed.value;
  const ponytail = profile.machine["plugin.ponytail"];
  const guards = profile.project["guards"];
  expect([
    profile.id,
    ponytail?.default,
    ponytail?.title,
    profile.machine["settings.claude-code"]?.type === "settings" && profile.machine["settings.claude-code"].set["env"],
    guards?.type === "settings" && guards.set["permissions"],
    Object.keys(profile.packs),
    setBy["/machine/plugin.ponytail"],
    setBy["/machine/plugin.ponytail/default"],
    setBy["/project/guards/set/permissions/deny/2"],
    setBy["/project/notes"],
  ]).toEqual([
    "acme.team",
    "off",
    "Ponytail at level ultra",
    { DISABLE_ERROR_REPORTING: "1", DISABLE_FEEDBACK_COMMAND: "0" },
    { deny: ["Bash(sudo *)", "Bash(git push *--force*)", "Bash(npm publish *)"] },
    ["acme.shared", "acme.frontend"],
    "acme.full",
    "acme.team",
    "acme.team",
    "acme.team",
  ]);
});

test("a part of another type, and a text from another source, replace the parent's whole", () => {
  const text = { inline: "# Mine\n" };
  const mine = ProfileFile.parse({
    ...child,
    machine: {
      "settings.claude-code": { type: "rules", title: "Mine", default: "on", file: "mine.md", text },
      "rules.global": { type: "rules", text },
    },
    project: { "agent-docs": { type: "files", files: { "docs/agents/domain.md": text } } },
  });
  const composed = composeProfile(mine, library);
  const docs = composed.ok && composed.value.profile.project["agent-docs"];
  expect(
    composed.ok && [
      composed.value.profile.machine["settings.claude-code"],
      composed.value.profile.machine["rules.global"],
      docs && docs.type === "files" && docs.files,
    ],
  ).toEqual([
    { type: "rules", title: "Mine", default: "on", file: "mine.md", text },
    { type: "rules", title: "Acme rules", default: "on", file: "10-acme.md", text },
    {
      "docs/agents/one.md": { pack: "acme.shared", path: "templates/one.md" },
      "docs/agents/two.md": { pack: "acme.shared", path: "templates/two.md" },
      "docs/agents/domain.md": text,
    },
  ]);
});

test("parents apply in list order after their own parents, a shared one once at its first place", () => {
  // b changes nothing itself, so c applied again after a would take back a's change.
  const b = file({ ...own, id: "acme.b", extends: [{ pack: "acme.x", path: "c" }] });
  const files = { a: tier("acme.a", "full", ["c"]), b, c: tier("acme.c", "quick") };
  const root = file({
    ...own,
    id: "acme.root",
    extends: [
      { pack: "acme.x", path: "a" },
      { pack: "acme.x", path: "b" },
    ],
  });
  const composed = composeProfile(
    root,
    loader(Object.fromEntries(Object.entries(files).map(([key, value]) => [`acme.x/${key}`, value]))),
  );
  expect(composed.ok && [composed.value.profile.project["tier"], composed.value.setBy["/project/tier/tier"]]).toEqual([
    { type: "tier", title: "acme.a", default: "on", tier: "full" },
    "acme.a",
  ]);
});

test("a parent that leads back to a profile on the way is refused, with the circle", () => {
  const files = loader({ "acme.x/a": tier("acme.a", "full", ["b"]), "acme.x/b": tier("acme.b", "full", ["a"]) });
  expect(outcome(composeProfile(tier("acme.root", "full", ["a"]), files))).toEqual({
    code: "profile.parent-cycle",
    params: { chain: ["acme.x/a", "acme.x/b", "acme.x/a"] },
  });
});

test("a parent its pack does not hold is refused", () => {
  expect(outcome(composeProfile(child, loader({})))).toEqual({
    code: "profile.parent-unknown",
    params: { pack: "acme.shared", path: "profiles/full.json" },
  });
});

test("a part left incomplete by every file, or an auto part without its probe, is refused", () => {
  expect([
    alone({ type: "settings", default: "on" }),
    alone({ type: "settings", title: "x", default: "auto", set: {} }),
  ]).toEqual([["machine.x.title", "machine.x.set"], ["machine.x.when"]]);
});

const foreign = (kind: string) => ({ code: "profile.foreign-kind", params: { kind } });
test("the root and each parent are read as profiles, so a file the reader refuses stops the composition", () => {
  expect([
    outcome(composeProfile(child, () => ({ ok: true, value: { kind: "benchkeeper-profile" } }))),
    outcome(composeProfile({ kind: "benchkeeper-preset" }, library)),
  ]).toEqual([foreign("benchkeeper-profile"), foreign("benchkeeper-preset")]);
});

const manual = (text: string) => ({
  manual: { type: "manual", title: "m", default: "on", claudeImport: true, rules: [{ inline: text }] },
});
const withOptions = (options: object) => set(defaults, ["machine", "plugin.ponytail", "options", "set"], options);
test("a plugin's options hold at most 1,000 values, since a file of them would merge value by value", () => {
  const full = Object.fromEntries(Array.from({ length: 1000 }, (_, at) => [`k${at}`, at]));
  expect([outcome(readProfile(withOptions(full))), outcome(readProfile(withOptions({ ...full, more: 1 })))]).toEqual([
    "ok",
    ["machine.plugin.ponytail.options.set"],
  ]);
});

test("a list of texts grows like any list", () => {
  const parent = file({ ...own, id: "acme.p", project: manual("a\n") });
  const root = file({ ...own, id: "acme.root", extends: [{ pack: "acme.x", path: "p" }], project: manual("b\n") });
  const composed = composeProfile(root, loader({ "acme.x/p": parent }));
  const part = composed.ok && composed.value.profile.project["manual"];
  expect(part && part.type === "manual" && part.rules).toEqual([{ inline: "a\n" }, { inline: "b\n" }]);
});

test(`more than ${MAX_PROFILE_FILES} profile files through parents are refused, however deep they go`, () => {
  const files = Object.fromEntries(
    Array.from({ length: 60 }, (_, at) => [
      `acme.x/${at}`,
      file({ ...own, id: `acme.f${at}`, extends: [{ pack: "acme.x", path: String(at + 1) }] }),
    ]),
  );
  const root = file({ ...own, id: "acme.root", extends: [{ pack: "acme.x", path: "0" }] });
  const composed = composeProfile(root, loader(files));
  expect(!composed.ok && composed.finding.code === "profile.parent-limit" && composed.finding.params).toEqual({
    chain: Array.from({ length: 50 }, (_, at) => `acme.x/${at}`),
    limit: 50,
  });
});

const deny = (rule: string) => ({
  guards: { type: "settings", title: "g", default: "on", commit: true, set: { permissions: { deny: [rule] } } },
});
test("a part replaced whole forgets who set its values, however deep they sit", () => {
  const files = loader({
    "acme.x/c": file({ ...own, id: "acme.c", project: deny("Bash(sudo *)") }),
    "acme.x/a": file({ ...own, id: "acme.a", extends: [{ pack: "acme.x", path: "c" }], project: deny("Bash(curl *)") }),
  });
  const project = { guards: { type: "packs", title: "p", default: "on", packs: [] } };
  const composed = composeProfile(
    file({ ...own, id: "acme.root", extends: [{ pack: "acme.x", path: "a" }], project }),
    files,
  );
  const setters = composed.ok && Object.entries(composed.value.setBy).filter(([at]) => at.startsWith("/project/"));
  expect(setters).toEqual([["/project/guards", "acme.root"]]);
});

const hub = (id: string, label: string) => ({
  type: "hub",
  title: id,
  default: "on",
  labels: { [label]: { color: "ffffff" } },
});

test("a label named like a source field merges as a label", () => {
  const parent = file({ ...own, id: "acme.p", workspace: { hub: hub("acme.p", "github") } });
  const root = file({
    ...own,
    id: "acme.root",
    extends: [{ pack: "acme.x", path: "p" }],
    workspace: { hub: hub("acme.root", "extra") },
  });
  const composed = composeProfile(root, loader({ "acme.x/p": parent }));
  const labels =
    composed.ok &&
    composed.value.profile.workspace["hub"]?.type === "hub" &&
    composed.value.profile.workspace["hub"].labels;
  expect(Object.keys(labels || {})).toEqual(["github", "extra"]);
});

test("a pack id two files give different sources is refused, naming both files", () => {
  const parent = file({
    ...own,
    id: "acme.p",
    packs: { "acme.x": { git: "https://x.example/other.git", ref: "main" } },
  });
  const root = file({ ...own, id: "acme.root", extends: [{ pack: "acme.x", path: "p" }] });
  expect(outcome(composeProfile(root, loader({ "acme.x/p": parent })))).toEqual({
    code: "profile.pack-sources",
    params: { pack: "acme.x", files: ["acme.p", "acme.root"] },
  });
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

// A recorded pack is a pack id and its SemVer version, so a newer one is never read as older (hub issue 160).
test.for<[string, boolean]>([
  ["cedarloom.core@0.1.0", true],
  ["cedarloom.core@1.2.3-rc.1", true],
  ["cedarloom.core", false],
  ["cedarloom.core@0.1", false],
  ["cedarloom.core@0", false],
  ["core@0.1.0", false],
])("a record's pack %s is read: %s", ([pack, valid]) => {
  const record = {
    schemaVersion: 1,
    kind: "cedarloom.profile-files",
    files: { "a.md": { sha256: "0".repeat(64), pack } },
  };
  expect(readDocument(ProfileFiles, FILES_SCHEMA_VERSION, record).ok).toBe(valid);
});
