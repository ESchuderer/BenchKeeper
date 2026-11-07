import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { type ClaudeLaunch, claudeRuntime, FRESH_INSTALL_PHASES, phaseLaunch } from "@cedarloom/adapter-claude";
import type { AgentRuntime } from "@cedarloom/agent-contracts";
import {
  type AccountRegistry,
  formatRegistry,
  type JournalEvent,
  type Json,
  WorkflowDefinition,
} from "@cedarloom/contracts";
import { openGraphStore, openRunStore, type RunStore } from "@cedarloom/ledger";
import {
  applyPlan,
  cancelRun,
  type Decided,
  doctor,
  launchWorker,
  leaseWorker,
  listGraphRuns,
  MAX_CONCURRENT,
  ownHome,
  planMap,
  resumeRun,
  runWorkflow,
  showLaunch,
  WORKFLOW_PLUGIN,
  type WorkerRequest,
} from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";
import { z } from "zod";

const fixtures = join(import.meta.dirname, "..", "..", "adapter-claude", "test", "fixtures");
const runtime = claudeRuntime([process.execPath, join(fixtures, "fake-claude.ts")]);
const AT = "2026-11-05T11:00:00.000Z";
const node = process.execPath;
// gh exits 1 when it finds no token.
// The marketplace's plugins folder at the pinned commit, with the workflow plugin; `plugins` lists its folders.
const marketplace = (plugins: readonly string[]) => async (source: { ref: string }) => ({
  ok: true as const,
  value: {
    commit: source.ref,
    files: plugins.map((name) => ({
      path: `${name}/.claude-plugin/plugin.json`,
      mode: "100644" as const,
      sha256: "0".repeat(64),
      content: Buffer.from(`{"name":"${name}"}`),
    })),
    digest: "d",
  },
});

const host = {
  parent: { PATH: process.env["PATH"] },
  platform: process.platform,
  home: "/home/dev",
  gh: [node, "-e", "process.exit(1)"],
  // No managed settings: the machine's own would make these tests depend on it.
  managedDir: null,
  fetchTree: marketplace(["workflow", "benchkeeper"]),
} as const;

// A config folder with confirmed Claude Code pools of `names`, each in its own home, which exists: main, unless
// `pools` names another.
const setup = (names: readonly string[] = ["work"], pools: Readonly<Record<string, string>> = {}) => {
  const poolOf = (name: string): string => pools[name] ?? "main";
  const root = mkdtempSync(join(tmpdir(), "cedarloom-launch-"));
  const state = join(root, "state");
  const config = join(root, "config");
  const work = join(root, "repo");
  for (const dir of [config, work, ...names.map((name) => ownHome(state, name))]) mkdirSync(dir, { recursive: true });
  const registry: AccountRegistry = {
    schemaVersion: 1,
    accounts: names.map((name) => ({
      name,
      agent: "claude",
      home: ownHome(state, name),
      pool: poolOf(name),
      added: AT,
    })),
    pools: {
      claude: Object.fromEntries(
        [...new Set(["main", ...names.map(poolOf)])].map((pool) => [
          pool,
          { confirmedAt: AT, confirmedFor: names.filter((name) => poolOf(name) === pool) },
        ]),
      ),
    },
  };
  writeFileSync(join(config, "accounts.json"), formatRegistry(registry));
  return { state, config, work };
};

interface Fake {
  /** The stream the version check's probe prints, a fixture's name or a path; stream.jsonl when unset. */
  readonly probe?: string;
  /** The stream the run prints; the probe's when unset. */
  readonly run?: string;
  /** More variables of the run, such as FAKE_HANG. */
  readonly runEnv?: Readonly<Record<string, string>>;
  /** The result file the fake writes. */
  readonly result?: (decided: Decided) => unknown;
  /** The workflow phase whose settings the launch runs with; implement when unset. */
  readonly phase?: keyof typeof FRESH_INSTALL_PHASES;
}

// A worker request on the fake CLI. The launcher builds the probe's options first, then the run's.
const request = (work: string, fake: Fake = {}): WorkerRequest<ClaudeLaunch> => {
  let built = 0;
  return {
    task: "t1",
    agent: "claude",
    pool: "main",
    previous: null,
    prompt: "Do the task.",
    ghToken: null,
    labels: { phase: fake.phase ?? "implement", review: true, level: "checkpoint", tier: "standard" },
    runtime,
    launch: (decided) => {
      const run = (built += 1) > 1;
      const probe = fake.probe ?? "stream.jsonl";
      const result = fake.result;
      return {
        ...FRESH_INSTALL_PHASES[fake.phase ?? "implement"],
        ...decided,
        cwd: work,
        allow: [],
        env: {
          ...decided.env,
          FAKE_STREAM: resolve(fixtures, run ? (fake.run ?? probe) : probe),
          ...(run ? fake.runEnv : {}),
          ...(result === undefined
            ? {}
            : { FAKE_RESULT: decided.resultFile, FAKE_RESULT_TEXT: JSON.stringify(result(decided)) }),
        },
      };
    },
  };
};

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
  const outcome = await launchWorker(state, config, request(work, { result: passing }), host);
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
  // The settings it ran with: the request's phase, review, level and tier, and the built launch's models, effort and permission mode.
  expect(launches[0]?.labels).toEqual(LABELS);
  // The workflow plugin went with the launch, and its init line names it loaded with its skills: nothing to report.
  expect(launches[0]?.plugins).toEqual({
    expected: ["workflow"],
    loaded: ["workflow"],
    skills: ["workflow:workflow", "workflow:tier"],
    errors: ["extra: no plugin.json"],
  });
  expect(doctor(state)).toEqual([]);
  expect(withLedger(state, (store) => store.readings().map((reading) => reading.window))).toEqual([
    "fiveHour",
    "sevenDay",
  ]);
  // The run's usage is kept as history too, with its run, its CLI version and the line it came in.
  const samples = withLedger(state, (store) => store.usageSamples());
  expect(samples.map((each) => [each.window, each.runId, each.agentVersion])).toEqual([
    ["five_hour", launches[0]?.runId, "2.1.316"],
    ["seven_day", launches[0]?.runId, "2.1.316"],
  ]);
  expect(samples[0]?.raw).toContain('"type":"rate_limit_event"');
});

