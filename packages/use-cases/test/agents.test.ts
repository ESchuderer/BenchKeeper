import { mkdtempSync } from "node:fs";
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
  env: {},
  tmpDir: "/tmp/worker",
  denyRead: [],
  allowedDomains: [],
} as const;
const input = { env: {}, probe };

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
  await expect(checkedVersions(dir, "claude", cli, input)).resolves.toEqual({
    ok: true,
    value: { version: "2.1.316", verified: ["2.1.316"] },
  });
  await checkedVersions(dir, "claude", cli, input);
  expect(cli.checkContract).toHaveBeenCalledTimes(1);
  // A failed check keeps readings off for that version and is not repeated on every launch.
  await expect(checkedVersions(dir, "claude", cli, input)).resolves.toEqual({
    ok: true,
    value: { version: "2.1.317", verified: ["2.1.316"] },
  });
  // A probe without an init line is recorded under the version that was read.
  await checkedVersions(dir, "claude", cli, input);
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
  // Another holder takes the store while the probe runs, so the check cannot be recorded.
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
