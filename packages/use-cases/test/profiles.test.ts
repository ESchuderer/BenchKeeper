import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan, Result } from "@cedarloom/contracts";
import { applyPlan, planChoice, planProfile } from "@cedarloom/use-cases";
import { afterAll, expect, test } from "vitest";

const root = mkdtempSync(join(process.env["RUNNER_TEMP"] ?? tmpdir(), "cedarloom-profiles-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const ok = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`refused: ${result.finding.code}`);
  return result.value;
};
const applied = (state: string, plan: Plan | null): void => {
  if (plan === null) throw new Error("no plan");
  expect(ok(applyPlan(state, plan, { yes: true })).status).toBe("applied");
};

// A machine with its hub named: config, state and Claude Code home folders of its own.
const machine = () => {
  const [config, state, home] = ["config-", "state-", "home-"].map((name) => mkdtempSync(join(root, name)));
  if (config === undefined || state === undefined || home === undefined) throw new Error("no folders");
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  return { config, state, home, plan: () => ok(planProfile(config, state, home)) };
};
const setUp = () => {
  const box = machine();
  applied(box.state, box.plan().plan);
  return box;
};

test("a second apply has nothing left to do, and the question rule names the hub", () => {
  const { home, plan } = setUp();
  const rule = readFileSync(join(home, "rules", "cedarloom-hub.md"), "utf8");
  expect([plan(), rule.includes("hub repository `acme/hub`")]).toEqual([
    { plan: null, changes: [], findings: [] },
    true,
  ]);
});

test("a part switched off takes away the file CedarLoom wrote for it, never another file in the folder", () => {
  const { config, state, home, plan } = setUp();
  // The owner's own rules file, written by a plan of their own: CedarLoom wrote it, but for no part.
  const mine = { kind: "write" as const, path: join(home, "rules", "mine.md"), before: null, content: "- mine\n" };
  applied(state, { schemaVersion: 1, operations: [mine] });
  applied(state, ok(planChoice(config, { part: "machine.rules.global", on: false })));
  const operations = plan().plan?.operations.map(({ kind, ...rest }) => [kind, "path" in rest ? rest.path : null]);
  expect(operations).toEqual([["delete", join(home, "rules", "00-global.md")]]);
});

test("a rules file the owner changed is left as it is and reported", () => {
  const { home, plan } = setUp();
  const path = join(home, "rules", "00-global.md");
  writeFileSync(path, "- my own rules\n");
  expect(plan()).toEqual({ plan: null, changes: [], findings: [{ code: "profile.owner-changed", params: { path } }] });
});

test("a rules file the owner deleted is written again", () => {
  const { home, plan } = setUp();
  const path = join(home, "rules", "00-global.md");
  rmSync(path);
  expect(plan().plan?.operations.map((op) => [op.kind, "path" in op ? op.path : null])).toEqual([["write", path]]);
});

const DISABLED = "1";
test("settings merge into the owner's file, each change named with the profile file that set it", () => {
  const { home, plan } = machine();
  const path = join(home, "settings.json");
  writeFileSync(path, JSON.stringify({ model: "opus", autoUpdatesChannel: "latest", env: { FOO: "x" } }));
  const planned = plan();
  const write = planned.plan?.operations.find((op) => op.kind === "write" && op.path === path);
  expect([
    write?.kind === "write" ? JSON.parse(write.content) : null,
    planned.changes.filter((change) => change.path === path).map(({ key, setBy }) => `${key} ${setBy}`),
  ]).toEqual([
    {
      model: "opus",
      autoUpdatesChannel: "stable",
      env: {
        FOO: "x",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: DISABLED,
        DISABLE_ERROR_REPORTING: DISABLED,
        DISABLE_FEEDBACK_COMMAND: DISABLED,
        CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: DISABLED,
      },
      showClearContextOnPlanAccept: true,
      attribution: { commit: "", pr: "" },
      autoMemoryEnabled: false,
      feedbackDrafts: "off",
    },
    [
      "/autoUpdatesChannel cedarloom.default",
      "/showClearContextOnPlanAccept cedarloom.default",
      "/attribution cedarloom.default",
      "/autoMemoryEnabled cedarloom.default",
      "/feedbackDrafts cedarloom.default",
      "/env/CLAUDE_CODE_DISABLE_AUTO_MEMORY cedarloom.default",
      "/env/DISABLE_ERROR_REPORTING cedarloom.default",
      "/env/DISABLE_FEEDBACK_COMMAND cedarloom.default",
      "/env/CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY cedarloom.default",
    ],
  ]);
});

test("a settings file that is no JSON is never rewritten", () => {
  const { config, state, home } = machine();
  const path = join(home, "settings.json");
  writeFileSync(path, '{ "model": "opus", // mine\n}');
  expect(planProfile(config, state, home)).toEqual({
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
