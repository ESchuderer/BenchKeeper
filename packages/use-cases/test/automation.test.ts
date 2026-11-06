import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
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

const run = (project: string, startedAt = "2026-11-06T07:00:00.000Z") => ({ project, startedAt });
// A project folder and a symbolic link to it.
const appWithLink = (root: string) => {
  const app = join(root, "app");
  mkdirSync(app);
  const link = join(root, "link");
  symlinkSync(app, link, "dir");
  return { app, link };
};
const T8 = "2026-11-06T08:00:00.000Z";

test("a fresh install is Supervised; then the project's level or the default; a switch reaches the runs running at it", () => {
  const { config, state } = folders();
  expect(automationSettings(config)).toEqual({ ok: true, value: null });
  expect(levelAtGate(state, config, run("/work/app"))).toEqual({ ok: true, value: "supervised" });
  mkdirSync(config, { recursive: true });
  const settings = { schemaVersion: 1, default: "checkpoint", projects: { "/work/app": "auto" } };
  writeFileSync(join(config, "automation.json"), JSON.stringify(settings));
  expect(levelAtGate(state, config, run("/work/app"))).toEqual({ ok: true, value: "auto" });
  expect(levelAtGate(state, config, run("/work/other"))).toEqual({ ok: true, value: "checkpoint" });
  expect(switchMode(state, "supervised", T8)).toEqual({ ok: true, value: { at: T8, level: "supervised" } });
  // A run that was running at the switch takes it; one that started later starts at its project's level.
  expect(levelAtGate(state, config, run("/work/app"))).toEqual({ ok: true, value: "supervised" });
  expect(levelAtGate(state, config, run("/work/app", "2026-11-06T08:30:00.000Z"))).toEqual({ ok: true, value: "auto" });
  switchMode(state, null, "2026-11-06T09:00:00.000Z");
  expect(levelAtGate(state, config, run("/work/app"))).toEqual({ ok: true, value: "auto" });
  expect(mode(state, config)).toEqual({
    ok: true,
    value: { switched: { at: "2026-11-06T09:00:00.000Z", level: null }, settings },
  });
});

test("a switch made in the very millisecond a run started gives it the stricter of the switch and its project's level", () => {
  const { config, state } = folders();
  mkdirSync(config, { recursive: true });
  const settings = { schemaVersion: 1, default: "supervised", projects: { "/work/app": "auto" } };
  writeFileSync(join(config, "automation.json"), JSON.stringify(settings));
  switchMode(state, "checkpoint", T8);
  // Checkpoint is stricter than the project's Auto; the default Supervised is stricter than the switch.
  expect(levelAtGate(state, config, run("/work/app", T8))).toEqual({ ok: true, value: "checkpoint" });
  expect(levelAtGate(state, config, run("/work/other", T8))).toEqual({ ok: true, value: "supervised" });
});

test("a project key written by hand through a link still applies; two keys for one folder keep the stricter level", () => {
  const { root, config, state } = folders();
  const { app, link } = appWithLink(root);
  mkdirSync(config, { recursive: true });
  const write = (projects: Record<string, string>) =>
    writeFileSync(join(config, "automation.json"), JSON.stringify({ schemaVersion: 1, default: "auto", projects }));
  write({ [link]: "supervised" });
  expect(levelAtGate(state, config, run(app))).toEqual({ ok: true, value: "supervised" });
  write({ [link]: "checkpoint", [app]: "auto" });
  expect(levelAtGate(state, config, run(link))).toEqual({ ok: true, value: "checkpoint" });
});

test("a run's start is compared as a time, so a start written without milliseconds still takes a later switch", () => {
  const { config, state } = folders();
  switchMode(state, "auto", "2026-11-06T08:00:00.500Z");
  // As text, "…08:00:00Z" sorts after "…08:00:00.500Z"; as times the switch came half a second after the start.
  expect(levelAtGate(state, config, run("/work/app", "2026-11-06T08:00:00Z"))).toEqual({ ok: true, value: "auto" });
  expect(levelAtGate(state, config, run("/work/app", "2026-11-06T08:00:01Z"))).toEqual({
    ok: true,
    value: "supervised",
  });
});

test("with modeScope until-off, a switch reaches every later run too, until off", () => {
  const { config, state } = folders();
  mkdirSync(config, { recursive: true });
  const settings = { schemaVersion: 1, default: "supervised", projects: {}, modeScope: "until-off" };
  writeFileSync(join(config, "automation.json"), JSON.stringify(settings));
  switchMode(state, "auto", T8);
  expect(levelAtGate(state, config, run("/work/app", "2026-11-06T08:30:00.000Z"))).toEqual({ ok: true, value: "auto" });
  switchMode(state, null, "2026-11-06T09:00:00.000Z");
  expect(levelAtGate(state, config, run("/work/app", "2026-11-06T09:30:00.000Z"))).toEqual({
    ok: true,
    value: "supervised",
  });
});

test("settings that are no settings, a folder in their place, or a store from a newer CedarLoom are reported", () => {
  const { root, config, state } = folders();
  mkdirSync(join(config, "automation.json"), { recursive: true });
  expect(automationSettings(config)).toMatchObject({ ok: false, finding: { params: { error: "EISDIR" } } });
  const invalid = join(root, "invalid");
  mkdirSync(invalid);
  writeFileSync(join(invalid, "automation.json"), "{}");
  expect(levelAtGate(state, invalid, run("/work/app"))).toMatchObject({
    ok: false,
    finding: { code: "document.invalid" },
  });
  expect(mode(state, invalid)).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  // The store is read only once the settings are.
  expect(levelAtGate(state, join(root, "none"), run("/work/app"))).toMatchObject({ ok: true });
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
  expect(levelAtGate(state, config, run(b))).toEqual({ ok: true, value: "checkpoint" });
});

test("a project is its folder's real path: a link to it changes the same entry, and a missing folder is refused", () => {
  const { root, config, state } = folders();
  const { app, link } = appWithLink(root);
  setLevel(state, config, { project: link, level: "supervised" });
  setLevel(state, config, { project: app, level: "auto" });
  expect(automationSettings(config)).toMatchObject({ value: { projects: { [realpathSync.native(app)]: "auto" } } });
  expect(Object.keys(JSON.parse(readFileSync(join(config, "automation.json"), "utf8")).projects)).toHaveLength(1);
  expect(levelAtGate(state, config, run(link))).toEqual({ ok: true, value: "auto" });
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
