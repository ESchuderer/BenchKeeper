import { z } from "zod";
import { Sha256 } from "./plan.ts";
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
    // Another runner holds the graph run's lease, until the given time unless it renews it.
    finding("run.lease-held", { runId: z.string(), pid: z.int() }),
    finding("run.finished", { runId: z.string(), status: z.string() }),
    // A report run writes nothing (A28): the ledger records no apply run under it, whatever the executor does.
    finding("run.report-only-apply", { runId: z.string(), applyRun: z.string() }),
    finding("undo.file-edited", { runId: z.string(), path: z.string() }),
    finding("undo.backup-missing", { runId: z.string(), path: z.string() }),
    finding("undo.backup-changed", { runId: z.string(), path: z.string() }),
    finding("store.busy", { dir: z.string() }),
    finding("store.network-filesystem", { dir: z.string(), fsType: z.string() }),
    finding("draft.not-found", { id: z.string() }),
    finding("draft.too-large", { id: z.string(), bytes: z.int(), limit: z.int() }),
    finding("store.newer-schema", { found: z.int(), known: z.int() }),
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
    // A plugin action under a schedule: it may write through the host or change other systems (pending owner decision).
    finding("workflow.report-only-plugin", { node: z.string() }),
    // A node of a plugin action that is not installed here: the workflow can be kept and shared, not run.
    finding("workflow.plugin-missing", { node: z.string(), type: z.string() }),
    finding("workflow.unreachable", { node: z.string() }),
    finding("workflow.stray-entry", { section: z.enum(["execution", "layout"]), node: z.string() }),
    finding("accounts.registry-exists", { path: z.string() }),
    finding("accounts.unknown-pool", { agent: z.string(), pool: z.string() }),
    // A40: Codex switching stays off until the owner has read OpenAI's terms, so no Codex pool can be confirmed.
    finding("accounts.codex-switching-off", { pool: z.string() }),
    // The terms a pool's confirmation answers to; it goes with every confirmation, in every output form.
    finding("accounts.pool-terms", { pool: z.string() }),
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
    // A managed settings file the launcher cannot read or parse, so it cannot clear it.
    finding("launch.managed-settings-unreadable", { path: z.string(), error: z.string() }),
    // Git could not start, fetch, list or read; `error` is the end of its message. Never the URL: it may hold a token.
    finding("git.failed", { step: z.enum(["start", "fetch", "list", "read"]), error: z.string() }),
    // A source that never reaches git: a URL or ref with a character a shell, terminal or helper reads, or a password.
    finding("git.refused-source", { field: z.enum(["url", "ref", "path"]) }),
    finding("git.unsafe-entry", { path: z.string(), kind: z.enum(["link", "submodule", "name", "case"]) }),
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
  "undo.file-edited": { severity: "warning", effort: "manual" },
  "undo.backup-missing": { severity: "error", effort: "manual" },
  "undo.backup-changed": { severity: "error", effort: "manual" },
  "store.busy": { severity: "error", effort: "manual" },
  "store.network-filesystem": { severity: "error", effort: "manual" },
  "draft.not-found": { severity: "error", effort: "manual" },
  "draft.too-large": { severity: "error", effort: "manual" },
  "store.newer-schema": { severity: "error", effort: "manual" },
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
  "workflow.report-only-plugin": { severity: "error", effort: "manual" },
  "workflow.plugin-missing": { severity: "error", effort: "manual" },
  "workflow.unreachable": { severity: "warning", effort: "manual" },
  "workflow.stray-entry": { severity: "warning", effort: "manual" },
  "accounts.registry-exists": { severity: "error", effort: "manual" },
  "accounts.unknown-pool": { severity: "error", effort: "manual" },
  "accounts.codex-switching-off": { severity: "error", effort: "manual" },
  "accounts.pool-terms": { severity: "warning", effort: "manual" },
  "automation.unknown-folder": { severity: "error", effort: "manual" },
  "launch.agent-unavailable": { severity: "error", effort: "manual" },
  "launch.settings-unproven": { severity: "error", effort: "manual" },
  "launch.account-full": { severity: "warning", effort: "manual" },
  "launch.gh-login": { severity: "error", effort: "manual" },
  "launch.sandbox-overridden": { severity: "error", effort: "manual" },
  "launch.managed-settings-unreadable": { severity: "error", effort: "manual" },
  "git.failed": { severity: "error", effort: "manual" },
  "git.refused-source": { severity: "error", effort: "manual" },
  "git.unsafe-entry": { severity: "error", effort: "manual" },
  "git.too-large": { severity: "error", effort: "manual" },
};
