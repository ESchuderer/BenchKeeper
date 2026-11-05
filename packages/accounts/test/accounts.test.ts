import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBenchKeeper, type Reading, selectAccount } from "@cedarloom/accounts";
import type { Account, AccountRegistry } from "@cedarloom/contracts";
import { expect, test } from "vitest";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");
const IMPORTED_AT = "2026-11-05T12:00:00.000Z";

const benchKeeper = (): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "benchkeeper.json"), "utf8"));

const home = (name: string) => `/home/dev/.local/share/benchkeeper/accounts/${name}`;

// The paths and codes of an import's schema finding.
const issues = (value: unknown) => {
  const imported = importBenchKeeper(value, IMPORTED_AT);
  return !imported.ok && imported.finding.code === "document.invalid" ? imported.finding.params.issues : [];
};

test("imports BenchKeeper's host accounts with pools per agent and minimums, never a credential", () => {
  const imported = importBenchKeeper(benchKeeper(), IMPORTED_AT);
  expect(imported).toEqual({
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
            home: home("codex-main"),
            pool: "main",
            added: "2026-10-03T08:00:00.000Z",
          },
        ],
        // Unconfirmed until the user confirms each pool (A5 guardrail).
        pools: { claude: { main: { confirmedAt: null } }, codex: { main: { confirmedAt: null } } },
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
  expect(JSON.stringify(imported)).not.toContain('token":{');
});

test("refuses a file that is not BenchKeeper's registry, or accounts that would share a folder", () => {
  expect(issues({})).toEqual([{ path: "accounts", code: "invalid_type" }]);
  expect(issues({ accounts: [{ name: "g", agent: "gemini", mode: "host", dir: "/g" }] })).toEqual([
    { path: "accounts.0.agent", code: "invalid_value" },
  ]);
  const twice = { name: "b", agent: "claude", mode: "host", dir: "/a" };
  expect(issues({ accounts: [{ ...twice, name: "a" }, twice] })).toEqual([{ path: "accounts.1.home", code: "custom" }]);
});

const account = (name: string, change: Partial<Account> = {}): Account => ({
  name,
  agent: "claude",
  home: `/accounts/${name}`,
  pool: "main",
  added: IMPORTED_AT,
  ...change,
});

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
      main: { confirmedAt: "2026-11-05T10:00:00.000Z" },
      spare: { confirmedAt: "2026-11-05T10:00:00.000Z" },
      idle: { confirmedAt: null },
    },
    codex: { main: { confirmedAt: "2026-11-05T10:00:00.000Z" } },
  },
};

const LATER = "2026-11-05T17:00:00.000Z";
const used = (name: string, fiveHour: number, sevenDay: number, resetsAt = LATER): Reading[] => [
  { account: name, window: "fiveHour", usedPercent: fiveHour, resetsAt },
  { account: name, window: "sevenDay", usedPercent: sevenDay, resetsAt },
];

test("a new worker gets the pool account with the most headroom above both of its minimums", () => {
  const readings = [...used("one", 50, 20), ...used("two", 30, 90), ...used("three", 30, 10), ...used("other", 0, 0)];
  const chosen = selectAccount(registry, { agent: "claude", pool: "main" }, readings, NOW);
  expect(chosen).toEqual({
    ok: true,
    account: registry.accounts[0],
    candidates: [
      { account: "one", margin: 42 },
      { account: "two", margin: 7 },
      { account: "three", margin: 30 },
    ],
  });
  const tie = selectAccount(
    registry,
    { agent: "claude", pool: "main" },
    [...used("one", 50, 0), ...used("two", 50, 0)],
    NOW,
  );
  expect(tie.ok && tie.account.name).toBe("one");
});

test("an account below a minimum, or with a window it has no current reading of, never qualifies", () => {
  const readings = [
    ...used("one", 95, 0),
    ...used("two", 0, 0).slice(0, 1),
    ...used("three", 0, 0, IMPORTED_AT),
    ...used("four", 0, 0, "not a time"),
  ];
  expect(selectAccount(registry, { agent: "claude", pool: "main" }, readings, NOW)).toEqual({
    ok: false,
    reason: "no-headroom",
    candidates: [
      { account: "one", margin: -3 },
      { account: "two", margin: null },
      { account: "three", margin: null },
    ],
  });
  const unparsable = selectAccount(registry, { agent: "claude", pool: "spare" }, readings, NOW);
  expect(unparsable).toEqual({ ok: false, reason: "no-headroom", candidates: [{ account: "four", margin: null }] });
});

test("no account comes from a pool that is not the agent's, or that the user has not confirmed", () => {
  for (const pool of ["constructor", "tostring"]) {
    expect(selectAccount(registry, { agent: "claude", pool }, [], NOW)).toMatchObject({ reason: "unknown-pool" });
  }
  expect(selectAccount(registry, { agent: "codex", pool: "idle" }, [], NOW)).toEqual({
    ok: false,
    reason: "unknown-pool",
    candidates: [],
  });
  expect(selectAccount(registry, { agent: "claude", pool: "idle" }, [], NOW)).toEqual({
    ok: false,
    reason: "unconfirmed-pool",
    candidates: [],
  });
});
