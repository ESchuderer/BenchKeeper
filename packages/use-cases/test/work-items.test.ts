import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { IssueRef, WorkflowDefinition } from "@cedarloom/contracts";
import { openGraphStore } from "@cedarloom/ledger";
import { applyPlan, linkRun, planChoice, planMirroring, previewIntent, sendOutbox } from "@cedarloom/use-cases";
import type { Tracker } from "@cedarloom/work-items";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("work-items");
const issue: IssueRef = { repo: "acme/hub", number: 7 };
const folder = (name: string): string => realpathSync(mkdtempSync(join(root, name)));
const applied = (state: string, plan: Parameters<typeof applyPlan>[1]): void => {
  expect(ok(applyPlan(state, plan, { yes: true })).status).toBe("applied");
};

// A project folder whose origin is the GitHub repository `repo`.
const project = (repo: string): string => {
  const dir = folder("project-");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", `https://github.com/${repo}.git`], { cwd: dir });
  return dir;
};

const comment = (repo: string) => ({ kind: "comment", issue: { repo, number: 1 }, body: "Done." });

// A tracker on the hub that keeps the comments it is sent.
const recording = () => {
  const comments: string[] = [];
  const tracker: Tracker = {
    hub: "acme/hub",
    hasLabel: async () => ({ ok: true, value: false }),
    findComment: async () => ({ ok: true, value: null }),
    comment: async (_, body) => {
      comments.push(body.split("\n")[0] ?? "");
      return { ok: true, value: { id: comments.length, url: "https://github.com/acme/hub/issues/7#issuecomment-1" } };
    },
    deleteComment: async () => ({ ok: true, value: null }),
    setLabel: async () => ({ ok: true, value: null }),
  };
  return { comments, tracker };
};

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
});

test("a linked run that ended in a mirrored repository posts one comment to its hub issue, once; others post none", async () => {
  const [config, state] = [folder("config-"), folder("state-")];
  applied(state, ok(planChoice(config, { hub: "acme/hub" })));
  applied(state, ok(planMirroring(config, "acme/app", true)));
  const graphs = openGraphStore(state);
  if (!graphs.ok) throw new Error(graphs.finding.code);
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "mirror", name: "Mirror", version: "2.0.0" },
    nodes: [{ id: "begin", type: "trigger.manual" }],
    edges: [],
  };
  const ended = (repo: string): string => {
    const base = { definition, inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
    const run = graphs.value.create({ ...base, project: project(repo) });
    graphs.value.append(run.runId, 1, { type: "finished", status: "succeeded", outputs: {} });
    run.release();
    return run.runId;
  };
  const [mirrored, other] = [ended("acme/app"), ended("acme/other")];
  graphs.value.close();
  for (const runId of [mirrored, other]) ok(await linkRun(state, config, runId, issue));
  const { comments, tracker } = recording();
  expect(ok(await sendOutbox(state, config, tracker))).toMatchObject([{ status: "sent", approvedBy: "mirroring" }]);
  expect(ok(await sendOutbox(state, config, tracker))).toEqual([]);
  expect(comments).toEqual([`CedarLoom run ${mirrored} ended: succeeded.`]);
});
