import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeRuntime, type ClaudeLaunch, FRESH_INSTALL_PHASES } from "@cedarloom/adapter-claude";
import type { AgentEvent, AgentSession } from "@cedarloom/agent-contracts";
import { expect, test, vi } from "vitest";
import { z } from "zod";

const fixtures = join(import.meta.dirname, "fixtures");
const runtime = claudeRuntime([process.execPath, join(fixtures, "fake-claude.ts")]);

const launch = (env: Record<string, string>, change: Partial<ClaudeLaunch> = {}): ClaudeLaunch => ({
  ...FRESH_INSTALL_PHASES.implement,
  home: fixtures,
  cwd: fixtures,
  prompt: "Do the task.",
  env,
  tmpDir: join(fixtures, "tmp"),
  denyRead: ["/accounts/other"],
  allowedDomains: ["github.com"],
  allow: ["Bash(pnpm test *)"],
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

// A launch as it arrives from JSON, such as settings or a shared workflow, where the types check nothing.
const fromJson = (change: Record<string, string>) => z.custom<ClaudeLaunch>().parse({ ...launch({}), ...change });

test("runs claude -p with stream-json under the account's config folder, in the worker environment", async () => {
  const login = {
    ANTHROPIC_API_KEY: "k",
    CLAUDE_CODE_OAUTH_TOKEN: "t",
    anthropic_auth_token: "a",
    CLAUDE_CODE_USE_BEDROCK: "1",
  };
  const env = {
    ...stream("stream.jsonl"),
    ...login,
    CLAUDE_CODE_SIMPLE: "1",
    claude_config_dir: "/elsewhere",
    KEEP: "yes",
    CLAUDE_CODE_USE_POWERSHELL_TOOL: "0",
  };
  vi.stubEnv("CEDARLOOM_PARENT_ONLY", "1");
  const all = await events(runtime.start(launch(env)));
  vi.unstubAllEnvs();
  const fake = started(all);
  const flags = ["-p", "--output-format", "stream-json", "--verbose", "--include-hook-events"];
  const settings = ["--model", "claude-sonnet-5-5", "--permission-mode", "dontAsk", "--permission-prompts", "none"];
  expect(fake.args.slice(0, 12)).toEqual([...flags, ...settings, "--settings"]);
  expect(fake.args.slice(13)).toEqual([
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
  ]);
  expect(fake.args).not.toContain("--bare");
  expect(fake.prompt).toBe("Do the task.");
  expect(fake.env).toMatchObject({
    KEEP: "yes",
    CLAUDE_CODE_USE_POWERSHELL_TOOL: "0",
    CLAUDE_CONFIG_DIR: fixtures,
    CLAUDE_CODE_EFFORT_LEVEL: "high",
    CLAUDE_CODE_SUBAGENT_MODEL: "claude-sonnet-5-5",
    CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
    CLAUDE_CODE_TMPDIR: join(fixtures, "tmp"),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
    CLAUDE_CODE_TRANSCRIPT_LOCAL_GC: "1",
  });
  for (const name of ["CLAUDE_CODE_SIMPLE", "claude_config_dir", "CEDARLOOM_PARENT_ONLY", ...Object.keys(login)]) {
    expect(fake.env).not.toHaveProperty(name);
  }
});

test("maps the stream-json lines to events", async () => {
  const all = await events(runtime.start(launch(stream("stream.jsonl"))));
  expect(all.slice(1).map((event) => event.type)).toEqual(["init", "other", "usage", "other", "result", "exit"]);
  expect(all[1]).toMatchObject({ sessionId: "00000000-0000-4000-8000-000000000001", agentVersion: "2.1.316" });
  expect(all[3]).toMatchObject({
    agentVersion: "2.1.316",
    windows: [
      { window: "five_hour", status: "allowed", percent: 10, resetsAt: "2026-11-05T19:20:00.000Z", quota: "fiveHour" },
      { window: "seven_day", status: "allowed", percent: 32, resetsAt: "2026-11-06T18:00:00.000Z", quota: "sevenDay" },
    ],
  });
  expect(all[5]).toMatchObject({ type: "result", ok: true, text: "OK" });
  expect(all[6]).toEqual({ type: "exit", code: 0, signal: null, error: null, stderr: "fake stderr\n" });
});

test("the settings passed with --settings hold the worker profile: denials, the strict sandbox, the caps", async () => {
  const settings: unknown = JSON.parse(started(await events(runtime.start(launch({})))).args[12] ?? "");
  expect(settings).toMatchObject({
    permissions: {
      allow: ["Bash(pnpm test *)"],
      // The path itself and below it; the working folder's own path depends on the platform.
      deny: [
        "Read(//accounts/other)",
        "Read(//accounts/other/**)",
        "Edit(//accounts/other)",
        "Edit(//accounts/other/**)",
        "Read(**/.env*)",
        expect.stringMatching(/^Edit\(\/\/.*workflows\/\*\*\)$/),
      ],
      disableBypassPermissionsMode: "disable",
      blockReadsOutsideWorkingDirectories: true,
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ["/accounts/other"],
        denyWrite: [join(fixtures, ".github", "workflows")],
        allowRead: expect.arrayContaining(["~/.nvm", "~/.cargo"]),
      },
      network: { allowedDomains: ["github.com"], strictAllowlist: true },
    },
    maxEffortLevel: "xhigh",
    workflowSizeGuideline: "small",
    autoMemoryEnabled: false,
    autoContinueAtUsageLimit: false,
    feedbackDrafts: "off",
    syncClaudeAiPlugins: false,
    syncClaudeAiSkills: false,
    env: { CLAUDE_CODE_EFFORT_LEVEL: "high", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
  });
  // No command runs outside the sandbox; the account's folder and process-only variables stay out of the settings.
  for (const key of ["sandbox.excludedCommands", "env.CLAUDE_CONFIG_DIR", "env.CLAUDE_CODE_TRANSCRIPT_LOCAL_GC"]) {
    expect(settings).not.toHaveProperty(key);
  }
});

test("reads no usage on a version whose contract check has not passed", async () => {
  const all = await events(runtime.start(launch(stream("stream.jsonl"), { verifiedVersions: ["2.1.315"] })));
  expect(all.map((event) => event.type)).toEqual(["other", "init", "other", "other", "other", "result", "exit"]);
});

test("reads the older single-window form and leaves lines it cannot read as they are", async () => {
  const all = await events(
    runtime.start(launch({ ...stream("older.jsonl"), FAKE_EXIT: "1", FAKE_CUT: '{"type":"res' })),
  );
  expect(all.slice(1)).toEqual([
    { type: "other", raw: "not json" },
    { type: "other", raw: expect.objectContaining({ type: "rate_limit_event" }) },
    expect.objectContaining({ type: "init", agentVersion: "2.1.309", model: "claude-sonnet-5-5" }),
    expect.objectContaining({
      type: "usage",
      windows: [
        {
          window: "five_hour",
          status: "allowed",
          percent: 15,
          resetsAt: "2026-11-05T19:20:00.000Z",
          quota: "fiveHour",
        },
      ],
    }),
    expect.objectContaining({
      type: "usage",
      windows: [{ window: "seven_day", status: "allowed_warning", percent: null, resetsAt: null, quota: "sevenDay" }],
    }),
    // A window the quota model lacks is reported, and not stored as a reading.
    expect.objectContaining({
      type: "usage",
      windows: [
        { window: "overage", status: "allowed", percent: 50, resetsAt: "2026-11-05T19:20:00.000Z", quota: null },
      ],
    }),
    { type: "other", raw: expect.objectContaining({ type: "rate_limit_event" }) },
    { type: "other", raw: expect.objectContaining({ type: "rate_limit_event" }) },
    expect.objectContaining({ type: "result", ok: false, text: null }),
    { type: "other", raw: '{"type":"res' },
    expect.objectContaining({ type: "exit", code: 1 }),
  ]);
});

test("refuses a launch the types alone cannot keep out, such as one built from JSON", () => {
  const refusals = [
    [{ model: "opus" }, "not a full Claude model ID: opus"],
    [{ subagentModel: "sonnet" }, "sonnet"],
    [{ permissionMode: "bypassPermissions" }, "not an allowed permission mode: bypassPermissions"],
    [{ effort: "max" }, "not an allowed effort: max"],
    [{ home: "" }, 'not an existing absolute config folder: ""'],
    [{ home: "accounts/one" }, "accounts/one"],
    [{ home: join(fixtures, "no-such-home") }, "no-such-home"],
    [{ home: join(fixtures, "stream.jsonl") }, "stream.jsonl"],
    [{ cwd: "work" }, 'not an absolute working folder: "work"'],
  ] as const;
  for (const [change, message] of refusals) expect(() => runtime.start(fromJson(change))).toThrow(message);
});

test("a Windows path becomes an absolute rule in POSIX form, and a server's MCP wildcard passes", async () => {
  const windows = { denyRead: ["C:\\Users\\dev\\.ssh"], allow: ["mcp__github__*", "mcp__github"] };
  const settings: unknown = JSON.parse(started(await events(runtime.start(launch({}, windows)))).args[12] ?? "");
  expect(settings).toMatchObject({
    permissions: {
      allow: ["mcp__github__*", "mcp__github"],
      deny: expect.arrayContaining(["Read(//c/Users/dev/.ssh)"]),
    },
  });
});

test("refuses settings with a value the documented syntax does not take, which would drop them all silently", () => {
  const invalid = [
    [{ denyRead: ["/accounts/*"] }, "invalid worker settings at sandbox.filesystem.denyRead.0"],
    [{ cwd: "/work/[repo]" }, "invalid worker settings at sandbox.filesystem.denyWrite.0"],
    // Allow rules with a glob in the tool name are skipped by the CLI.
    [{ allow: ["*"] }, "invalid worker settings at permissions.allow.0"],
    [{ allow: ["mcp__*"] }, "invalid worker settings at permissions.allow.0"],
    [{ allow: ["Bash(git push"] }, "invalid worker settings at permissions.allow.0"],
    [{ denyRead: ["/accounts/(old)"] }, "invalid worker settings at permissions.deny.0"],
    [{ allowedDomains: ["git hub.com"] }, "invalid worker settings at sandbox.network.allowedDomains.0"],
  ] as const;
  for (const [change, message] of invalid) expect(() => runtime.start(launch({}, change))).toThrow(message);
});

test("resumes a session by its ID", async () => {
  const fake = started(await events(runtime.resume("00000000-0000-4000-8000-000000000001", launch({}))));
  expect(fake.args.slice(-2)).toEqual(["--resume", "00000000-0000-4000-8000-000000000001"]);
  expect(() => runtime.resume("--version", launch({}))).toThrow("not a session ID: --version");
});

test("reads the version of the CLI that a launch's environment runs", async () => {
  await expect(runtime.version({})).resolves.toBe("2.1.316");
  await expect(runtime.version({ FAKE_VERSION: "2.1.316-beta.1 (Claude Code)" })).resolves.toBe("2.1.316-beta.1");
  // Neither a version of another form nor one that is long or holds a terminal escape is taken.
  for (const FAKE_VERSION of ["unknown", `2.1.316-${"x".repeat(40)}`, "2.1.316\u001b[31m"]) {
    await expect(runtime.version({ FAKE_VERSION })).rejects.toThrow("unrecognized claude --version output");
  }
});

test("an init line whose version has another form counts as no init line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-stream-"));
  const line = readFileSync(join(fixtures, "no-reset.jsonl"), "utf8").replace('"2.1.316"', '"2.1.316\\u001b[31m"');
  writeFileSync(join(dir, "escaped.jsonl"), line);
  const { prompt: _, verifiedVersions: __, ...probe } = launch({ FAKE_STREAM: join(dir, "escaped.jsonl") });
  await expect(runtime.checkContract(probe)).resolves.toEqual({ version: null, missing: ["init", "usage"] });
});

