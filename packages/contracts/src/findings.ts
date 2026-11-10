import { z } from "zod";
import { AutomationLevel } from "./automation.ts";
import { GitOid, Sha256 } from "./plan.ts";
import { contracts, SchemaVersion } from "./registry.ts";
import { HandleType } from "./workflow.ts";

const finding = <const C extends string, const P extends z.ZodRawShape>(code: C, params: P) =>
  z.strictObject({ code: z.literal(code), params: z.strictObject(params) });

// Where a document breaks its schema: the path and zod's issue code of each problem, no prose, and the character a text
// may not hold as U+XXXX, which nobody sees (hub 198).
const issues = z.array(z.strictObject({ path: z.string(), code: z.string(), char: z.string().optional() }));

/** A result of a check: a code and typed parameters; the text for people comes from the message catalog. */
export const Finding = z
  .discriminatedUnion("code", [
    finding("document.unreadable", { path: z.string(), error: z.string() }),
    finding("document.newer-schema", { found: SchemaVersion, known: SchemaVersion, path: z.string().optional() }),
    /** `path`, here and above, names the file when the reader knows it. */
    finding("document.invalid", { issues, path: z.string().optional() }),
    finding("plan.not-approved", { planHash: Sha256, approvedHash: z.string() }),
    finding("plan.path-not-absolute", { path: z.string() }),
    finding("plan.not-a-file", { path: z.string(), error: z.string() }),
    finding("plan.chain-broken", {
      path: z.string(),
      index: z.int(),
      expected: Sha256.nullable(),
      found: Sha256.nullable(),
    }),
    finding("plan.file-changed", { path: z.string(), expected: Sha256.nullable(), actual: Sha256.nullable() }),
    finding("apply.symlink", { path: z.string() }),
    finding("apply.not-text", { path: z.string() }),
    finding("apply.backup-failed", { path: z.string(), error: z.string() }),
    finding("apply.write-failed", { path: z.string(), error: z.string() }),
    finding("apply.write-mismatch", { path: z.string(), expected: Sha256.nullable(), actual: Sha256.nullable() }),
    finding("run.not-found", { runId: z.string() }),
    finding("run.interrupted", { runId: z.string(), undoes: z.string().nullable() }),
    finding("run.failed", { runId: z.string(), undoes: z.string().nullable() }),
    /** A node type this CedarLoom does not run yet (in 0.1.0: trigger.schedule, workflow.run); nothing of the run starts. */
    finding("run.node-unsupported", { node: z.string(), type: z.string() }),
    finding("undo.file-edited", { runId: z.string(), path: z.string() }),
    finding("undo.backup-missing", { runId: z.string(), path: z.string() }),
    finding("undo.backup-changed", { runId: z.string(), path: z.string() }),
    finding("store.busy", { dir: z.string() }),
    finding("store.network-filesystem", { dir: z.string(), fsType: z.string() }),
    finding("draft.not-found", { id: z.string() }),
    /** An import the server keeps no plan for: applied already, older than its latest reviews, or from before a restart. */
    finding("import.not-found", { id: z.string() }),
    finding("draft.too-large", { id: z.string(), bytes: z.int(), limit: z.int() }),
    finding("store.newer-schema", { found: z.int(), known: z.int() }),
    /** A run store from before 0.1.0, which is not carried over (pre-release only). */
    finding("store.older-schema", { dir: z.string(), found: z.int(), known: z.int() }),
    /** Graph findings of a workflow; `node: null` names one of the workflow's own outputs. */
    finding("workflow.duplicate-id", { kind: z.enum(["node", "edge"]), id: z.string() }),
    finding("workflow.trigger-count", { count: z.int() }),
    finding("workflow.unknown-node-type", { node: z.string(), type: z.string() }),
    finding("workflow.invalid-config", { node: z.string(), issues }),
    finding("workflow.dangling-edge", { edge: z.string(), end: z.enum(["from", "to"]), ref: z.string() }),
    finding("workflow.unknown-handle", { edge: z.string(), end: z.enum(["from", "to"]), handle: z.string() }),
    finding("workflow.incompatible-handles", { edge: z.string(), from: HandleType, to: HandleType }),
    finding("workflow.unchecked-handles", { edge: z.string(), from: HandleType, to: HandleType }),
    finding("workflow.many-sources", { node: z.string().nullable(), handle: z.string(), count: z.int() }),
    finding("workflow.missing-source", { node: z.string().nullable(), handle: z.string() }),
    finding("workflow.cycle", { nodes: z.array(z.string()) }),
    finding("workflow.join-branches", { node: z.string(), count: z.int() }),
    finding("workflow.duplicate-edge", { edge: z.string(), of: z.string() }),
    finding("workflow.exclusive-sources", { node: z.string(), handle: z.string(), from: z.string() }),
    finding("workflow.optional-input", { node: z.string(), handle: z.string(), input: z.string() }),
    finding("workflow.schedule-input", { input: z.string() }),
    finding("workflow.report-only-write", { node: z.string() }),
    finding("workflow.unreachable", { node: z.string() }),
    finding("workflow.stray-entry", { section: z.enum(["execution", "layout"]), node: z.string() }),
    /** An agent step's skill folder: `name` is its `skill`, else its id in lower case. */
    finding("workflow.skill-name", { node: z.string(), name: z.string() }),
    finding("workflow.duplicate-skill", { node: z.string(), name: z.string(), of: z.string() }),
    /** A check holds back the agent step before it, so only an agent step's `done` starts it. */
    finding("workflow.check-source", { node: z.string(), from: z.string() }),
    finding("workflow.check-output", { node: z.string(), handle: z.string() }),
    /** Why a workflow builds into no package at its automation level: a stage ends at each gate the level keeps. */
    finding("package.two-stages", { node: z.string() }),
    finding("package.cross-stage", { edge: z.string() }),
    finding("package.name-taken", { name: z.string(), node: z.string() }),
    finding("package.reserved-name", { name: z.string() }),
    /**
     * A workflow package installs only once approved by its plugin's name, as its hooks run in every session: the
     * commands its steps and its precheck run, as the package writes them.
     */
    finding("package.approval-needed", {
      id: z.string(),
      plugin: z.string(),
      level: AutomationLevel,
      commands: z.array(z.string()),
    }),
    /** The guard's or the exit hook's bundle, which every package carries, is missing from the CLI's hooks folder. */
    finding("package.hooks-missing", { path: z.string() }),
    finding("package.not-installed", { id: z.string() }),
    /** Two workflow ids fold to one plugin name: `id` is the workflow whose package the plugin holds. */
    finding("package.plugin-taken", { plugin: z.string(), id: z.string() }),
    /**
     * Another installed package is built at a level on the other side of Auto: each package's guard binds every workflow
     * script's agents, so their merge passes only while every installed package is at Auto.
     */
    finding("package.levels-mixed", {
      id: z.string(),
      level: AutomationLevel,
      other: z.string(),
      otherLevel: AutomationLevel,
    }),
    /** Codex holds copies of CedarLoom's packages (`codex plugin add`), but none of this one. */
    finding("package.codex-missing", { plugin: z.string(), id: z.string() }),
    /** Codex runs a copy that differs from the installed package, as after a rebuild. */
    finding("package.codex-stale", { plugin: z.string(), id: z.string() }),
    /** Codex holds a copy of a package CedarLoom no longer installs. */
    finding("package.codex-left", { plugin: z.string() }),
    /** An installed package's hooks run with a Node.js that is gone, so Claude Code refuses every call they guard. */
    finding("package.node-missing", {
      plugin: z.string(),
      path: z.string(),
      /** The workflow and level it was built from, as its manifest names them; null when it names none. */
      id: z.string().nullable(),
      level: AutomationLevel.nullable(),
    }),
    /** A project's level is set for a folder that exists, by its real path. */
    finding("automation.unknown-folder", { path: z.string() }),
    /**
     * Git could not start, fetch, list, read or add a worktree; `error` is the end of its message. Never the URL: it may
     * hold a token.
     */
    finding("git.failed", {
      step: z.enum(["start", "fetch", "list", "read", "commit", "update"]),
      error: z.string(),
    }),
    /**
     * The workflow store (P3 a): a draft opened from another stored version than the one there now (an import changed
     * it meanwhile) is saved only on top of it, never merged.
     */
    finding("store.conflict", { id: z.string() }),
    /** A saved version must be above the stored one (semver precedence). */
    finding("store.version-not-higher", { id: z.string(), stored: z.string(), found: z.string() }),
    /** Store commits carry the user's Git identity, which their configuration lacks. */
    finding("store.identity-missing", { key: z.enum(["user.name", "user.email"]) }),
    /** The branch moved since the plan was made: the apply moves nothing. */
    finding("store.moved", { ref: z.string(), expected: GitOid.nullable(), actual: GitOid.nullable() }),
    finding("store.not-found", { id: z.string(), commit: z.string().nullable() }),
    /** Opening a stored version as a draft never replaces a draft. */
    finding("store.draft-exists", { id: z.string() }),
    /** A source that never reaches git: a URL or ref with a character a shell, terminal or helper reads, or a password. */
    finding("git.refused-source", { field: z.enum(["url", "ref", "path"]) }),
    finding("git.unsafe-entry", { path: z.string(), kind: z.enum(["link", "submodule", "name", "case"]) }),
    /**
     * An extension that may not run here (P1 a, A31). A Node before 25 could widen its folder's grant; one that speaks
     * another protocol or serves other actions than its manifest names is stopped at once.
     */
    finding("extension.refused", {
      extension: z.string(),
      reason: z.enum(["sandbox-unavailable", "windows", "protocol", "actions", "folder", "runtime", "off", "programs"]),
    }),
    /**
     * An extension that is not installed or updated. `extension`: its id when the manifest names it. The `cedarloom`
     * publisher is refused, as only the app ships it.
     */
    finding("extension.install-refused", {
      extension: z.string().nullable(),
      reason: z.enum(["no-manifest", "entry", "protocol", "installed", "id", "reserved", "programs"]),
    }),
    /** An extension to update or remove that is not installed. */
    finding("extension.unknown", { extension: z.string() }),
    /** An update that asks for capabilities the user has not approved: only an approval of its exact plan applies it. */
    finding("extension.consent-needed", { extension: z.string() }),
    /** An extension that could not start, answer its handshake, or run an action; `error` says why, shown safely. */
    finding("extension.failed", {
      extension: z.string(),
      step: z.enum(["stage", "start", "initialize", "run", "doctor"]),
      error: z.string(),
    }),
    /** A finding of an extension's own check (contributes.doctor), in its words from its own catalog: shown safely. */
    finding("extension.finding", {
      extension: z.string(),
      check: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      code: z.string(),
      message: z.string(),
    }),
    /** A file of another kind where a profile belongs: BenchKeeper's profiles and presets are never imported (D33). */
    finding("profile.foreign-kind", { kind: z.string() }),
    /** Where a profile holds a token-shaped value or an environment name for a credential; the value is never shown. */
    finding("profile.secret-like", { path: z.string() }),
    finding("profile.forbidden-setting", { path: z.string() }),
    finding("profile.parent-unknown", { pack: z.string(), path: z.string() }),
    finding("profile.parent-cycle", { chain: z.array(z.string()) }),
    finding("profile.parent-limit", { chain: z.array(z.string()), limit: z.int() }),
    /** One pack id with two sources in one composition: the files that name each. */
    finding("profile.pack-sources", { pack: z.string(), files: z.array(z.string()) }),
    finding("profile.entry-unknown", {
      pack: z.string(),
      path: z.string(),
      kind: z.enum(["rules", "template", "profile", "skill"]),
    }),
    finding("profile.app-too-old", { minApp: z.string(), app: z.string() }),
    /** A part the selection or a `requires` names that the profile does not hold, both as `level.id`. */
    finding("profile.part-unknown", { part: z.string(), by: z.string() }),
    finding("profile.part-requires", { part: z.string(), requires: z.string() }),
    /** A file the owner changed or made since CedarLoom last wrote it: the plan leaves it as it is. */
    finding("profile.owner-changed", { path: z.string() }),
    /** A `{{name}}` left in a text, at the text's JSON Pointer in the composed profile. */
    finding("profile.placeholder-unknown", { at: z.string(), placeholder: z.string() }),
    finding("profile.binding-missing", { part: z.string(), binding: z.enum(["hub", "gates"]) }),
    /**
     * A drift line of `profiles check`, its plans and the doctor (plan section 2.9): what differs from the profile, the
     * path, part, source or item it is about, and the item `apply --remove` takes when its removal is offered.
     */
    finding("profile.drift", {
      status: z.enum(["missing", "outdated", "deselected-present", "not-run"]),
      subject: z.string(),
      remove: z.string().nullable(),
    }),
    /** What a home holds that the profile does not name, reported only, with the item `apply --remove` takes (PF4). */
    finding("profile.extra", { item: z.string() }),
    /** An `apply --remove` item the plan does not offer. */
    finding("profile.remove-unknown", { item: z.string() }),
    /** A `profiles init` target that holds a file, which may be a profile the owner edited, or is the selection file. */
    finding("profile.copy-exists", { path: z.string() }),
    /** A project file another clone wrote from a newer version of its pack than this machine has, left as it is. */
    finding("profile.newer-pack", { path: z.string(), recorded: z.string(), local: z.string() }),
    /** An auto part that stays off until this machine names the binding it waits for. */
    finding("profile.binding-waiting", { part: z.string(), binding: z.enum(["gates"]) }),
    /** A part switched on stays off while its condition fails: for `orca`, the extension is off or no program is found. */
    finding("profile.when-unmet", { part: z.string(), when: z.enum(["orca"]) }),
    /**
     * A plugin part the run did not approve by name; its plugin's hooks, MCP servers and commands run in every session.
     * The marketplace's repository (`owner/repo` on GitHub) or Git URL, its branch or tag, and whether Claude Code
     * updates it by itself; no source: a marketplace Claude Code already knows.
     */
    finding("profile.approval-needed", {
      part: z.string(),
      plugin: z.string(),
      source: z.string().nullable(),
      ref: z.string().nullable(),
      autoUpdate: z.boolean(),
      /** The project folder of a project's plugin part; null for the machine's. */
      project: z.string().nullable(),
    }),
    finding("profile.options-guarded", { part: z.string(), path: z.string() }),
    /** A files part whose targets run as programs or configure tools waits for approval by name (hub issue 130). */
    finding("profile.target-approval", {
      part: z.string(),
      title: z.string(),
      project: z.string(),
      /** Where the part's code comes from: the gates' `owner/repo@commit`, a dev container's Template and Features. */
      source: z.string().nullable(),
      programs: z.array(z.string()),
      configs: z.array(z.string()),
    }),
    /**
     * An MCP part waits for approval by name: what it runs (a command line) or connects to (a URL), the variables it
     * gets by name, each entry the plan would add or put in place of the one CedarLoom wrote before with its file's own
     * text, whether the project has `.codex/`, and whether an npm or PyPI package runs without a version, the newest
     * release at each start.
     */
    finding("profile.mcp-approval", {
      part: z.string(),
      title: z.string(),
      project: z.string(),
      server: z.string(),
      transport: z.enum(["stdio", "http"]),
      runs: z.string(),
      variables: z.array(z.string()),
      entries: z.array(z.strictObject({ file: z.string(), change: z.enum(["add", "replace"]), entry: z.string() })),
      codex: z.boolean(),
      unpinned: z.boolean(),
      /** The package whose local install runs, for a devDependency source, which the line names in place of `runs`. */
      installed: z.string().nullable(),
    }),
    /**
     * An MCP server entry the plan adds to a file, puts in place of the one CedarLoom wrote, or takes out as its part is
     * switched off, in the file's own text.
     */
    finding("profile.mcp-entry", {
      part: z.string(),
      server: z.string(),
      change: z.enum(["add", "replace", "remove"]),
      file: z.string(),
      entry: z.string(),
    }),
    /**
     * A file holds the server's name with an entry CedarLoom did not write, or changed since, or its servers in a form
     * the plan cannot change alone, so the plan writes that server to no file.
     */
    finding("profile.mcp-conflict", { part: z.string(), server: z.string(), file: z.string() }),
    /**
     * A switched-off part's MCP server entry stays, as it changed since CedarLoom wrote it or sits in a form the plan
     * cannot take out alone; CedarLoom leaves it to the owner from then on.
     */
    finding("profile.mcp-kept", { part: z.string(), server: z.string(), file: z.string() }),
    /**
     * An MCP part runs a package from the project's install, which package.json does not list as a devDependency at an
     * exact version.
     */
    finding("profile.mcp-dependency", { part: z.string(), package: z.string() }),
    /** An MCP part runs a package from the project's install, which the walk up finds only inside a Git repository. */
    finding("profile.mcp-outside-git", { part: z.string(), package: z.string() }),
    /** The project folder is the user's home, whose `.claude/` and `.codex/` files are the tools' user config. */
    finding("profile.project-is-home", { project: z.string() }),
    /** The Dev Containers CLI did not apply a part's Template, which then writes nothing. */
    finding("profile.template-failed", { part: z.string(), template: z.string(), error: z.string() }),
    /** A target two parts write, such as the Dependabot file of two gates parts: the later part and the target. */
    finding("profile.target-twice", { part: z.string(), target: z.string() }),
    /** Two skills of one name, which would install into one folder: the folder, and each skill's pack entry or repository. */
    finding("profile.skill-twice", { folder: z.string(), skills: z.array(z.string()) }),
    /** A skill whose files hold `.claude-plugin/`, so Claude Code would load it as a plugin: the skill and the file. */
    finding("profile.skill-plugin", { skill: z.string(), path: z.string() }),
    /** A files part's target that a link leads outside the project, into its Git folder or onto a sealed file. */
    finding("profile.target-linked", { part: z.string(), target: z.string(), path: z.string() }),
    /** The owner's CLAUDE.md does not import AGENTS.md, and no CLAUDE.local.md block does, so the manual goes unread. */
    finding("profile.agents-unread", { path: z.string() }),
    /** A Git source that follows a branch or tag holds a file that may run (anything but .md and .txt at mode 100644). */
    finding("profile.pack-unpinned", { source: z.string(), path: z.string() }),
    finding("profile.source-digest", { source: z.string(), expected: z.string(), found: z.string() }),
    /** A new commit at a followed ref, taken once this machine has seen it there for 3 days. */
    finding("profile.source-waiting", { source: z.string(), commit: z.string(), offered: z.string() }),
    /** The commit in use of a followed source, which its new commit waits to replace, can no longer be fetched. */
    finding("profile.source-unavailable", { source: z.string(), commit: z.string() }),
    finding("git.too-large", {
      path: z.string().nullable(),
      found: z.int(),
      limit: z.int(),
      unit: z.enum(["files", "bytes"]),
    }),
    /** An outbox intent whose approval names another intent: nothing is queued. */
    finding("outbox.not-approved", { key: z.string(), hash: Sha256, approvedHash: z.string() }),
    finding("outbox.not-found", { id: z.string() }),
    /** A key that holds another intent already, entry `id`: nothing is queued. */
    finding("outbox.key-taken", { key: z.string(), id: z.string() }),
    /** An entry for another repository than the hub, the only tracker (A3 b): it fails, and nothing is written. */
    finding("outbox.not-hub", { id: z.string(), repo: z.string() }),
    /** The entry's status does not allow the step, such as a send of one that ended, or `sending`: another process sends it. */
    finding("outbox.status", { id: z.string(), status: z.string() }),
    /** A sent entry with nothing to undo: it changed nothing on the issue, or it deleted a comment, which stays deleted. */
    finding("outbox.not-undoable", { id: z.string(), reason: z.enum(["unchanged", "no-inverse"]) }),
    /**
     * The tracker was not reached, or answered with a server error or a rate limit: the entry stays queued. A rate
     * limit keeps GitHub's retry-after (seconds) and x-ratelimit-reset (epoch seconds) as sent, null without them.
     */
    finding("tracker.unavailable", {
      error: z.string(),
      retryAfter: z.string().nullable(),
      rateLimitReset: z.string().nullable(),
    }),
    /** The tracker refused the write with an HTTP status, such as an issue that is gone or a token without the permission. */
    finding("tracker.refused", { status: z.int(), error: z.string() }),
    /** An answer CedarLoom cannot read: the entry fails, as a retry reads the same; the write may have happened. */
    finding("tracker.invalid-answer", { error: z.string() }),
    /** A managed Claude Code policy switches hooks (the guard's among them) or the sandbox off for every session. */
    finding("managed.guard-off", { path: z.string(), key: z.string() }),
    /** A managed Claude Code policy that cannot be read, so the doctor cannot tell what it switches off. */
    finding("managed.unreadable", { path: z.string(), error: z.string() }),
    /** This machine binds no hub, the only tracker, so no work-item command can name an issue. */
    finding("work-items.no-hub", {}),
    /** An issue outside this machine's hub (A3 b): nothing is queued or linked. */
    finding("work-items.not-hub", { repo: z.string(), hub: z.string() }),
    /** A project whose origin remote names no GitHub repository, or two, so its hub label has no name: nothing is queued. */
    finding("work-items.no-project-name", { project: z.string() }),
    /** Nothing is stored under the name in the OS credential store (service `cedarloom`). */
    finding("secret.missing", { name: z.string() }),
    /** The OS credential store could not be reached, such as a locked keychain or no Secret Service on Linux. */
    finding("secret.unavailable", { name: z.string(), error: z.string() }),
    /** A token that is not a fine-grained GitHub token: a classic one reaches every repository of its user (H2). */
    finding("secret.not-fine-grained", { name: z.string() }),
    /** A token is read from standard input only when it is piped in: typed at a terminal, it would show. */
    finding("secret.no-input", { name: z.string() }),
  ])
  .register(contracts, { id: "Finding" });
