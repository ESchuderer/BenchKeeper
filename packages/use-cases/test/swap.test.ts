import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountsStatus, applyPlan, loadRegistry, planAdd, planSwitch, readSwapAccounts } from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("swap");
const ID = "cedarloom.claude-swap";

// A machine whose app ships a claude-swap extension (the fixture's switch target) and whose registry has the Claude
// Code accounts work and home.
const machine = () => {
  const at = mkdtempSync(join(root, "machine-"));
  const paths = { state: join(at, "state"), config: join(at, "config"), app: join(at, "app") };
  const folder = join(paths.app, ID);
  mkdirSync(folder, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    kind: "cedarloom.extension",
    id: ID,
    version: "1.0.0",
    name: "claude-swap",
    api: "1.0",
    runtime: { kind: "node", entry: "main.mjs" },
    contributes: { actions: { status: { title: "Status" } }, switchTargets: { interactive: { agent: "claude" } } },
  };
  writeFileSync(join(folder, "cedarloom-extension.json"), JSON.stringify(manifest));
  copyFileSync(join(import.meta.dirname, "fixtures", "doctor", "main.mjs"), join(folder, "main.mjs"));
  for (const name of ["work", "home"]) {
    const added = ok(planAdd(paths.config, paths.state, { name, agent: "claude", pool: null }));
    ok(applyPlan(paths.state, added.plan, { yes: true }));
  }
  return paths;
};

test("claude-swap's readings are kept for the accounts whose claude-swap alias is their name, and none while its extension is off", async () => {
  const paths = machine();
  const readings = () =>
    ok(accountsStatus(paths.state, ok(loadRegistry(paths.config)))).readings.map(
      ({ account, window, usedPercent, source }) => [account, window, usedPercent, source],
    );
  ok(applyPlan(paths.state, ok(planSwitch(paths.app, paths.config, ID, "off")), { yes: true }));
  const off = [await readSwapAccounts(paths), readings()];
  ok(applyPlan(paths.state, ok(planSwitch(paths.app, paths.config, ID, "auto")), { yes: true }));
  expect([off, [await readSwapAccounts(paths), readings()]]).toEqual([
    [[], []],
    [[], [["work", "fiveHour", 40, "cswap"]]],
  ]);
});
