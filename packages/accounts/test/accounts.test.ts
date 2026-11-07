import { type Selection, selectAccount } from "@cedarloom/accounts";
import type { Account, AccountRegistry, Reading as Stored } from "@cedarloom/contracts";
import * as fc from "fast-check";
import { expect, test } from "vitest";

type Reading = Omit<Stored, "readAt" | "source">;

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const ADDED_AT = "2026-11-05T12:00:00.000Z";
const CONFIRMED = "2026-11-05T10:00:00.000Z";

const account = (name: string, change: Partial<Account> = {}): Account => ({
  name,
  agent: "claude",
  home: `/accounts/${name}`,
  pool: "main",
  added: ADDED_AT,
  ...change,
});

const POOL = ["one", "two", "three"];

const registry: AccountRegistry = {
  schemaVersion: 1,
  accounts: [
    account("one"),
    account("two"),
    account("three"),
    account("four", { pool: "spare" }),
    account("solo", { pool: null }),
    account("other", { agent: "codex" }),
  ],
  pools: {
    claude: {
      main: { confirmedAt: CONFIRMED, confirmedFor: POOL },
      spare: { confirmedAt: CONFIRMED, confirmedFor: ["four"] },
      idle: { confirmedAt: null, confirmedFor: [] },
    },
    codex: { main: { confirmedAt: null, confirmedFor: [] } },
  },
};

const EARLIER = "2026-11-05T11:00:00.000Z";
const LATER = "2026-11-05T17:00:00.000Z";
const used = (name: string, fiveHour: number, sevenDay: number, resetsAt = LATER): Reading[] => [
  { account: name, window: "fiveHour", usedPercent: fiveHour, resetsAt },
  { account: name, window: "sevenDay", usedPercent: sevenDay, resetsAt },
];

const main = { agent: "claude", pool: "main" } as const;

test("a new worker gets the pool account with the most headroom above both minimums, 8 and 3 percent", () => {
  const readings = [...used("one", 50, 20), ...used("two", 30, 90), ...used("three", 60, 10), ...used("other", 0, 0)];
  expect(selectAccount(registry, main, readings, NOW)).toEqual({
    ok: true,
    account: registry.accounts[0],
    reason: "most-headroom",
    candidates: [
      { account: "one", margin: 42 },
      { account: "two", margin: 7 },
      { account: "three", margin: 32 },
    ],
  });
  const tie = selectAccount(registry, main, [...used("one", 50, 0), ...used("two", 50, 0)], NOW);
  expect(tie.ok && tie.account.name).toBe("one");
});

// Each account's windows, the 7-day one resetting at `weekly`; two days out unless given.
const week = (name: string, fiveHour: number, sevenDay: number, weekly = "2026-11-07T12:00:00.000Z"): Reading[] => [
  { account: name, window: "fiveHour", usedPercent: fiveHour, resetsAt: LATER },
  { account: name, window: "sevenDay", usedPercent: sevenDay, resetsAt: weekly },
];

test("claude-swap's weekly-first and consume-first take the qualifying account whose 7-day window resets soonest", () => {
  // One has the most headroom; two resets sooner; three's 7-day window reset already, so its next reset is unknown.
  const readings = [
    ...week("one", 10, 10),
    ...week("two", 50, 50, "2026-11-06T12:00:00.000Z"),
    ...week("three", 0, 99, EARLIER),
  ];
  for (const strategy of ["weekly-first", "consume-first"] as const) {
    expect(selectAccount(registry, { ...main, swap: { strategy } }, readings, NOW)).toMatchObject({
      account: { name: "two" },
      reason: "soonest-weekly-reset",
    });
  }
  // Without claude-swap's strategy, the most headroom: three's reset window is unknown.
  expect(selectAccount(registry, main, readings, NOW)).toMatchObject({
    account: { name: "one" },
    reason: "most-headroom",
    candidates: [{ margin: 82 }, { margin: 42 }, { margin: null }],
  });
});

test("priority-consume-first takes the highest tier first, then the soonest weekly reset; tiers default to 0", () => {
  const readings = [...week("one", 10, 10), ...week("two", 50, 50, "2026-11-06T12:00:00.000Z"), ...week("three", 0, 0)];
  const priority = (tiers: Record<string, number>) => {
    const swap = { strategy: "priority-consume-first", tiers: new Map(Object.entries(tiers)) } as const;
    return selectAccount(registry, { ...main, swap }, readings, NOW);
  };
  expect(priority({ three: 500 })).toMatchObject({ account: { name: "three" }, reason: "highest-tier" });
  expect(priority({})).toMatchObject({ account: { name: "two" }, reason: "highest-tier" });
  // A name an object inherits, such as constructor, has no tier unless claude-swap gives it one.
  const named = {
    ...registry,
    accounts: [account("constructor"), account("one")],
    pools: { claude: { main: { confirmedAt: CONFIRMED, confirmedFor: ["constructor", "one"] } } },
  };
  const tied = [...week("constructor", 10, 10, "2026-11-06T12:00:00.000Z"), ...week("one", 10, 10)];
  const swap = { strategy: "priority-consume-first", tiers: new Map([["one", 500]]) } as const;
  expect(selectAccount(named, { ...main, swap }, tied, NOW)).toMatchObject({ account: { name: "one" } });
});