test("without a valid result of its own run the worker failed, and its lease ends", async () => {
  const { state, config, work } = setup();
  for (const result of [undefined, other]) {
    await expect(
      launchWorker(state, config, request(work, result === undefined ? {} : { result }), host),
    ).resolves.toMatchObject({
      value: { verdict: "failed", summary: null },
    });
  }
  expect(withLedger(state, (store) => store.launches().map((row) => row.verdict))).toEqual(["failed", "failed"]);
});

test("a run whose own init line lacks the settings proof is stopped at once, and its lease ends as failed", async () => {
  const { state, config, work } = setup();
  const unproven = {
    ok: false,
    finding: { code: "launch.settings-unproven", params: { agent: "claude", version: "2.1.316" } },
  };
  // The version passed its check, but this run's settings did not apply: without a stop it would hang.
  const hanging = request(work, { run: "unapplied.jsonl", runEnv: { FAKE_HANG: "1" }, result: passing });
  await expect(launchWorker(state, config, hanging, host)).resolves.toEqual(unproven);
  expect(withLedger(state, (store) => store.launches().map((row) => row.verdict))).toEqual(["failed"]);
}, 15_000);

test("a CLI version whose check gave no proof that it applies the settings starts no run: the backstop", async () => {
  const { state, config, work } = setup();
  await expect(launchWorker(state, config, request(work, { probe: "unapplied.jsonl" }), host)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.settings-unproven", params: { agent: "claude", version: "2.1.316" } },
  });
  expect(withLedger(state, (store) => store.launches())).toEqual([]);
  expect(workerFolders(state)).toEqual([]);
});

test("a run whose stream holds no init line proves nothing, so it failed whatever its result file says", async () => {
  const { state, config, work } = setup();
  // The version's check passed, but this run's stream drops its init line.
  const noInit = join(mkdtempSync(join(tmpdir(), "cedarloom-stream-")), "no-init.jsonl");
  const lines = readFileSync(join(fixtures, "stream.jsonl"), "utf8").split("\n");
  writeFileSync(noInit, lines.filter((line) => !line.includes('"subtype":"init"')).join("\n"));
  await expect(
    launchWorker(state, config, request(work, { run: noInit, result: passing }), host),
  ).resolves.toMatchObject({
    ok: true,
    value: { kind: "finished", verdict: "failed", exit: { code: 0 } },
  });
  expect(withLedger(state, (store) => store.launches().map((row) => row.verdict))).toEqual(["failed"]);
});

// The tokens of the result in stream.jsonl, over its one model.
const TOTALS = { inputTokens: 2, outputTokens: 70, cacheReadTokens: 11687, cacheCreationTokens: 12674 };

const LABELS = {
  phase: "implement",
  model: "claude-sonnet-5-5",
  subagentModel: "claude-sonnet-5-5",
  effort: "high",
  permissionMode: "dontAsk",
  review: true,
  level: "checkpoint",
  tier: "standard",
} as const;
const lease = (runId: string, account: string) =>
  ({
    runId,
    task: "t0",
    agent: "claude",
    account,
    version: "2.1.316",
    pid: process.pid,
    startedAt: AT,
    labels: LABELS,
  }) as const;
const runIdOf = (n: number) => `0b9f4c1e-8d2a-4c6b-9f3e-1a2b3c4d5e6${n}`;
// Takes the account's leases, as other launchers that run, and holds them.
const fill = (state: string, account: string, from: number) =>
  withLedger(state, (store) =>
    [from, from + 1].map((n) => store.leaseAccount(lease(runIdOf(n), account), MAX_CONCURRENT.claude)),
  );
const workerFolders = (state: string) =>
  existsSync(join(state, "workers")) ? readdirSync(join(state, "workers")) : [];

test("a worker's run keeps the totals its result reported, which its view shows", async () => {
  const { state, config, work } = setup();
  const outcome = await launchWorker(state, config, request(work, { result: passing }), host);
  if (!outcome.ok || outcome.value.kind !== "finished") throw new Error("no run");
  const totals = { ...TOTALS, costUsd: 0.10513739999999999 };
  expect(showLaunch(state, outcome.value.runId)).toMatchObject({ ok: true, value: { totals } });
  expect(showLaunch(state, runIdOf(9))).toEqual({
    ok: false,
    finding: { code: "run.not-found", params: { runId: runIdOf(9) } },
  });
});

