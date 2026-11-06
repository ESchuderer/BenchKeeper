import { statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { Effort, Launch } from "@cedarloom/agent-contracts";
import { overlay } from "./overlay.ts";

// Claude Code permission modes a session may run in; `bypassPermissions` is left out, because CedarLoom never bypasses.
const PERMISSION_MODES = ["manual", "acceptEdits", "plan", "dontAsk", "auto"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
const MODES = new Set<string>(PERMISSION_MODES);
const EFFORTS = new Set<string>(["low", "medium", "high", "xhigh"] satisfies Effort[]);

/** Launch options of a Claude Code session. */
export interface ClaudeLaunch extends Launch {
  readonly permissionMode: PermissionMode;
  /** The permission rules the worker's profile allows, such as `Bash(pnpm test *)`; in dontAsk the only approvals. */
  readonly allow: readonly string[];
}

type Phase = Pick<ClaudeLaunch, "model" | "subagentModel" | "effort" | "permissionMode">;

/**
 * The fresh-install settings per workflow phase, which the policy layer copies into a launch until the user sets their
 * own. The plan step runs in plan mode on its own model, because the `opusplan` alias uses Opus only in plan mode
 * (https://code.claude.com/docs/en/model-config#opusplan-model-setting) and a `-p` run does not start in plan mode
 * (https://code.claude.com/docs/en/permission-modes#which-mode-a-non-interactive-run-starts-in).
 */
export const FRESH_INSTALL_PHASES = {
  plan: { model: "claude-opus-5-5", subagentModel: "claude-opus-5-5", effort: "high", permissionMode: "plan" },
  implement: {
    model: "claude-sonnet-5-5",
    subagentModel: "claude-sonnet-5-5",
    effort: "high",
    permissionMode: "dontAsk",
  },
  review: { model: "claude-opus-5-5", subagentModel: "claude-opus-5-5", effort: "high", permissionMode: "dontAsk" },
} as const satisfies Record<string, Phase>;

const FULL_MODEL_ID = /^claude-[a-z0-9-]+$/;

// Refuses what the types cannot keep out of a launch built from JSON, such as settings or a shared workflow. On 2.1.316 an
// empty CLAUDE_CONFIG_DIR runs on the machine's default login, a relative one creates the folder in the working directory,
// and a missing one runs logged out.
const refuse = (launch: ClaudeLaunch): void => {
  for (const model of [launch.model, launch.subagentModel]) {
    if (!FULL_MODEL_ID.test(model)) throw new Error(`not a full Claude model ID: ${model}`);
  }
  if (!MODES.has(launch.permissionMode)) throw new Error(`not an allowed permission mode: ${launch.permissionMode}`);
  if (!EFFORTS.has(launch.effort)) throw new Error(`not an allowed effort: ${launch.effort}`);
  if (!isAbsolute(launch.home) || statSync(launch.home, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`not an existing absolute config folder: "${launch.home}"`);
  }
  // The settings deny writes below the working folder by its absolute path.
  if (!isAbsolute(launch.cwd)) throw new Error(`not an absolute working folder: "${launch.cwd}"`);
  if (!isAbsolute(launch.resultFile)) throw new Error(`not an absolute result file: "${launch.resultFile}"`);
};

// The worker profile's variables (https://code.claude.com/docs/en/env-vars): auto memory off (A8), the A102 caps, no
// agent view, feedback, error reports or title requests, MCP servers without the worker's variables, and bounded Stop-hook
// loops.
const WORKER_VARIABLES = {
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS: "4",
  CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "4",
  CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: "2",
  CLAUDE_CODE_DISABLE_AGENT_VIEW: "1",
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
  DISABLE_ERROR_REPORTING: "1",
  DISABLE_FEEDBACK_COMMAND: "1",
  CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
  CLAUDE_CODE_SEND_FEEDBACK: "0",
  CLAUDE_CODE_MCP_ALLOWLIST_ENV: "1",
  MCP_TOOL_TIMEOUT: "600000",
  CLAUDE_CODE_STOP_HOOK_BLOCK_CAP: "8",
} as const;

// The phase's effort and subagent model; the settings repeat them with the worker variables.
const pinned = (launch: ClaudeLaunch) => ({
  CLAUDE_CODE_EFFORT_LEVEL: launch.effort,
  CLAUDE_CODE_SUBAGENT_MODEL: launch.subagentModel,
  CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
});

/**
 * The arguments after the command. Never `--bare`: it skips the account's login, CLAUDE.md and auto memory
 * (https://code.claude.com/docs/en/headless#start-faster-with-bare-mode). `--permission-prompts none` denies what nobody
 * can answer and tells Claude not to retry it (https://code.claude.com/docs/en/headless#turn-off-permission-prompts-in-unattended-runs).
 */
export const launchArgs = (launch: ClaudeLaunch): string[] => {
  refuse(launch);
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-hook-events",
    "--model",
    launch.model,
    "--permission-mode",
    launch.permissionMode,
    "--permission-prompts",
    "none",
    "--settings",
    JSON.stringify(
      overlay({ ...launch, env: { ...WORKER_VARIABLES, ...pinned(launch), ...telemetrySettings(launch.telemetry) } }),
    ),
    // No settings file at all: never the user's (A95), and a project's only once trust records exist (owner decision,
    // 2026-11-06).
    "--setting-sources",
    "",
    // A repository's .mcp.json would run in -p without trust.
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    // Workers read no settings file, so no enabledPlugins reaches them: their plugins come this way, start and resume
    // alike (https://code.claude.com/docs/en/cli-reference).
    ...launch.pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
    // The result file's folder joins the working folders, which the settings otherwise keep every write inside, and so
    // do the plugins, whose skills read their own files (the settings deny edits there); last, because the flag takes
    // several folders.
    "--add-dir",
    dirname(launch.resultFile),
    ...launch.pluginDirs,
  ];
};

// Dropped from the launch's environment, without regard to case, because Windows names ignore it: the names the adapter
// sets, CLAUDE_CODE_SIMPLE, which is equivalent to --bare (https://code.claude.com/docs/en/env-vars), and the login
// variables, which outrank the account's own login (https://code.claude.com/docs/en/authentication#authentication-precedence).
// CLAUDE_CODE_USE_POWERSHELL_TOOL is kept: it turns a tool on or off and selects no login.
const LOGIN = /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_(?!POWERSHELL_TOOL$))/i;
// Telemetry is the adapter's alone: no exporter, endpoint or content flag of the launch's environment reaches the CLI.
const TELEMETRY = /^(?:OTEL_|CLAUDE_CODE_ENABLE_TELEMETRY$)/i;

