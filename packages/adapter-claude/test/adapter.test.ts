import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeAuthStatus,
  claudeLogin,
  claudeRuntime,
  type ClaudeLaunch,
  claudeTelemetry,
  FRESH_INSTALL_PHASES,
  phaseLaunch,
} from "@cedarloom/adapter-claude";
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
  resultFile: join(fixtures, "out", "result.json"),
  denyRead: ["/accounts/other"],
  allowedDomains: ["github.com"],
  allow: ["Bash(pnpm test *)"],
  verifiedVersions: ["2.1.316", "2.1.309"],
  pluginDirs: [],
  telemetry: null,
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

// Variables that select a login, which never reach the CLI.
const LOGIN_VARIABLES = {
  ANTHROPIC_API_KEY: "k",
  CLAUDE_CODE_OAUTH_TOKEN: "t",
  anthropic_auth_token: "a",
  CLAUDE_CODE_USE_BEDROCK: "1",
};

test("runs claude -p with stream-json under the account's config folder, in the worker environment", async () => {
  const env = {
    ...stream("stream.jsonl"),
    ...LOGIN_VARIABLES,
    CLAUDE_CODE_SIMPLE: "1",
    claude_config_dir: "/elsewhere",
    KEEP: "yes",
    CLAUDE_CODE_USE_POWERSHELL_TOOL: "0",
  };
  vi.stubEnv("CEDARLOOM_PARENT_ONLY", "1");
  const all = await events(runtime.start(launch(env, { pluginDirs: [join(fixtures, "plugins", "workflow")] })));
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
    "--plugin-dir",
    join(fixtures, "plugins", "workflow"),
    "--add-dir",
    join(fixtures, "out"),
    join(fixtures, "plugins", "workflow"),
  ]);
  expect([fake.args.includes("--bare"), fake.prompt]).toEqual([false, "Do the task."]);
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
  for (const name of [
    "CLAUDE_CODE_SIMPLE",
    "claude_config_dir",
    "CEDARLOOM_PARENT_ONLY",
    ...Object.keys(LOGIN_VARIABLES),
  ]) {
    expect(fake.env).not.toHaveProperty(name);
  }
});

test("a worker's launch in a phase runs on that phase's settings, in the folder given, allowing nothing more", () => {
  const { model, subagentModel, effort, permissionMode, cwd, allow } = phaseLaunch(launch({}), "plan", "/work/tree");
  expect({ model, subagentModel, effort, permissionMode, cwd, allow }).toEqual({
    model: "claude-opus-5-5",
    subagentModel: "claude-opus-5-5",
    effort: "high",
    permissionMode: "plan",
    cwd: "/work/tree",
    allow: [],
  });
});

test("the login runs claude auth login with the account's environment, and tells how it ended", () => {
  // Exits 0 only for `auth login` with the given config folder.
  const check =
    "process.exit(process.argv.slice(-2).join(' ') === 'auth login' && process.env.CLAUDE_CONFIG_DIR === '/h' ? 0 : 3)";
  const login = claudeLogin([process.execPath, "-e", check]);
  expect(login({ CLAUDE_CONFIG_DIR: "/h" })).toEqual({ code: 0 });
  expect(login({ CLAUDE_CONFIG_DIR: "/other" })).toEqual({ code: 3 });
  expect(claudeLogin([join(tmpdir(), "no-such-claude")])({})).toMatchObject({
    code: null,
    error: expect.stringContaining("ENOENT"),
  });
});

// Answers `auth status` by the config folder, as Claude Code does: JSON, exit 0 when logged in and 1 when not.
const statusCli = `
const dir = process.env.CLAUDE_CONFIG_DIR;
if (process.argv.slice(-2).join(" ") !== "auth status") process.exit(9);
const say = (json, code) => { console.log(JSON.stringify(json)); process.exit(code); };
if (dir === "/out") say({ loggedIn: false, authMethod: "none" }, 1);
if (dir === "/bad") { console.log("not json"); process.exit(0); }
if (dir === "/crash") process.exit(2);
if (dir === "/crash1") process.exit(1);
if (dir === "/hang") setInterval(() => undefined, 60_000);
if (dir === "/old") say({ loggedIn: true, authMethod: "claude.ai" }, 0);
if (dir !== "/hang") say({ loggedIn: true, authMethod: "claude.ai", configDirectory: dir, subscriptionType: "max" }, 0);
`;

