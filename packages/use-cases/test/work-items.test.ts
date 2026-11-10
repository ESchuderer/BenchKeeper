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

// A Git folder whose origin fetches from `fetch` and, when given, pushes to `push`.
const origin = (fetch?: string, push?: string): string => {
  const project = folder("project-");
  execFileSync("git", ["init", "-q", project]);
  if (fetch !== undefined) execFileSync("git", ["-C", project, "remote", "add", "origin", fetch]);
  if (push !== undefined) execFileSync("git", ["-C", project, "remote", "set-url", "--push", "origin", push]);
  return project;
};

test("a project's label is named by the profile for its origin's GitHub repository, else by that repository's name in lower case; a project without one is refused", async () => {
  const [config, state] = [folder("config-"), folder("state-")];
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  const tracker = { labels: async () => ({ ok: true as const, value: [] }) };
  const projectLabels = async (project: string) =>
    ok(await previewHubLabels(config, tracker, { project })).flatMap(({ intent }) =>
      intent.kind === "create-label" && intent.label.startsWith("project:")
        ? [[intent.repo, intent.label, intent.color]]
        : [],
    );
  const buildGuide = origin("git@github.com:acme/BuildGuide.git");
  expect(await projectLabels(buildGuide)).toEqual([["acme/hub", "project:buildguide", "1d76db"]]);
  expect(await projectLabels(origin("https://github.com/acme/-My_App.v2-.git"))).toEqual([
    ["acme/hub", "project:my-app-v2", "1d76db"],
  ]);
  const long = origin(`git@github.com:acme/${"a".repeat(43)}.git`);
  expect(await previewHubLabels(config, tracker, { project: long })).toEqual({
    ok: false,
    finding: { code: "work-items.label-too-long", params: { label: `project:${"a".repeat(43)}`, limit: 50 } },
  });
  for (const project of [
    origin(),
    origin("git@github.com:acme/_.git"),
    origin("git@github.com:acme/r.git", "git@github.com:acme/s.git"),
  ]) {
    expect(await previewHubLabels(config, tracker, { project })).toEqual({
      ok: false,
      finding: { code: "work-items.no-project-name", params: { project } },
    });
  }

  // A key names its repository without case; one file spells a repository once (the profile schema refuses two).
  const file = join(config, "mine.json");
  const head = { schemaVersion: 1, kind: "cedarloom.profile", id: "acme.mine", version: "1.0.0", name: "Mine" };
  const extend = { extends: [{ pack: "cedarloom.core", path: "profiles/default.json" }], minApp: "0.0.0" };
  const projectNames = { "ACME/BuildGuide": "agent-studio" };
  const packs = { "cedarloom.core": { bundled: true } };
  writeFileSync(file, JSON.stringify({ ...head, ...extend, packs, workspace: { hub: { type: "hub", projectNames } } }));
  applied(state, ok(planChoice(config, { file })));
  expect(await projectLabels(buildGuide)).toEqual([["acme/hub", "project:agent-studio", "1d76db"]]);

  applied(state, ok(planChoice(config, { part: "workspace.hub", on: false })));
  expect(await previewHubLabels(config, tracker, { project: origin() })).toEqual({ ok: true, value: [] });
});
