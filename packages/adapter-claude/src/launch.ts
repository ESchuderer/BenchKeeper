import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
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
};

// The worker profile's variables (https://code.claude.com/docs/en/env-vars): auto memory off (A8), the A102 caps, no
// agent view, feedback, error reports or title requests, MCP servers without the worker's variables, bounded Stop-hook
// loops and transcripts.
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
  CLAUDE_CODE_TRANSCRIPT_LOCAL_GC: "1",
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
    JSON.stringify(overlay({ ...launch, env: { ...WORKER_VARIABLES, ...pinned(launch) } })),
    // No settings file at all: never the user's (A95), and a project's only once trust records exist (pending owner
    // decision; the live test of A95 is open).
    "--setting-sources",
    "",
    // A repository's .mcp.json would run in -p without trust.
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
  ];
};

// Dropped from the launch's environment, without regard to case, because Windows names ignore it: the names the adapter
// sets, CLAUDE_CODE_SIMPLE, which is equivalent to --bare (https://code.claude.com/docs/en/env-vars), and the login
// variables, which outrank the account's own login (https://code.claude.com/docs/en/authentication#authentication-precedence).
// CLAUDE_CODE_USE_POWERSHELL_TOOL is kept: it turns a tool on or off and selects no login.
const LOGIN = /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_(?!POWERSHELL_TOOL$))/i;
const OWN_NAMES = new Set([
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
  "CLAUDE_CODE_TMPDIR",
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
    Object.entries(launch.env).filter(([name]) => !OWN_NAMES.has(name.toUpperCase()) && !LOGIN.test(name)),
  ),
  ...WORKER_VARIABLES,
  ...pinned(launch),
  CLAUDE_CONFIG_DIR: launch.home,
  // Claude Code's own temporary files only: a TMPDIR outside the sandbox's writable folders would break commands.
  CLAUDE_CODE_TMPDIR: launch.tmpDir,
});