// Applies `accounts map` of each folder to its account or pool.
const map = (state: string, config: string, bindings: readonly (readonly [string, string])[]) => {
  for (const [name, folder] of bindings) {
    const planned = planMap(config, name, folder);
    if (!planned.ok) throw new Error(planned.finding.code);
    applyPlan(state, planned.value.plan, { yes: true });
  }
};

test("a worker launched below folders bound by accounts map runs on the deepest one's account, if within its line", async () => {
  const { state, config, work } = setup(["work", "spare"]);
  const project = realpathSync(work);
  const inner = join(project, "packages");
  mkdirSync(inner);
  map(state, config, [
    ["work", project],
    ["spare", inner],
  ]);
  // Without readings the choice would stay on the pool's first account, work, as would the outer binding.
  const below = { ...request(work, { result: passing }), project: join(inner, "app") };
  const outcome = await launchWorker(state, config, below, host);
  expect(outcome).toMatchObject({ ok: true, value: { kind: "finished", account: "spare" } });
  // A bound account below its line starts no worker, and no other account is taken.
  const reading = {
    account: "spare",
    window: "fiveHour",
    usedPercent: 95,
    resetsAt: "2099-01-01T00:00:00.000Z",
  } as const;
  withLedger(state, (store) => store.recordReading({ ...reading, readAt: new Date().toISOString() }));
  expect(await launchWorker(state, config, below, host)).toEqual({
    ok: true,
    value: { kind: "no-account", reason: "no-headroom" },
  });
});

test("without the workflow plugin at the pinned commit a worker starts without one, and the doctor says so", async () => {
  const { state, config, work } = setup();
  const without = { ...host, fetchTree: marketplace(["benchkeeper"]) };
  const outcome = await launchWorker(state, config, request(work, { result: passing }), without);
  expect(outcome).toMatchObject({ ok: true, value: { kind: "finished", verdict: "pass" } });
  expect(withLedger(state, (store) => store.launches()[0]?.plugins?.expected)).toEqual([]);
  expect(doctor(state)).toEqual([
    { code: "doctor.plugin-none", params: { plugin: "workflow", commit: WORKFLOW_PLUGIN.commit } },
  ]);
});

test("a worker starts only in its account's own home, so nothing is written into another tool's", async () => {
  const { state, config, work } = setup();
  const registry = JSON.parse(readFileSync(join(config, "accounts.json"), "utf8"));
  const ade = join(state, "..", "ade-home");
  registry.accounts[0].home = ade;
  writeFileSync(join(config, "accounts.json"), JSON.stringify(registry));
  await expect(launchWorker(state, config, request(work), host)).resolves.toEqual({
    ok: false,
    finding: { code: "accounts.home-not-own", params: { account: "work", home: ade } },
  });
  expect(workerFolders(state)).toEqual([]);
});

test("a worker never starts in an own home that is a link, so nothing is written into the folder it points to", async () => {
  const { state, config, work } = setup();
  const elsewhere = mkdtempSync(join(tmpdir(), "cedarloom-elsewhere-"));
  renameSync(ownHome(state, "work"), join(state, "work-before"));
  symlinkSync(elsewhere, ownHome(state, "work"), "junction");
  await expect(launchWorker(state, config, request(work), host)).resolves.toEqual({
    ok: false,
    finding: { code: "accounts.home-linked", params: { account: "work", path: ownHome(state, "work") } },
  });
  expect([workerFolders(state), readdirSync(elsewhere)]).toEqual([[], []]);
});

test("a worker never starts before its account's login made the own home: no probe runs logged out", async () => {
  const { state, config, work } = setup();
  renameSync(ownHome(state, "work"), join(state, "work-before"));
  await expect(launchWorker(state, config, request(work), host)).resolves.toEqual({
    ok: false,
    finding: { code: "accounts.home-missing", params: { account: "work", home: ownHome(state, "work") } },
  });
  // No contract check ran, so none is recorded for the CLI version, and the home is left to the login to make.
  expect(withLedger(state, (store) => store.contractChecks("claude"))).toEqual([]);
  expect([workerFolders(state), existsSync(ownHome(state, "work"))]).toEqual([[], false]);
});

test("the account choice passes over an account whose leases are all taken; with none free, no worker starts", async () => {
  const { state, config, work } = setup(["work", "spare"]);
  const held = fill(state, "work", 1);
  await expect(launchWorker(state, config, request(work, { result: passing }), host)).resolves.toMatchObject({
    value: { kind: "finished", account: "spare", verdict: "pass" },
  });
  held.push(...fill(state, "spare", 3));
  await expect(launchWorker(state, config, request(work), host)).resolves.toEqual({
    ok: true,
    value: { kind: "no-account", reason: "all-leased" },
  });
  for (const each of held) each?.release();
});

