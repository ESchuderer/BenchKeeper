import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED } from "@cedarloom/packs";
import { DEFAULT_PROFILE, planMachine, resolveProfile } from "@cedarloom/profiles";
import { expect, test } from "vitest";

const folder = () => mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-machine-"));

// The machine plan of the default profile with the global rules part's text replaced, for a home of its own.
const planWith = (text: object, home = folder(), target = { home, user: home, guarded: [] as string[] }) => {
  const profile = JSON.parse(readFileSync(join(BUNDLED, DEFAULT_PROFILE.pack, DEFAULT_PROFILE.path), "utf8"));
  profile.machine["rules.global"].text = text;
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
  const plan = planMachine(resolved.value, target, new Map(), new Set(["machine.plugin.ponytail"]));
  return plan.ok ? plan.value : plan.finding;
};

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

test("a plugin's options never land in a Claude Code home, not even through a link", () => {
  const [home, user] = [folder(), folder()];
  mkdirSync(join(user, ".config"));
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(home, join(user, ".config", "ponytail"), "junction");
  expect(planWith({ inline: "- mine\n" }, home, { home, user, guarded: [home] })).toEqual({
    code: "profile.options-guarded",
    params: { part: "machine.plugin.ponytail", path: join(user, ".config", "ponytail", "config.json") },
  });
});
