import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBenchKeeper, type Selection, selectAccount } from "@cedarloom/accounts";
import type { Account, AccountRegistry, Reading as Stored } from "@cedarloom/contracts";
import * as fc from "fast-check";
import { expect, test } from "vitest";

type Reading = Omit<Stored, "readAt">;

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const IMPORTED_AT = "2026-11-05T12:00:00.000Z";
const CONFIRMED = "2026-11-05T10:00:00.000Z";

const benchKeeper = (): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "benchkeeper.json"), "utf8"));

const home = (name: string) => `/home/dev/.local/share/benchkeeper/accounts/${name}`;

// The paths and codes of an import's schema finding.
const issues = (value: unknown) => {
  const imported = importBenchKeeper(value, IMPORTED_AT);
  return !imported.ok && imported.finding.code === "document.invalid" ? imported.finding.params.issues : [];
};

test("imports BenchKeeper's host accounts with pools per agent and minimums, never a credential", () => {
  const unconfirmed = { main: { confirmedAt: null, confirmedFor: [] } };
  expect(importBenchKeeper(benchKeeper(), IMPORTED_AT)).toEqual({
    ok: true,
    value: {
      registry: {
        schemaVersion: 1,
        minimum: { fiveHour: 8, sevenDay: 5 },
        accounts: [
          {
            name: "work",
            agent: "claude",
            label: "Work subscription",
            home: home("work"),
            pool: "main",
            minimum: { fiveHour: 15 },
            added: "2026-10-01T08:00:00.000Z",
          },
          { name: "spare", agent: "claude", home: home("spare"), pool: "main", added: IMPORTED_AT },
          {
            name: "codex-main",
            agent: "codex",
            label: "c".repeat(80),
            home: home("codex-main"),
            pool: "main",
            added: "2026-10-03T08:00:00.000Z",
          },
        ],
        // Unconfirmed until the user confirms each pool (A5 guardrail).
        pools: { claude: unconfirmed, codex: unconfirmed },
      },
      left: [
        { account: null, item: "autoPick" },
        { account: null, item: "rotate" },
        { account: "work", item: "default" },
        { account: "work", item: "warn" },
        { account: "spare", item: "token" },
        { account: "boxed", item: "container-account" },
      ],
    },
  });
});

test("refuses a file that is not BenchKeeper's registry, a newer one, or accounts that would share a folder", () => {
  expect(issues({})).toEqual([{ path: "accounts", code: "invalid_type" }]);
  expect(issues({ accounts: [{ name: "g", agent: "gemini", mode: "host", dir: "/g" }] })).toEqual([
    { path: "accounts.0.agent", code: "invalid_value" },
  ]);
  const twice = { name: "b", agent: "claude", mode: "host", dir: "/a" };
  expect(issues({ accounts: [{ ...twice, name: "a" }, twice] })).toEqual([{ path: "accounts.1.home", code: "custom" }]);
  expect(importBenchKeeper({ schemaVersion: 2, accounts: [] }, IMPORTED_AT)).toMatchObject({
    ok: false,
    finding: { code: "document.newer-schema", params: { found: 2, known: 1 } },
  });
});

test("property: no value of a stored token reaches the registry", () => {
  expect(() =>
    fc.assert(
      fc.property(fc.string({ minLength: 8 }), (secret) => {
        const token = { created: IMPORTED_AT, value: `sk-${secret}` };
        const file = {
          schemaVersion: 1,
          accounts: [{ name: "work", agent: "claude", mode: "host", dir: "/a", token }],
        };
        return !JSON.stringify(importBenchKeeper(file, IMPORTED_AT)).includes(JSON.stringify(token.value).slice(1, -1));
      }),
    ),
  ).not.toThrow();
});

const account = (name: string, change: Partial<Account> = {}): Account => ({
  name,
  agent: "claude",
  home: `/accounts/${name}`,
  pool: "main",
  added: IMPORTED_AT,
  ...change,
});

const POOL = ["one", "two", "three"];

const registry: AccountRegistry = {
  schemaVersion: 1,
  minimum: { fiveHour: 8, sevenDay: 3 },
  accounts: [
    account("one"),
    account("two"),
    account("three", { minimum: { fiveHour: 40 } }),
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

const LATER = "2026-11-05T17:00:00.000Z";
const used = (name: string, fiveHour: number, sevenDay: number, resetsAt = LATER): Reading[] => [
  { account: name, window: "fiveHour", usedPercent: fiveHour, resetsAt },
  { account: name, window: "sevenDay", usedPercent: sevenDay, resetsAt },
];

const main = { agent: "claude", pool: "main" } as const;

test("a new worker gets the pool account with the most headroom above both of its minimums", () => {
  const readings = [...used("one", 50, 20), ...used("two", 30, 90), ...used("three", 30, 10), ...used("other", 0, 0)];
  expect(selectAccount(registry, main, readings, NOW)).toEqual({
    ok: true,
    account: registry.accounts[0],
    reason: "most-headroom",
    candidates: [
      { account: "one", margin: 42 },
      { account: "two", margin: 7 },
      { account: "three", margin: 30 },
    ],
  });
  const tie = selectAccount(registry, main, [...used("one", 50, 0), ...used("two", 50, 0)], NOW);
  expect(tie.ok && tie.account.name).toBe("one");
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

test("an account below a minimum, or with a window it has no current reading of, never qualifies", () => {
  const readings = [...used("one", 95, 0), ...used("two", 0, 0).slice(0, 1), ...used("three", 0, 0, IMPORTED_AT)];
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
  // A known window below its minimum counts although the other window has reset: no account to stay on silently.
  const exhausted = [...used("two", 0, 99).slice(1), ...used("two", 0, 0, IMPORTED_AT).slice(0, 1)];
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
    resetsAt: fc.constantFrom("2026-11-05T11:00:00.000Z", IMPORTED_AT, "not a time", LATER, LATER, LATER),
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
  const minimums = fc.array(fc.constantFrom(undefined, 0, 8, 40), { minLength: 3, maxLength: 3 });
  const previous = fc.constantFrom(null, "one", "two", "three", "solo");
  expect(() =>
    fc.assert(
      fc.property(randomReadings, minimums, previous, (readings, own, from) => {
        const accounts = POOL.map((name, index) => {
          const fiveHour = own[index];
          return account(name, fiveHour === undefined ? {} : { minimum: { fiveHour } });
        });
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
