import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { type ClaudeLaunch, claudeRuntime, FRESH_INSTALL_PHASES } from "@cedarloom/adapter-claude";
import { type AccountRegistry, formatRegistry } from "@cedarloom/contracts";
import { openRunStore, type RunStore } from "@cedarloom/ledger";
import { type Decided, launchWorker, MAX_CONCURRENT, type WorkerRequest } from "@cedarloom/use-cases";
import { expect, test } from "vitest";

const fixtures = join(import.meta.dirname, "..", "..", "adapter-claude", "test", "fixtures");
const runtime = claudeRuntime([process.execPath, join(fixtures, "fake-claude.ts")]);
const AT = "2026-11-05T11:00:00.000Z";
const node = process.execPath;
// gh exits 1 when it finds no token.
const host = {
  parent: { PATH: process.env["PATH"] },
  platform: process.platform,
  home: "/home/dev",
  gh: [node, "-e", "process.exit(1)"],
} as const;

// A config folder with one confirmed Claude Code pool of one account, whose home exists.
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "cedarloom-launch-"));
  const state = join(root, "state");
  const config = join(root, "config");
  const home = join(root, "work-home");
  const work = join(root, "repo");
  for (const dir of [config, home, work]) mkdirSync(dir);
  const registry: AccountRegistry = {
    schemaVersion: 1,
    minimum: { fiveHour: 8, sevenDay: 3 },
    accounts: [{ name: "work", agent: "claude", home, pool: "main", added: AT }],
    pools: { claude: { main: { confirmedAt: AT, confirmedFor: ["work"] } } },
  };
  writeFileSync(join(config, "accounts.json"), formatRegistry(registry));
  return { state, config, work };
};

// A worker request whose fake CLI prints `stream` and writes `result(decided)` to the result file, if given.
const request = (
  work: string,
  stream: string,
  result?: (decided: Decided) => unknown,
): WorkerRequest<ClaudeLaunch> => ({
  task: "t1",
  agent: "claude",
  pool: "main",
  previous: null,
  prompt: "Do the task.",
  ghToken: null,
  runtime,
  launch: (decided) => ({
    ...FRESH_INSTALL_PHASES.implement,
    ...decided,
    cwd: work,
    allow: [],
    env: {
      ...decided.env,
      FAKE_STREAM: join(fixtures, stream),
      ...(result === undefined
        ? {}
        : { FAKE_RESULT: decided.resultFile, FAKE_RESULT_TEXT: JSON.stringify(result(decided)) }),
    },
  }),
});

const passing = (decided: Decided) => ({ schemaVersion: 1, runId: decided.runId, verdict: "pass", summary: "Done." });
// The result of another run.
const other = (decided: Decided) => ({ ...passing(decided), runId: "0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e6f" });

const withLedger = <T>(state: string, read: (store: RunStore) => T): T => {
  const store = openRunStore(state);
  if (!store.ok) throw new Error(store.finding.code);
  try {
    return read(store.value);
  } finally {
    store.value.close();
  }
};

test("a worker runs end to end: account, version check, lease, readings, and the verdict of its result file", async () => {
  const { state, config, work } = setup();
  const outcome = await launchWorker(state, config, request(work, "stream.jsonl", passing), host);
  expect(outcome).toMatchObject({
    ok: true,
    value: { kind: "finished", account: "work", verdict: "pass", summary: "Done.", exit: { code: 0 } },
  });
  const launches = withLedger(state, (store) => store.launches());
  expect(launches).toMatchObject([
    { task: "t1", agent: "claude", account: "work", version: "2.1.316", verdict: "pass" },
  ]);
  expect(launches[0]?.runId).toBe(outcome.ok && outcome.value.kind === "finished" ? outcome.value.runId : null);
  expect(launches[0]?.finishedAt).not.toBeNull();
  expect(withLedger(state, (store) => store.readings().map((reading) => reading.window))).toEqual([
    "fiveHour",
    "sevenDay",
  ]);
});

