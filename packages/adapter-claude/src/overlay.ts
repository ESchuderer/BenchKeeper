import { join } from "node:path";
import { z } from "zod";

export interface OverlayInput {
  readonly cwd: string;
  readonly allow: readonly string[];
  readonly denyRead: readonly string[];
  readonly allowedDomains: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

// Toolchains below the home folder that shell commands read and blockReadsOutsideWorkingDirectories closes for them
// (pending owner decision): nvm, pnpm's store on Linux and on macOS, cargo, user-installed binaries, npm's global prefix.
const TOOLCHAINS = ["~/.nvm", "~/.local/share/pnpm", "~/Library/pnpm", "~/.cargo", "~/.local/bin", "~/.npm-global"];

// The documented rule syntax: a tool name with an optional specifier in parentheses that holds no closing parenthesis,
// or an MCP tool (https://code.claude.com/docs/en/settings#permission-rule-syntax).
const Rule = z.string().regex(/^(?:[A-Z][A-Za-z]*(?:\([^)]+\))?|mcp__[\w-]+)$/);
const Domain = z.string().regex(/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d+)?$/i);
const Paths = z.array(z.string().min(1));

// One invalid value makes Claude Code skip the whole --settings object without a word, sandbox and deny rules
// included (2.1.316 trial), so every value a launch puts in is checked before it starts.
const Checked = z.looseObject({
  permissions: z.looseObject({ allow: z.array(Rule), ask: z.array(Rule), deny: z.array(Rule) }),
  sandbox: z.looseObject({
    filesystem: z.looseObject({ denyRead: Paths, denyWrite: Paths, allowRead: Paths }),
    network: z.looseObject({ allowedDomains: z.array(Domain) }),
  }),
  env: z.record(z.string(), z.string()),
});

/**
 * The per-launch settings passed with --settings, the worker profile of the settings defaults; --settings can set any
 * key the user settings file can (https://code.claude.com/docs/en/cli-reference). Throws when a value is not one the
 * documented syntax takes.
 * shortcut: a key a later CLI version stops taking still drops the settings silently; the per-version check of slice 2
 * should prove they applied.
 */
export const overlay = ({ cwd, allow, denyRead, allowedDomains, env }: OverlayInput) => {
  const workflows = join(cwd, ".github", "workflows");
  const settings = {
    permissions: {
      allow,
      ask: ["Bash(git push *)"],
      // Permission rules mark an absolute path with two slashes (https://code.claude.com/docs/en/permissions).
      deny: [
        ...denyRead.flatMap((path) => [`Read(/${path}/**)`, `Edit(/${path}/**)`]),
        "Read(**/.env*)",
        `Edit(/${workflows}/**)`,
      ],
      disableBypassPermissionsMode: "disable",
      blockReadsOutsideWorkingDirectories: true,
      blockWritesOutsideWorkingDirectories: true,
    },
    // A96: the only documented limit on what a shell command reads; no command ever runs outside it.
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: false,
      filesystem: { denyRead, denyWrite: [workflows], allowRead: TOOLCHAINS },
      network: { allowedDomains, strictAllowlist: true },
    },
    // A102: a window lasts hours, not minutes.
    maxEffortLevel: "xhigh",
    workflowSizeGuideline: "small",
    autoMemoryEnabled: false,
    autoContinueAtUsageLimit: false,
    disableAgentView: true,
    feedbackDrafts: "off",
    forceLoginMethod: "claudeai",
    disableClaudeAiConnectors: true,
    syncClaudeAiPlugins: false,
    syncClaudeAiSkills: false,
    crossSessionInbound: "refuse",
    isolatePeerMachines: true,
    allowedHttpHookUrls: [],
    httpHookAllowedEnvVars: [],
    // Repeated here: settings outrank the process environment.
    env,
  };
  const checked = Checked.safeParse(settings);
  if (!checked.success) throw new Error(`invalid worker settings at ${checked.error.issues[0]?.path.join(".")}`);
  return settings;
};
