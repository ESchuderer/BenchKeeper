import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, diffProfile, planProfileCopy } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("profile-copy");
const DEFAULT = { pack: "cedarloom.core", path: "profiles/default.json" };

// A machine's config folder after copying the default into a file of the owner's, and that file's JSON.
const copied = () => {
  const [config, state, folder] = ["config-", "state-", "copy-"].map((name) => mkdtempSync(join(root, name)));
  if (config === undefined || state === undefined || folder === undefined) throw new Error("no folders");
  const file = join(folder, "mine.json");
  expect(ok(applyPlan(state, ok(planProfileCopy(config, DEFAULT, file)), { yes: true })).status).toBe("applied");
  return { config, file, json: JSON.parse(readFileSync(file, "utf8")) };
};

test("init copies a pack's profile into a new file and selects it; never over a file, nor onto the selection", () => {
  const { config, file, json } = copied();
  const selection = JSON.parse(readFileSync(join(config, "profile.json"), "utf8"));
  const fresh = mkdtempSync(join(root, "config-"));
  const own = join(fresh, "profile.json");
  expect([
    json.id,
    selection.profile,
    planProfileCopy(config, DEFAULT, file),
    planProfileCopy(fresh, DEFAULT, own),
  ]).toEqual([
    "cedarloom.default",
    { file },
    { ok: false, finding: { code: "profile.copy-exists", params: { path: file } } },
    { ok: false, finding: { code: "profile.copy-exists", params: { path: own } } },
  ]);
});

test("diff names a part removed from the copy, one added and a changed field, not a part whose keys moved", () => {
  const { config, file, json } = copied();
  delete json.machine["skill.find-skills"];
  json.project.mine = json.project.manual;
  json.name = "Mine";
  json.machine["rules.global"] = Object.fromEntries(Object.entries(json.machine["rules.global"]).toReversed());
  writeFileSync(file, JSON.stringify(json));
  expect(ok(diffProfile(config, DEFAULT))).toEqual([
    { change: "changed", key: "name" },
    { change: "removed", key: "machine.skill.find-skills" },
    { change: "added", key: "project.mine" },
  ]);
});

test("diff compares a profile with its parents: one that extends the pack's and only renames it differs by its name", () => {
  const { config, file, json } = copied();
  delete json.machine;
  delete json.workspace;
  delete json.project;
  writeFileSync(file, JSON.stringify({ ...json, name: "Mine", extends: [DEFAULT] }));
  expect(ok(diffProfile(config, DEFAULT))).toEqual([{ change: "changed", key: "name" }]);
});
