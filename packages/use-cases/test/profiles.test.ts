import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plan } from "@cedarloom/contracts";
import { applyPlan, claudeHome, type Fetch, planChoice, planProfile } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("profiles");
// Every Git source as one commit holding a skill's file, so no test fetches from the network.
const stock: Fetch = async () => {
  const content = Buffer.from("# Skill\n");
  const file = { path: "SKILL.md", mode: "100644" as const, sha256: "3".repeat(64), content };
  return { ok: true, value: { commit: "1".repeat(40), digest: "2".repeat(64), files: [file] } };
};
const applied = (state: string, plan: Plan | null): void => {
  if (plan === null) throw new Error("no plan");
  expect(ok(applyPlan(state, plan, { yes: true })).status).toBe("applied");
};

// The default profile's plugin parts, approved by name.
const PLUGINS = ["machine.plugin.cedarloom", "machine.plugin.ponytail", "machine.plugin.matt-pocock"];
// A machine with its hub named: config, state, Claude Code home and user home folders of its own.
const machine = () => {
  const [config, state, home, user] = ["config-", "state-", "home-", "user-"].map((name) =>
    mkdtempSync(join(root, name)),
  );
  if (config === undefined || state === undefined || home === undefined || user === undefined)
    throw new Error("no folders");
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  return {
    config,
    state,
    home,
    user,
    plan: async () => ok(await planProfile(config, state, { home, user }, { allow: PLUGINS, fetch: stock })),
  };
};
const setUp = async () => {
  const box = machine();
  applied(box.state, (await box.plan()).plan);
  return box;
};

test("a second apply has nothing left to do, and the question rule names the hub", async () => {
  const { home, plan } = await setUp();
  const rule = readFileSync(join(home, "rules", "cedarloom-hub.md"), "utf8");
  expect([await plan(), rule.includes("hub repository `acme/hub`")]).toEqual([{ plan: null, findings: [] }, true]);
});

test("a part switched off takes away the file CedarLoom wrote for it, never another file in the folder", async () => {
  const { config, state, home, plan } = await setUp();
  // The owner's own rules file, written by a plan of their own: CedarLoom wrote it, but for no part.
  const mine = { kind: "write" as const, path: join(home, "rules", "mine.md"), before: null, content: "- mine\n" };
  applied(state, { schemaVersion: 1, operations: [mine] });
  applied(state, ok(planChoice(config, { part: "machine.rules.global", on: false })));
  const operations = (await plan()).plan?.operations.map(({ kind, ...rest }) => [
    kind,
    "path" in rest ? rest.path : null,
  ]);
  expect(operations).toEqual([["delete", join(home, "rules", "00-global.md")]]);
});

test("a rules file the owner changed is left as it is and reported", async () => {
  const { home, plan } = await setUp();
  const path = join(home, "rules", "00-global.md");
  writeFileSync(path, "- my own rules\n");
  expect(await plan()).toEqual({ plan: null, findings: [{ code: "profile.owner-changed", params: { path } }] });
});

test("a rules file the owner deleted is written again", async () => {
  const { home, plan } = await setUp();
  const path = join(home, "rules", "00-global.md");
  rmSync(path);
  expect((await plan()).plan?.operations.map((op) => [op.kind, "path" in op ? op.path : null])).toEqual([
    ["write", path],
  ]);
});

test("a part switched off leaves its file when the owner changed it, and reports it", async () => {
  const { config, state, home, plan } = await setUp();
  const path = join(home, "rules", "00-global.md");
  writeFileSync(path, "- my own rules\n");
  applied(state, ok(planChoice(config, { part: "machine.rules.global", on: false })));
  expect(await plan()).toEqual({ plan: null, findings: [{ code: "profile.owner-changed", params: { path } }] });
});

test("a settings file that is no JSON is never rewritten", async () => {
  const { config, state, home } = machine();
  const path = join(home, "settings.json");
  writeFileSync(path, '{ "model": "opus", // mine\n}');
  expect(await planProfile(config, state, { home, user: home }, { fetch: stock })).toEqual({
    ok: false,
    finding: { code: "document.unreadable", params: { path, error: "not JSON" } },
  });
});

test("the selection names only the profile's parts, and a part goes back to its default", () => {
  const { config, state } = machine();
  applied(state, ok(planChoice(config, { part: "workspace.memory", on: false })));
  applied(state, ok(planChoice(config, { part: "workspace.memory", on: null })));
  const selection = JSON.parse(readFileSync(join(config, "profile.json"), "utf8"));
  expect([selection.select, planChoice(config, { part: "machine.rules.gone", on: true })]).toEqual([
    {},
    {
      ok: false,
      finding: { code: "profile.part-unknown", params: { part: "machine.rules.gone", by: "The selection" } },
    },
  ]);
});

test("a Claude Code home not made yet is named as the disk will name it, through a linked folder", () => {
  const folder = mkdtempSync(join(root, "real-"));
  const link = join(root, `link-${folder.slice(-6)}`);
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(folder, link, "junction");
  expect(claudeHome({ CLAUDE_CONFIG_DIR: join(link, "home") })).toBe(join(realpathSync.native(folder), "home"));
});

test("a plugin's options never land in CedarLoom's state, where the worker homes are", async () => {
  const { config, state, home, user } = machine();
  mkdirSync(join(user, ".config"));
  // A junction on Windows, which needs no extra privilege; a symbolic link elsewhere.
  symlinkSync(state, join(user, ".config", "ponytail"), "junction");
  const path = join(user, ".config", "ponytail", "config.json");
  expect(await planProfile(config, state, { home, user }, { allow: PLUGINS, fetch: stock })).toEqual({
    ok: false,
    finding: { code: "profile.options-guarded", params: { part: "machine.plugin.ponytail", path } },
  });
});