test("an account claude-swap disabled is skipped, and its active one is passed over while another qualifies", () => {
  const readings = [...week("one", 10, 10), ...week("two", 50, 50)];
  const chosen = (swap: { disabled?: ReadonlySet<string>; active?: string }) =>
    selectAccount(registry, { ...main, swap }, readings, NOW);
  expect(chosen({ disabled: new Set(["one"]) })).toMatchObject({
    account: { name: "two" },
    candidates: [{ account: "two" }, { account: "three" }],
  });
  expect(chosen({ active: "one" })).toMatchObject({ account: { name: "two" } });
  // The active account still serves when no other qualifies.
  expect(chosen({ active: "one", disabled: new Set(["two"]) })).toMatchObject({ account: { name: "one" } });
});

test("the worker model's own weekly window counts once read, against the 7-day minimum; another model's does not", () => {
  const opus = { account: "one", window: "sevenDay:opus", usedPercent: 98, resetsAt: LATER };
  const readings = [...used("one", 50, 20), opus, ...used("two", 30, 60)];
  // For an Opus worker, one's Opus window leaves -1 above its 3 percent: two is chosen.
  expect(selectAccount(registry, { ...main, model: "claude-opus-5-5" }, readings, NOW)).toMatchObject({
    account: { name: "two" },
    candidates: [{ margin: -1 }, { margin: 37 }, { margin: null }],
  });
  // A Sonnet worker does not look at it; two, without a Sonnet window, is not unknown.
  expect(selectAccount(registry, { ...main, model: "claude-sonnet-5-5" }, readings, NOW)).toMatchObject({
    account: { name: "one" },
    candidates: [{ margin: 42 }, { margin: 37 }, { margin: null }],
  });
});

test("an account whose leases are all taken is passed over; with every one taken, the pool yields none", () => {
  const readings = [...used("one", 50, 20), ...used("two", 30, 90), ...used("three", 30, 10)];
  const passedOver = selectAccount(registry, { ...main, busy: new Set(["one"]) }, readings, NOW);
  expect(passedOver).toMatchObject({ ok: true, reason: "most-headroom", account: { name: "three" } });
  expect(passedOver.candidates.map((each) => each.account)).toEqual(["two", "three"]);
  // With no readings the task stays on its account only while that one has a free lease.
  expect(selectAccount(registry, { ...main, previous: "one", busy: new Set(["one"]) }, [], NOW)).toMatchObject({
    ok: true,
    reason: "no-readings",
    account: { name: "two" },
  });
  expect(selectAccount(registry, { ...main, busy: new Set(["one", "two", "three"]) }, readings, NOW)).toEqual({
    ok: false,
    reason: "all-leased",
    candidates: [],
  });
});

test("an account below a minimum, or with a window never read, never qualifies", () => {
  const readings = [...used("one", 95, 0), ...used("two", 0, 0).slice(0, 1)];
  expect(selectAccount(registry, main, readings, NOW)).toEqual({
    ok: false,
    reason: "no-headroom",
    candidates: [
      { account: "one", margin: -3 },
      { account: "two", margin: null },
      { account: "three", margin: null },
    ],
  });
});

test("a window that has reset since its last reading is unknown until it is read again", () => {
  // One was read near both limits before the windows reset; three's 7-day window was never read.
  const readings = [...used("one", 95, 99, EARLIER), ...used("three", 0, 0).slice(0, 1)];
  expect(selectAccount(registry, { ...main, previous: "two" }, readings, NOW)).toEqual({
    ok: true,
    account: registry.accounts[1],
    reason: "no-readings",
    candidates: POOL.map((name) => ({ account: name, margin: null })),
  });
  // A reading without a reset counts until the next one replaces it.
  const unreset = used("two", 50, 0).map((reading) => ({ ...reading, resetsAt: null }));
  expect(selectAccount(registry, main, unreset, NOW)).toMatchObject({
    account: { name: "two" },
    reason: "most-headroom",
  });
  // A reset at the very moment of the choice has passed too.
  const now = selectAccount(registry, main, [...used("one", 50, 0), ...used("two", 0, 0, ADDED_AT)], NOW);
  expect(now.candidates).toEqual([
    { account: "one", margin: 42 },
    { account: "two", margin: null },
    { account: "three", margin: null },
  ]);
});

test("a reset 5-hour window does not lift an account whose 7-day window is still known and below its minimum", () => {
  const readings = [...used("one", 95, 0, EARLIER).slice(0, 1), ...used("one", 0, 99).slice(1)];
  expect(selectAccount(registry, main, readings, NOW)).toEqual({
    ok: false,
    reason: "no-headroom",
    candidates: [
      { account: "one", margin: -2 },
      { account: "two", margin: null },
      { account: "three", margin: null },
    ],
  });
});

