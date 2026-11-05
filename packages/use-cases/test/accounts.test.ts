import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountRegistry } from "@cedarloom/contracts";
import { openRunStore } from "@cedarloom/ledger";
import { chooseAccount } from "@cedarloom/use-cases";
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
