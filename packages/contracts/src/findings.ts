import { z } from "zod";
import { GitOid, Sha256 } from "./plan.ts";
import { contracts, SchemaVersion } from "./registry.ts";
import { HandleType } from "./workflow.ts";

const finding = <const C extends string, const P extends z.ZodRawShape>(code: C, params: P) =>
  z.strictObject({ code: z.literal(code), params: z.strictObject(params) });

// Where a document breaks its schema: the path and zod's issue code of each problem, no prose.
const issues = z.array(z.strictObject({ path: z.string(), code: z.string() }));

/** A result of a check: a code and typed parameters; the text for people comes from the message catalog. */
export const Finding = z
  .discriminatedUnion("code", [
    finding("document.unreadable", { path: z.string(), error: z.string() }),
    finding("document.newer-schema", { found: SchemaVersion, known: SchemaVersion }),
    finding("document.invalid", { issues }),
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
    finding("run.input-unknown", { input: z.string() }),
    finding("run.input-missing", { input: z.string() }),
    finding("run.input-invalid", { input: z.string(), type: z.enum(["string", "number", "boolean", "json"]) }),
    // A stored event of a graph run that its schema refuses: the run is not replayed from a log it cannot trust.
    finding("run.event-invalid", { runId: z.string(), seq: z.int(), issues }),
    // Another runner's process `pid` holds the graph run's lease until it ends, or took the run over.
    finding("run.lease-held", { runId: z.string(), pid: z.int() }),
    finding("run.finished", { runId: z.string(), status: z.string() }),
    // A report run writes nothing (A28): the ledger records no apply run under it, whatever the executor does.
    finding("run.report-only-apply", { runId: z.string(), applyRun: z.string() }),
    // A node type this CedarLoom does not run yet (in 0.1.0: trigger.schedule, workflow.run); nothing of the run starts.
    finding("run.node-unsupported", { node: z.string(), type: z.string() }),
    // No POSIX sh for the run's commands (on Windows, Git for Windows' sh.exe).
    finding("run.shell-missing", {}),
    // A resume or cancel named another project folder than the run's own; its commands run only there.
    finding("run.project-mismatch", { runId: z.string(), project: z.string(), given: z.string() }),
    // The project folder of a run, or of a resume, is not there: its commands would fail, so nothing starts.
    finding("run.project-missing", { project: z.string() }),
    finding("undo.file-edited", { runId: z.string(), path: z.string() }),
    finding("undo.backup-missing", { runId: z.string(), path: z.string() }),
    finding("undo.backup-changed", { runId: z.string(), path: z.string() }),
    finding("store.busy", { dir: z.string() }),
    finding("store.network-filesystem", { dir: z.string(), fsType: z.string() }),
    finding("draft.not-found", { id: z.string() }),
    finding("draft.too-large", { id: z.string(), bytes: z.int(), limit: z.int() }),
    finding("store.newer-schema", { found: z.int(), known: z.int() }),
    // A run store from before 0.1.0, which is not carried over (pre-release only).
    finding("store.older-schema", { dir: z.string(), found: z.int(), known: z.int() }),
    // Graph findings of a workflow; `node: null` names one of the workflow's own outputs.
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
    // An extension action under a schedule: it may write through the host or change other systems (P9 b).
    finding("workflow.report-only-extension", { node: z.string() }),
    // A node of an extension action that is not installed here: the workflow can be kept and shared, not run.
    finding("workflow.extension-missing", { node: z.string(), type: z.string() }),
    finding("workflow.unreachable", { node: z.string() }),
    finding("workflow.stray-entry", { section: z.enum(["execution", "layout"]), node: z.string() }),
    finding("accounts.unknown-pool", { agent: z.string(), pool: z.string() }),
    // A40: Codex switching stays off until the owner has read OpenAI's terms, so no Codex pool can be confirmed.
    finding("accounts.codex-switching-off", { pool: z.string() }),
    // The terms a pool's confirmation answers to; it goes with every confirmation, in every output form.
    finding("accounts.pool-terms", { pool: z.string() }),
    finding("accounts.unknown-account", { account: z.string() }),
    finding("accounts.name-taken", { account: z.string() }),
    // An account or pool name the registry's rule refuses.
    finding("accounts.name-invalid", { name: z.string() }),
    // Own homes and their login are Claude Code's only, until a Codex adapter starts workers.
    finding("accounts.login-unsupported", { account: z.string(), agent: z.string() }),
    // The own home of the account is a folder another account names: it is not taken over.
    finding("accounts.folder-taken", { path: z.string() }),
    // Workers run, and logins happen, only in the account's own home, so nothing is written into another tool's.
    finding("accounts.home-not-own", { account: z.string(), home: z.string() }),
    // The own home, or the homes folder above it, is a link: what is written there would land in another folder.
    finding("accounts.home-linked", { account: z.string(), path: z.string() }),
    // The own home does not exist yet: only the login makes it, so nothing runs on the account logged out.
    finding("accounts.home-missing", { account: z.string(), home: z.string() }),
    // The own home or the homes folder could not be made or closed to the owner (error: the file system's).
    finding("accounts.home-unusable", { account: z.string(), path: z.string(), error: z.string() }),
    // The agent's login ended with an error or did not start.
    finding("accounts.login-failed", { account: z.string(), error: z.string() }),
    // The doctor's check of each own home's login (`claude auth status`), never beside a worker on that account.
    finding("doctor.logged-out", { account: z.string(), home: z.string() }),
    finding("doctor.login-elsewhere", { account: z.string(), home: z.string(), configDirectory: z.string() }),
    finding("doctor.login-method", { account: z.string(), method: z.string() }),
    finding("doctor.login-unchecked", { account: z.string(), error: z.string() }),
    finding("doctor.login-skipped", { account: z.string() }),
    // A project's level is set for a folder that exists, by its real path.
    finding("automation.unknown-folder", { path: z.string() }),
    // The agent CLI could not tell its version or run its contract check, so no worker of it starts.
    finding("launch.agent-unavailable", { agent: z.string(), error: z.string() }),
    // The CLI version's contract check shows no proof that it applied the worker settings: no worker starts unsandboxed.
    finding("launch.settings-unproven", { agent: z.string(), version: z.string() }),
    // Every lease of the account is taken: the most workers it runs at once.
    finding("launch.account-full", { account: z.string(), max: z.int() }),
    // gh found a token without GH_TOKEN (error null), or the check could not tell: either way the launch is refused.
    finding("launch.gh-login", { error: z.string().nullable() }),
    // A managed settings file loosens the worker sandbox: a managed key outranks the worker's settings.
    finding("launch.sandbox-overridden", { path: z.string(), key: z.string() }),
    // The agent's own login check shows no login in the account's home, so its CLI version is not probed (reason: why).
    finding("launch.not-logged-in", { account: z.string(), reason: z.string() }),
    // The latest run's init line: no workflow plugin went with it, as the pinned marketplace commit has none (info).
    finding("doctor.plugin-none", { plugin: z.string(), commit: z.string() }),
    // The latest run's init line: a plugin it passed did not load with its skills (errors: the plugins' load errors).
    finding("doctor.plugin-not-loaded", { plugin: z.string(), errors: z.string() }),
    // A managed settings file the launcher cannot read or parse, so it cannot clear it.
    finding("launch.managed-settings-unreadable", { path: z.string(), error: z.string() }),
    // Git could not start, fetch, list, read or add a worktree; `error` is the end of its message. Never the URL: it may
    // hold a token.
    finding("git.failed", {
      step: z.enum(["start", "fetch", "list", "read", "worktree", "commit", "update"]),
      error: z.string(),
    }),
    // The workflow store (P3 a). A draft opened from another stored version than the one there now (an import changed
    // it meanwhile): saved only on top of it, never merged.
    finding("store.conflict", { id: z.string() }),
    // A saved version must be above the stored one (semver precedence).
    finding("store.version-not-higher", { id: z.string(), stored: z.string(), found: z.string() }),
    // Store commits carry the user's Git identity, which their configuration lacks.
    finding("store.identity-missing", { key: z.enum(["user.name", "user.email"]) }),
    // The branch moved since the plan was made: the apply moves nothing.
    finding("store.moved", { ref: z.string(), expected: GitOid.nullable(), actual: GitOid.nullable() }),
    finding("store.not-found", { id: z.string(), commit: z.string().nullable() }),
    // Opening a stored version as a draft never replaces a draft.
    finding("store.draft-exists", { id: z.string() }),
    // A source that never reaches git: a URL or ref with a character a shell, terminal or helper reads, or a password.
    finding("git.refused-source", { field: z.enum(["url", "ref", "path"]) }),
    finding("git.unsafe-entry", { path: z.string(), kind: z.enum(["link", "submodule", "name", "case"]) }),
    // An extension its trust level may not run here (P1 a, A31) or this Node (before 25), whose folder could widen its
    // grant, or that speaks another protocol or serves other actions than its manifest names; it is stopped at once.
    finding("extension.refused", {
      extension: z.string(),
      reason: z.enum(["sandbox-unavailable", "windows", "protocol", "actions", "folder", "runtime"]),
    }),
    // An extension that is not installed or updated: no manifest at its folder's root, no entry file, another protocol
    // than this CedarLoom speaks, one installed already, or an update whose folder now holds another extension. Its id
    // when the manifest names it.
    finding("extension.install-refused", {
      extension: z.string().nullable(),
      reason: z.enum(["no-manifest", "entry", "protocol", "installed", "id"]),
    }),
    // An extension to update or remove that is not installed.
    finding("extension.unknown", { extension: z.string() }),
    // An update that asks for capabilities the user has not approved: only an approval of its exact plan applies it.
    finding("extension.consent-needed", { extension: z.string() }),
    // An extension that could not start, answer its handshake, or run an action; `error` says why, shown safely.
    finding("extension.failed", {
      extension: z.string(),
      step: z.enum(["stage", "start", "initialize", "run"]),
      error: z.string(),
    }),
    // A file of another kind where a profile belongs: BenchKeeper's profiles and presets are never imported (D33).
    finding("profile.foreign-kind", { kind: z.string() }),
    // Where a profile holds a token-shaped value or an environment name for a credential; the value is never shown.
    finding("profile.secret-like", { path: z.string() }),
    finding("profile.forbidden-setting", { path: z.string() }),
    finding("profile.parent-unknown", { pack: z.string(), path: z.string() }),
    finding("profile.parent-cycle", { chain: z.array(z.string()) }),
    finding("profile.parent-limit", { chain: z.array(z.string()), limit: z.int() }),
    // One pack id with two sources in one composition: the files that name each.
    finding("profile.pack-sources", { pack: z.string(), files: z.array(z.string()) }),
    finding("profile.entry-unknown", {
      pack: z.string(),
      path: z.string(),
      kind: z.enum(["rules", "template", "profile"]),
    }),
    finding("profile.app-too-old", { minApp: z.string(), app: z.string() }),
    // A part the selection or a `requires` names that the profile does not hold, both as `level.id`.
    finding("profile.part-unknown", { part: z.string(), by: z.string() }),
    finding("profile.part-requires", { part: z.string(), requires: z.string() }),
    // A file the owner changed or made since CedarLoom last wrote it: the plan leaves it as it is.
    finding("profile.owner-changed", { path: z.string() }),
    // A `{{name}}` left in a text, at the text's JSON Pointer in the composed profile.
    finding("profile.placeholder-unknown", { at: z.string(), placeholder: z.string() }),
    finding("profile.binding-missing", { part: z.string(), binding: z.enum(["hub"]) }),
    finding("git.too-large", {
      path: z.string().nullable(),
      found: z.int(),
      limit: z.int(),
      unit: z.enum(["files", "bytes"]),
    }),
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
  "run.input-unknown": { severity: "error", effort: "command" },
  "run.input-missing": { severity: "error", effort: "command" },
  "run.input-invalid": { severity: "error", effort: "command" },
  "run.event-invalid": { severity: "error", effort: "manual" },
  "run.lease-held": { severity: "error", effort: "manual" },
  "run.finished": { severity: "error", effort: "manual" },
  "run.report-only-apply": { severity: "error", effort: "manual" },
  "run.node-unsupported": { severity: "error", effort: "manual" },
  "run.shell-missing": { severity: "error", effort: "manual" },
  "run.project-mismatch": { severity: "error", effort: "manual" },
  "run.project-missing": { severity: "error", effort: "manual" },
  "undo.file-edited": { severity: "warning", effort: "manual" },
  "undo.backup-missing": { severity: "error", effort: "manual" },
  "undo.backup-changed": { severity: "error", effort: "manual" },
  "store.busy": { severity: "error", effort: "manual" },
  "store.network-filesystem": { severity: "error", effort: "manual" },
  "draft.not-found": { severity: "error", effort: "manual" },
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
  "workflow.report-only-extension": { severity: "error", effort: "manual" },
  "workflow.extension-missing": { severity: "error", effort: "manual" },
  "workflow.unreachable": { severity: "warning", effort: "manual" },
  "workflow.stray-entry": { severity: "warning", effort: "manual" },
  "accounts.unknown-pool": { severity: "error", effort: "manual" },
  "accounts.codex-switching-off": { severity: "error", effort: "manual" },
  "accounts.pool-terms": { severity: "warning", effort: "manual" },
  "accounts.unknown-account": { severity: "error", effort: "manual" },
  "accounts.name-taken": { severity: "error", effort: "manual" },
  "accounts.name-invalid": { severity: "error", effort: "manual" },
  "accounts.login-unsupported": { severity: "error", effort: "manual" },
  "accounts.folder-taken": { severity: "error", effort: "manual" },
  "accounts.home-not-own": { severity: "error", effort: "manual" },
  "accounts.home-linked": { severity: "error", effort: "manual" },
  "accounts.home-missing": { severity: "error", effort: "manual" },
  "accounts.home-unusable": { severity: "error", effort: "manual" },
  "accounts.login-failed": { severity: "error", effort: "manual" },
  "doctor.logged-out": { severity: "error", effort: "manual" },
  "doctor.login-elsewhere": { severity: "error", effort: "manual" },
  "doctor.login-method": { severity: "warning", effort: "manual" },
  "doctor.login-unchecked": { severity: "warning", effort: "manual" },
  "doctor.login-skipped": { severity: "info", effort: "manual" },
  "automation.unknown-folder": { severity: "error", effort: "manual" },
  "launch.agent-unavailable": { severity: "error", effort: "manual" },
  "launch.settings-unproven": { severity: "error", effort: "manual" },
  "launch.account-full": { severity: "warning", effort: "manual" },
  "launch.gh-login": { severity: "error", effort: "manual" },
  "launch.sandbox-overridden": { severity: "error", effort: "manual" },
  "launch.managed-settings-unreadable": { severity: "error", effort: "manual" },
  "launch.not-logged-in": { severity: "error", effort: "manual" },
  "doctor.plugin-none": { severity: "info", effort: "manual" },
  "doctor.plugin-not-loaded": { severity: "error", effort: "manual" },
  "extension.refused": { severity: "error", effort: "manual" },
  "extension.failed": { severity: "error", effort: "manual" },
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
};
