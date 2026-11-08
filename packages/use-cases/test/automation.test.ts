import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "@cedarloom/ledger";
import { applyPlan, automationSettings, planLevel } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

const folders = () => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-automation-"));
  return { root, config: join(root, "config"), state: join(root, "state") };
};

// A project folder and a symbolic link to it.
const appWithLink = (root: string) => {
  const app = join(root, "app");
  mkdirSync(app);
  const link = join(root, "link");
  symlinkSync(app, link, "dir");
  return { app, link };
};

test("settings that are no settings, or a folder in their place, are reported", () => {
  const { root, config } = folders();
  mkdirSync(join(config, "automation.json"), { recursive: true });
  expect(automationSettings(config)).toMatchObject({ ok: false, finding: { params: { error: "EISDIR" } } });
  const invalid = join(root, "invalid");
  mkdirSync(invalid);
  writeFileSync(join(invalid, "automation.json"), "{}");
  expect(automationSettings(invalid)).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
});

// Plans `change`, checks the plan's one write against the file as it is, and applies it.
const setLevel = (state: string, config: string, change: Parameters<typeof planLevel>[1]) => {
  const planned = planLevel(config, change);
  if (!planned.ok) throw new Error(planned.finding.code);
  const applied = applyPlan(state, planned.value, { yes: true });
  if (!applied.ok || applied.value.status !== "applied") throw new Error("not applied");
  return planned.value;
};

test("the default and each project's level are set by plan, sorted by folder; default gives a project the default", () => {
  const { root, config, state } = folders();
  const a = join(root, "a");
  const b = join(root, "b");
  for (const folder of [a, b]) mkdirSync(folder);
  const path = join(config, "automation.json");
  const first = setLevel(state, config, { project: null, level: "checkpoint" });
  expect(first.operations).toEqual([
    {
      kind: "write",
      path,
      before: null,
      content: `${JSON.stringify({ schemaVersion: 1, default: "checkpoint", projects: {} }, null, 2)}\n`,
    },
  ]);
  setLevel(state, config, { project: b, level: "auto" });
  const before = readFileSync(path, "utf8");
  const third = setLevel(state, config, { project: a, level: "supervised" });
  expect(third.operations[0]).toMatchObject({ before: sha256(before) });
  const realA = realpathSync.native(a);
  const realB = realpathSync.native(b);
  expect(Object.keys(JSON.parse(readFileSync(path, "utf8")).projects)).toEqual([realA, realB]);
  setLevel(state, config, { project: b, level: null });
  expect(automationSettings(config)).toEqual({
    ok: true,
    value: { schemaVersion: 1, default: "checkpoint", projects: { [realA]: "supervised" } },
  });
});

test("a project is its folder's real path: a link to it changes the same entry, and a missing folder is refused", () => {
  const { root, config, state } = folders();
  const { app, link } = appWithLink(root);
  setLevel(state, config, { project: link, level: "supervised" });
  setLevel(state, config, { project: app, level: "auto" });
  expect(automationSettings(config)).toMatchObject({ value: { projects: { [realpathSync.native(app)]: "auto" } } });
  expect(Object.keys(JSON.parse(readFileSync(join(config, "automation.json"), "utf8")).projects)).toHaveLength(1);
  const missing = join(root, "gone");
  expect(planLevel(config, { project: missing, level: "auto" })).toEqual({
    ok: false,
    finding: { code: "automation.unknown-folder", params: { path: missing } },
  });
  // A file is no project folder either.
  writeFileSync(join(root, "file"), "");
  expect(planLevel(config, { project: join(root, "file"), level: "auto" })).toMatchObject({
    finding: { code: "automation.unknown-folder" },
  });
});

test("a folder that is gone can still be given the default again, by the path it was set under", () => {
  const { config, state } = folders();
  mkdirSync(config, { recursive: true });
  const settings = { schemaVersion: 1, default: "checkpoint", projects: { "/work/gone": "auto" } };
  writeFileSync(join(config, "automation.json"), JSON.stringify(settings));
  setLevel(state, config, { project: "/work/gone", level: null });
  expect(automationSettings(config)).toEqual({ ok: true, value: { ...settings, projects: {} } });
});

test("settings that cannot be read plan nothing", () => {
  const { config } = folders();
  mkdirSync(join(config, "automation.json"), { recursive: true });
  expect(planLevel(config, { project: null, level: "auto" })).toMatchObject({
    ok: false,
    finding: { params: { error: "EISDIR" } },
  });
});
