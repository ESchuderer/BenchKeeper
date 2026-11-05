import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountRegistry } from "@cedarloom/contracts";
import { openRunStore } from "@cedarloom/ledger";
import { applyPlan, chooseAccount, loadRegistry, planConfirm, planImport } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const AT = "2026-11-05T11:00:00.000Z";

const registry: AccountRegistry = {
  schemaVersion: 1,
  minimum: { fiveHour: 8, sevenDay: 3 },
  accounts: ["work", "spare", "solo"].map((name) => ({
    name,
    agent: "claude",
    home: `/accounts/${name}`,
    pool: name === "solo" ? "single" : "main",
    added: AT,
  })),
  pools: { claude: { main: { confirmedAt: AT }, single: { confirmedAt: AT } } },
};

// A store with readings: work has 10 percent left in its 5-hour window, spare 80, solo none.
const stateWithReadings = (): string => {
  const state = mkdtempSync(join(tmpdir(), "cedarloom-accounts-"));
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  for (const [account, used] of [
    ["work", 90],
    ["spare", 20],
  ] as const) {
    for (const window of ["fiveHour", "sevenDay"] as const) {
      store.value.recordReading({
        account,
        window,
        usedPercent: used,
        resetsAt: "2026-11-05T17:00:00.000Z",
        readAt: AT,
      });
    }
  }
  store.value.close();
  return state;
};

const switches = (state: string) => {
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  try {
    return store.value.switches();
  } finally {
    store.value.close();
  }
};

test("a task's worker starts on the pool account with headroom, and the choice is a ledger row with its readings", () => {
  const state = stateWithReadings();
  const request = { task: "t1", agent: "claude", pool: "main", previous: "work" } as const;
  const chosen = chooseAccount(state, registry, request, NOW);
  expect(chosen.ok && chosen.value.ok && chosen.value.account.name).toBe("spare");
  const rows = switches(state);
  expect(rows).toEqual([
    {
      at: expect.any(String),
      task: "t1",
      from: "work",
      to: "spare",
      readings: expect.arrayContaining([expect.objectContaining({ account: "spare" })]),
      candidates: [
        { account: "work", margin: 2 },
        { account: "spare", margin: 72 },
      ],
    },
  ]);
  expect(rows[0]?.readings).toHaveLength(4);
});

test("a pool without an account to start on records no switch", () => {
  const state = stateWithReadings();
  const chosen = chooseAccount(state, registry, { task: "t2", agent: "claude", pool: "single", previous: null }, NOW);
  expect(chosen).toEqual({
    ok: true,
    value: { ok: false, reason: "no-headroom", candidates: [{ account: "solo", margin: null }] },
  });
  expect(switches(state)).toEqual([]);
});

const host = (name: string, agent: string) => ({ name, agent, mode: "host", dir: `/accounts/${name}`, pool: "main" });

// A config folder and a BenchKeeper registry file with one Claude pool and one Codex pool.
const configAndBenchKeeper = () => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-config-"));
  const from = join(root, "benchkeeper-accounts.json");
  writeFileSync(
    from,
    JSON.stringify({ accounts: [host("work", "claude"), host("cx", "codex")], settings: { autoPick: true } }),
  );
  return { config: join(root, "config"), state: join(root, "state"), from };
};

test("BenchKeeper's registry is imported once, as a plan that creates the registry file", () => {
  const { config, state, from } = configAndBenchKeeper();
  expect(loadRegistry(config)).toEqual({ ok: true, value: null });
  const planned = planImport(config, from, AT);
  if (!planned.ok) throw new Error(planned.finding.code);
  expect(planned.value.left).toEqual([{ account: null, item: "autoPick" }]);
  expect(planned.value.plan.operations).toMatchObject([{ kind: "write", before: null, mode: 0o600 }]);
  expect(applyPlan(state, planned.value.plan, { yes: true })).toMatchObject({ ok: true, value: { status: "applied" } });
  const imported = loadRegistry(config);
  expect(imported.ok && imported.value?.pools).toEqual({
    claude: { main: { confirmedAt: null } },
    codex: { main: { confirmedAt: null } },
  });
  expect(planImport(config, from, AT)).toEqual({
    ok: false,
    finding: { code: "accounts.registry-exists", params: { path: join(config, "accounts.json") } },
  });
  writeFileSync(join(config, "accounts.json"), "{}");
  expect(loadRegistry(config)).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
});

test("a pool is confirmed by a plan that replaces the registry; Codex pools and unknown pools are refused", () => {
  const { config, state, from } = configAndBenchKeeper();
  expect(planConfirm(config, { agent: "claude", pool: "main" }, AT)).toMatchObject({
    ok: false,
    finding: { code: "document.unreadable" },
  });
  const imported = planImport(config, from, AT);
  if (!imported.ok) throw new Error(imported.finding.code);
  applyPlan(state, imported.value.plan, { yes: true });
  expect(planConfirm(config, { agent: "codex", pool: "main" }, AT)).toEqual({
    ok: false,
    finding: { code: "accounts.codex-switching-off", params: { pool: "main" } },
  });
  expect(planConfirm(config, { agent: "claude", pool: "spare" }, AT)).toEqual({
    ok: false,
    finding: { code: "accounts.unknown-pool", params: { agent: "claude", pool: "spare" } },
  });
  const confirm = planConfirm(config, { agent: "claude", pool: "main" }, AT);
  if (!confirm.ok) throw new Error(confirm.finding.code);
  expect(applyPlan(state, confirm.value, { yes: true })).toMatchObject({ ok: true, value: { status: "applied" } });
  expect(JSON.parse(readFileSync(join(config, "accounts.json"), "utf8")).pools.claude.main).toEqual({
    confirmedAt: AT,
  });
});

test("an import reports a BenchKeeper file it cannot read or map", () => {
  const { config, from } = configAndBenchKeeper();
  expect(planImport(config, `${from}.missing`, AT)).toMatchObject({
    ok: false,
    finding: { code: "document.unreadable" },
  });
  writeFileSync(from, JSON.stringify({ accounts: "none" }));
  expect(planImport(config, from, AT)).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
});
