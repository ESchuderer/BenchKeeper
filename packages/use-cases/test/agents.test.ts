import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRuntime, ContractCheck, UsageWindow } from "@cedarloom/agent-contracts";
import { DatabaseSync } from "node:sqlite";
import { openRunStore } from "@cedarloom/ledger";
import { checkedVersions, recordUsage } from "@cedarloom/use-cases";
import { expect, test, vi } from "vitest";

const state = () => mkdtempSync(join(tmpdir(), "cedarloom-agents-"));

const unused = () => {
  throw new Error("not in this test");
};

// A runtime whose CLI reports `versions` in turn and whose probe answers `checks` in turn.
const runtime = (versions: string[], checks: ContractCheck[]) => {
  const fake = {
    capabilities: {
      start: "supported",
      observe: "supported",
      cancel: "supported",
      resume: "supported",
      handover: "supported",
      usage: "partial",
    },
    version: vi.fn<AgentRuntime["version"]>(async () => versions.shift() ?? "none left"),
    checkContract: vi.fn<AgentRuntime["checkContract"]>(async () => checks.shift() ?? { version: null, missing: [] }),
    start: unused,
    resume: unused,
    handover: unused,
  } satisfies AgentRuntime;
  return fake;
};

const probe = {
  home: "/accounts/work",
  cwd: "/work",
  model: "claude-sonnet-5-5",
  subagentModel: "claude-sonnet-5-5",
  effort: "high",
  permissionMode: "dontAsk",
  env: {},
  tmpDir: "/tmp/worker",
  resultFile: "/state/workers/0b9f4c1e/out/result.json",
  denyRead: [],
  allowedDomains: [],
} as const;
const input = { env: {}, probe };
const checked = (dir: string, cli: ReturnType<typeof runtime>) => checkedVersions(dir, "claude", cli, input);
const passed = (version: string, verified: string[], settingsApplied = true) => ({
  ok: true,
  value: { version, verified, settingsApplied },
});
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

test("a version is checked once, before its first launch; a new version is checked again", async () => {
  const dir = state();
  const cli = runtime(
    ["2.1.316", "2.1.316", "2.1.317", "2.1.318"],
    [
      { version: "2.1.316", missing: [] },
      { version: "2.1.317", missing: ["usage"] },
      { version: null, missing: ["init", "usage", "result"] },
    ],
  );
  await expect(checked(dir, cli)).resolves.toEqual(passed("2.1.316", ["2.1.316"]));
  await checked(dir, cli);
  expect(cli.checkContract).toHaveBeenCalledTimes(1);
  // A failed check keeps readings off for that version and is not repeated on every launch.
  await expect(checked(dir, cli)).resolves.toEqual(passed("2.1.317", ["2.1.316"]));
  // A probe without an init line is recorded under the version that was read.
  await checked(dir, cli);
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  expect(store.value.contractChecks("claude").map(({ version, missing }) => [version, missing])).toEqual([
    ["2.1.316", []],
    ["2.1.317", ["usage"]],
    ["2.1.318", ["init", "usage", "result"]],
  ]);
  store.value.close();
});

test("a CLI that cannot tell its version or run its check starts no worker", async () => {
  const missing = runtime([], []);
  missing.version.mockRejectedValueOnce(new Error("spawn claude ENOENT"));
  await expect(checkedVersions(state(), "claude", missing, input)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.agent-unavailable", params: { agent: "claude", error: "spawn claude ENOENT" } },
  });
  const escaped = runtime(["2.1.316\u001b[31m"], []);
  await expect(checkedVersions(state(), "claude", escaped, input)).resolves.toEqual({
    ok: false,
    finding: { code: "launch.agent-unavailable", params: { agent: "claude", error: "unrecognized CLI version" } },
  });
  expect(escaped.checkContract).not.toHaveBeenCalled();
  const broken = runtime(["2.1.316"], []);
  broken.checkContract.mockRejectedValueOnce("not an Error");
  await expect(checkedVersions(state(), "claude", broken, input)).resolves.toMatchObject({
    ok: false,
    finding: { params: { error: "unknown error" } },
  });
});

test("a store the check cannot use, before the probe or after it, is reported", async () => {
  const newer = state();
  const db = new DatabaseSync(join(newer, "runs.sqlite"));
  db.exec("PRAGMA user_version = 99");
  db.close();
  await expect(checkedVersions(newer, "claude", runtime(["2.1.316"], []), input)).resolves.toMatchObject({
    ok: false,
    finding: { code: "store.newer-schema" },
  });
  // Another holder takes the store while the probe runs and keeps it through all three tries, so the check cannot be
  // recorded.
  const dir = state();
  const cli = runtime(["2.1.316"], []);
  let holder: { close: () => void } | undefined;
  cli.checkContract.mockImplementationOnce(async () => {
    const store = openRunStore(dir);
    if (store.ok) holder = store.value;
    return { version: "2.1.316", missing: [] };
  });
  await expect(checkedVersions(dir, "claude", cli, input)).resolves.toMatchObject({
    ok: false,
    finding: { code: "store.busy" },
  });
  holder?.close();
}, 15_000);

