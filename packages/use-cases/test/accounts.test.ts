import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AccountRegistry, formatRegistry } from "@cedarloom/contracts";
import { openRunStore } from "@cedarloom/ledger";
import { chooseAccount, chooseMove, loadRegistry } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const AT = "2026-11-05T11:00:00.000Z";

const registry: AccountRegistry = {
  schemaVersion: 1,
  accounts: ["work", "spare", "solo"].map((name) => ({
    name,
    agent: "claude",
    home: `/accounts/${name}`,
    pool: name === "solo" ? "single" : "main",
    added: AT,
  })),
  pools: {
    claude: {
      main: { confirmedAt: AT, confirmedFor: ["work", "spare"] },
      single: { confirmedAt: AT, confirmedFor: ["solo"] },
    },
  },
};

// A store with readings; by default work has 10 percent left in both windows, spare 80, solo none.
const stateWithReadings = (workUsed = 90, spareUsed = 20): string => {
  const state = mkdtempSync(join(tmpdir(), "cedarloom-accounts-"));
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  for (const [account, used] of [
    ["work", workUsed],
    ["spare", spareUsed],
  ] as const) {
    for (const window of ["fiveHour", "sevenDay"] as const) {
      store.value.recordReading({
        account,
        window,
        usedPercent: used,
        resetsAt: "2026-11-05T17:00:00.000Z",
        readAt: AT,
        source: "worker",
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
      at: new Date(NOW).toISOString(),
      task: "t1",
      from: "work",
      to: "spare",
      reason: "most-headroom",
      trigger: "launch",
      readings: expect.arrayContaining([expect.objectContaining({ account: "spare" })]),
      candidates: [
        { account: "work", margin: 2 },
        { account: "spare", margin: 72 },
      ],
    },
  ]);
  expect(rows[0]?.readings).toHaveLength(4);
  expect(rows[0]?.readings.map((reading) => reading.source)).toEqual(Array(4).fill("worker"));
});

test("a running worker past its line moves as a ledger row with its trigger; the cooldown counts from that row or a later start", () => {
  const state = stateWithReadings(95, 20);
  const main = { confirmedAt: AT, confirmedFor: ["work", "spare"], moveRunning: true };
  const moving = { ...registry, pools: { claude: { ...registry.pools.claude, main } } };
  const request = { task: "t6", agent: "claude", pool: "main", from: "work", trigger: "line" } as const;
  expect(chooseMove(state, moving, request, NOW)).toMatchObject({
    ok: true,
    value: { move: true, account: { name: "spare" } },
  });
  const [row] = switches(state);
  expect(row).toMatchObject({ task: "t6", from: "work", to: "spare", reason: "most-headroom", trigger: "line" });
  // The row keeps the readings of the account it left too.
  expect(row?.readings.map((reading) => reading.account)).toEqual(["spare", "spare", "work", "work"]);
  expect(chooseMove(state, moving, request, NOW + 60_000)).toMatchObject({
    ok: true,
    value: { move: false, reason: "cooldown" },
  });
  expect(switches(state)).toHaveLength(1);
  // A resumed worker starts without a row: the cooldown counts from its start.
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  const labels = {
    phase: "implement",
    model: "claude-sonnet-5-5",
    subagentModel: "claude-sonnet-5-5",
    effort: "high",
    permissionMode: "dontAsk",
    review: false,
    level: "checkpoint",
    tier: null,
  } as const;
  const started = {
    runId: randomUUID(),
    task: "t7",
    agent: "claude",
    account: "work",
    version: "2.1.316",
    pid: 101,
  } as const;
  store.value.leaseAccount({ ...started, startedAt: new Date(NOW + 600_000).toISOString(), labels }, 2)?.release();
  store.value.close();
  expect(chooseMove(state, moving, { ...request, task: "t7" }, NOW + 660_000)).toMatchObject({
    ok: true,
    value: { move: false, reason: "cooldown" },
  });
});

test("with no known reading the task stays and the row says why; a pool without headroom records nothing", () => {
  const state = stateWithReadings();
  // No time given: the choice is judged at the moment the store is held.
  const stays = chooseAccount(state, registry, { task: "t2", agent: "claude", pool: "single", previous: null });
  expect(stays.ok && stays.value.ok && [stays.value.account.name, stays.value.reason]).toEqual(["solo", "no-readings"]);
  expect(switches(state)).toMatchObject([{ task: "t2", from: null, to: "solo", reason: "no-readings", readings: [] }]);
  const full = stateWithReadings(95, 95);
  const none = chooseAccount(full, registry, { task: "t3", agent: "claude", pool: "main", previous: "work" }, NOW);
  expect(none).toMatchObject({ ok: true, value: { ok: false, reason: "no-headroom" } });
  expect(switches(full)).toEqual([]);
});

// A config folder without a registry yet, and the state folder beside it.
const freshConfig = () => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-config-"));
  return { config: join(root, "config"), state: join(root, "state") };
};

// Writes a registry with work (Claude Code) and cx (Codex) in /accounts, each in an unconfirmed pool main.
const writeRegistry = (config: string) => {
  const unconfirmed = { main: { confirmedAt: null, confirmedFor: [] } };
  const accounts = (["claude", "codex"] as const).map((agent, index) => {
    const name = index === 0 ? "work" : "cx";
    return { name, agent, home: `/accounts/${name}`, pool: "main", added: AT };
  });
  mkdirSync(config, { recursive: true });
  writeFileSync(
    join(config, "accounts.json"),
    formatRegistry({
      schemaVersion: 1,
      accounts,
      pools: { claude: unconfirmed, codex: unconfirmed },
    }),
  );
};

test("the registry reads as none when there is none, and one that is broken or cannot be read is reported", () => {
  const { config } = freshConfig();
  expect(loadRegistry(config)).toEqual({ ok: true, value: null });
  writeRegistry(config);
  expect(loadRegistry(config)).toMatchObject({ ok: true, value: { accounts: [{ name: "work" }, { name: "cx" }] } });
  writeFileSync(join(config, "accounts.json"), "{}");
  expect(loadRegistry(config)).toMatchObject({ ok: false, finding: { code: "document.invalid" } });
  // A registry the process cannot read is reported, not taken for none.
  const unreadable = join(config, "folder-as-registry");
  mkdirSync(join(unreadable, "accounts.json"), { recursive: true });
  expect(loadRegistry(unreadable)).toMatchObject({
    ok: false,
    finding: { code: "document.unreadable", params: { error: "EISDIR" } },
  });
});
