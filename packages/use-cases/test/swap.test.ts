import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openRunStore } from "@cedarloom/ledger";
import {
  accountsStatus,
  applyPlan,
  loadRegistry,
  planAdd,
  planSwitch,
  readSwapAccounts,
  swapPolicy,
  switchInteractive,
} from "@cedarloom/use-cases";
import { expect, test } from "vitest";
import { ok, testRoot } from "./harness.ts";

const root = testRoot("swap");
const ID = "cedarloom.claude-swap";

// A machine whose app ships a claude-swap extension (the fixture's switch target) and whose registry has the Claude
// Code accounts work (claude-swap's active account 1), elsewhere (its account 2) and home (no claude-swap alias).
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
  for (const name of ["work", "home", "elsewhere"]) {
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
    [{ findings: [], interactive: null }, []],
    [
      { findings: [], interactive: { number: 1, account: "work" } },
      [
        ["elsewhere", "fiveHour", 10, "cswap"],
        ["work", "fiveHour", 40, "cswap"],
      ],
    ],
  ]);
});

// A worker's live lease on `account`, held until released.
const leased = (state: string, account: string) => {
  const store = ok(openRunStore(state));
  const labels = {
    phase: "implement",
    model: "m",
    subagentModel: "m",
    effort: "high",
    permissionMode: "dontAsk",
    review: true,
    level: "auto",
    tier: null,
  } as const;
  const run = {
    runId: randomUUID(),
    task: "t",
    agent: "claude",
    account,
    version: "2.1.316",
    pid: process.pid,
  } as const;
  const lease = { ...run, startedAt: new Date().toISOString(), labels };
  const held = store.leaseAccount(lease, 2);
  store.close();
  return held;
};
const code = (result: { ok: boolean }) =>
  result.ok ? Reflect.get(result, "value") : Reflect.get(result, "finding").code;

test("interactive sessions switch to an account by its claude-swap alias, never onto one CedarLoom workers run on; the policy is claude-swap's auto mode's", async () => {
  const paths = machine();
  const before = [
    code(await switchInteractive(paths, "nobody", false)),
    code(await switchInteractive(paths, "home", false)),
    code(await switchInteractive(paths, "elsewhere", false)),
    code(await switchInteractive(paths, "elsewhere", true)),
    code(await swapPolicy(paths, { "autoswitch.threshold": "85" })),
    code(await swapPolicy(paths, { "autoswitch.threshold": "85", "run.shareHistory": "false" })),
  ];
  const held = [leased(paths.state, "elsewhere"), leased(paths.state, "work")];
  const busy = [
    code(await switchInteractive(paths, "elsewhere", true)),
    code(await switchInteractive(paths, "work", true)),
  ];
  for (const each of held) each?.release();
  ok(applyPlan(paths.state, ok(planSwitch(paths.app, paths.config, ID, "off")), { yes: true }));
  expect([...before, ...busy, code(await swapPolicy(paths))]).toEqual([
    "accounts.unknown-account",
    "accounts.swap-unlinked",
    { number: 2, switched: null },
    { number: 2, switched: true },
    { "autoswitch.threshold": "85" },
    "accounts.swap-setting",
    "accounts.swap-busy",
    // Interactive sessions already use it: nothing moves, so its workers do not refuse.
    { number: 1, switched: false },
    "accounts.swap-unavailable",
  ]);
});