test("the login status of a home is read from claude auth status, and anything else is unknown", async () => {
  const status = claudeAuthStatus([process.execPath, "-e", statusCli]);
  const of = (dir: string) => status({ CLAUDE_CONFIG_DIR: dir });
  expect(await of("/h")).toEqual({ kind: "logged-in", authMethod: "claude.ai", configDirectory: "/h" });
  // Before Claude Code 2.1.268 the status names no config folder.
  expect(await of("/old")).toEqual({ kind: "logged-in", authMethod: "claude.ai", configDirectory: null });
  expect(await of("/out")).toEqual({ kind: "logged-out" });
  expect(await of("/bad")).toEqual({ kind: "unknown", error: "exit code 0 with output that is no login status" });
  expect(await of("/crash")).toEqual({ kind: "unknown", error: "exit code 2 with output that is no login status" });
  // Exit 1 is logged out only with the status JSON; a crash that also exits 1 is unknown.
  expect(await of("/crash1")).toEqual({ kind: "unknown", error: "exit code 1 with output that is no login status" });
  const hung = claudeAuthStatus([process.execPath, "-e", statusCli], 200);
  expect(await hung({ CLAUDE_CONFIG_DIR: "/hang" })).toEqual({ kind: "unknown", error: "timed out after 0.2 s" });
  expect(await claudeAuthStatus([join(tmpdir(), "no-such-claude")])({})).toMatchObject({
    kind: "unknown",
    error: expect.stringContaining("ENOENT"),
  });
});

test("a launch with a receiver exports its logs only there, with its token and no content flags", async () => {
  // The launch's own telemetry variables never reach the CLI, whatever they say; its proxy bypass list is kept.
  const own = {
    OTEL_LOG_USER_PROMPTS: "1",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://elsewhere",
    CLAUDE_CODE_ENABLE_TELEMETRY: "0",
    BETA_TRACING_ENDPOINT: "https://elsewhere",
    NO_PROXY: "corp.example",
  };
  const telemetry = { endpoint: "http://127.0.0.1:4318/v1/logs", token: "t0k" };
  const on = started(await events(runtime.start(launch(own, { telemetry }))));
  const settings = {
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
    OTEL_LOGS_EXPORTER: "otlp",
    OTEL_METRICS_EXPORTER: "none",
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: telemetry.endpoint,
    OTEL_METRICS_INCLUDE_VERSION: "true",
  };
  expect(on.env).toMatchObject({ ...settings, OTEL_EXPORTER_OTLP_LOGS_HEADERS: "Authorization=Bearer t0k" });
  // One list for both spellings: Windows keeps one of them, other systems both.
  const bypass = Object.entries(on.env).flatMap(([name, value]) => (name.toUpperCase() === "NO_PROXY" ? [value] : []));
  expect(new Set(bypass)).toEqual(new Set(["corp.example,127.0.0.1,localhost"]));
  for (const name of ["OTEL_LOG_USER_PROMPTS", "OTEL_EXPORTER_OTLP_ENDPOINT", "BETA_TRACING_ENDPOINT"]) {
    expect(on.env).not.toHaveProperty(name);
  }
  // The settings on the command line, which every local user can read, repeat them without the token.
  const flag = z
    .object({ env: z.record(z.string(), z.string()) })
    .parse(JSON.parse(on.args[on.args.indexOf("--settings") + 1] ?? ""));
  expect(flag.env).toMatchObject(settings);
  expect(on.args.join(" ")).not.toContain("t0k");
  // Without a receiver telemetry stays off.
  const off = started(await events(runtime.start(launch(own))));
  for (const name of [...Object.keys(settings), "OTEL_EXPORTER_OTLP_LOGS_HEADERS", "no_proxy"]) {
    expect(off.env).not.toHaveProperty(name);
  }
  expect(off.env["NO_PROXY"]).toBe("corp.example");
});

test("an interactive home's block, what counts as Claude Code telemetry already, and the token a block holds", () => {
  const token = "ab".repeat(24);
  const block = claudeTelemetry.env({ endpoint: "http://127.0.0.1:24318/v1/logs", token });
  expect(block).toMatchObject({
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: `Authorization=Bearer ${token}`,
    OTEL_LOGS_EXPORTER: "otlp",
  });
  expect([claudeTelemetry.tokenOf(block), claudeTelemetry.tokenOf({}), claudeTelemetry.keys]).toEqual([
    token,
    null,
    ["otelHeadersHelper"],
  ]);
  const named = [
    "OTEL_TRACES_EXPORTER",
    "CLAUDE_CODE_ENABLE_TELEMETRY",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
    "ENABLE_ENHANCED_TELEMETRY_BETA",
    "BETA_TRACING_ENDPOINT",
    "ENABLE_BETA_TRACING_DETAILED",
  ];
  const others = ["PATH", "CLAUDE_CODE_EFFORT_LEVEL", "CLAUDE_CODE_ENABLE_TELEMETRY_X"];
  expect([...named, ...others].map((name) => claudeTelemetry.isTelemetry(name))).toEqual([
    ...named.map(() => true),
    ...others.map(() => false),
  ]);
});

