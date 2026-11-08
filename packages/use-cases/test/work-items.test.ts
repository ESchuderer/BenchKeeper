import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { applyPlan, planChoice, previewIntent } from "@cedarloom/use-cases";
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
});
