import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  composeProfile,
  type LoadParent,
  Profile,
  PROFILE_SCHEMA_VERSION,
  ProfileFile,
  ProfileSelection,
  readDocument,
  readProfile,
  type Result,
  SELECTION_SCHEMA_VERSION,
} from "@cedarloom/contracts";
import { expect, test } from "vitest";
import { z } from "zod";
import { set } from "./published.ts";

const read = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(join(import.meta.dirname, "..", "corpus", path), "utf8"));
const defaults = await read("CedarLoomProfile/1/valid-default.json");
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
const library = loader({ "cedarloom.core/profiles/default.json": ProfileFile.parse(defaults) });
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
    guards?.type === "settings" &&
      z
        .object({ deny: z.array(z.string()) })
        .parse(guards.set["permissions"])
        .deny.slice(12),
    Object.keys(profile.packs),
    setBy["/machine/plugin.ponytail"],
    setBy["/machine/plugin.ponytail/default"],
    setBy["/project/guards/set/permissions/deny/13"],
    setBy["/project/notes"],
  ]).toEqual([
    "acme.team",
    "off",
    "Ponytail, level full",
    {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_FEEDBACK_COMMAND: "0",
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
    },
    ["Bash(helm upgrade *)", "Bash(npm publish *)"],
    ["cedarloom.core", "acme.frontend"],
    "cedarloom.default",
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
    { type: "rules", title: "Global rules", default: "on", file: "00-global.md", text },
    {
      "docs/agents/issue-tracker.md": { pack: "cedarloom.core", path: "templates/issue-tracker.md" },
      "docs/agents/triage-labels.md": { pack: "cedarloom.core", path: "templates/triage-labels.md" },
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
    params: { pack: "cedarloom.core", path: "profiles/default.json" },
  });
});

test("a part left incomplete by every file, or an auto part without its probe, is refused", () => {
  expect([
    alone({ type: "settings", default: "on" }),
    alone({ type: "settings", title: "x", default: "auto", set: {} }),
  ]).toEqual([["machine.x.title", "machine.x.set"], ["machine.x.when"]]);
});

test("a parent the reader refuses stops the composition with its finding", () => {
  const finding = { code: "profile.foreign-kind", params: { kind: "benchkeeper-profile" } } as const;
  expect(outcome(composeProfile(child, () => ({ ok: false, finding })))).toEqual(finding);
});

test("a part replaced whole forgets who set its fields", () => {
  const files = loader({ "acme.x/c": tier("acme.c", "quick"), "acme.x/a": tier("acme.a", "full", ["c"]) });
  const project = { tier: { type: "packs", title: "p", default: "on", packs: [] } };
  const composed = composeProfile(
    file({ ...own, id: "acme.root", extends: [{ pack: "acme.x", path: "a" }], project }),
    files,
  );
  const setters = composed.ok && Object.entries(composed.value.setBy).filter(([at]) => at.startsWith("/project/"));
  expect(setters).toEqual([["/project/tier", "acme.root"]]);
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

test("one entry from two sources is two parents", () => {
  const other = { "acme.x": { git: "https://x.example/other.git", ref: "main" } };
  const p = file({ ...tier("acme.p", "full", ["base"]), packs: other });
  const files: Record<string, ProfileFile> = {
    "https://x.example/x.git/p": p,
    "https://x.example/x.git/base": tier("acme.base-x", null),
    "https://x.example/other.git/base": tier("acme.base-other", "quick"),
  };
  const bySource: LoadParent = (parent, from) => {
    const source = from.packs?.[parent.pack];
    const found = source !== undefined && "git" in source ? files[`${source.git}/${parent.path}`] : undefined;
    return found === undefined ? undefined : { ok: true, value: found };
  };
  const root = tier("acme.root", "standard", ["p", "base"]);
  const composed = composeProfile(ProfileFile.parse(set(root, ["project"], {})), bySource);
  expect(composed.ok && composed.value.setBy["/project/tier/tier"]).toBe("acme.base-x");
});