test("maps the stream-json lines to events", async () => {
  const all = await events(runtime.start(launch(stream("stream.jsonl"))));
  expect(all.slice(1).map((event) => event.type)).toEqual(["init", "other", "usage", "other", "result", "exit"]);
  expect(all[1]).toMatchObject({ sessionId: "00000000-0000-4000-8000-000000000001", agentVersion: "2.1.316" });
  // The plugins, skills and plugin errors the init line names (documented in the Agent SDK's SDKSystemMessage).
  expect(all[1]).toMatchObject({
    plugins: {
      loaded: ["workflow"],
      skills: ["workflow:workflow", "workflow:tier", "review"],
      errors: ["extra: no plugin.json"],
    },
  });
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
      allow: ["Bash(pnpm test *)", expect.stringMatching(/^Edit\(\/\/.*out\/result\.json\)$/)],
      // The path itself and below it; the working folder's own path depends on the platform. The own home's login and
      // state files come too, as the next test shows.
      deny: expect.arrayContaining([
        "Read(//accounts/other)",
        "Read(//accounts/other/**)",
        "Edit(//accounts/other)",
        "Edit(//accounts/other/**)",
        "Read(**/.env*)",
        "NotebookEdit",
        expect.stringMatching(/^Edit\(\/\/.*workflows\/\*\*\)$/),
      ]),
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

test("the worker's own home stays closed to its file tools only where the login and the account's state live", async () => {
  const own = launch({}, { denyRead: [fixtures, "/accounts/other"] });
  const settings = z
    .object({
      permissions: z.object({ deny: z.array(z.string()) }),
      sandbox: z.object({ filesystem: z.object({ denyRead: z.array(z.string()) }) }),
    })
    .parse(JSON.parse(started(await events(runtime.start(own))).args[12] ?? ""));
  const { deny } = settings.permissions;
  // Not the home whole, so the model reads what the CLI saves there for the session, such as a large tool output.
  expect(deny.filter((rule) => rule.endsWith("/fixtures)") || rule.endsWith("/fixtures/**)"))).toEqual([]);
  // The four files end in *, so their .signature.json and .stamp.json sidecars are closed too; ide/ holds the IDE's token.
  const state = [
    ".credentials.json*",
    ".claude.json*",
    "backups",
    "remote-settings.json*",
    "policy-limits.json*",
    "ide",
  ];
  for (const name of state) expect(deny.filter((rule) => rule.includes(`/fixtures/${name}`))).toHaveLength(4);
  // Every other home stays closed whole, and shell commands keep the whole home closed.
  expect(deny).toEqual(expect.arrayContaining(["Read(//accounts/other)", "Edit(//accounts/other/**)"]));
  expect(settings.sandbox.filesystem.denyRead).toEqual([fixtures, "/accounts/other"]);
});

test("plugin fields of an unknown form leave the init line an init event, with no plugins", async () => {
  const all = await events(runtime.start(launch(stream("malformed-plugins.jsonl"))));
  expect(all[1]).toMatchObject({ type: "init", settingsApplied: true, plugins: null });
});

test("a plugin's folder is readable to the session's file tools, and closed to their edits", async () => {
  const plugin = launch({}, { pluginDirs: ["/state/plugins/abc/workflow"] });
  const settings = z
    .object({ permissions: z.object({ deny: z.array(z.string()) }) })
    .parse(JSON.parse(started(await events(runtime.start(plugin))).args[12] ?? ""));
  const rules = settings.permissions.deny.filter((rule) => rule.includes("/state/plugins/abc/workflow"));
  expect(rules).toEqual(["Edit(//state/plugins/abc/workflow)", "Edit(//state/plugins/abc/workflow/**)"]);
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
    // An init line that names no plugins tells nothing about them.
    expect.objectContaining({ type: "init", agentVersion: "2.1.309", model: "claude-sonnet-5-5", plugins: null }),
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
    [{ resultFile: "result.json" }, 'not an absolute result file: "result.json"'],
  ] as const;
  for (const [change, message] of refusals) expect(() => runtime.start(fromJson(change))).toThrow(message);
});

test("a Windows path becomes an absolute rule in POSIX form, and a server's MCP wildcard passes", async () => {
  const windows = { denyRead: ["C:\\Users\\dev\\.ssh"], allow: ["mcp__github__*", "mcp__github"] };
  const settings: unknown = JSON.parse(started(await events(runtime.start(launch({}, windows)))).args[12] ?? "");
  expect(settings).toMatchObject({
    permissions: {
      allow: ["mcp__github__*", "mcp__github", expect.stringMatching(/^Edit\(\/\/.*result\.json\)$/)],
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
  const resumed = launch({}, { pluginDirs: ["/state/plugins/abc/workflow"] });
  const fake = started(await events(runtime.resume("00000000-0000-4000-8000-000000000001", resumed)));
  expect(fake.args.slice(-2)).toEqual(["--resume", "00000000-0000-4000-8000-000000000001"]);
  // The plugin goes with every resume, as with every start.
  expect(fake.args.join(" ")).toContain("--plugin-dir /state/plugins/abc/workflow");
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

test("an init line proves the settings applied only with its core tools listed and the sentinel left out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-stream-"));
  const lines = readFileSync(join(fixtures, "stream.jsonl"), "utf8");
  const checks = [];
  for (const [name, tools] of [
    ["empty", "[]"],
    ["no-read", '["Bash","Edit"]'],
  ] as const) {
    writeFileSync(join(dir, `${name}.jsonl`), lines.replace('"tools":["Bash","Read","Edit"]', `"tools":${tools}`));
    const { prompt: _, verifiedVersions: __, ...probe } = launch({ FAKE_STREAM: join(dir, `${name}.jsonl`) });
    checks.push(await runtime.checkContract(probe));
  }
  expect(checks).toEqual([
    { version: "2.1.316", missing: ["settings"] },
    { version: "2.1.316", missing: ["settings"] },
  ]);
  // Each session's own init event carries the proof, so a launch can check it.
  const all = await events(runtime.start(launch({ FAKE_STREAM: join(dir, "empty.jsonl") })));
  expect(all[1]).toMatchObject({ type: "init", settingsApplied: false });
  const applied = await events(runtime.start(launch(stream("stream.jsonl"))));
  expect(applied[1]).toMatchObject({ type: "init", settingsApplied: true });
});

test("an init line whose version has another form keeps its session ID, but proves no version", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cedarloom-stream-"));
  const line = readFileSync(join(fixtures, "no-reset.jsonl"), "utf8").replace('"2.1.316"', '"2.1.316\\u001b[31m"');
  writeFileSync(join(dir, "escaped.jsonl"), line);
  const escaped = { FAKE_STREAM: join(dir, "escaped.jsonl") };
  const all = await events(runtime.start(launch(escaped, { verifiedVersions: ["2.1.316"] })));
  expect(all[1]).toMatchObject({ type: "init", sessionId: "00000000-0000-4000-8000-000000000003", agentVersion: null });
  // No usage is read without a known version.
  expect(all.map((event) => event.type)).not.toContain("usage");
  const { prompt: _, verifiedVersions: __, ...probe } = launch(escaped);
  await expect(runtime.checkContract(probe)).resolves.toEqual({
    version: null,
    missing: ["init", "usage"],
  });
});

test("a contract check passes only with the version, the settings applied, a usage share with its reset and a result", async () => {
  const { prompt: _, verifiedVersions: __, ...probe } = launch(stream("stream.jsonl"), { verifiedVersions: [] });
  await expect(runtime.checkContract(probe)).resolves.toEqual({ version: "2.1.316", missing: [] });
  const older = { ...probe, env: stream("older.jsonl") };
  // The older form lists no tools, so nothing proves the settings applied.
  await expect(runtime.checkContract(older)).resolves.toEqual({ version: "2.1.309", missing: ["settings", "result"] });
  // The sentinel still among the tools: the CLI dropped the settings.
  const unapplied = { ...probe, env: stream("unapplied.jsonl") };
  await expect(runtime.checkContract(unapplied)).resolves.toEqual({ version: "2.1.316", missing: ["settings"] });
  const noReset = { ...probe, env: stream("no-reset.jsonl") };
  await expect(runtime.checkContract(noReset)).resolves.toEqual({ version: "2.1.316", missing: ["usage"] });
  await expect(runtime.checkContract({ ...probe, env: {} })).resolves.toEqual({
    version: null,
    missing: ["init", "settings", "usage", "result"],
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

test("cancel stops the CLI with the command it runs, on Windows too, also after its reader left early", async () => {
  const session = runtime.start(launch({ FAKE_CHILD: "1", FAKE_HANG: "1", FAKE_TICK: "1" }));
  const Command = z.object({ type: z.literal("command"), pid: z.int() });
  let pid: number | undefined;
  // Leaves at the command line, as a launcher leaves at an init line without the settings proof.
  for await (const event of session.events) {
    pid = Command.safeParse(event.type === "other" ? event.raw : null).data?.pid;
    if (pid !== undefined) break;
  }
  // The CLI keeps writing meanwhile: a closed stdout would end it with EPIPE before the cancel and orphan its command.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await session.cancel();
  expect(pid).toBeDefined();
  await vi.waitFor(() => expect(() => process.kill(pid ?? -1, 0)).toThrow("ESRCH"), { timeout: 3000 });
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
