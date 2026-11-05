import type { Launch } from "@cedarloom/agent-contracts";

/** Claude Code permission modes a session may run in; `bypassPermissions` is left out, because CedarLoom never bypasses. */
export type PermissionMode = "manual" | "acceptEdits" | "plan" | "dontAsk" | "auto";

/** Launch options of a Claude Code session. */
export interface ClaudeLaunch extends Launch {
  readonly permissionMode: PermissionMode;
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

/**
 * The arguments after the command. Never `--bare`: it skips the account's login, CLAUDE.md and auto memory
 * (https://code.claude.com/docs/en/headless#start-faster-with-bare-mode). `--permission-prompts none` denies what nobody
 * can answer and tells Claude not to retry it (https://code.claude.com/docs/en/headless#turn-off-permission-prompts-in-unattended-runs).
 */
export const launchArgs = (launch: ClaudeLaunch): string[] => {
  for (const model of [launch.model, launch.subagentModel]) {
    if (!FULL_MODEL_ID.test(model)) throw new Error(`not a full Claude model ID: ${model}`);
  }
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
  ];
};

// Dropped from the launch's environment, without regard to case, because Windows names ignore it: the names the adapter
// sets, CLAUDE_CODE_SIMPLE, which is equivalent to --bare (https://code.claude.com/docs/en/env-vars), and the login
// variables, which outrank the account's own login (https://code.claude.com/docs/en/authentication#authentication-precedence).
const LOGIN = /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_USE_)/i;
const OWN_NAMES = new Set([
  "CLAUDE_CODE_SIMPLE",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL_FORCE",
]);

/**
 * The process environment: the launch's own, with the account's config folder, the effort (the variable outranks the
 * flag and the effort settings, https://code.claude.com/docs/en/env-vars) and every subagent forced onto the phase's
 * model (https://code.claude.com/docs/en/sub-agents#run-every-subagent-on-one-model).
 */
export const launchEnv = (launch: ClaudeLaunch): Record<string, string> => ({
  ...Object.fromEntries(
    Object.entries(launch.env).filter(([name]) => !OWN_NAMES.has(name.toUpperCase()) && !LOGIN.test(name)),
  ),
  CLAUDE_CONFIG_DIR: launch.home,
  CLAUDE_CODE_EFFORT_LEVEL: launch.effort,
  CLAUDE_CODE_SUBAGENT_MODEL: launch.subagentModel,
  CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1",
});
