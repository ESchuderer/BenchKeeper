import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, planChoice, previewHubLabels, previewIntent } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("work-items");
const folder = (name: string): string => realpathSync(mkdtempSync(join(root, name)));
const applied = (state: string, plan: Parameters<typeof applyPlan>[1]): void => {
  expect(ok(applyPlan(state, plan, { yes: true })).status).toBe("applied");
};

const comment = (repo: string) => ({ kind: "comment", issue: { repo, number: 1 }, body: "Done." });

test("without a hub nothing is queued, and an issue outside the hub is refused; the hub's name has no case", () => {
  const config = folder("config-");
  expect(previewIntent(config, comment("acme/hub"))).toEqual({
    ok: false,
    finding: { code: "work-items.no-hub", params: {} },
  });
  applied(folder("state-"), ok(planChoice(config, { hub: "acme/hub" })));
  expect(previewIntent(config, comment("acme/app"))).toEqual({
    ok: false,
    finding: { code: "work-items.not-hub", params: { repo: "acme/app", hub: "acme/hub" } },
  });
  expect(previewIntent(config, comment("ACME/Hub"))).toMatchObject({ ok: true });
  expect(previewIntent(config, { kind: "delete-label", repo: "acme/app", label: "bug", id: 1 })).toEqual({
    ok: false,
    finding: { code: "work-items.not-hub", params: { repo: "acme/app", hub: "acme/hub" } },
  });
});

test("only the labels the hub lacks are previewed, compared without case, and only while the hub part is on", async () => {
  const [config, state] = [folder("config-"), folder("state-")];
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  const tracker = { labels: async () => ({ ok: true as const, value: ["Needs-Triage", "question", "bug"] }) };
  const missing = ok(await previewHubLabels(config, tracker));
  expect(missing.map(({ intent }) => ("repo" in intent ? [intent.repo, intent.label] : []))).toEqual([
    ["acme/hub", "needs-info"],
    ["acme/hub", "ready-for-agent"],
    ["acme/hub", "ready-for-human"],
    ["acme/hub", "wontfix"],
    ["acme/hub", "deferred"],
  ]);
  applied(state, ok(planChoice(config, { part: "workspace.hub", on: false })));
  expect(await previewHubLabels(config, tracker)).toEqual({ ok: true, value: [] });
});

test("a project's label is named by the profile for its origin's GitHub repository, else by that repository's name in lower case; a project without one is refused", async () => {
  const [config, state, project, bare] = [folder("config-"), folder("state-"), folder("project-"), folder("bare-")];
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  execFileSync("git", ["init", "-q", project]);
  execFileSync("git", ["-C", project, "remote", "add", "origin", "git@github.com:acme/BuildGuide.git"]);
  execFileSync("git", ["init", "-q", bare]);
  const tracker = { labels: async () => ({ ok: true as const, value: [] }) };
  const projectLabels = async () =>
    ok(await previewHubLabels(config, tracker, project)).flatMap(({ intent }) =>
      intent.kind === "create-label" && intent.label.startsWith("project:") ? [[intent.label, intent.color]] : [],
    );
  expect(await projectLabels()).toEqual([["project:buildguide", "1d76db"]]);

  const file = join(config, "mine.json");
  const head = { schemaVersion: 1, kind: "cedarloom.profile", id: "acme.mine", version: "1.0.0", name: "Mine" };
  const extend = { extends: [{ pack: "cedarloom.core", path: "profiles/default.json" }], minApp: "0.0.0" };
  const hub = { type: "hub", projectNames: { "ACME/buildguide": "agent-studio" } };
  const packs = { "cedarloom.core": { bundled: true } };
  writeFileSync(file, JSON.stringify({ ...head, ...extend, packs, workspace: { hub } }));
  applied(state, ok(planChoice(config, { file })));
  expect(await projectLabels()).toEqual([["project:agent-studio", "1d76db"]]);

  expect(await previewHubLabels(config, tracker, bare)).toEqual({
    ok: false,
    finding: { code: "work-items.no-project-name", params: { project: bare } },
  });
});
