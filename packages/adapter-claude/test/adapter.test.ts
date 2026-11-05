import { join } from "node:path";
import { claudeRuntime, type ClaudeLaunch, FRESH_INSTALL_PHASES } from "@cedarloom/adapter-claude";
import type { AgentEvent, AgentSession } from "@cedarloom/agent-contracts";
import { expect, test, vi } from "vitest";
import { z } from "zod";

const fixtures = join(import.meta.dirname, "fixtures");
const runtime = claudeRuntime([process.execPath, join(fixtures, "fake-claude.ts")]);

const launch = (env: Record<string, string>, change: Partial<ClaudeLaunch> = {}): ClaudeLaunch => ({
  ...FRESH_INSTALL_PHASES.implement,
  home: "/accounts/one",
  cwd: fixtures,
  prompt: "Do the task.",
  env,
  verifiedVersions: ["2.1.316", "2.1.309"],
  ...change,
});

const events = async (session: AgentSession): Promise<AgentEvent[]> => {
  const all: AgentEvent[] = [];
  for await (const event of session.events) all.push(event);
  return all;
};

// The fake CLI's first line: what the adapter started it with.
const Started = z.object({ args: z.array(z.string()), prompt: z.string(), env: z.record(z.string(), z.string()) });
const started = (all: AgentEvent[]) => Started.parse(all[0]?.type === "other" ? all[0].raw : null);

const stream = (name: string) => ({ FAKE_STREAM: join(fixtures, name) });

