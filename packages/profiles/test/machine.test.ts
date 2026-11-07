import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED } from "@cedarloom/packs";
import { DEFAULT_PROFILE, planMachine, resolveProfile } from "@cedarloom/profiles";
import { expect, test } from "vitest";

const folder = () => mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-machine-"));

// The machine plan of the default profile, changed by `edit`, as a local profile, for a home of its own.
const planOf = (edit: (profile: { machine: Record<string, Record<string, unknown>> }) => void, home = folder()) => {
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
  const plan = planMachine(resolved.value, home, new Map());
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
  expect(planWith({ inline: "- Pin actions by commit, never by ${{ github.ref }}.\n" })).toMatchObject({
    findings: [],
  });
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