// OpenTelemetry logs only, to the launcher's loopback receiver, metrics off, and no content flag
// (https://code.claude.com/docs/en/monitoring-usage); the receiver keeps the api_request events. The settings repeat
// these, never the token.
const telemetrySettings = (telemetry: ClaudeLaunch["telemetry"]): Record<string, string> =>
  telemetry === null
    ? {}
    : {
        CLAUDE_CODE_ENABLE_TELEMETRY: "1",
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_METRICS_EXPORTER: "none",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: telemetry.endpoint,
        OTEL_METRICS_INCLUDE_VERSION: "true",
      };

/**
 * The env block that sends Claude Code's telemetry to the receiver at `endpoint` with `token`, for the logs signal
 * only: a worker's process environment, or an interactive home's settings.json (`accounts telemetry`).
 */
export const claudeTelemetryEnv = (telemetry: { readonly endpoint: string; readonly token: string }) => ({
  ...telemetrySettings(telemetry),
  OTEL_EXPORTER_OTLP_LOGS_HEADERS: `Authorization=Bearer ${telemetry.token}`,
});

// The worker's block, in the process environment only: the settings travel on the command line, which every local user
// can read. The loopback stays off the worker's proxy, whose bypass of the loopback Claude Code documents for
// WebSockets only (https://code.claude.com/docs/en/network-config); both spellings get one list, as Windows keeps one
// of them.
const telemetryEnv = ({ telemetry, env }: ClaudeLaunch): Record<string, string> => {
  if (telemetry === null) return {};
  const bypass = [env["NO_PROXY"], env["no_proxy"], "127.0.0.1,localhost"].filter(Boolean).join(",");
  return { ...claudeTelemetryEnv(telemetry), NO_PROXY: bypass, no_proxy: bypass };
};
const OWN_NAMES = new Set([
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
  "CLAUDE_CODE_TMPDIR",
  "CLAUDE_CODE_TRANSCRIPT_LOCAL_GC",
  ...Object.keys(WORKER_VARIABLES),
]);

/**
 * The process environment: the launch's own, with the account's config folder, the effort (the variable outranks the
 * flag and the effort settings, https://code.claude.com/docs/en/env-vars), every subagent forced onto the phase's
 * model (https://code.claude.com/docs/en/sub-agents#run-every-subagent-on-one-model), the worker's temporary folder
 * and the worker profile's variables.
 */
export const launchEnv = (launch: ClaudeLaunch): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(launch.env).filter(
      ([name]) => !OWN_NAMES.has(name.toUpperCase()) && !LOGIN.test(name) && !TELEMETRY.test(name),
    ),
  ),
  ...telemetryEnv(launch),
  ...WORKER_VARIABLES,
  ...pinned(launch),
  // Read from the process environment only, so it is not repeated in the settings.
  CLAUDE_CODE_TRANSCRIPT_LOCAL_GC: "1",
  CLAUDE_CONFIG_DIR: launch.home,
  // Claude Code's own temporary files only: a TMPDIR outside the sandbox's writable folders would break commands.
  CLAUDE_CODE_TMPDIR: launch.tmpDir,
});
