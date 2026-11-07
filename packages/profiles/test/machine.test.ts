import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED } from "@cedarloom/packs";
import { DEFAULT_PROFILE, planMachine, resolveProfile } from "@cedarloom/profiles";
import { expect, test } from "vitest";

const folder = () => mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-machine-"));

// The machine plan of the default profile, changed by `edit`, as a local profile, for a home of its own.
type Edit = (profile: { machine: Record<string, Record<string, unknown>> }) => void;
const planOf = (
  edit: Edit,
  home = folder(),
  { user = home, guarded = [] as string[], allow = [] as string[] } = {},
) => {
  const profile = JSON.parse(readFileSync(join(BUNDLED, DEFAULT_PROFILE.pack, DEFAULT_PROFILE.path), "utf8"));
  edit(profile);
  const file = join(folder(), "mine.json");
  writeFileSync(file, JSON.stringify(profile));
  const selection = {
    schemaVersion: 1 as const,
    kind: "cedarloom.profile-selection" as const,
    profile: { file },
    select: {},
    bindings: { hub: "acme/hub" },
  };
  const resolved = resolveProfile(selection, "0.1.0");
  if (!resolved.ok) throw new Error(resolved.finding.code);
  const plan = planMachine(resolved.value, { home, user, guarded }, new Map(), { approved: new Set(allow) });
  return plan.ok ? plan.value : plan.finding;
};
// The plan with the global rules part's text replaced.
const planWith = (text: object, home = folder()) =>
  planOf((profile) => {
    if (profile.machine["rules.global"] !== undefined) profile.machine["rules.global"]["text"] = text;
  }, home);

test.for<[string, object, unknown]>([
  [
    "a placeholder without a value",
    { inline: "- Ask {{owner}} first.\n" },
    { code: "profile.placeholder-unknown", params: { at: "/machine/rules.global/text", placeholder: "owner" } },
  ],
  [
    "a template where a rules text belongs",
    { pack: "cedarloom.core", path: "templates/orca.yaml" },
    { code: "profile.entry-unknown", params: { pack: "cedarloom.core", path: "templates/orca.yaml", kind: "rules" } },
  ],
])("a rules text with %s stops the plan", ([, text, expected]) => {
  expect(planWith(text)).toEqual(expected);
});

test("a rules file the plan cannot read stops it, by name", () => {
  const home = folder();
  const path = join(home, "rules", "00-global.md");
  mkdirSync(path, { recursive: true });
  expect(planWith({ inline: "- mine\n" }, home)).toEqual({
    code: "document.unreadable",
    params: { path, error: "EISDIR" },
  });
});

test("a rules text may quote a GitHub Actions expression", () => {
  expect("code" in planWith({ inline: "- Pin actions by commit, never by ${{ github.ref }}.\n" })).toBe(false);
});

test("the settings merge into the owner's file and keep every key of theirs", () => {
  const home = folder();
  writeFileSync(join(home, "settings.json"), JSON.stringify({ model: "opus", env: { FOO: "x" } }));
  const planned = planOf((profile) => {
    if (profile.machine["settings.claude-code"] !== undefined) {
      profile.machine["settings.claude-code"]["set"] = {
        autoUpdatesChannel: "latest",
        env: { BASH_DEFAULT_TIMEOUT_MS: "1000" },
      };
    }
  }, home);
  const write =
    "operations" in planned
      ? planned.operations.find((op) => op.kind === "write" && op.path.endsWith(".json"))
      : undefined;
  expect(write?.kind === "write" ? JSON.parse(write.content) : null).toEqual({
    model: "opus",
    env: { FOO: "x", BASH_DEFAULT_TIMEOUT_MS: "1000" },
    autoUpdatesChannel: "latest",
  });
});

