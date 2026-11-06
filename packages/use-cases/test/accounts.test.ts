import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AccountRegistry } from "@cedarloom/contracts";
import { openRunStore } from "@cedarloom/ledger";
import {
  applyPlan,
  chooseAccount,
  loadRegistry,
  loginAccount,
  ownHome,
  planConfirm,
  planHome,
  planImport,
} from "@cedarloom/use-cases";
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
      readings: expect.arrayContaining([expect.objectContaining({ account: "spare" })]),
      candidates: [
        { account: "work", margin: 2 },
        { account: "spare", margin: 72 },
      ],
    },
  ]);
  expect(rows[0]?.readings).toHaveLength(4);
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
    claude: { main: { confirmedAt: null, confirmedFor: [] } },
    codex: { main: { confirmedAt: null, confirmedFor: [] } },
  });
  expect(planImport(config, from, AT)).toEqual({
    ok: false,
    finding: { code: "accounts.registry-exists", params: { path: join(config, "accounts.json") } },
  });
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
  expect(confirm.value.findings).toEqual([{ code: "accounts.pool-terms", params: { pool: "main" } }]);
  expect(applyPlan(state, confirm.value.plan, { yes: true })).toMatchObject({ ok: true, value: { status: "applied" } });
  // The confirmation names the pool's accounts as they are now.
  expect(JSON.parse(readFileSync(join(config, "accounts.json"), "utf8")).pools.claude.main).toEqual({
    confirmedAt: AT,
    confirmedFor: ["work"],
  });
});

// A config folder with BenchKeeper's registry imported: work (Claude Code) and cx (Codex), in /accounts.
const importedRegistry = () => {
  const { config, state, from } = configAndBenchKeeper();
  const imported = planImport(config, from, AT);
  if (!imported.ok) throw new Error(imported.finding.code);
  applyPlan(state, imported.value.plan, { yes: true });
  return { config, state };
};

test("an account moves into its own home by a plan, and the folder it named before stays as an alias", () => {
  const { config, state } = importedRegistry();
  const home = ownHome(state, "work");
  expect(home).toBe(join(state, "homes", "work"));
  const moved = planHome(config, state, "work");
  if (!moved.ok || moved.value.plan === null) throw new Error("no plan");
  expect(moved.value.home).toBe(home);
  expect(applyPlan(state, moved.value.plan, { yes: true })).toMatchObject({ ok: true, value: { status: "applied" } });
  expect(loadRegistry(config)).toMatchObject({
    ok: true,
    value: {
      accounts: [
        { name: "work", home, aliases: ["/accounts/work"] },
        { name: "cx", home: "/accounts/cx" },
      ],
    },
  });
  // In its own home already: nothing to plan.
  expect(planHome(config, state, "work")).toEqual({ ok: true, value: { plan: null, home } });
  expect(planHome(config, state, "none")).toEqual({
    ok: false,
    finding: { code: "accounts.unknown-account", params: { account: "none" } },
  });
  expect(planHome(config, state, "cx")).toEqual({
    ok: false,
    finding: { code: "accounts.login-unsupported", params: { account: "cx", agent: "codex" } },
  });
  // A folder another account names already is not taken over.
  const edited = JSON.parse(readFileSync(join(config, "accounts.json"), "utf8"));
  edited.accounts[0] = { ...edited.accounts[0], home: "/accounts/work", aliases: [] };
  edited.accounts[1].aliases = [home];
  writeFileSync(join(config, "accounts.json"), JSON.stringify(edited));
  expect(planHome(config, state, "work")).toEqual({
    ok: false,
    finding: { code: "accounts.folder-taken", params: { path: home } },
  });
});

test("the login runs in the account's own home, made for the owner only, with the clean environment", () => {
  const { config, state } = importedRegistry();
  const seen: Record<string, string>[] = [];
  const run = (code: number) => (env: Record<string, string>) => {
    seen.push(env);
    return { code };
  };
  const parent = { PATH: "/bin", HOME: "/home/dev", TERM: "xterm", ANTHROPIC_API_KEY: "k", CLAUDE_CONFIG_DIR: "/x" };
  const linux = { parent, platform: "linux" as const };
  // Not in its own home yet: no login, so nothing lands in the folder it names.
  expect(loginAccount(config, state, "work", { ...linux, run: run(0) })).toEqual({
    ok: false,
    finding: { code: "accounts.home-not-own", params: { account: "work", home: "/accounts/work" } },
  });
  expect(loginAccount(config, state, "none", { ...linux, run: run(0) })).toMatchObject({
    finding: { code: "accounts.unknown-account" },
  });
  const moved = planHome(config, state, "work");
  if (!moved.ok || moved.value.plan === null) throw new Error("no plan");
  applyPlan(state, moved.value.plan, { yes: true });
  const home = ownHome(state, "work");
  expect(loginAccount(config, state, "work", { ...linux, run: run(0) })).toEqual({ ok: true, value: { home } });
  expect(seen).toEqual([{ PATH: "/bin", HOME: "/home/dev", TERM: "xterm", CLAUDE_CONFIG_DIR: home }]);
  // Windows keeps no POSIX mode.
  const mode = process.platform === "win32" ? 0o700 : statSync(home).mode & 0o777;
  expect(mode).toBe(0o700);
  // A login that fails or never starts is a finding; without a terminal type none is passed.
  expect(loginAccount(config, state, "work", { parent: { PATH: "/bin" }, platform: "linux", run: run(1) })).toEqual({
    ok: false,
    finding: { code: "accounts.login-failed", params: { account: "work", error: "exit code 1" } },
  });
  expect(seen.at(-1)).toEqual({ PATH: "/bin", CLAUDE_CONFIG_DIR: home });
  const missing = loginAccount(config, state, "work", {
    ...linux,
    run: () => ({ code: null, error: "spawn claude ENOENT" }),
  });
  expect(missing).toMatchObject({ ok: false, finding: { params: { error: "spawn claude ENOENT" } } });
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