test("a launch refused before its run leaves no worker folder: a lease taken meanwhile, gh's own login, no CLI", async () => {
  const { state, config, work } = setup();
  // Other launchers take the account's leases between the choice and the lease.
  const held: ReturnType<typeof fill> = [];
  const racing = {
    ...request(work),
    runtime: {
      ...runtime,
      version: (env: Readonly<Record<string, string>>) => {
        if (held.length === 0) held.push(...fill(state, "work", 1));
        return runtime.version(env);
      },
    },
  };
  await expect(launchWorker(state, config, racing, host)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.account-full", params: { account: "work", max: 2 } },
  });
  for (const each of held) each?.release();
  const loggedIn = { ...host, gh: [node, "-e", "process.exit(0)"] } as const;
  await expect(launchWorker(state, config, request(work), loggedIn)).resolves.toMatchObject({
    ok: false,
    finding: { code: "launch.gh-login" },
  });
  const missing = {
    ...request(work),
    runtime: { ...runtime, version: () => Promise.reject(new Error("spawn claude ENOENT")) },
  };
  await expect(launchWorker(state, config, missing, host)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.agent-unavailable", params: { agent: "claude", error: "spawn claude ENOENT" } },
  });
  expect(workerFolders(state)).toEqual([]);
});

test("without a registry or a pool that yields an account, no worker starts", async () => {
  const { state, config, work } = setup();
  const empty = mkdtempSync(join(tmpdir(), "cedarloom-launch-"));
  await expect(launchWorker(state, empty, request(work), host)).resolves.toEqual({
    ok: true,
    value: { kind: "no-account", reason: "unknown-pool" },
  });
  const unknown = { ...request(work), pool: "other" };
  await expect(launchWorker(state, config, unknown, host)).resolves.toEqual({
    ok: true,
    value: { kind: "no-account", reason: "unknown-pool" },
  });
  const newer = setup();
  withLedger(newer.state, () => undefined);
  const db = new DatabaseSync(join(newer.state, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  await expect(launchWorker(newer.state, newer.config, request(work), host)).resolves.toMatchObject({
    ok: false,
    finding: { code: "store.newer-schema" },
  });
  writeFileSync(join(config, "accounts.json"), "{");
  await expect(launchWorker(state, config, request(work), host)).resolves.toMatchObject({
    ok: false,
    finding: { code: "document.invalid" },
  });
});

test("a run that throws ends its lease as failed", async () => {
  const { state, config, work } = setup();
  const failing = {
    ...request(work),
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
  await expect(launchWorker(state, config, request(work, { result: passing }), host)).resolves.toMatchObject({
    value: { verdict: "pass" },
  });
}, 15_000);

const Started = z.object({ type: z.literal("fake"), pid: z.int() });
const Command = z.object({ type: z.literal("command"), pid: z.int() });
const gone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

test("a run whose observer throws stops the worker CLI and the command it runs, and ends the lease as failed", async () => {
  const { state, config, work } = setup();
  const pids: number[] = [];
  const throwing = {
    ...request(work, { runEnv: { FAKE_CHILD: "1", FAKE_HANG: "1" } }),
    runtime: {
      ...runtime,
      start: (options: ClaudeLaunch) => {
        const session = runtime.start(options);
        async function* events() {
          for await (const event of session.events) {
            const raw = event.type === "exit" ? null : event.raw;
            const started = Started.safeParse(raw);
            if (started.success) pids.push(started.data.pid);
            const command = Command.safeParse(raw);
            if (command.success) {
              pids.push(command.data.pid);
              throw new Error("observer failed");
            }
            yield event;
          }
        }
        return { events: events(), cancel: () => session.cancel() };
      },
    },
  };
  await expect(launchWorker(state, config, throwing, host)).rejects.toThrow("observer failed");
  expect(pids).toHaveLength(2);
  expect(pids.filter((pid) => !gone(pid))).toEqual([]);
  expect(withLedger(state, (store) => store.launches().map((row) => row.verdict))).toEqual(["failed"]);
}, 15_000);

test("the version check tries a store another process holds again a second later", async () => {
  const { state, config, work } = setup();
  const holding = {
    ...request(work, { result: passing }),
    runtime: {
      ...runtime,
      // Another holder takes the store while the probe runs and lets go during the wait after the first try.
      checkContract: async (probe: Parameters<typeof runtime.checkContract>[0]) => {
        const check = await runtime.checkContract(probe);
        const holder = openRunStore(state);
        if (holder.ok) setTimeout(() => holder.value.close(), 1200);
        return check;
      },
    },
  };
  await expect(launchWorker(state, config, holding, host)).resolves.toMatchObject({ value: { verdict: "pass" } });
}, 15_000);

test("managed settings that loosen the sandbox, or cannot be read, refuse a Claude Code launch before anything else", async () => {
  const { state, config, work } = setup();
  const managedDir = mkdtempSync(join(tmpdir(), "cedarloom-managed-"));
  const file = join(managedDir, "managed-settings.json");
  writeFileSync(file, JSON.stringify({ sandbox: { enabled: false } }));
  await expect(launchWorker(state, config, request(work), { ...host, managedDir })).resolves.toEqual({
    ok: false,
    finding: { code: "launch.sandbox-overridden", params: { path: file, key: "sandbox.enabled" } },
  });
  writeFileSync(file, "{");
  await expect(launchWorker(state, config, request(work), { ...host, managedDir })).resolves.toEqual({
    ok: false,
    finding: { code: "launch.managed-settings-unreadable", params: { path: file, error: "not JSON" } },
  });
  // Nothing was chosen, leased or created: the state folder holds only the accounts' homes.
  expect(readdirSync(state)).toEqual(["homes"]);
  // Claude Code's managed settings do not apply to a Codex launch, which goes on to its own refusals.
  await expect(
    launchWorker(state, config, { ...request(work), agent: "codex" }, { ...host, managedDir }),
  ).resolves.toEqual({
    ok: true,
    value: { kind: "no-account", reason: "unknown-pool" },
  });
});

test("a run's labels take the permission mode the launch was built with: a plan launch records plan", async () => {
  const { state, config, work } = setup();
  await launchWorker(state, config, request(work, { phase: "plan", result: passing }), host);
  expect(withLedger(state, (store) => store.launches()[0]?.labels)).toMatchObject({
    phase: "plan",
    model: "claude-opus-5-5",
    permissionMode: "plan",
    tier: "standard",
  });
});

test("a storage error while keeping a run's usage drops that usage, and the run goes on to its verdict", async () => {
  const { state, config, work } = setup();
  const probe = openRunStore(state);
  if (!probe.ok) throw new Error(probe.finding.code);
  const writer = vi.spyOn(Object.getPrototypeOf(probe.value), "recordSamples").mockImplementation(() => {
    throw new Error("disk I/O error");
  });
  probe.value.close();
  try {
    await expect(launchWorker(state, config, request(work, { result: passing }), host)).resolves.toMatchObject({
      value: { kind: "finished", verdict: "pass" },
    });
    expect(writer).toHaveBeenCalled();
  } finally {
    writer.mockRestore();
  }
});

// A launch on the fake CLI with its stream and `more` of the fake's settings.
const faked = <T extends ClaudeLaunch>(launch: T, more: Record<string, string>): T => ({
  ...launch,
  env: { ...launch.env, FAKE_STREAM: join(fixtures, "stream.jsonl"), ...more },
});
// The fake CLI as the runtime of agent nodes: a run also gets `env`, and writes a result of `verdict` with its own run
// id, as the result prompt names it (none when null). A resumed session's summary names the session it went on with.
const agentRuntime = (
  env: Record<string, string> = {},
  verdict: string | null = "pass",
): AgentRuntime<ClaudeLaunch> => {
  const writing = (launch: ClaudeLaunch, summary: string) => {
    const runId = /"runId":"([^"]+)"/.exec(launch.prompt)?.[1] ?? "";
    const result = { schemaVersion: 1, runId, verdict, summary };
    const written =
      verdict === null ? {} : { FAKE_RESULT: launch.resultFile, FAKE_RESULT_TEXT: JSON.stringify(result) };
    return faked(launch, { ...env, ...written });
  };
  const start = (launch: ClaudeLaunch) => runtime.start(writing(launch, "Reviewed."));
  const resume = (sessionId: string, launch: ClaudeLaunch) =>
    runtime.resume(sessionId, writing(launch, `Resumed ${sessionId}.`));
  const checkContract = (probe: Parameters<typeof runtime.checkContract>[0]) =>
    runtime.checkContract(faked({ ...probe, prompt: "", verifiedVersions: [] }, {}));
  return { ...runtime, checkContract, start, resume };
};

// The project as a git repository with one commit, and a workflow file beside it: t -> a, an agent.run of `config`
// whose result is the run's output.
const agentWorkflow = (work: string, config: Record<string, Json>, execution: Record<string, Json> = {}): string => {
  execFileSync("git", ["init", "--quiet"], { cwd: work });
  const user = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.org"];
  execFileSync("git", [...user, "commit", "--quiet", "--allow-empty", "-m", "start"], { cwd: work });
  const file = join(work, "..", "agent.json");
  const workflow = {
    schemaVersion: 1,
    kind: "cedarloom.workflow",
    metadata: { id: "agent", name: "Agent", version: "1.0.0" },
    outputs: { result: { type: "string" } },
    nodes: [
      { id: "t", type: "trigger.manual" },
      { id: "a", type: "agent.run", with: config },
    ],
    edges: [
      { id: "e1", from: { node: "t", handle: "start" }, to: { node: "a", handle: "run" } },
      { id: "e2", from: { node: "a", handle: "result" }, to: { output: "result" } },
    ],
    execution,
  };
  writeFileSync(file, JSON.stringify(workflow));
  return file;
};
const REVIEW = { task: "Review the change.", phase: "review" };
const attemptsOf = (state: string) =>
  new DatabaseSync(join(state, "runs.sqlite"), { readOnly: true })
    .prepare("SELECT state, outputs, sessionId FROM node_attempts")
    .all()
    .map((row) => ({ state: row["state"], outputs: JSON.parse(String(row["outputs"])), sessionId: row["sessionId"] }));

test("an agent node runs a worker in the run's worktree on its phase's settings, keeps its session and gives its summary", async () => {
  const { state, config, work } = setup();
  const file = agentWorkflow(work, REVIEW);
  const ran = await runWorkflow(
    state,
    file,
    {},
    { project: work, agents: { config, host, runtime: agentRuntime(), launch: phaseLaunch } },
  );
  expect(ran).toMatchObject({ ok: true, value: { status: "succeeded" } });
  const runId = ran.ok ? ran.value.runId : "";
  expect(attemptsOf(state)).toEqual([
    {
      state: "done",
      outputs: { result: "Reviewed.", verdict: "pass" },
      sessionId: "00000000-0000-4000-8000-000000000001",
    },
  ]);
  const tree = join(state, "worktrees", runId);
  expect(execFileSync("git", ["branch", "--show-current"], { cwd: tree, encoding: "utf8" }).trim()).toBe(
    `cedarloom/${runId}`,
  );
  expect(withLedger(state, (store) => store.launches())).toMatchObject([
    {
      task: `${runId}:a#1`,
      verdict: "pass",
      labels: { phase: "review", model: "claude-opus-5-5", review: true, level: "supervised", tier: null },
    },
  ]);
}, 30_000);

test("an agent that sends nothing for its stall time is stopped and times out; a cancel stops a running one", async () => {
  const { state, config, work } = setup();
  const file = agentWorkflow(work, REVIEW);
  const hang = { config, host, runtime: agentRuntime({ FAKE_HANG: "1" }, null), launch: phaseLaunch, stallMs: 300 };
  const stalled = await runWorkflow(state, file, {}, { project: work, agents: hang });
  const stop = new AbortController();
  const onEvent = (event: JournalEvent) => event.type === "session" && stop.abort();
  const agents = { ...hang, stallMs: 60_000 };
  const cancelled = await runWorkflow(state, file, {}, { project: work, agents, signal: stop.signal, onEvent });
  expect([stalled, cancelled]).toMatchObject([{ value: { status: "failed" } }, { value: { status: "cancelled" } }]);
  expect(attemptsOf(state).map((row) => row.state)).toEqual(["timed-out", "cancelled"]);
}, 30_000);

// A retry's backoff that does not wait.
const noWait = () => Promise.resolve();
// Waits until `done` holds.
const until = async (done: () => boolean): Promise<void> => {
  while (!done()) await new Promise((wake) => setTimeout(wake, 10));
};
const runFolders = (state: string) =>
  existsSync(join(state, "worktrees")) ? readdirSync(join(state, "worktrees")) : [];
const branches = (work: string) =>
  execFileSync("git", ["branch", "--list", "--format=%(refname:short)", "cedarloom/*"], { cwd: work, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

test("a cancel while the worktree is added starts no session, and lets the lease go", async () => {
  const { state, config, work } = setup();
  const file = agentWorkflow(work, REVIEW);
  const stop = new AbortController();
  const onEvent = (event: JournalEvent) => event.type === "started" && stop.abort();
  const agents = { config, host, runtime: agentRuntime({ FAKE_HANG: "1" }, null), launch: phaseLaunch };
  expect(await runWorkflow(state, file, {}, { project: work, agents, onEvent, signal: stop.signal })).toMatchObject({
    value: { status: "cancelled" },
  });
  expect(withLedger(state, (store) => store.launches().map((each) => each.verdict))).toEqual(["not-run"]);
}, 15_000);

test("a leased worker whose signal ended already stops its session at once", async () => {
  const { state, config, work } = setup();
  const leased = await leaseWorker(state, config, request(work, { runEnv: { FAKE_HANG: "1" } }), host);
  if (!leased.ok || leased.value.kind !== "leased") throw new Error("no lease");
  expect(await leased.value.run({ signal: AbortSignal.abort() })).toMatchObject({
    ok: true,
    value: { kind: "finished", verdict: "failed" },
  });
}, 15_000);

test("an agent waits for a free lease of its account before it starts, and a cancel ends the wait", async () => {
  const { state, config, work } = setup();
  const file = agentWorkflow(work, REVIEW);
  const held = fill(state, "work", 1);
  let freed = false;
  setTimeout(() => {
    freed = true;
    for (const lock of held) lock?.release();
  }, 300);
  const order: boolean[] = [];
  const onEvent = (event: JournalEvent) => event.type === "started" && order.push(freed);
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch, retryMs: 50 };
  expect(await runWorkflow(state, file, {}, { project: work, agents, onEvent })).toMatchObject({
    value: { status: "succeeded" },
  });
  expect(order).toEqual([true]);
  // A run is listed once its runner listens for a stop.
  const again = fill(state, "work", 3);
  const stop = new AbortController();
  const waiting = runWorkflow(state, file, {}, { project: work, agents, signal: stop.signal });
  await until(() => {
    const listed = listGraphRuns(state);
    return listed.ok && listed.value.length === 2;
  });
  stop.abort();
  expect(await waiting).toMatchObject({ value: { status: "cancelled" } });
  for (const lock of again) lock?.release();
}, 30_000);

test.skipIf(process.platform === "win32")(
  "a report run's agent works in its project, closed to writes with the git folder a linked worktree shares, and makes no worktree",
  async () => {
    const { state, config, work } = setup();
    const file = agentWorkflow(work, REVIEW);
    const linked = join(work, "..", "linked");
    execFileSync("git", ["worktree", "add", "--quiet", "--detach", linked], { cwd: work });
    const closed: [string, readonly string[] | undefined][] = [];
    const launch = (...args: Parameters<typeof phaseLaunch>) => {
      closed.push([args[2], args[3]]);
      return phaseLaunch(...args);
    };
    const agents = { config, host, runtime: agentRuntime(), launch };
    const ran = await runWorkflow(state, file, {}, { project: linked, agents, report: true });
    expect(ran).toMatchObject({ ok: true, value: { status: "succeeded" } });
    expect(closed.at(-1)).toEqual([realpathSync(linked), [join(realpathSync(work), ".git")]]);
    expect(existsSync(join(state, "worktrees"))).toBe(false);
  },
  30_000,
);

test.runIf(process.platform === "win32")(
  "a report run with an agent is refused on native Windows, which has no sandbox (Q7)",
  async () => {
    const { state, config, work } = setup();
    const file = agentWorkflow(work, REVIEW);
    const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
    expect(await runWorkflow(state, file, {}, { project: work, agents, report: true })).toEqual({
      ok: false,
      finding: { code: "run.sandbox-unavailable", params: { node: "a" } },
    });
  },
);

test("an agent fails, saying why, before it makes a worktree or a branch; one stopped first lets its lease go", async () => {
  const { state, config, work } = setup();
  const file = agentWorkflow(work, REVIEW);
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  await runWorkflow(state, file, {}, { project: work, agents: { ...agents, config: join(config, "none") } });
  const plain = join(work, "..", "plain");
  mkdirSync(plain);
  await runWorkflow(state, file, {}, { project: plain, agents });
  // Stopped while its launch is built, before it goes.
  const stop = new AbortController();
  const launch = (...args: Parameters<typeof phaseLaunch>) => {
    stop.abort();
    return phaseLaunch(...args);
  };
  await runWorkflow(state, file, {}, { project: work, agents: { ...agents, launch }, signal: stop.signal });
  // gh's own login refuses the launch; a session whose init line proves no settings is stopped.
  const loggedIn = { ...host, gh: [node, "-e", "process.exit(0)"] } as const;
  await runWorkflow(state, file, {}, { project: work, agents: { ...agents, host: loggedIn } });
  const unproven = agentRuntime({ FAKE_STREAM: join(fixtures, "unapplied.jsonl") });
  await runWorkflow(state, file, {}, { project: work, agents: { ...agents, runtime: unproven } });
  // The level's settings file cannot be read.
  writeFileSync(join(config, "automation.json"), "{");
  await runWorkflow(state, file, {}, { project: work, agents });
  // A session whose init line proves no settings is no session to resume.
  expect(attemptsOf(state).map((row) => [row.state, row.outputs, row.sessionId])).toEqual([
    ["failed", { error: "no-single-pool" }, null],
    ["failed", { error: "git.failed" }, null],
    ["cancelled", {}, null],
    ["failed", { error: "launch.gh-login" }, null],
    ["failed", { error: "launch.settings-unproven" }, null],
    ["failed", { error: "document.invalid" }, null],
  ]);
  expect(withLedger(state, (store) => store.launches().map((each) => each.verdict))).toEqual([
    "not-run",
    "not-run",
    "failed",
  ]);
  // Only the run whose session started has a worktree and a branch.
  expect([runFolders(state).length, branches(work).length]).toEqual([1, 1]);
}, 30_000);

test("an agent in a folder bound to a pool chooses from that pool, where two unbound pools refuse it", async () => {
  const { state, config, work } = setup(["work", "spare"], { spare: "second" });
  const file = agentWorkflow(work, REVIEW);
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  await runWorkflow(state, file, {}, { project: work, agents });
  map(state, config, [["second", work]]);
  expect(await runWorkflow(state, file, {}, { project: work, agents })).toMatchObject({
    value: { status: "succeeded" },
  });
  expect(attemptsOf(state).map((row) => row.outputs)).toEqual([
    { error: "no-single-pool" },
    { result: "Reviewed.", verdict: "pass" },
  ]);
  expect(withLedger(state, (store) => store.launches().map((each) => each.account))).toEqual(["spare"]);
}, 30_000);

test("an add of the worktree that failed is tried again by the next attempt, and lets its lease go", async () => {
  const { state, config, work } = setup();
  const file = agentWorkflow(work, REVIEW, { nodes: { a: { retries: 1 } } });
  const folder = () => {
    const listed = listGraphRuns(state);
    return join(state, "worktrees", (listed.ok ? listed.value[0]?.id : undefined) ?? "none");
  };
  // A folder is in the worktree's way when the first attempt goes, and gone when the second does.
  const onEvent = (event: JournalEvent) => {
    if (event.type === "started" && event.attempt === 1) {
      mkdirSync(folder(), { recursive: true });
      writeFileSync(join(folder(), "x.txt"), "x");
    }
    if (event.type === "ended" && event.attempt === 1) rmSync(folder(), { recursive: true, force: true });
  };
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  expect(await runWorkflow(state, file, {}, { project: work, agents, onEvent, sleep: noWait })).toMatchObject({
    value: { status: "succeeded" },
  });
  expect(attemptsOf(state).map((row) => [row.state, row.outputs])).toEqual([
    ["failed", { error: "git.failed" }],
    ["done", { result: "Reviewed.", verdict: "pass" }],
  ]);
  expect(withLedger(state, (store) => store.launches().map((each) => each.verdict))).toEqual(["not-run", "pass"]);
}, 30_000);

// A run of the agent workflow `file` in `work` that no runner holds; `journal` is what its runner wrote before it died.
const leftRun = (state: string, work: string, file: string, journal: readonly JournalEvent[] = []): string => {
  const graphs = openGraphStore(state);
  if (!graphs.ok) throw new Error(graphs.finding.code);
  const definition = WorkflowDefinition.parse(JSON.parse(readFileSync(file, "utf8")));
  const base = { inputs: {}, trigger: "manual", mode: "act", parentRun: null, parentNode: null } as const;
  const created = graphs.value.create({ ...base, definition, project: realpathSync(work) });
  for (const event of journal) graphs.value.append(created.runId, created.epoch, event);
  created.release();
  graphs.value.close();
  return created.runId;
};

test("a later runner of a run works in the worktree the run has", async () => {
  const { state, config, work } = setup();
  const created = { runId: leftRun(state, work, agentWorkflow(work, REVIEW)) };
  const folder = join(state, "worktrees", created.runId);
  execFileSync("git", ["worktree", "add", "--quiet", "-b", `cedarloom/${created.runId}`, folder, "HEAD"], {
    cwd: work,
  });
  writeFileSync(join(folder, "kept.txt"), "kept");
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  expect(await resumeRun(state, created.runId, { project: work, agents })).toMatchObject({
    value: { status: "succeeded" },
  });
  expect([existsSync(join(folder, "kept.txt")), branches(work)]).toEqual([true, [`cedarloom/${created.runId}`]]);
}, 30_000);

const SESSION = "00000000-0000-4000-8000-000000000002";
const LAUNCH = runIdOf(0);
// A run whose runner died while attempt 1 of a ran on `account`: the journal keeps its start and its session, and the
// ledger its launch, whose lease was let go without an end.
const died = (state: string, work: string, account: string): string => {
  const runId = leftRun(state, work, agentWorkflow(work, REVIEW), [
    { type: "started", node: "a", attempt: 1, pid: null },
    { type: "session", node: "a", attempt: 1, sessionId: SESSION },
  ]);
  withLedger(state, (store) =>
    store.leaseAccount({ ...lease(LAUNCH, account), task: `${runId}:a#1` }, MAX_CONCURRENT.claude)?.release(),
  );
  return runId;
};

// The result file of the staged launch, as its worker wrote it.
const written = (state: string, result: { verdict: string; summary: string }): void => {
  const out = join(state, "workers", LAUNCH.slice(0, 8), "out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "result.json"), JSON.stringify({ schemaVersion: 1, runId: LAUNCH, ...result }));
};

test("an agent attempt a dead runner left ends with the result its worker wrote, without a relaunch", async () => {
  const { state, config, work } = setup();
  const runId = died(state, work, "work");
  written(state, { verdict: "pass", summary: "Done before the crash." });
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  expect(await resumeRun(state, runId, { project: work, agents })).toMatchObject({ value: { status: "succeeded" } });
  expect([attemptsOf(state), withLedger(state, (store) => store.launches().length)]).toEqual([
    [{ state: "done", outputs: { result: "Done before the crash.", verdict: "pass" }, sessionId: SESSION }],
    1,
  ]);
}, 30_000);

test("an agent attempt a dead runner left without a result resumes its session on the account it ran on", async () => {
  const { state, config, work } = setup(["first", "second"]);
  const runId = died(state, work, "second");
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  expect(await resumeRun(state, runId, { project: work, agents })).toMatchObject({ value: { status: "succeeded" } });
  expect(attemptsOf(state)).toEqual([
    {
      state: "done",
      outputs: { result: `Resumed ${SESSION}.`, verdict: "pass" },
      sessionId: "00000000-0000-4000-8000-000000000001",
    },
  ]);
  expect(withLedger(state, (store) => store.launches().map((each) => [each.task, each.account, each.verdict]))).toEqual(
    [
      [`${runId}:a#1`, "second", "interrupted"],
      [`${runId}:a#1`, "second", "pass"],
    ],
  );
}, 30_000);

test("an agent attempt whose launch the launcher ended before its runner died ends with that verdict", async () => {
  const { state, config, work } = setup();
  const runId = died(state, work, "work");
  withLedger(state, (store) => store.finishLaunch(LAUNCH, "not-run"));
  // The launcher judged this result, of a CLI that exited with an error: its verdict holds, its summary is kept.
  written(state, { verdict: "pass", summary: "Done, then it failed." });
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  expect(await resumeRun(state, runId, { project: work, agents })).toMatchObject({ value: { status: "failed" } });
  expect([attemptsOf(state), withLedger(state, (store) => store.launches().length)]).toEqual([
    [{ state: "failed", outputs: { result: "Done, then it failed.", verdict: "not-run" }, sessionId: SESSION }],
    1,
  ]);
}, 30_000);

test("a cancel of a run a dead runner left resumes no agent: its attempt ends interrupted", async () => {
  const { state, config, work } = setup();
  const runId = died(state, work, "work");
  const agents = { config, host, runtime: agentRuntime(), launch: phaseLaunch };
  expect(await cancelRun(state, runId, { project: work, agents })).toMatchObject({ value: { status: "cancelled" } });
  expect([attemptsOf(state).map((row) => row.state), withLedger(state, (store) => store.launches().length)]).toEqual([
    ["interrupted"],
    1,
  ]);
}, 30_000);
