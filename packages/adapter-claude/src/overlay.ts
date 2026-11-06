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
// or an MCP tool without one. Deny and ask rules also take a glob in the tool name such as mcp__* or *; an allow rule
// takes only a server's own wildcard, mcp__github__*, since 2.1.316 skips the others there
// (https://code.claude.com/docs/en/permissions).
const Rule = z.string().regex(/^(?:\*|[A-Z][A-Za-z]*(?:\([^)]+\))?|mcp__[\w*-]+)$/);
const Allowed = z.string().regex(/^(?:[A-Z][A-Za-z]*(?:\([^)]+\))?|mcp__[\w-]+(?:__(?:[\w-]+|\*))?)$/);
const Domain = z.string().regex(/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::\d+)?$/i);
const Paths = z.array(z.string().min(1));
// A denied path is matched literally, the workflow folder below the working folder too: one with a glob character is
// refused rather than escaped.
const Literal = z.array(z.string().regex(/^[^*?[\]{}]+$/));

// A path in a permission rule, absolute with two slashes; Windows paths in their POSIX form, C:\Users as //c/Users.
const rulePath = (path: string): string => {
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path);
  return drive === null ? `/${path}` : `//${drive[1]?.toLowerCase()}/${drive[2]?.replaceAll("\\", "/")}`;
};

// One invalid value makes Claude Code skip the whole --settings object without a word, sandbox and deny rules
// included (2.1.316 trial), so every value a launch puts in is checked before it starts.
const Checked = z.looseObject({
  permissions: z.looseObject({ allow: z.array(Allowed), ask: z.array(Rule), deny: z.array(Rule) }),
  sandbox: z.looseObject({
    filesystem: z.looseObject({ denyRead: Literal, denyWrite: Literal, allowRead: Paths }),
    network: z.looseObject({ allowedDomains: z.array(Domain) }),
  }),
  env: z.record(z.string(), z.string()),
});

/**
 * The per-launch settings passed with --settings, the worker profile of the settings defaults; --settings can set any
 * key the user settings file can (https://code.claude.com/docs/en/cli-reference). Throws when a value is not one the
 * documented syntax takes.
 * shortcut: a key a later CLI version stops taking still drops the settings silently, until the launcher's contract
 * check proves they applied (the next launcher slice).
 */
export const overlay = ({ cwd, allow, denyRead, allowedDomains, env }: OverlayInput) => {
  const workflows = join(cwd, ".github", "workflows");
  const settings = {
    permissions: {
      allow,
      ask: ["Bash(git push *)"],
      // The path itself and everything below it: a credential file inside the working folder is matched too.
      deny: [
        ...denyRead
          .map(rulePath)
          .flatMap((path) => ["Read", "Edit"].flatMap((tool) => [`${tool}(${path})`, `${tool}(${path}/**)`])),
        "Read(**/.env*)",
        `Edit(${rulePath(workflows)}/**)`,
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