test("a contract check passes only with the version, a usage share with its reset and a successful result", async () => {
  const { prompt: _, verifiedVersions: __, ...probe } = launch(stream("stream.jsonl"), { verifiedVersions: [] });
  await expect(runtime.checkContract(probe)).resolves.toEqual({ version: "2.1.316", missing: [] });
  const older = { ...probe, env: stream("older.jsonl") };
  await expect(runtime.checkContract(older)).resolves.toEqual({ version: "2.1.309", missing: ["result"] });
  const noReset = { ...probe, env: stream("no-reset.jsonl") };
  await expect(runtime.checkContract(noReset)).resolves.toEqual({ version: "2.1.316", missing: ["usage"] });
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
    {
      type: "exit",
      code: expect.any(Number),
      signal: null,
      error: { code: "process", message: expect.stringContaining("ENOENT") },
      stderr: "",
    },
  ]);
});

test("cancel stops the CLI with the command it runs, on Windows too", async () => {
  const session = runtime.start(launch({ FAKE_CHILD: "1", FAKE_HANG: "1" }));
  const Command = z.object({ type: z.literal("command"), pid: z.int() });
  let pid: number | undefined;
  for await (const event of session.events) {
    pid = Command.safeParse(event.type === "other" ? event.raw : null).data?.pid;
    if (pid !== undefined) break;
  }
  await session.cancel();
  expect(pid).toBeDefined();
  await vi.waitFor(() => expect(() => process.kill(pid ?? -1, 0)).toThrow("ESRCH"), { timeout: 5000 });
});

test("cancel after the CLI has exited stops nothing, as its process ID may belong to another process", async () => {
  const session = runtime.start(launch({}));
  expect((await events(session)).at(-1)).toMatchObject({ type: "exit", code: 0 });
  await expect(session.cancel()).resolves.toBeUndefined();
});

test("stops a CLI that writes a line past the cap, before the host runs out of string length", async () => {
  const all = await events(runtime.start(launch({ FAKE_LONG: String(65 * 1024 * 1024), FAKE_HANG: "1" })));
  expect(all.map((event) => event.type)).toEqual(["other", "exit"]);
  expect(all[1]).toMatchObject({ error: { code: "line-too-long", limitBytes: 64 * 1024 * 1024 } });
});
