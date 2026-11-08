import { join } from "node:path";
import type { GuardHook } from "@cedarloom/agent-contracts";
import { sameFolder } from "@cedarloom/contracts";
import { z } from "zod";

export interface OverlayInput {
  /** The account's config folder the worker runs in; one of `denyRead`. */
  readonly home: string;
  readonly cwd: string;
  readonly resultFile: string;
  readonly allow: readonly string[];
  readonly denyRead: readonly string[];
  readonly allowedDomains: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Plugin folders the session loads; its file tools may read them, never change them. */
  readonly pluginDirs: readonly string[];
  /** The hook every shell command passes first; its files are closed to the session's writes. */
  readonly guardHook: GuardHook;
  /** Other folders a report run's worker may not write: docs/agents/cedarloom-rationale.md#read-only-workers */
  readonly readOnly?: readonly string[];
}

// A trailing ` *` matches the bare command too (https://code.claude.com/docs/en/permissions).
const PUSH = "Bash(git push *)";

// Closed to file tools where the login and account state live: docs/agents/cedarloom-rationale.md#worker-home
const OWN_STATE = [
  ".credentials.json*",
  ".claude.json*",
  "backups",
  "remote-settings.json*",
  "policy-limits.json*",
  "ide",
];

// The settings' proof: docs/agents/cedarloom-rationale.md#settings-overlay
export const SETTINGS_SENTINEL = "NotebookEdit";

// Toolchains below home that blockReadsOutsideWorkingDirectories closes to shell commands (owner decision, 2026-11-06).
const TOOLCHAINS = ["~/.nvm", "~/.local/share/pnpm", "~/Library/pnpm", "~/.cargo", "~/.local/bin", "~/.npm-global"];

// The documented rule syntax: docs/agents/cedarloom-rationale.md#permission-rules
const Rule = z.string().regex(/^(?:\*|[A-Z][A-Za-z]*(?:\([^)]+\))?|mcp__[\w*-]+)$/);
const Allowed = z.string().regex(/^(?:[A-Z][A-Za-z]*(?:\([^)]+\))?|mcp__[\w-]+(?:__(?:[\w-]+|\*))?)$/);
const Domain = z.string().regex(/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d+)?$/i);
const Paths = z.array(z.string().min(1));
// Denied paths match literally, the workflow folder too, so one with a glob character is refused rather than escaped.
const Literal = z.array(z.string().regex(/^[^*?[\]{}]+$/));

// A path in a permission rule, absolute with two slashes; Windows paths in their POSIX form, C:\Users as //c/Users.
const rulePath = (path: string): string => {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return drive === null ? `/${path}` : `//${drive[1]?.toLowerCase()}/${drive[2]?.replaceAll("\\", "/")}`;
};

// One invalid value silently drops the whole --settings object (2.1.316 trial), so every value is checked first.
const Checked = z.looseObject({
  permissions: z.looseObject({ allow: z.array(Allowed), ask: z.array(Rule), deny: z.array(Rule) }),
  sandbox: z.looseObject({
    filesystem: z.looseObject({ denyRead: Literal, denyWrite: Literal, allowRead: Paths }),
    network: z.looseObject({ allowedDomains: z.array(Domain) }),
  }),
  env: z.record(z.string(), z.string()),
});

// The worker profile's keys that every launch sets alike.
const FIXED = {
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
};

// Tools that start work outside this session (https://code.claude.com/docs/en/tools-reference).
const REACH_PAST_GUARD = ["RemoteTrigger", "SendMessage", "ListAgents"];

// A failed guard refuses its call; a lower settings file's disableAllHooks does not apply (code.claude.com/docs/en/hooks).
const guardHooks = ({ command, args }: GuardHook) => ({
  PreToolUse: [
    {
      matcher: "Bash|Monitor|PowerShell",
      hooks: [{ type: "command", command, args, timeout: 10, onFailure: "block" }],
    },
  ],
});

// The worker profile passed with --settings, checked first: docs/agents/cedarloom-rationale.md#settings-overlay
export const overlay = (input: OverlayInput) => {
  const { home, cwd, resultFile, allow, denyRead, allowedDomains, env, pluginDirs, readOnly, guardHook } = input;
  // Deny rules outrank ask and allow (https://code.claude.com/docs/en/permissions), for file tools and shell alike.
  const closedToWrites = [
    ...(readOnly === undefined ? [join(cwd, ".github", "workflows")] : [cwd, ...readOnly]),
    ...guardHook.files,
  ];
  const closed = [...denyRead.filter((path) => !sameFolder(path, home)), ...OWN_STATE.map((name) => join(home, name))];
  const settings = {
    permissions: {
      // Edit rules cover every tool that writes a file (https://code.claude.com/docs/en/permissions).
      allow: [...allow, `Edit(${rulePath(resultFile)})`],
      ask: [PUSH],
      // The path itself and everything below it: a credential file inside the working folder is matched too.
      deny: [
        ...closed
          .map(rulePath)
          .flatMap((path) => ["Read", "Edit"].flatMap((tool) => [`${tool}(${path})`, `${tool}(${path}/**)`])),
        "Read(**/.env*)",
        SETTINGS_SENTINEL,
        // Cloud tasks and the owner's other sessions run commands no hook of this session reads.
        ...REACH_PAST_GUARD,
        ...closedToWrites.map((path) => `Edit(${rulePath(path)}/**)`),
        ...(readOnly === undefined ? [] : [PUSH]),
        // The plugins join the working folders, which lets their skills read their own files, but not change them.
        ...pluginDirs.map(rulePath).flatMap((path) => [`Edit(${path})`, `Edit(${path}/**)`]),
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
      // Every --add-dir folder is writable to commands: the plugins, whose hooks run outside the sandbox, are closed.
      filesystem: { denyRead, denyWrite: [...closedToWrites, ...pluginDirs], allowRead: TOOLCHAINS },
      network: { allowedDomains, strictAllowlist: true },
    },
    hooks: guardHooks(guardHook),
    disableAllHooks: false,
    ...FIXED,
    // Repeated here: settings outrank the process environment.
    env,
  };
  const checked = Checked.safeParse(settings);
  if (!checked.success) throw new Error(`invalid worker settings at ${checked.error.issues[0]?.path.join(".")}`);
  return settings;
};