export type Finding = z.infer<typeof Finding>;
export type FindingCode = Finding["code"];

interface FindingInfo {
  severity: "error" | "warning" | "info";
  /** `command`: a CedarLoom command fixes it; `manual`: the user acts. */
  effort: "command" | "manual";
}

export const findingInfo: Record<FindingCode, FindingInfo> = {
  "document.unreadable": { severity: "error", effort: "manual" },
  "document.newer-schema": { severity: "error", effort: "manual" },
  "document.invalid": { severity: "error", effort: "manual" },
  "plan.not-approved": { severity: "error", effort: "command" },
  "plan.path-not-absolute": { severity: "error", effort: "manual" },
  "plan.not-a-file": { severity: "error", effort: "manual" },
  "plan.chain-broken": { severity: "error", effort: "manual" },
  "plan.file-changed": { severity: "error", effort: "command" },
  "apply.symlink": { severity: "error", effort: "manual" },
  "apply.not-text": { severity: "error", effort: "manual" },
  "apply.backup-failed": { severity: "error", effort: "manual" },
  "apply.write-failed": { severity: "error", effort: "command" },
  "apply.write-mismatch": { severity: "error", effort: "command" },
  "run.not-found": { severity: "error", effort: "manual" },
  "run.interrupted": { severity: "warning", effort: "command" },
  "run.failed": { severity: "warning", effort: "command" },
  "run.node-unsupported": { severity: "error", effort: "manual" },
  "undo.file-edited": { severity: "warning", effort: "manual" },
  "undo.backup-missing": { severity: "error", effort: "manual" },
  "undo.backup-changed": { severity: "error", effort: "manual" },
  "store.busy": { severity: "error", effort: "manual" },
  "store.network-filesystem": { severity: "error", effort: "manual" },
  "draft.not-found": { severity: "error", effort: "manual" },
  "import.not-found": { severity: "error", effort: "command" },
  "draft.too-large": { severity: "error", effort: "manual" },
  "store.newer-schema": { severity: "error", effort: "manual" },
  "store.older-schema": { severity: "error", effort: "manual" },
  "workflow.duplicate-id": { severity: "error", effort: "manual" },
  "workflow.trigger-count": { severity: "error", effort: "manual" },
  "workflow.unknown-node-type": { severity: "error", effort: "manual" },
  "workflow.invalid-config": { severity: "error", effort: "manual" },
  "workflow.dangling-edge": { severity: "error", effort: "manual" },
  "workflow.unknown-handle": { severity: "error", effort: "manual" },
  "workflow.incompatible-handles": { severity: "error", effort: "manual" },
  "workflow.unchecked-handles": { severity: "warning", effort: "manual" },
  "workflow.many-sources": { severity: "error", effort: "manual" },
  "workflow.missing-source": { severity: "error", effort: "manual" },
  "workflow.cycle": { severity: "error", effort: "manual" },
  "workflow.join-branches": { severity: "error", effort: "manual" },
  "workflow.duplicate-edge": { severity: "error", effort: "manual" },
  "workflow.exclusive-sources": { severity: "warning", effort: "manual" },
  "workflow.optional-input": { severity: "error", effort: "manual" },
  "workflow.schedule-input": { severity: "error", effort: "manual" },
  "workflow.report-only-write": { severity: "error", effort: "manual" },
  "workflow.unreachable": { severity: "warning", effort: "manual" },
  "workflow.stray-entry": { severity: "warning", effort: "manual" },
  "workflow.skill-name": { severity: "error", effort: "manual" },
  "workflow.duplicate-skill": { severity: "error", effort: "manual" },
  "workflow.check-source": { severity: "error", effort: "manual" },
  "workflow.check-output": { severity: "error", effort: "manual" },
  "package.two-stages": { severity: "error", effort: "manual" },
  "package.cross-stage": { severity: "error", effort: "manual" },
  "package.name-taken": { severity: "error", effort: "manual" },
  "package.reserved-name": { severity: "error", effort: "manual" },
  "package.approval-needed": { severity: "warning", effort: "command" },
  "package.hooks-missing": { severity: "error", effort: "command" },
  "package.not-installed": { severity: "error", effort: "manual" },
  "package.plugin-taken": { severity: "error", effort: "manual" },
  "package.levels-mixed": { severity: "warning", effort: "command" },
  "package.codex-missing": { severity: "info", effort: "command" },
  "package.codex-stale": { severity: "warning", effort: "command" },
  "package.codex-left": { severity: "warning", effort: "command" },
  "package.node-missing": { severity: "error", effort: "command" },
  "automation.unknown-folder": { severity: "error", effort: "manual" },
  "extension.refused": { severity: "error", effort: "manual" },
  "extension.failed": { severity: "error", effort: "manual" },
  // Its severity is the extension's: see severityOf.
  "extension.finding": { severity: "warning", effort: "manual" },
  "extension.install-refused": { severity: "error", effort: "manual" },
  "extension.unknown": { severity: "error", effort: "manual" },
  "extension.consent-needed": { severity: "error", effort: "command" },
  "git.failed": { severity: "error", effort: "manual" },
  "store.conflict": { severity: "error", effort: "command" },
  "store.version-not-higher": { severity: "error", effort: "manual" },
  "store.identity-missing": { severity: "error", effort: "manual" },
  "store.moved": { severity: "error", effort: "command" },
  "store.not-found": { severity: "error", effort: "manual" },
  "store.draft-exists": { severity: "error", effort: "manual" },
  "git.refused-source": { severity: "error", effort: "manual" },
  "git.unsafe-entry": { severity: "error", effort: "manual" },
  "git.too-large": { severity: "error", effort: "manual" },
  "profile.foreign-kind": { severity: "error", effort: "manual" },
  "profile.secret-like": { severity: "error", effort: "manual" },
  "profile.forbidden-setting": { severity: "error", effort: "manual" },
  "profile.parent-unknown": { severity: "error", effort: "manual" },
  "profile.parent-cycle": { severity: "error", effort: "manual" },
  "profile.parent-limit": { severity: "error", effort: "manual" },
  "profile.pack-sources": { severity: "error", effort: "manual" },
  "profile.entry-unknown": { severity: "error", effort: "manual" },
  "profile.app-too-old": { severity: "error", effort: "manual" },
  "profile.part-unknown": { severity: "error", effort: "manual" },
  "profile.part-requires": { severity: "error", effort: "command" },
  "profile.owner-changed": { severity: "warning", effort: "manual" },
  "profile.placeholder-unknown": { severity: "error", effort: "manual" },
  "profile.binding-missing": { severity: "error", effort: "command" },
  "profile.binding-waiting": { severity: "info", effort: "command" },
  "profile.when-unmet": { severity: "warning", effort: "command" },
  "profile.drift": { severity: "warning", effort: "command" },
  "profile.remove-unknown": { severity: "error", effort: "manual" },
  "profile.copy-exists": { severity: "error", effort: "manual" },
  "profile.newer-pack": { severity: "warning", effort: "manual" },
  "profile.extra": { severity: "info", effort: "command" },
  "profile.approval-needed": { severity: "warning", effort: "command" },
  "profile.options-guarded": { severity: "error", effort: "manual" },
  "profile.target-approval": { severity: "warning", effort: "command" },
  "profile.mcp-approval": { severity: "warning", effort: "command" },
  "profile.mcp-entry": { severity: "info", effort: "command" },
  "profile.mcp-conflict": { severity: "warning", effort: "manual" },
  "profile.mcp-kept": { severity: "warning", effort: "manual" },
  "profile.mcp-dependency": { severity: "warning", effort: "manual" },
  "profile.mcp-outside-git": { severity: "warning", effort: "manual" },
  "profile.project-is-home": { severity: "error", effort: "manual" },
  "profile.target-linked": { severity: "error", effort: "manual" },
  "profile.skill-twice": { severity: "error", effort: "manual" },
  "profile.template-failed": { severity: "warning", effort: "manual" },
  "profile.target-twice": { severity: "error", effort: "manual" },
  "profile.skill-plugin": { severity: "error", effort: "manual" },
  "profile.agents-unread": { severity: "warning", effort: "manual" },
  "profile.pack-unpinned": { severity: "error", effort: "manual" },
  "profile.source-digest": { severity: "error", effort: "manual" },
  "profile.source-waiting": { severity: "info", effort: "manual" },
  "profile.source-unavailable": { severity: "error", effort: "manual" },
  "outbox.not-approved": { severity: "error", effort: "command" },
  "outbox.not-found": { severity: "error", effort: "manual" },
  "outbox.key-taken": { severity: "error", effort: "manual" },
  "outbox.not-hub": { severity: "error", effort: "manual" },
  "outbox.status": { severity: "error", effort: "manual" },
  "outbox.not-undoable": { severity: "warning", effort: "manual" },
  "tracker.unavailable": { severity: "warning", effort: "command" },
  "tracker.refused": { severity: "error", effort: "manual" },
  "tracker.invalid-answer": { severity: "error", effort: "manual" },
  "managed.guard-off": { severity: "warning", effort: "manual" },
  "managed.unreadable": { severity: "warning", effort: "manual" },
  "work-items.no-hub": { severity: "error", effort: "command" },
  "work-items.not-hub": { severity: "error", effort: "manual" },
  "work-items.no-project-name": { severity: "error", effort: "manual" },
  "secret.missing": { severity: "error", effort: "command" },
  "secret.unavailable": { severity: "error", effort: "manual" },
  "secret.not-fine-grained": { severity: "error", effort: "manual" },
  "secret.no-input": { severity: "error", effort: "command" },
};

/** A finding's severity: an extension's own finding carries its own, every other code has one. */
export const severityOf = (found: Finding): FindingInfo["severity"] =>
  found.code === "extension.finding" ? found.params.severity : findingInfo[found.code].severity;