test("runs claude -p with stream-json under the account's config folder and maps its lines", async () => {
  const login = { ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t", anthropic_auth_token: "a" };
  const env = {
    ...stream("stream.jsonl"),
    ...login,
    CLAUDE_CODE_SIMPLE: "1",
    claude_config_dir: "/elsewhere",
    KEEP: "yes",
  };
  vi.stubEnv("CEDARLOOM_PARENT_ONLY", "1");
  const all = await events(runtime.start(launch(env)));
  vi.unstubAllEnvs();
  const fake = started(all);
  const flags = ["-p", "--output-format", "stream-json", "--verbose", "--include-hook-events"];
  const settings = ["--model", "claude-sonnet-5-5", "--permission-mode", "dontAsk", "--permission-prompts", "none"];
  expect(fake.args).toEqual([...flags, ...settings]);
  expect(fake.args).not.toContain("--bare");
  expect(fake.prompt).toBe("Do the task.");
  expect(fake.env).toMatchObject({
    KEEP: "yes",
    CLAUDE_CONFIG_DIR: "/accounts/one",
    CLAUDE_CODE_EFFORT_LEVEL: "high",
    CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-5-5",
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
  });
  for (const name of ["CLAUDE_CODE_SIMPLE", "claude_config_dir", "CEDARLOOM_PARENT_ONLY", ...Object.keys(login)]) {
    expect(fake.env).not.toHaveProperty(name);
  }
  expect(all.slice(1).map((event) => event.type)).toEqual(["init", "other", "usage", "other", "result", "exit"]);
  expect(all[1]).toMatchObject({ sessionId: "00000000-0000-4000-8000-000000000001", agentVersion: "2.1.316" });
  expect(all[3]).toMatchObject({
    agentVersion: "2.1.316",
    windows: [
      { window: "five_hour", status: "allowed", percent: 10, resetsAt: "2026-11-05T19:20:00.000Z" },
      { window: "seven_day", status: "allowed", percent: 32, resetsAt: "2026-11-06T18:00:00.000Z" },
    ],
  });
  expect(all[5]).toMatchObject({ type: "result", ok: true, text: "OK" });
  expect(all[6]).toEqual({ type: "exit", code: 0, signal: null, error: null, stderr: "fake stderr\n" });
});

test("reads no usage on a version whose contract check has not passed", async () => {
  const all = await events(runtime.start(launch(stream("stream.jsonl"), { verifiedVersions: ["2.1.315"] })));
  expect(all.map((event) => event.type)).toEqual(["other", "init", "other", "other", "other", "result", "exit"]);
});

test("reads the older single-window form and leaves lines it cannot read as they are", async () => {
  const all = await events(runtime.start(launch({ ...stream("older.jsonl"), FAKE_EXIT: "1" })));
  expect(all.slice(1)).toEqual([
    { type: "other", raw: "not json" },
    { type: "other", raw: expect.objectContaining({ type: "rate_limit_event" }) },
    expect.objectContaining({ type: "init", agentVersion: "2.1.309", model: "claude-sonnet-5-5" }),
    expect.objectContaining({
      type: "usage",
      windows: [{ window: "five_hour", status: "allowed", percent: 15, resetsAt: "2026-11-05T19:20:00.000Z" }],
    }),
    expect.objectContaining({
      type: "usage",
      windows: [{ window: "seven_day", status: "allowed_warning", percent: null, resetsAt: null }],
    }),
    { type: "other", raw: expect.objectContaining({ type: "rate_limit_event" }) },
    { type: "other", raw: expect.objectContaining({ type: "rate_limit_event" }) },
    expect.objectContaining({ type: "result", ok: false, text: null }),
    expect.objectContaining({ type: "exit", code: 1 }),
  ]);
});

test("refuses a model alias", () => {
  expect(() => runtime.start(launch({}, { model: "opus" }))).toThrow("not a full Claude model ID: opus");
  expect(() => runtime.start(launch({}, { subagentModel: "sonnet" }))).toThrow("sonnet");
});

test("resumes a session by its ID", async () => {
  const fake = started(await events(runtime.resume("00000000-0000-4000-8000-000000000001", launch({}))));
  expect(fake.args.slice(-2)).toEqual(["--resume", "00000000-0000-4000-8000-000000000001"]);
});

test("reads the version of the CLI that a launch's environment runs", async () => {
  await expect(runtime.version({})).resolves.toBe("2.1.316");
  await expect(runtime.version({ FAKE_VERSION: "unknown" })).rejects.toThrow(
    "unrecognized claude --version output: unknown",
  );
});

test("a contract check passes only with the version, a usage share and a successful result", async () => {
  const { prompt: _, verifiedVersions: __, ...probe } = launch(stream("stream.jsonl"), { verifiedVersions: [] });
  await expect(runtime.checkContract(probe)).resolves.toEqual({ version: "2.1.316", missing: [] });
  const older = { ...probe, env: stream("older.jsonl") };
  await expect(runtime.checkContract(older)).resolves.toEqual({ version: "2.1.309", missing: ["result"] });
  await expect(runtime.checkContract({ ...probe, env: {} })).resolves.toEqual({
    version: null,
    missing: ["init", "usage", "result"],
  });
  await expect(runtime.checkContract({ ...probe, model: "sonnet" })).rejects.toThrow("sonnet");
});

test("a handover stops the running session before it starts the next", async () => {
  const from = runtime.start(launch({ FAKE_HANG: "1" }));
  const first = events(from);
  const to = await runtime.handover(from, launch(stream("stream.jsonl")));
  const stopped = (await first).at(-1);
  expect(stopped).toMatchObject({ type: "exit", error: null });
  expect(stopped?.type === "exit" && (stopped.code !== 0 || stopped.signal !== null)).toBe(true);
  expect((await events(to)).at(-2)).toMatchObject({ type: "result", ok: true });
});

test("a handover to a bad launch leaves the running session alone", async () => {
  const from = { events: (async function* () {})(), cancel: vi.fn<() => Promise<void>>(async () => undefined) };
  await expect(runtime.handover(from, launch({}, { model: "opus" }))).rejects.toThrow("opus");
  expect(from.cancel).not.toHaveBeenCalled();
});

test("a CLI that exits before it reads the prompt ends with its exit", async () => {
  // Larger than a pipe's buffer, so the write fails once the process is gone.
  const all = await events(runtime.start(launch({ FAKE_DEAF: "1" }, { prompt: "x".repeat(1_000_000) })));
  expect(all).toEqual([{ type: "exit", code: 3, signal: null, error: null, stderr: "" }]);
});

test("reports a CLI that cannot start", async () => {
  const missing = claudeRuntime([join(fixtures, "no-such-claude")]).start(launch({}));
  await missing.cancel();
  const all = await events(missing);
  expect(all).toEqual([
    { type: "exit", code: expect.any(Number), signal: null, error: expect.stringContaining("ENOENT"), stderr: "" },
  ]);
});
