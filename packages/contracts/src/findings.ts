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
    finding("workflow.unreachable", { node: z.string() }),
    finding("workflow.stray-entry", { section: z.enum(["execution", "layout"]), node: z.string() }),
    finding("accounts.registry-exists", { path: z.string() }),
    finding("accounts.unknown-pool", { agent: z.string(), pool: z.string() }),
    // A40: Codex switching stays off until the owner has read OpenAI's terms, so no Codex pool can be confirmed.
    finding("accounts.codex-switching-off", { pool: z.string() }),
    // The terms a pool's confirmation answers to; it goes with every confirmation, in every output form.
    finding("accounts.pool-terms", { pool: z.string() }),
    // gh found a token without GH_TOKEN (error null), or the check could not tell: either way the launch is refused.
    finding("launch.gh-login", { error: z.string().nullable() }),
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
  "workflow.unreachable": { severity: "warning", effort: "manual" },
  "workflow.stray-entry": { severity: "warning", effort: "manual" },
  "accounts.registry-exists": { severity: "error", effort: "manual" },
  "accounts.unknown-pool": { severity: "error", effort: "manual" },
  "accounts.codex-switching-off": { severity: "error", effort: "manual" },
  "accounts.pool-terms": { severity: "warning", effort: "manual" },
  "launch.gh-login": { severity: "error", effort: "manual" },
};
