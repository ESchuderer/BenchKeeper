import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileSelection } from "@cedarloom/contracts";
import { BUNDLED } from "@cedarloom/packs";
import { DEFAULT_PROFILE, resolveProfile } from "@cedarloom/profiles";
import { expect, test } from "vitest";

const selection = (fields: Partial<ProfileSelection>): ProfileSelection => ({
  schemaVersion: 1,
  kind: "cedarloom.profile-selection",
  profile: DEFAULT_PROFILE,
  select: {},
  bindings: { hub: "acme/hub" },
  ...fields,
});
const problems = (chosen: ProfileSelection, app = "0.1.0") => {
  const resolved = resolveProfile(chosen, app);
  return resolved.ok ? resolved.value.problems : [resolved.finding];
};

// The default profile's file with another minApp and any extra fields, as a local profile.
const local = (minApp: string, extra = {}): ProfileSelection => {
  const file = join(mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-profile-")), "mine.json");
  const text = readFileSync(join(BUNDLED, DEFAULT_PROFILE.pack, DEFAULT_PROFILE.path), "utf8");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(text), minApp, ...extra }));
  return selection({ profile: { file } });
};

test.for<[string, ProfileSelection, unknown[]]>([
  [
    "the hub on without its repository",
    selection({ bindings: {} }),
    [{ code: "profile.binding-missing", params: { part: "workspace.hub", binding: "hub" } }],
  ],
  [
    "the hub off while project parts need it",
    selection({ select: { "workspace.hub": false } }),
    [
      { code: "profile.part-requires", params: { part: "project.local-manual", requires: "workspace.hub" } },
      { code: "profile.part-requires", params: { part: "project.agent-docs", requires: "workspace.hub" } },
    ],
  ],
  [
    "a part the profile lacks",
    selection({ select: { "machine.rules.gone": false } }),
    [{ code: "profile.part-unknown", params: { part: "machine.rules.gone", by: "The selection" } }],
  ],
  [
    "a local profile for a newer CedarLoom",
    local("9.0.0"),
    [{ code: "profile.app-too-old", params: { minApp: "9.0.0", app: "0.1.0" } }],
  ],
  [
    "a local profile for a newer CedarLoom with a field this one does not know",
    local("9.0.0", { future: true }),
    [{ code: "profile.app-too-old", params: { minApp: "9.0.0", app: "0.1.0" } }],
  ],
])("a selection with %s does not apply", ([, chosen, expected]) => {
  expect(problems(chosen)).toEqual(expected);
});

test("a bundled profile ships with its release, so a development build reads it", () => {
  expect(problems(selection({}), "0.0.0")).toEqual([]);
});