// The default profile's plugin parts replaced by the test's own: one from a Git marketplace with options, one from GitHub.
const plugins =
  (more: Record<string, Record<string, unknown>> = {}): Edit =>
  (profile) => {
    const kept = Object.entries(profile.machine).filter(([, part]) => part["type"] !== "plugin");
    profile.machine = {
      ...Object.fromEntries(kept),
      "plugin.a": {
        type: "plugin",
        title: "a",
        default: "on",
        plugin: "a@tools",
        marketplace: { name: "tools", git: "https://x.example/tools.git", ref: "v1" },
        options: { file: ".config/a/config.json", set: { mode: "full" } },
      },
      "plugin.b": {
        type: "plugin",
        title: "b",
        default: "on",
        plugin: "b@shop",
        marketplace: { name: "shop", github: "acme/shop", autoUpdate: true },
      },
      ...more,
    };
  };
const writes = (planned: ReturnType<typeof planOf>) =>
  new Map(
    ("operations" in planned ? planned.operations : []).flatMap((op) =>
      op.kind === "write" && op.path.endsWith(".json") ? [[op.path, JSON.parse(op.content)]] : [],
    ),
  );
const BOTH = ["machine.plugin.a", "machine.plugin.b"];

test("a plugin part waits for approval by name; approved, the settings declare its marketplace and the plugin", () => {
  const home = folder();
  const waiting = planOf(plugins(), home);
  const approved = writes(planOf(plugins(), home, { allow: BOTH }));
  expect([
    "findings" in waiting ? waiting.findings.map(({ code, params }) => [code, params]) : null,
    approved.get(join(home, "settings.json")),
    approved.get(join(home, ".config", "a", "config.json")),
  ]).toMatchObject([
    [
      [
        "profile.approval-needed",
        {
          part: "machine.plugin.a",
          plugin: "a@tools",
          source: "https://x.example/tools.git",
          ref: "v1",
          autoUpdate: false,
        },
      ],
      [
        "profile.approval-needed",
        { part: "machine.plugin.b", plugin: "b@shop", source: "acme/shop", ref: null, autoUpdate: true },
      ],
    ],
    {
      extraKnownMarketplaces: {
        tools: { source: { source: "git", url: "https://x.example/tools.git", ref: "v1" } },
        shop: { source: { source: "github", repo: "acme/shop" }, autoUpdate: true },
      },
      enabledPlugins: { "a@tools": true, "b@shop": true },
    },
    { mode: "full" },
  ]);
});

test("a marketplace the settings already name is replaced whole, never mixed with the profile's", () => {
  const home = folder();
  const old = { source: { source: "github", repo: "old/tools", ref: "main", path: "x.json" } };
  writeFileSync(join(home, "settings.json"), JSON.stringify({ extraKnownMarketplaces: { tools: old } }));
  const settings = writes(planOf(plugins(), home, { allow: ["machine.plugin.a"] })).get(join(home, "settings.json"));
  expect(settings?.extraKnownMarketplaces).toEqual({
    tools: { source: { source: "git", url: "https://x.example/tools.git", ref: "v1" } },
  });
});

test("two plugins with one options file make one write of both sets", () => {
  const home = folder();
  const twin = {
    type: "plugin",
    title: "a2",
    default: "on",
    plugin: "a@shop",
    options: { file: ".config/a/config.json", set: { size: 2 } },
  };
  const planned = planOf(plugins({ "plugin.a2": twin }), home, { allow: ["machine.plugin.a", "machine.plugin.a2"] });
  const path = join(home, ".config", "a", "config.json");
  const count =
    "operations" in planned ? planned.operations.filter((op) => "path" in op && op.path === path).length : 0;
  expect([count, writes(planned).get(path)]).toEqual([1, { mode: "full", size: 2 }]);
});

test("a plugin's options never land in a Claude Code home, not even through a link", () => {
  const [home, user] = [folder(), folder()];
  mkdirSync(join(user, ".config"));
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(home, join(user, ".config", "a"), "junction");
  expect(planOf(plugins(), home, { user, guarded: [home], allow: ["machine.plugin.a"] })).toEqual({
    code: "profile.options-guarded",
    params: { part: "machine.plugin.a", path: join(user, ".config", "a", "config.json") },
  });
});

test("an approval that names no plugin part of the profile stops the plan", () => {
  expect(planOf(plugins(), folder(), { allow: ["plugin.a"] })).toEqual({
    operations: [],
    findings: [{ code: "profile.part-unknown", params: { part: "plugin.a", by: "--allow" } }],
  });
});
