import { join } from "node:path";
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
  /**
   * A report run's worker, given the other folders it may not write either, such as the shared `.git` of a linked
   * worktree, which Claude Code's sandbox opens to its commands. It changes nothing in the working folder or those
   * folders and runs no `git push`; it still writes its result. It does not stop a push in another spelling (`git -C`,
   * `sh -c`, `gh`, `curl`: the read-only token, or none, is that boundary), hooks, writes to its temporary and result
   * folders, or sending out what it read.
   */
  readonly readOnly?: readonly string[];
}

// A trailing ` *` matches the bare command too (https://code.claude.com/docs/en/permissions).
const PUSH = "Bash(git push *)";

// The worker's own home stays closed to its file tools only where the login and the account's state live, so the model
// reads what the CLI keeps there for the session, such as a large tool output saved under projects/; every other home
// stays closed whole, and so does every home to shell commands (live test, Claude Code 2.1.316, 2026-11-06). The four
// files end in *, so their .signature.json and .stamp.json sidecars, which repeat them or name the account, are closed
// too; ide/ holds each IDE connection's lock file with its auth token.
const OWN_STATE = [
  ".credentials.json*",
  ".claude.json*",
  "backups",
  "remote-settings.json*",
  "policy-limits.json*",
  "ide",
];

/**
 * A core tool the settings deny by its bare name, which removes it from the session's tools
 * (https://code.claude.com/docs/en/permissions): its absence from the init line's tool list proves the CLI applied the
 * settings. Plan mode lists it too (2.1.316). The cost: workers cannot change notebooks with the file tools, since Edit
 * refuses .ipynb files (2.1.316); shell commands still can (owner decision, kept).
 */
export const SETTINGS_SENTINEL = "NotebookEdit";

// Toolchains below the home folder that shell commands read and blockReadsOutsideWorkingDirectories closes for them
// (owner decision, 2026-11-06): nvm, pnpm's store on Linux and on macOS, cargo, user-installed binaries, npm's global
// prefix.
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
 * documented syntax takes. A key a later CLI version stops taking drops the settings silently; the session's init line
 * then lists SETTINGS_SENTINEL, and its init event reports the settings as not applied.
 */
export const overlay = (input: OverlayInput) => {
  const { home, cwd, resultFile, allow, denyRead, allowedDomains, env, pluginDirs, readOnly } = input;
  // Deny rules outrank ask and allow rules (https://code.claude.com/docs/en/permissions). A read-only worker's file tools
  // and shell commands change nothing in the working folder; any other worker's, nothing in its workflows folder.
  const closedToWrites = readOnly === undefined ? [join(cwd, ".github", "workflows")] : [cwd, ...readOnly];
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