test("with no known reading in the pool nothing switches: the task stays on its account, else the first", () => {
  const stays = (previous: string | null, readings: Reading[] = []) =>
    selectAccount(registry, { ...main, previous }, readings, NOW);
  expect(stays("two")).toEqual({
    ok: true,
    account: registry.accounts[1],
    reason: "no-readings",
    candidates: POOL.map((name) => ({ account: name, margin: null })),
  });
  expect([stays(null), stays("solo")].map((chosen) => chosen.ok && chosen.account.name)).toEqual(["one", "one"]);
  // A known window below its minimum counts although the other one was never read: no account to stay on silently.
  const exhausted = used("two", 0, 99).slice(1);
  expect(stays("two", exhausted)).toEqual({
    ok: false,
    reason: "no-headroom",
    candidates: [
      { account: "one", margin: null },
      { account: "two", margin: -2 },
      { account: "three", margin: null },
    ],
  });
  // An unparsable reset time is no known reading either.
  const unparsable = selectAccount(registry, { agent: "claude", pool: "spare" }, used("four", 0, 0, "x"), NOW);
  expect(unparsable).toMatchObject({
    ok: true,
    reason: "no-readings",
    candidates: [{ account: "four", margin: null }],
  });
});

test("no account comes from a pool that is not the agent's, unconfirmed, or changed since its confirmation", () => {
  expect(selectAccount(registry, { agent: "claude", pool: "constructor" }, [], NOW)).toMatchObject({
    reason: "unknown-pool",
  });
  expect(selectAccount(registry, { agent: "codex", pool: "idle" }, [], NOW)).toMatchObject({ reason: "unknown-pool" });
  // A Codex pool confirmed in a registry built in memory, past the format's check, still switches nothing.
  const codex = { ...registry, pools: { codex: { main: { confirmedAt: CONFIRMED, confirmedFor: ["other"] } } } };
  expect(selectAccount(codex, { agent: "codex", pool: "main" }, [], NOW)).toMatchObject({ reason: "unconfirmed-pool" });
  for (const pool of ["idle", "main"]) {
    const named = {
      claude: { ...registry.pools.claude, main: { confirmedAt: CONFIRMED, confirmedFor: ["one", "two"] } },
    };
    expect(selectAccount({ ...registry, pools: named }, { agent: "claude", pool }, [], NOW)).toEqual({
      ok: false,
      reason: "unconfirmed-pool",
      candidates: [],
    });
  }
});

// Per account, each window read or not, from few values and mostly before the reset: ties and fully read pools come up
// often, as do past, current and unparsable reset times and readings of an account outside the pool.
const windowReading = fc.option(
  fc.record({
    usedPercent: fc.constantFrom(0, 40, 92),
    resetsAt: fc.constantFrom("2026-11-05T11:00:00.000Z", ADDED_AT, "not a time", LATER, LATER, LATER),
  }),
  { nil: undefined },
);
const randomReadings = fc
  .tuple(...[...POOL, "solo"].map((name) => fc.tuple(fc.constant(name), windowReading, windowReading)))
  .map((perAccount) =>
    perAccount.flatMap(([name, fiveHour, sevenDay]): Reading[] => [
      ...(fiveHour === undefined ? [] : [{ account: name, window: "fiveHour" as const, ...fiveHour }]),
      ...(sevenDay === undefined ? [] : [{ account: name, window: "sevenDay" as const, ...sevenDay }]),
    ]),
  );

// The rule, checked against what the choice reports: the largest margin of at least 0 wins and the first on a tie;
// with no known margin the task stays (else the first account); otherwise no account.
const holds = (chosen: Selection, previous: string | null): boolean => {
  const margins = chosen.candidates.map((candidate) => candidate.margin);
  if (!chosen.ok) return margins.some((m) => m !== null) && margins.every((m) => m === null || m < 0);
  if (chosen.reason === "no-readings") {
    return margins.every((m) => m === null) && chosen.account.name === (POOL.find((n) => n === previous) ?? "one");
  }
  const index = chosen.candidates.findIndex((candidate) => candidate.account === chosen.account.name);
  const own = margins[index] ?? -1;
  return own >= 0 && margins.every((m, i) => m === null || (i < index ? m < own : m <= own));
};

test("property: the choice follows the rule, and readings of accounts outside the pool change nothing", () => {
  const previous = fc.constantFrom(null, "one", "two", "three", "solo");
  expect(() =>
    fc.assert(
      fc.property(randomReadings, previous, (readings, from) => {
        const accounts = POOL.map((name) => account(name));
        const random = { ...registry, accounts: [...accounts, account("solo", { pool: null })] };
        const chosen = selectAccount(random, { ...main, previous: from }, readings, NOW);
        const inPool = selectAccount(
          random,
          { ...main, previous: from },
          readings.filter((r) => r.account !== "solo"),
          NOW,
        );
        return holds(chosen, from) && JSON.stringify(inPool) === JSON.stringify(chosen);
      }),
      { numRuns: 1000 },
    ),
  ).not.toThrow();
});