test("without a valid result of its own run the worker failed, and its lease ends", async () => {
  const { state, config, work } = setup();
  for (const result of [undefined, other]) {
    await expect(launchWorker(state, config, request(work, "stream.jsonl", result), host)).resolves.toMatchObject({
      value: { verdict: "failed", summary: null },
    });
  }
  expect(withLedger(state, (store) => store.launches().map((row) => row.verdict))).toEqual(["failed", "failed"]);
});

test("no worker starts on a CLI version without proof that it applies the worker settings", async () => {
  const { state, config, work } = setup();
  await expect(launchWorker(state, config, request(work, "unapplied.jsonl", passing), host)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.settings-unproven", params: { agent: "claude", version: "2.1.316" } },
  });
  expect(withLedger(state, (store) => store.launches())).toEqual([]);
});

test("a launch waits while the account runs its most workers, and gh's own login refuses it", async () => {
  const { state, config, work } = setup();
  withLedger(state, (store) => {
    for (const n of [1, 2]) {
      const runId = `0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e6${n}`;
      const lease = {
        runId,
        task: "t0",
        agent: "claude",
        account: "work",
        version: "2.1.316",
        pid: process.pid,
      } as const;
      store.leaseAccount({ ...lease, startedAt: AT }, MAX_CONCURRENT.claude);
    }
  });
  await expect(launchWorker(state, config, request(work, "stream.jsonl", passing), host)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.account-full", params: { account: "work", max: 2 } },
  });
  const loggedIn = { ...host, gh: [node, "-e", "process.exit(0)"] } as const;
  await expect(launchWorker(state, config, request(work, "stream.jsonl"), loggedIn)).resolves.toMatchObject({
    ok: false,
    finding: { code: "launch.gh-login" },
  });
});

test("without a registry or a pool that yields an account, no worker starts", async () => {
  const { state, config, work } = setup();
  const empty = mkdtempSync(join(tmpdir(), "cedarloom-launch-"));
  await expect(launchWorker(state, empty, request(work, "stream.jsonl"), host)).resolves.toEqual({
    ok: true,
    value: { kind: "no-account", reason: "unknown-pool" },
  });
  const unknown = { ...request(work, "stream.jsonl"), pool: "other" };
  await expect(launchWorker(state, config, unknown, host)).resolves.toEqual({
    ok: true,
    value: { kind: "no-account", reason: "unknown-pool" },
  });
  const newer = setup();
  withLedger(newer.state, () => undefined);
  const db = new DatabaseSync(join(newer.state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  await expect(launchWorker(newer.state, newer.config, request(work, "stream.jsonl"), host)).resolves.toMatchObject({
    ok: false,
    finding: { code: "store.newer-schema" },
  });
  writeFileSync(join(config, "accounts.json"), "{");
  await expect(launchWorker(state, config, request(work, "stream.jsonl"), host)).resolves.toMatchObject({
    ok: false,
    finding: { code: "document.invalid" },
  });
});

test("a CLI that cannot tell its version starts no worker", async () => {
  const { state, config, work } = setup();
  const missing = {
    ...request(work, "stream.jsonl"),
    runtime: { ...runtime, version: () => Promise.reject(new Error("spawn claude ENOENT")) },
  };
  await expect(launchWorker(state, config, missing, host)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.agent-unavailable", params: { agent: "claude", error: "spawn claude ENOENT" } },
  });
});

test("a run that throws ends its lease as failed", async () => {
  const { state, config, work } = setup();
  const failing = {
    ...request(work, "stream.jsonl"),
    runtime: {
      ...runtime,
      start: () => {
        throw new Error("no start");
      },
    },
  };
  await expect(launchWorker(state, config, failing, host)).rejects.toThrow("no start");
  expect(withLedger(state, (store) => store.launches().map((row) => row.verdict))).toEqual(["failed"]);
});

test("a store another process holds is tried again a second later", async () => {
  const { state, config, work } = setup();
  const holder = openRunStore(state);
  if (!holder.ok) throw new Error(holder.finding.code);
  // Released during the wait after the first try.
  setTimeout(() => holder.value.close(), 1200);
  await expect(launchWorker(state, config, request(work, "stream.jsonl", passing), host)).resolves.toMatchObject({
    value: { verdict: "pass" },
  });
}, 15_000);