test("a failed check is repeated once it is a day old; a younger failed check is not", async () => {
  const dir = state();
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  store.value.recordContractCheck({ agent: "claude", version: "2.1.316", missing: ["result"], at: hoursAgo(25) });
  store.value.recordContractCheck({ agent: "claude", version: "2.1.317", missing: ["result"], at: hoursAgo(23) });
  store.value.close();
  const cli = runtime(["2.1.316", "2.1.317"], [{ version: "2.1.316", missing: [] }]);
  await expect(checked(dir, cli)).resolves.toEqual(passed("2.1.316", ["2.1.316"]));
  await checked(dir, cli);
  expect(cli.checkContract).toHaveBeenCalledTimes(1);
});

test("a check is kept under the version the probe ran, and the version read is not probed on every launch", async () => {
  const dir = state();
  // An update between the version read and the probe, or an init line that reports another form than --version.
  const cli = runtime(["2.1.316", "2.1.317", "2.1.316"], [{ version: "2.1.317", missing: [] }]);
  // The version read has no proof of its own that the CLI applies the settings.
  await expect(checked(dir, cli)).resolves.toEqual(passed("2.1.316", ["2.1.317"], false));
  await checked(dir, cli);
  await checked(dir, cli);
  expect(cli.checkContract).toHaveBeenCalledTimes(1);
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  expect(store.value.contractChecks("claude").map(({ version, missing }) => [version, missing])).toEqual([
    ["2.1.316", ["init"]],
    ["2.1.317", []],
  ]);
  store.value.close();
});

test("a version whose check gave no proof that the CLI applies the settings reports none", async () => {
  const cli = runtime(["2.1.316"], [{ version: "2.1.316", missing: ["settings"] }]);
  await expect(checked(state(), cli)).resolves.toEqual(passed("2.1.316", [], false));
});

test("launches on a new version at once share one probe", async () => {
  const dir = state();
  const cli = runtime(["2.1.316", "2.1.316"], []);
  let finish: (check: ContractCheck) => void = unused;
  cli.checkContract.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  const both = Promise.all([checked(dir, cli), checked(dir, cli)]);
  // Both launches read the version and the store without waiting on I/O, so they wait on the probe by the next turn.
  await new Promise((resolve) => setImmediate(resolve));
  finish({ version: "2.1.316", missing: [] });
  await expect(both).resolves.toEqual([passed("2.1.316", ["2.1.316"]), passed("2.1.316", ["2.1.316"])]);
  expect(cli.checkContract).toHaveBeenCalledTimes(1);
});

test("the store's own errors are reported as they are, not as an unavailable CLI", async () => {
  const file = join(state(), "not-a-folder");
  writeFileSync(file, "");
  await expect(checkedVersions(file, "claude", runtime(["2.1.316"], []), input)).rejects.toThrow(/ENOTDIR|EEXIST/);
  // A version the ledger refuses, such as one with a terminal escape, is refused on write.
  const escaped = runtime(["2.1.316"], [{ version: "2.1.316\u001b[31m", missing: [] }]);
  await expect(checkedVersions(state(), "claude", escaped, input)).rejects.toThrow(/pattern/i);
});

const window = (name: string, quota: UsageWindow["quota"], percent: number | null, resetsAt: string | null) => ({
  window: name,
  status: "allowed",
  percent,
  resetsAt,
  quota,
});

test("a session's usage windows become readings, those the quota model can store", () => {
  const dir = state();
  const at = "2026-11-06T08:00:00.000Z";
  const windows = [
    window("five_hour", "fiveHour", 10, "2026-11-06T12:00:00.000Z"),
    window("seven_day", "sevenDay", null, "2026-11-10T12:00:00.000Z"),
    window("seven_day_opus", null, 40, "2026-11-10T12:00:00.000Z"),
    window("seven_day", "sevenDay", 32, null),
  ];
  expect(recordUsage(dir, "work", windows, at)).toEqual({ ok: true, value: 1 });
  const store = openRunStore(dir);
  if (!store.ok) throw new Error(store.finding.code);
  expect(store.value.readings()).toEqual([
    { account: "work", window: "fiveHour", usedPercent: 10, resetsAt: "2026-11-06T12:00:00.000Z", readAt: at },
  ]);
  store.value.close();
});
