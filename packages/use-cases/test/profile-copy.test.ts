import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, diffProfile, planProfileCopy } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("profile-copy");
const DEFAULT = "cedarloom.core/profiles/default.json";
// The bundled default as the repository holds it, read here and not through the packs it ships in.
const shipped = readFileSync(
  new URL("../../packs/bundled/cedarloom.core/profiles/default.json", import.meta.url),
  "utf8",
);

// A machine's config folder after copying the default into a file of the owner's.
const copied = () => {
  const [config, state, folder] = ["config-", "state-", "copy-"].map((name) => mkdtempSync(join(root, name)));
  if (config === undefined || state === undefined || folder === undefined) throw new Error("no folders");
  const file = join(folder, "mine.json");
  expect(ok(applyPlan(state, ok(planProfileCopy(config, DEFAULT, file)), { yes: true })).status).toBe("applied");
  return { config, file };
};

test("init copies a pack's profile into a file of the owner's and selects that file", () => {
  const { config, file } = copied();
  const selection = JSON.parse(readFileSync(join(config, "profile.json"), "utf8"));
  expect([readFileSync(file, "utf8"), selection.profile]).toEqual([shipped, { file }]);
});

test("diff names a part removed from the copy, one added and a changed field, not a part whose keys moved", () => {
  const { config, file } = copied();
  const json = JSON.parse(shipped);
  delete json.machine["skill.find-skills"];
  json.project.mine = json.project.manual;
  json.name = "Mine";
  json.machine["rules.global"] = Object.fromEntries(Object.entries(json.machine["rules.global"]).reverse());
  writeFileSync(file, JSON.stringify(json));
  expect(ok(diffProfile(config, DEFAULT))).toEqual([
    { change: "changed", key: "name" },
    { change: "removed", key: "machine.skill.find-skills" },
    { change: "added", key: "project.mine" },
  ]);
});
