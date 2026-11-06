import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sha256 } from "@cedarloom/ledger";
import { applyPlan, automationSettings, levelAtGate, mode, planLevel, switchMode } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

const folders = () => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-automation-"));
  return { root, config: join(root, "config"), state: join(root, "state") };
};

test("a fresh install is Supervised; then the project's level or the default, until running work is switched", () => {
  const { config, state } = folders();
  expect(automationSettings(config)).toEqual({ ok: true, value: null });
  expect(levelAtGate(state, config, "/work/app")).toEqual({ ok: true, value: "supervised" });
  mkdirSync(config, { recursive: true });
  const settings = { schemaVersion: 1, default: "checkpoint", projects: { "/work/app": "auto" } };
  writeFileSync(join(config, "automation.json"), JSON.stringify(settings));
  expect(levelAtGate(state, config, "/work/app")).toEqual({ ok: true, value: "auto" });
  expect(levelAtGate(state, config, "/work/other")).toEqual({ ok: true, value: "checkpoint" });
  const at = "2026-11-06T08:00:00.000Z";
  expect(switchMode(state, "supervised", at)).toEqual({ ok: true, value: { at, level: "supervised" } });
  expect(levelAtGate(state, config, "/work/app")).toEqual({ ok: true, value: "supervised" });
  switchMode(state, null);
  expect(mode(state, config)).toEqual({ ok: true, value: { running: null, settings } });
});

test("settings that are no settings, a folder in their place, or a store from a newer CedarLoom are reported", () => {
  const { root, config, state } = folders();
  mkdirSync(join(config, "automation.json"), { recursive: true });
  expect(automationSettings(config)).toMatchObject({ ok: false, finding: { params: { error: "EISDIR" } } });
  const invalid = join(root, "invalid");
  mkdirSync(invalid);
  writeFileSync(join(invalid, "automation.json"), "{}");
  expect(levelAtGate(state, invalid, "/work/app")).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  mkdirSync(state);
  const db = new DatabaseSync(join(state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  expect(mode(state, join(root, "none"))).toMatchObject({ ok: false, finding: { code: "store.newer-schema" } });
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
  const { config, state } = folders();
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
  setLevel(state, config, { project: "/work/b", level: "auto" });
  const before = readFileSync(path, "utf8");
  const third = setLevel(state, config, { project: "/work/a", level: "supervised" });
  expect(third.operations[0]).toMatchObject({ before: sha256(before) });
  expect(Object.keys(JSON.parse(readFileSync(path, "utf8")).projects)).toEqual(["/work/a", "/work/b"]);
  setLevel(state, config, { project: "/work/b", level: null });
  expect(automationSettings(config)).toEqual({
    ok: true,
    value: { schemaVersion: 1, default: "checkpoint", projects: { "/work/a": "supervised" } },
  });
  expect(levelAtGate(state, config, "/work/b")).toEqual({ ok: true, value: "checkpoint" });
});

test("a project folder that is no absolute path, or settings that cannot be read, plan nothing", () => {
  const { config } = folders();
  expect(planLevel(config, { project: "work/app", level: "auto" })).toMatchObject({
    ok: false,
    finding: { code: "document.invalid" },
  });
  mkdirSync(join(config, "automation.json"), { recursive: true });
  expect(planLevel(config, { project: null, level: "auto" })).toMatchObject({
    ok: false,
    finding: { params: { error: "EISDIR" } },
  });
});
