import { join } from "node:path";

export interface OverlayInput {
  readonly cwd: string;
  readonly allow: readonly string[];
  readonly denyRead: readonly string[];
  readonly allowedDomains: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The per-launch settings passed with --settings, the worker profile of the settings defaults. It holds only keys that
 * every settings file honors (https://code.claude.com/docs/en/settings-reference): sandbox.network.strictAllowlist,
 * autoContinueAtUsageLimit and feedbackDrafts count in user or managed settings only. dontAsk refuses a host outside
 * allowedDomains anyway (https://code.claude.com/docs/en/sandboxing#hosts-outside-your-allowed-domains), a usage-limit
 * wait is not offered in -p, and the feedback variables turn feedback off.
 */
export const overlay = ({ cwd, allow, denyRead, allowedDomains, env }: OverlayInput) => ({
  permissions: {
    allow,
    ask: ["Bash(git push *)"],
    // Permission rules mark an absolute path with two slashes (https://code.claude.com/docs/en/permissions).
    deny: [...denyRead.flatMap((path) => [`Read(/${path}/**)`, `Edit(/${path}/**)`]), "Read(**/.env*)"],
    disableBypassPermissionsMode: "disable",
    blockReadsOutsideWorkingDirectories: true,
    blockWritesOutsideWorkingDirectories: true,
  },
  // A96: the only documented limit on what a shell command reads; never run a command unsandboxed.
  sandbox: {
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    filesystem: { denyRead, denyWrite: [join(cwd, ".github", "workflows")] },
    network: { allowedDomains },
    excludedCommands: ["devcontainer exec *"],
  },
  // A102: a window lasts hours, not minutes.
  maxEffortLevel: "xhigh",
  workflowSizeGuideline: "small",
  autoMemoryEnabled: false,
  disableAgentView: true,
  forceLoginMethod: "claudeai",
  disableClaudeAiConnectors: true,
  crossSessionInbound: "refuse",
  isolatePeerMachines: true,
  allowedHttpHookUrls: [],
  httpHookAllowedEnvVars: [],
  // Repeated here: settings outrank the process environment.
  env,
});
